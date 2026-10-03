import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import {
    agentId as agentRunningInside,
    agentDatabaseRun,
    type AgentBaseInference,
    type AgentBaseTurn,
    type AgentModule,
    type AgentModuleAgentLifecycle,
    type AgentModuleAction,
    type AgentModuleHooks,
    type AgentModuleScope,
    type AgentModuleSystemScope,
    type AgentSystemRef,
    type AnyAgentTool,
} from "@slopus/happy-agent-base";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { afterCommit, type Context } from "@steve.kite/stdlib";

import {
    goalEventListenerSchema,
    goalEventSchema,
    type GoalEvent,
    type GoalEventListener,
    type GoalUnsubscribe,
} from "./GoalEvent.js";
import { AGENT_MESSAGE_ORIGIN_METADATA, senderAgentIdMetadata } from "../impl/messageOrigin.js";
import { createGoalContinuationPrompt } from "./impl/createGoalContinuationPrompt.js";
import {
    clearGoal as clearStoredGoal,
    GOAL_CONTINUATION_ID_KEY,
    GOAL_FAILURE_COUNT_KEY,
    GOAL_LAST_INFERENCE_KEY,
    GOAL_LIFECYCLE_KEY,
    GOAL_OBSERVED_LIFECYCLE_ID_KEY,
    readGoal,
    readGoalAuthoritativeState,
    writeGoal,
    writeGoalLifecycle,
} from "./impl/goalState.js";
import { goalKV } from "./impl/goalKV.js";
import { normalizeGoalObjective } from "./impl/normalizeGoalObjective.js";
import {
    FAILED_TURNS_BEFORE_BLOCKED,
    goalAgentIdSchema,
    goalMessageIdSchema,
    goalOperationIdSchema,
    goalStatusSchema,
    goalTimestampSchema,
    type GoalStatus,
    type SessionGoal,
} from "./SessionGoal.js";
import { createGoalTool } from "./tools/create_goal.js";
import { clearGoalTool } from "./tools/clear_goal.js";
import { getGoalTool } from "./tools/get_goal.js";
import { updateGoalTool } from "./tools/update_goal.js";

export { FAILED_TURNS_BEFORE_BLOCKED } from "./SessionGoal.js";

const goalInferenceSchema = Type.Object(
    {
        state: Type.Optional(
            Type.Union([
                Type.Literal("cancelled"),
                Type.Literal("normal"),
                Type.Literal("tool_call"),
                Type.Literal("length"),
                Type.Literal("error"),
            ]),
        ),
    },
    { additionalProperties: false },
);
/** The character budget every model-facing goal result is trimmed to fit. */
export const GOAL_OUTPUT_CHARACTERS = 12_000;

interface GoalActivation {
    readonly goal: SessionGoal;
    readonly lifecycleId: string;
}

/**
 * Shared persistent goal state plus the hooks that keep an active goal moving.
 *
 * Goal owns only current domain state. Durable tool settlement belongs to Agent Base and is
 * committed with each transactional tool; Goal keeps no replay ledger.
 */
export class GoalModule implements AgentModule {
    readonly name = "goal";
    readonly migrations = [
        [
            "001-goal-state",
            async (ctx: Context): Promise<void> => {
                await agentDatabaseRun(
                    ctx.db,
                    sql`CREATE TABLE IF NOT EXISTS happy_agent_goal_state (
                        agent_id TEXT NOT NULL,
                        state_key TEXT NOT NULL,
                        value_json TEXT NOT NULL,
                        PRIMARY KEY (agent_id, state_key)
                    )`,
                );
            },
        ],
    ] as const;

    /** Subscribers taken after construction, inside and after the committing transaction. */
    readonly #transactionalListeners = new Set<GoalEventListener>();
    readonly #postCommitListeners = new Set<GoalEventListener>();

    readonly #mutations = new Map<string, Promise<void>>();
    #agents: AgentSystemRef | undefined;

    /** Subscribe inside the committing transaction; throwing there rolls the mutation back. */
    onEventTransactional(listener: GoalEventListener): GoalUnsubscribe {
        return this.#subscribe(this.#transactionalListeners, listener);
    }

