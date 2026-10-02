import { withAgentContext } from "@slopus/happy-agent-base";
import { describe, expect, it } from "vitest";

import { GoalModule } from "../../sources/goal/GoalModule.js";
import {
    GOAL_CONTINUATION_ID_KEY,
    GOAL_FAILURE_COUNT_KEY,
    GOAL_LAST_INFERENCE_KEY,
    GOAL_OBSERVED_LIFECYCLE_ID_KEY,
    readGoalAuthoritativeState,
} from "../../sources/goal/impl/goalState.js";
import { goalKV } from "../../sources/goal/impl/goalKV.js";
import { moduleDatabase } from "../support/moduleDatabase.js";
import { resolveModuleHooks } from "../support/moduleHooks.js";
import { recordingAgents } from "./recordingAgents.js";

function runStore(initial: readonly [string, unknown][] = []) {
    const values = new Map(initial);
    return {
        values,
        runKV: {
            read: async (_ctx: unknown, key: string) => values.get(key),
            write: async (_ctx: unknown, key: string, value: unknown) => {
                values.set(key, structuredClone(value));
            },
            delete: async (_ctx: unknown, key: string) => {
                values.delete(key);
            },
        },
    };
}

function ownerContext(
    database: { context: Parameters<typeof withAgentContext>[0] },
    agentId: string,
) {
    return withAgentContext(database.context, {
        id: agentId,
        provider: "scripted",
        permissionMode: "auto",
    });
}

describe("Goal lifecycle hooks", () => {
    it("clears stale run state before a loop and records the current lifecycle", async () => {
        const module = new GoalModule();
        const database = moduleDatabase(module.migrations, "goal-before-loop-state-test");
        await database.ready;
        const agents = recordingAgents();
        const hooks = await resolveModuleHooks(database.context, module, agents.ref);
        const ctx = ownerContext(database, "agent-a");
        const store = runStore([
            [GOAL_CONTINUATION_ID_KEY, "stale-continuation"],
            [GOAL_OBSERVED_LIFECYCLE_ID_KEY, "stale-lifecycle"],
        ]);
        try {
            await module.setGoal(ctx, "agent-a", "ship it", "lifecycle-a");
            await hooks.beforeAgentLoopTransact!(
                ctx,
                { agent: { id: "agent-a" }, runKV: store.runKV } as never,
                { loopId: "loop-a" },
            );

            expect(store.values.get(GOAL_CONTINUATION_ID_KEY)).toBeUndefined();
            expect(store.values.get(GOAL_OBSERVED_LIFECYCLE_ID_KEY)).toBe("lifecycle-a");

            await module.changeGoalStatus(ctx, "agent-a", "paused");
            store.values.set(GOAL_CONTINUATION_ID_KEY, "stale-continuation");
            store.values.set(GOAL_OBSERVED_LIFECYCLE_ID_KEY, "stale-lifecycle");
            await hooks.beforeAgentLoopTransact!(
                ctx,
                { agent: { id: "agent-a" }, runKV: store.runKV } as never,
                { loopId: "loop-a" },
            );
            expect(store.values.get(GOAL_CONTINUATION_ID_KEY)).toBeUndefined();
            expect(store.values.get(GOAL_OBSERVED_LIFECYCLE_ID_KEY)).toBeUndefined();
        } finally {
            database.close();
        }
    });

    it("returns a repeatable attributed continuation action and resets prior failures", async () => {
        const module = new GoalModule();
        const database = moduleDatabase(module.migrations, "goal-continuation-action-test");
        await database.ready;
        const agents = recordingAgents();
        const hooks = await resolveModuleHooks(database.context, module, agents.ref);
        const ctx = ownerContext(database, "agent-a");
        const store = runStore([
            [GOAL_OBSERVED_LIFECYCLE_ID_KEY, "lifecycle-a"],
            [GOAL_LAST_INFERENCE_KEY, { state: "normal" }],
            [GOAL_FAILURE_COUNT_KEY, 2],
        ]);
        try {
            await module.setGoal(ctx, "agent-a", "ship <it>", "lifecycle-a");
            const scope = { agent: { id: "agent-a" }, runKV: store.runKV } as never;
            const first = await hooks.afterAgentLoop!(ctx, scope, { loopId: "loop-a" });
            const second = await hooks.afterAgentLoop!(ctx, scope, { loopId: "loop-a" });
            const firstAction = first?.[0];
            const secondAction = second?.[0];

            expect(first).toHaveLength(1);
            expect(firstAction?.type).toBe("send");
            expect(secondAction?.type).toBe("send");
            if (firstAction?.type !== "send" || secondAction?.type !== "send") {
                throw new Error("Expected Goal continuation send actions.");
            }
            expect(secondAction.id).toBe(firstAction.id);
            expect(firstAction).toMatchObject({
                type: "send",
                metadata: {
                    messageOrigin: "agent",
                    senderAgentId: "agent-a",
                },
            });
            expect(firstAction.message.content[0]).toMatchObject({
                type: "text",
            });
            expect((firstAction.message.content[0] as { text: string }).text).toContain(
                "ship &lt;it&gt;",
            );
            await expect(
                readGoalAuthoritativeState(ctx, goalKV("agent-a"), "agent-a"),
            ).resolves.toMatchObject({ failureCount: undefined });
        } finally {
            database.close();
        }
    });

    it("blocks after the configured consecutive failure count and interrupts host work", async () => {
        const events: string[] = [];
        const module = new GoalModule();
        module.onEventTransactional((_ctx, event) => {
            events.push(
                `${event.type}:${event.type === "goal_cleared" ? "cleared" : event.goal.status}`,
            );
        });
        const database = moduleDatabase(module.migrations, "goal-failure-block-test");
        await database.ready;
        const agents = recordingAgents();
        const hooks = await resolveModuleHooks(database.context, module, agents.ref);
        const ctx = ownerContext(database, "agent-a");
        const store = runStore([
            [GOAL_OBSERVED_LIFECYCLE_ID_KEY, "lifecycle-a"],
            [GOAL_LAST_INFERENCE_KEY, { state: "error" }],
        ]);
        try {
            await module.setGoal(ctx, "agent-a", "ship it", "lifecycle-a");
            const scope = { agent: { id: "agent-a" }, runKV: store.runKV } as never;

            await expect(
                hooks.afterAgentLoop!(ctx, scope, { loopId: "loop-a" }),
            ).resolves.toBeUndefined();
            await expect(
                readGoalAuthoritativeState(ctx, goalKV("agent-a"), "agent-a"),
            ).resolves.toMatchObject({ failureCount: 1 });
            await expect(
                hooks.afterAgentLoop!(ctx, scope, { loopId: "loop-a" }),
            ).resolves.toBeUndefined();
            await expect(
                readGoalAuthoritativeState(ctx, goalKV("agent-a"), "agent-a"),
            ).resolves.toMatchObject({ failureCount: 2 });
            await expect(
                hooks.afterAgentLoop!(ctx, scope, { loopId: "loop-a" }),
            ).resolves.toBeUndefined();

            await expect(module.goal(database.context, "agent-a")).resolves.toMatchObject({
                status: "blocked",
            });
            expect(events).toEqual(["goal_set:active", "goal_status_changed:blocked"]);
            // Blocking happens inside the agent's own finished loop, so nothing needs stopping.
            expect(agents.aborts).toEqual([]);
        } finally {
            database.close();
        }
    });

    it("does not continue after a cancelled inference", async () => {
        const module = new GoalModule();
        const database = moduleDatabase(module.migrations, "goal-cancelled-continuation-test");
        await database.ready;
        const agents = recordingAgents();
        const hooks = await resolveModuleHooks(database.context, module, agents.ref);
        const ctx = ownerContext(database, "agent-a");
        const store = runStore([
            [GOAL_OBSERVED_LIFECYCLE_ID_KEY, "lifecycle-a"],
            [GOAL_LAST_INFERENCE_KEY, { state: "cancelled" }],
        ]);
        try {
            await module.setGoal(ctx, "agent-a", "ship it", "lifecycle-a");
            await expect(
                hooks.afterAgentLoop!(
                    ctx,
                    { agent: { id: "agent-a" }, runKV: store.runKV } as never,
                    { loopId: "loop-a" },
                ),
            ).resolves.toBeUndefined();
        } finally {
            database.close();
        }
    });

    it("does not continue for stale lifecycle observations and rejects corrupt run state", async () => {
        const module = new GoalModule();
        const database = moduleDatabase(module.migrations, "goal-stale-observation-test");
        await database.ready;
        const agents = recordingAgents();
        const hooks = await resolveModuleHooks(database.context, module, agents.ref);
        const ctx = ownerContext(database, "agent-a");
        const store = runStore([
            [GOAL_OBSERVED_LIFECYCLE_ID_KEY, "stale-lifecycle"],
            [GOAL_LAST_INFERENCE_KEY, { state: "normal" }],
        ]);
        try {
            await module.setGoal(ctx, "agent-a", "ship it", "lifecycle-a");
            const scope = { agent: { id: "agent-a" }, runKV: store.runKV } as never;
            await expect(
                hooks.afterAgentLoop!(ctx, scope, { loopId: "loop-a" }),
            ).resolves.toBeUndefined();

            store.values.set(GOAL_OBSERVED_LIFECYCLE_ID_KEY, "lifecycle-a");
            store.values.set(GOAL_LAST_INFERENCE_KEY, { state: "corrupt" });
            await expect(hooks.afterAgentLoop!(ctx, scope, { loopId: "loop-a" })).rejects.toThrow(
                "stored Goal inference state is invalid",
            );

            store.values.set(GOAL_OBSERVED_LIFECYCLE_ID_KEY, { forged: true });
            await expect(hooks.afterAgentLoop!(ctx, scope, { loopId: "loop-a" })).rejects.toThrow(
                "observed Goal lifecycle ID is invalid",
            );
        } finally {
            database.close();
        }
    });

    it("pauses cancelled, aborted, and missing-inference turns but leaves normal turns active", async () => {
        const module = new GoalModule();
        const database = moduleDatabase(module.migrations, "goal-turn-outcomes-test");
        await database.ready;
        const agents = recordingAgents();
        const hooks = await resolveModuleHooks(database.context, module, agents.ref);
        const ctx = ownerContext(database, "agent-a");
        try {
            const normal = runStore([[GOAL_LAST_INFERENCE_KEY, { state: "normal" }]]);
            await module.setGoal(ctx, "agent-a", "normal");
            await hooks.afterTurnTransact!(
                ctx,
                { agent: { id: "agent-a" }, runKV: normal.runKV } as never,
                {
                    loopId: "loop-a",
                    turnId: "turn-a",
                    contextTokens: undefined,
                    aborted: false,
                },
            );
            await expect(module.goal(database.context, "agent-a")).resolves.toMatchObject({
                status: "active",
            });

            const cancelled = runStore([[GOAL_LAST_INFERENCE_KEY, { state: "cancelled" }]]);
            await module.setGoal(ctx, "agent-b", "cancelled");
            await hooks.afterTurnTransact!(
                ctx,
                { agent: { id: "agent-b" }, runKV: cancelled.runKV } as never,
                {
                    loopId: "loop-a",
                    turnId: "turn-b",
                    contextTokens: undefined,
                    aborted: false,
                },
            );
            await expect(module.goal(database.context, "agent-b")).resolves.toMatchObject({
                status: "paused",
            });

            const aborted = runStore([[GOAL_LAST_INFERENCE_KEY, { state: "normal" }]]);
            await module.setGoal(ctx, "agent-c", "aborted");
            await hooks.afterTurnTransact!(
                ctx,
                { agent: { id: "agent-c" }, runKV: aborted.runKV } as never,
                {
                    loopId: "loop-a",
                    turnId: "turn-c",
                    contextTokens: undefined,
                    aborted: true,
                },
            );
            await expect(module.goal(database.context, "agent-c")).resolves.toMatchObject({
                status: "paused",
            });

            const missing = runStore();
            await module.setGoal(ctx, "agent-d", "missing");
            await hooks.afterTurnTransact!(
                ctx,
                { agent: { id: "agent-d" }, runKV: missing.runKV } as never,
                {
                    loopId: "loop-a",
                    turnId: "turn-d",
                    contextTokens: undefined,
                    aborted: false,
                },
            );
            await expect(module.goal(database.context, "agent-d")).resolves.toMatchObject({
                status: "paused",
            });
            // Each of these runs after the turn already ended, so nothing is aborted.
            expect(agents.aborts).toEqual([]);
        } finally {
            database.close();
        }
    });

    it("rejects malformed inference hook state instead of persisting it", async () => {
        const module = new GoalModule();
        const database = moduleDatabase(module.migrations, "goal-inference-validation-test");
        await database.ready;
        const agents = recordingAgents();
        const hooks = await resolveModuleHooks(database.context, module, agents.ref);
        try {
            await expect(
                hooks.afterInferenceTransact!(
                    database.context,
                    { runKV: runStore().runKV } as never,
                    { state: "not-a-real-state" } as never,
                ),
            ).rejects.toThrow("inference state is invalid");
        } finally {
            database.close();
        }
    });
});