    /** Subscribe after the outer transaction commits; a failure there cannot undo the change. */
    onEvent(listener: GoalEventListener): GoalUnsubscribe {
        return this.#subscribe(this.#postCommitListeners, listener);
    }

    readonly #hooks: AgentModuleHooks = {
        agentArchivedTransact: async (
            ctx: Context,
            _scope: AgentModuleSystemScope,
            agent: AgentModuleAgentLifecycle,
        ): Promise<void> => {
            await this.#pauseActiveGoal(ctx, agent.id);
        },

        tools: (_ctx: Context, scope: AgentModuleScope): readonly AnyAgentTool[] => [
            createGoalTool(
                this,
                scope.agent.id,
                GOAL_OUTPUT_CHARACTERS,
                async (toolCtx, goal, lifecycleId) => {
                    if (agentRunningInside(toolCtx) !== scope.agent.id) return;
                    await scope.runKV.write(toolCtx, GOAL_OBSERVED_LIFECYCLE_ID_KEY, lifecycleId);
                },
            ),
            getGoalTool(this, scope.agent.id, GOAL_OUTPUT_CHARACTERS),
            updateGoalTool(this, scope.agent.id, GOAL_OUTPUT_CHARACTERS),
            clearGoalTool(this, scope.agent.id),
        ],

        afterInferenceTransact: async (
            ctx: Context,
            scope: AgentModuleScope,
            inference: AgentBaseInference,
        ): Promise<void> => {
            const value = inference.state === undefined ? {} : { state: inference.state };
            if (!Value.Check(goalInferenceSchema, value)) {
                throw new Error("Goal inference state is invalid.");
            }
            await scope.runKV.write(ctx, GOAL_LAST_INFERENCE_KEY, value);
        },

        afterTurnTransact: async (
            ctx: Context,
            scope: AgentModuleScope,
            turn: AgentBaseTurn,
        ): Promise<void> => {
            const inference = await scope.runKV.read(ctx, GOAL_LAST_INFERENCE_KEY);
            if (!Value.Check(Type.Union([goalInferenceSchema, Type.Undefined()]), inference)) {
                throw new Error("The stored Goal inference state is invalid.");
            }
            const failed =
                turn.aborted ||
                inference === undefined ||
                inference.state === undefined ||
                inference.state === "cancelled" ||
                inference.state === "error";
            if (!failed) return;
            await this.#pauseActiveGoal(ctx, scope.agent.id);
        },

        beforeAgentLoopTransact: async (ctx: Context, scope: AgentModuleScope): Promise<void> => {
            const state = await readGoalAuthoritativeState(
                ctx,
                goalKV(scope.agent.id),
                scope.agent.id,
            );
            await scope.runKV.delete(ctx, GOAL_CONTINUATION_ID_KEY);
            if (state.goal?.status !== "active") {
                await scope.runKV.delete(ctx, GOAL_OBSERVED_LIFECYCLE_ID_KEY);
            } else {
                const lifecycle = state.lifecycle;
                if (lifecycle === undefined) {
                    throw new Error("An active Goal requires its exact lifecycle sidecar.");
                }
                await scope.runKV.write(ctx, GOAL_OBSERVED_LIFECYCLE_ID_KEY, lifecycle.id);
            }
        },

        afterAgentLoop: (ctx: Context, scope: AgentModuleScope) => this.#afterAgentLoop(ctx, scope),
    };

    readonly beforeStart = (_ctx: Context, agents: AgentSystemRef): AgentModuleHooks => {
        this.#agents = agents;
        return this.#hooks;
    };

    async goal(ctx: Context, agentId: string): Promise<SessionGoal | undefined> {
        this.#assertAgentId(agentId);
        return await readGoal(ctx, goalKV(agentId), agentId);
    }

    async setGoal(ctx: Context, agentId: string, objective: string): Promise<SessionGoal>;
    async setGoal(
        ctx: Context,
        agentId: string,
        objective: string,
        lifecycleId: string,
    ): Promise<GoalActivation>;
    async setGoal(
        ctx: Context,
        agentId: string,
        objective: string,
        lifecycleId?: string,
    ): Promise<SessionGoal | GoalActivation> {
        const activation = await this.#mutate(
            ctx,
            agentId,
            async (txCtx) => await this.#setGoal(txCtx, agentId, objective, lifecycleId),
        );
        return lifecycleId === undefined ? activation.goal : activation;
    }

    async changeGoalStatus(
        ctx: Context,
        agentId: string,
        status: GoalStatus,
    ): Promise<SessionGoal> {
        return await this.#mutate(
            ctx,
            agentId,
            async (txCtx) => await this.#changeGoalStatus(txCtx, agentId, status),
        );
    }

    async clearGoal(ctx: Context, agentId: string): Promise<boolean> {
        return await this.#mutate(
            ctx,
            agentId,
            async (txCtx) => await this.#clearGoal(txCtx, agentId),
        );
    }

    /**
     * Run one public goal mutation for an agent at a time.
     *
     * Each mutation reads the current goal and then writes a decision derived from it, so two
     * overlapping callers would otherwise both read "no goal" and both create one. Queuing them
     * makes the second caller observe the first caller's committed goal, which is what turns a
     * competing objective into a clear rejection and an identical retry into the same goal.
     */
    async #mutate<Result>(
        ctx: Context,
        agentId: string,
        work: (txCtx: Context) => Promise<Result>,
    ): Promise<Result> {
        const previous = this.#mutations.get(agentId) ?? Promise.resolve();
        const run = previous.then(async () => await ctx.inTx(work));
        const settled = run.then(
            () => undefined,
            () => undefined,
        );
        this.#mutations.set(agentId, settled);
        try {
            return await run;
        } finally {
            if (this.#mutations.get(agentId) === settled) this.#mutations.delete(agentId);
        }
    }

    async #afterAgentLoop(
        ctx: Context,
        scope: AgentModuleScope,
    ): Promise<readonly AgentModuleAction[] | undefined> {
        const continuation = await ctx.inTx(async (txCtx) => {
            const kv = goalKV(scope.agent.id);
            const observed = await scope.runKV.read(txCtx, GOAL_OBSERVED_LIFECYCLE_ID_KEY);
            if (observed === undefined) return undefined;
            if (!Value.Check(goalOperationIdSchema, observed)) {
                throw new Error("The observed Goal lifecycle ID is invalid.");
            }
            const state = await readGoalAuthoritativeState(txCtx, kv, scope.agent.id);
            const current = state.goal;
            if (current?.status !== "active" || state.lifecycle?.id !== observed) {
                return undefined;
            }
            const inference = await scope.runKV.read(txCtx, GOAL_LAST_INFERENCE_KEY);
            if (!Value.Check(Type.Union([goalInferenceSchema, Type.Undefined()]), inference)) {
                throw new Error("The stored Goal inference state is invalid.");
            }
            // A cancelled inference is someone stopping the agent, not the goal failing. Stop
            // driving the goal forward without counting it against the failure budget.
            if (inference?.state === "cancelled") return undefined;
            const failed =
                inference === undefined ||
                inference.state === undefined ||
                inference.state === "error";
            if (failed) {
                const failures = (state.failureCount ?? 0) + 1;
                if (failures < FAILED_TURNS_BEFORE_BLOCKED) {
                    await kv.write(txCtx, GOAL_FAILURE_COUNT_KEY, failures);
                    return undefined;
                }
                const blocked: SessionGoal = {
                    ...current,
                    status: "blocked",
                    updatedAt: this.#now(),
                };
                await writeGoal(txCtx, kv, blocked);
                await this.#deactivate(txCtx, kv);
                await this.#publishEvent(
                    txCtx,
                    this.#event({
                        type: "goal_status_changed",
                        agentId: scope.agent.id,
                        goal: blocked,
                    }),
                );
                return undefined;
            }
            await kv.delete(txCtx, GOAL_FAILURE_COUNT_KEY);
            const id = await this.#continuationActionId(txCtx, scope);
            return { id, goal: structuredClone(current) };
        });
        if (continuation === undefined) return undefined;
        return [
            {
                type: "send",
                id: continuation.id,
                message: {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: createGoalContinuationPrompt(continuation.goal),
                        },
                    ],
                },
                // A goal continuation is the agent driving itself, delivered in the user-role input
                // shape only because that is the shape a provider accepts. It carries no human
                // authority, so it is stamped agent-originated: without this an agent that set its
                // own goal objective would manufacture its own trusted permission evidence. The
                // sender stamp names the agent for attribution only and grants nothing.
                metadata: {
                    ...AGENT_MESSAGE_ORIGIN_METADATA,
                    ...senderAgentIdMetadata(scope.agent.id),
                },
            },
        ];
    }

    async #setGoal(
        ctx: Context,
        agentId: string,
        objective: string,
        requestedLifecycleId: string | undefined,
    ): Promise<GoalActivation> {
        this.#assertAgentId(agentId);
        const normalized = normalizeGoalObjective(objective);
        if (
            requestedLifecycleId !== undefined &&
            !Value.Check(goalOperationIdSchema, requestedLifecycleId)
        ) {
            throw new Error("Goal lifecycle ID is invalid.");
        }
        const kv = goalKV(agentId);
        const state = await readGoalAuthoritativeState(ctx, kv, agentId);
        const existing = state.goal;
        if (existing !== undefined && existing.status !== "complete") {
            if (existing.status === "active" && existing.objective === normalized) {
                const lifecycle = state.lifecycle;
                if (lifecycle === undefined) {
                    throw new Error("An active Goal requires its exact lifecycle sidecar.");
                }
                return {
                    goal: structuredClone(existing),
                    lifecycleId: lifecycle.id,
                };
            }
            throw new Error(
                "This agent already has an unfinished goal. Complete or clear it before starting another.",
            );
        }
        const external = agentRunningInside(ctx) !== agentId;
        this.#assertCanActivateExternally(external);
        const lifecycleId = requestedLifecycleId ?? this.#newId();
        const at = this.#now();
        const goal: SessionGoal = {
            createdAt: at,
            objective: normalized,
            status: "active",
            updatedAt: at,
        };
        await writeGoal(ctx, kv, goal);
        await this.#activate(ctx, kv, lifecycleId, goal, external);
        await this.#publishEvent(ctx, this.#event({ type: "goal_set", agentId, goal }));
        await this.#wakeExternalActivation(ctx, agentId, lifecycleId, goal, external);
        return { goal: structuredClone(goal), lifecycleId };
    }

    async #changeGoalStatus(
        ctx: Context,
        agentId: string,
        status: GoalStatus,
    ): Promise<SessionGoal> {
        this.#assertAgentId(agentId);
        this.#assertStatus(status);
        const kv = goalKV(agentId);
        const state = await readGoalAuthoritativeState(ctx, kv, agentId);
        const existing = state.goal;
        if (existing === undefined) throw new Error("This agent does not have a goal.");
        if (existing.status === "complete" && status === "active") {
            throw new Error("A completed goal cannot be resumed. Start a new goal instead.");
        }
        if (existing.status === status) {
            return structuredClone(existing);
        }
        const external = agentRunningInside(ctx) !== agentId;
        if (status === "active") this.#assertCanActivateExternally(external);
        const goal: SessionGoal = {
            ...existing,
            status,
            updatedAt: this.#now(),
        };
        await writeGoal(ctx, kv, goal);
        let lifecycleId: string | undefined;
        if (status === "active") {
            lifecycleId = this.#newId();
            await this.#activate(ctx, kv, lifecycleId, goal, external);
        } else {
            await this.#deactivate(ctx, kv);
        }
        await this.#publishEvent(
            ctx,
            this.#event({
                type: "goal_status_changed",
                agentId,
                goal,
            }),
        );
        if (lifecycleId !== undefined) {
            await this.#wakeExternalActivation(ctx, agentId, lifecycleId, goal, external);
        } else if (external && (status === "paused" || status === "blocked")) {
            this.#abortAgentWork(ctx, agentId);
        }
        return structuredClone(goal);
    }

    async #clearGoal(ctx: Context, agentId: string): Promise<boolean> {
        this.#assertAgentId(agentId);
        const kv = goalKV(agentId);
        const state = await readGoalAuthoritativeState(ctx, kv, agentId);
        const cleared = state.goal !== undefined;
        if (cleared) {
            await clearStoredGoal(ctx, kv);
            await this.#deactivate(ctx, kv);
            await this.#publishEvent(ctx, this.#event({ type: "goal_cleared", agentId }));
            if (agentRunningInside(ctx) !== agentId) this.#abortAgentWork(ctx, agentId);
        }
        return cleared;
    }

    /**
     * Park an active goal when the work behind it ended. Every caller runs after that work already
     * stopped — an archived agent, a failed turn, an interrupted turn — so there is nothing left to
     * abort here.
     */
    async #pauseActiveGoal(ctx: Context, agentId: string): Promise<boolean> {
        this.#assertAgentId(agentId);
        const kv = goalKV(agentId);
        const state = await readGoalAuthoritativeState(ctx, kv, agentId);
        const current = state.goal;
        if (current?.status !== "active") return false;
        const paused: SessionGoal = {
            ...current,
            status: "paused",
            updatedAt: this.#now(),
        };
        await writeGoal(ctx, kv, paused);
        await this.#deactivate(ctx, kv);
        await this.#publishEvent(
            ctx,
            this.#event({
                type: "goal_status_changed",
                agentId,
                goal: paused,
            }),
        );
        return true;
    }

    /**
     * Stop the turn the owning agent is running, after the transition commits.
     *
     * Only a mutation from outside that agent does this. When the agent itself pauses, blocks, or
     * clears its own goal it is doing so from inside its own tool call, and aborting there would
     * cancel the very turn that asked.
     */
    #abortAgentWork(ctx: Context, agentId: string): void {
        const agents = this.#agents;
        if (agents === undefined) return;
        afterCommit(ctx, async (postCommitCtx) => {
            try {
                await agents.abort(postCommitCtx, agentId);
            } catch (error: unknown) {
                postCommitCtx.log.error(
                    { error, agentId },
                    "Goal could not stop the agent after its goal changed.",
                );
            }
        });
    }

    async #activate(
        ctx: Context,
        kv: ReturnType<typeof goalKV>,
        lifecycleId: string,
        goal: SessionGoal,
        external: boolean,
    ): Promise<void> {
        await writeGoalLifecycle(ctx, kv, {
            activation: external ? "external" : "agent",
            id: lifecycleId,
            goal: structuredClone(goal),
        });
        await kv.delete(ctx, GOAL_FAILURE_COUNT_KEY);
    }

    async #deactivate(ctx: Context, kv: ReturnType<typeof goalKV>): Promise<void> {
        await kv.delete(ctx, GOAL_LIFECYCLE_KEY);
        await kv.delete(ctx, GOAL_FAILURE_COUNT_KEY);
    }

    #assertCanActivateExternally(external: boolean): void {
        if (external && this.#agents === undefined) {
            throw new Error(
                "Activating a Goal from outside the owning agent requires the agent system. " +
                    "Add the Goal module to an AgentSystem so its beforeStart hook can capture it.",
            );
        }
    }

    async #wakeExternalActivation(
        ctx: Context,
        agentId: string,
        lifecycleId: string,
        goal: SessionGoal,
        external: boolean,
    ): Promise<void> {
        if (!external) return;
        const agents = this.#agents;
        if (agents === undefined) {
            throw new Error("Goal agent system disappeared during activation.");
        }
        await agents.send(
            ctx,
            agentId,
            {
                role: "user",
                content: [{ type: "text", text: createGoalContinuationPrompt(goal) }],
            },
            {
                id: continuationMessageId(agentId, lifecycleId, goal),
                // The wake wears the user role only because that is the shape a provider accepts.
                // It carries no human authority, so it is stamped agent-originated and attributed
                // to the agent whose goal it pursues.
                metadata: {
                    ...AGENT_MESSAGE_ORIGIN_METADATA,
                    ...senderAgentIdMetadata(agentId),
                },
            },
        );
    }

    #subscribe(listeners: Set<GoalEventListener>, listener: GoalEventListener): GoalUnsubscribe {
        if (!Value.Check(goalEventListenerSchema, listener)) {
            throw new Error("A goal subscriber must be a function.");
        }
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }

    async #publishEvent(ctx: Context, event: GoalEvent): Promise<void> {
        // A snapshot, so subscribing or unsubscribing from inside a subscriber cannot change who
        // this event goes to.
        for (const listener of [...this.#transactionalListeners]) await listener(ctx, event);
        afterCommit(ctx, (postCommitCtx) => this.#notifyPostCommit(postCommitCtx, event));
    }

    #event(
        payload:
            | { readonly type: "goal_set"; readonly agentId: string; readonly goal: SessionGoal }
            | {
                  readonly type: "goal_status_changed";
                  readonly agentId: string;
                  readonly goal: SessionGoal;
              }
            | { readonly type: "goal_cleared"; readonly agentId: string },
    ): GoalEvent {
        const event = { ...payload, eventId: this.#newId(), at: this.#now() } as unknown;
        if (!Value.Check(goalEventSchema, event)) throw new Error("Goal event is invalid.");
        return deepFreeze(structuredClone(event) as GoalEvent);
    }

    #newId(): string {
        const id = globalThis.crypto.randomUUID();
        if (!Value.Check(goalOperationIdSchema, id)) {
            throw new Error("Goal minted an identity it cannot represent.");
        }
        return id;
    }

    #now(): number {
        const now = Date.now();
        if (!Value.Check(goalTimestampSchema, now)) {
            throw new Error("The clock returned a time Goal cannot represent.");
        }
        return now;
    }

    async #notifyPostCommit(ctx: Context, event: GoalEvent): Promise<void> {
        for (const listener of [...this.#postCommitListeners]) {
            try {
                await listener(ctx, event);
            } catch (error: unknown) {
                ctx.log.error(
                    { error, eventId: event.eventId, type: event.type },
                    "A goal subscriber failed after the change was committed.",
                );
            }
        }
    }

    async #continuationActionId(ctx: Context, scope: AgentModuleScope): Promise<string> {
        const existing = await scope.runKV.read(ctx, GOAL_CONTINUATION_ID_KEY);
        if (existing !== undefined) {
            if (!Value.Check(goalMessageIdSchema, existing)) {
                throw new Error("The stored Goal continuation ID is invalid.");
            }
            return existing as string;
        }
        const id = hashMessageId(["goal-continuation", scope.agent.id, this.#newId()]);
        await scope.runKV.write(ctx, GOAL_CONTINUATION_ID_KEY, id);
        return id;
    }

    #assertAgentId(agentId: string): void {
        if (!Value.Check(goalAgentIdSchema, agentId)) throw new Error("Goal agent ID is invalid.");
    }

    #assertStatus(status: string): asserts status is GoalStatus {
        if (!Value.Check(goalStatusSchema, status)) throw new Error("Goal status is invalid.");
    }
}

function continuationMessageId(agentId: string, lifecycleId: string, goal: SessionGoal): string {
    return hashMessageId([
        "goal-external-wake",
        agentId,
        lifecycleId,
        goal.objective,
        goal.createdAt,
    ]);
}

function hashMessageId(parts: readonly (string | number)[]): string {
    const id = `g${createHash("sha256")
        .update(JSON.stringify(parts), "utf8")
        .digest("hex")
        .slice(0, 31)}`;
    if (!Value.Check(goalMessageIdSchema, id)) {
        throw new Error("Goal message identity is invalid.");
    }
    return id;
}

function deepFreeze<T>(value: T): T {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    return Object.freeze(value);
}
