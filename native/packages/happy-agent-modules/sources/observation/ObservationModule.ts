import { mkdir } from "node:fs/promises";

import type {
    AgentBaseCompaction,
    AgentBaseInference,
    AgentBaseInferenceStart,
    AgentBaseLoop,
    AgentBaseSettlement,
    AgentBaseToolCall,
    AgentBaseToolOutcome,
    AgentBaseTurn,
    AgentBaseTurnStart,
    AgentModule,
    AgentModuleHooks,
    AgentModuleScope,
} from "@slopus/happy-agent-base";
import type { SessionEvent } from "@slopus/happy-providers";
import {
    withLogContext,
    withLogger,
    withTracer,
    type Context,
    type Logger,
    type RootContext,
} from "@steve.kite/stdlib";

import type { ConfigModule } from "../config/index.js";
import type { HistoryMessage } from "../history/index.js";
import {
    MAX_OBSERVATION_FILE_BYTES,
    MAX_OBSERVATION_PENDING_BYTES,
    resolveObservationSettings,
    type ObservationSettings,
} from "./ObservationSettings.js";
import { HistoryDump } from "./impl/HistoryDump.js";
import { RotatingFileWriter } from "./impl/RotatingFileWriter.js";
import { createObservationLogger } from "./impl/createObservationLogger.js";
import {
    startObservationTracing,
    type ObservationTracing,
} from "./impl/startObservationTracing.js";

/**
 * What the agent records about itself: logs, traces, and a readable copy of its history.
 *
 * Three separate audiences, one module, because all three answer the same question — what was this
 * agent actually doing — and all three need the same thing from the host: a place on disk, a
 * lifetime, and somewhere to be installed before any work starts.
 *
 * Logging and tracing both work by installation rather than by call. `ctx.log` and `ctx.span` exist
 * on every context and do nothing at all until a logger and a tracer are installed on the root the
 * rest are derived from; {@link install} is where that happens. So the spans that describe the
 * agent's loop, turns, inferences, and tool calls are opened by the agent runtime itself, around
 * the work they measure, and this module only decides whether anything is listening.
 *
 * The history dump is the odd one out: it is not telemetry but a plain file per agent, one JSON
 * object per record, appended as the durable history commits. It is what a person tails.
 */
export class ObservationModule implements AgentModule {
    readonly name = "observation";

    readonly #settings: ObservationSettings;
    readonly #logWriter: RotatingFileWriter | undefined;
    readonly #logger: Logger | undefined;
    readonly #tracing: ObservationTracing | undefined;
    readonly #historyDump: HistoryDump | undefined;
    readonly #activeCompactions = new Map<string, ActiveCompaction>();
    readonly #activeInferences = new Map<string, ActiveInference>();
    readonly #activeTools = new Map<string, ActiveTool>();
    #closed = false;

    private constructor(parts: {
        readonly settings: ObservationSettings;
        readonly logWriter: RotatingFileWriter | undefined;
        readonly tracing: ObservationTracing | undefined;
        readonly historyDump: HistoryDump | undefined;
    }) {
        this.#settings = parts.settings;
        this.#logWriter = parts.logWriter;
        this.#logger =
            parts.logWriter === undefined
                ? undefined
                : createObservationLogger(parts.logWriter, parts.settings.logLevel);
        this.#tracing = parts.tracing;
        this.#historyDump = parts.historyDump;
    }

    /**
     * Open everything the configured settings ask for, and nothing they do not.
     *
     * The configuration module owns both the settings and the paths this writes to, so it is what
     * this takes. The `HAPPY_OBSERVATION_*` overrides are read from the process environment here,
     * where the decision is made, rather than handed in.
     *
     * This runs before the agent system exists, because the logger it produces has to be on the
     * context that system is created with.
     */
    static async start(config: ConfigModule, deployment?: string): Promise<ObservationModule> {
        const { paths, values, version } = config.configuration;
        const settings = resolveObservationSettings(values.observation);
        const logWriter = settings.logs
            ? await RotatingFileWriter.open({
                  maxBytes: MAX_OBSERVATION_FILE_BYTES,
                  maxPendingBytes: MAX_OBSERVATION_PENDING_BYTES,
                  path: paths.logPath,
              })
            : undefined;
        let historyDump: HistoryDump | undefined;
        if (settings.historyDump) {
            await mkdir(paths.historyDumpHome, { recursive: true });
            historyDump = new HistoryDump(paths.historyDumpHome);
        }
        const tracing = settings.traces
            ? startObservationTracing({
                  deployment: deployment ?? "production",
                  endpoint: settings.tracesEndpoint,
                  version,
              })
            : undefined;
        return new ObservationModule({ historyDump, logWriter, settings, tracing });
    }

    /** The settings actually in force, after configuration and environment have both been read. */
    get settings(): ObservationSettings {
        return this.#settings;
    }

    /**
     * The application root every other lifetime should be derived from.
     *
     * Installing rather than mutating is the whole point: contexts are immutable, so the host takes
     * this one and uses it, and everything downstream inherits the logger and tracer by construction
     * instead of by looking anything up.
     */
    install(ctx: RootContext): RootContext {
        const logged = this.#logger === undefined ? ctx : withLogger(ctx, this.#logger);
        return this.#tracing === undefined
            ? logged
            : withTracer(logged, this.#tracing.contextTracer);
    }

    /**
     * The subscriber `HistoryModule` calls once each history append has committed.
     *
     * Hand it to that module with `history.onAppend(observation.recordHistory)`. It is
     * deliberately a bound property rather than a method, so it can be subscribed without binding
     * it and without exposing anything else of this module.
     */
    readonly recordHistory = async (
        _ctx: Context,
        agentId: string,
        messages: readonly HistoryMessage[],
    ): Promise<void> => {
        await this.#historyDump?.record(agentId, messages);
    };

    /** Resolve once everything observed so far has reached its file. */
    async flush(): Promise<void> {
        await Promise.all([this.#historyDump?.flush(), this.#logWriter?.flush()]);
    }

    /**
     * Close every file and stop exporting.
     *
     * A collector that has gone away, or a disk that has filled, must not turn an otherwise clean
     * shutdown into a failure — so every part is settled and the first real failure is reported
     * only after all of them have had their chance to finish.
     */
    async close(_ctx?: Context): Promise<void> {
        if (this.#closed) return;
        this.#closed = true;
        const outcomes = await Promise.allSettled([
            this.#historyDump?.close() ?? Promise.resolve(),
            this.#tracing?.shutdown() ?? Promise.resolve(),
        ]);
        // The log file closes last so anything the shutdown above logged is still written.
        const logOutcome = await Promise.allSettled([
            this.#logWriter?.close() ?? Promise.resolve(),
        ]);
        const failures = [...outcomes, ...logOutcome]
            .filter((outcome) => outcome.status === "rejected")
            .map((outcome) => outcome.reason);
        if (failures.length > 0) {
            throw new AggregateError(failures, "Observation did not shut down cleanly.");
        }
    }

    readonly #hooks: AgentModuleHooks = {
        beforeAgentLoop: (ctx: Context, scope: AgentModuleScope, loop: AgentBaseLoop): void => {
            withLogContext(ctx, { agentId: scope.agent.id, loopId: loop.loopId }).log.info(
                `agent:run:start agentId=${logValue(scope.agent.id)} loopId=${logValue(loop.loopId)}`,
            );
        },

        beforeTurn: (
            ctx: Context,
            scope: AgentModuleScope,
            turn: AgentBaseTurnStart,
        ): undefined => {
            withLogContext(ctx, {
                agentId: scope.agent.id,
                turnId: turn.turnId,
                ...(turn.contextTokens === undefined ? {} : { contextTokens: turn.contextTokens }),
            }).log.debug(
                `agent:turn:start agentId=${logValue(scope.agent.id)} turnId=${logValue(turn.turnId)}${numberField("contextTokens", turn.contextTokens)}`,
            );
            return undefined;
        },

        afterTurn: (ctx: Context, scope: AgentModuleScope, turn: AgentBaseTurn): undefined => {
            withLogContext(ctx, {
                agentId: scope.agent.id,
                turnId: turn.turnId,
            }).log.debug(
                `agent:turn:finish agentId=${logValue(scope.agent.id)} turnId=${logValue(turn.turnId)} outcome=${turn.aborted ? "cancelled" : "completed"}`,
            );
            return undefined;
        },

        beforeInference: (
            ctx: Context,
            scope: AgentModuleScope,
            inference: AgentBaseInferenceStart,
        ): void => {
            const startedAt = Date.now();
            this.#activeInferences.set(scope.agent.id, {
                activitySeen: false,
                attempt: 1,
                attemptStartedAt: startedAt,
                inferenceId: inference.inferenceId,
                startedAt,
            });
            withLogContext(ctx, {
                agentId: scope.agent.id,
                inferenceId: inference.inferenceId,
                provider: scope.agent.provider,
                ...(scope.agent.model === undefined ? {} : { model: scope.agent.model }),
                ...(scope.agent.effort === undefined ? {} : { effort: scope.agent.effort }),
                ...(scope.agent.tier === undefined ? {} : { tier: scope.agent.tier }),
                ...(inference.contextTokens === undefined
                    ? {}
                    : { contextTokens: inference.contextTokens }),
            }).log.debug(
                `inference:start agentId=${logValue(scope.agent.id)} inferenceId=${logValue(inference.inferenceId)} provider=${logValue(scope.agent.provider)}${stringField("model", scope.agent.model)}${stringField("effort", scope.agent.effort)}${stringField("tier", scope.agent.tier)}${numberField("contextTokens", inference.contextTokens)}`,
            );
        },

        onEvent: (ctx: Context, scope: AgentModuleScope, event: SessionEvent): void => {
            const active = this.#activeInferences.get(scope.agent.id);
            if (active === undefined) return;
            const eventCtx = withLogContext(ctx, {
                agentId: scope.agent.id,
                inferenceId: active.inferenceId,
                attempt: active.attempt,
                event: event.type,
                module: this.name,
            });
            if (event.type === "block_start") {
                active.attemptStartedAt = Date.now();
                active.activitySeen = false;
                eventCtx.log.debug(
                    `inference:stream:open agentId=${logValue(scope.agent.id)} inferenceId=${logValue(active.inferenceId)} attempt=${active.attempt} elapsedMs=${elapsed(active.startedAt)}`,
                );
                return;
            }
            if (event.type === "retrying") {
                eventCtx.log.warn(
                    `inference:retry agentId=${logValue(scope.agent.id)} inferenceId=${logValue(active.inferenceId)} retry=${event.attempt} elapsedMs=${elapsed(active.startedAt)} reason=${logValue(event.reason)}`,
                );
                active.attempt = event.attempt + 1;
                active.activitySeen = false;
                return;
            }
            if (event.type === "block_reset") {
                eventCtx.log.warn(
                    `inference:stream:reset agentId=${logValue(scope.agent.id)} inferenceId=${logValue(active.inferenceId)} attempt=${active.attempt} elapsedMs=${elapsed(active.startedAt)}`,
                );
                active.activitySeen = false;
                return;
            }
            if (!active.activitySeen) {
                active.activitySeen = true;
                eventCtx.log.debug(
                    `inference:first-activity agentId=${logValue(scope.agent.id)} inferenceId=${logValue(active.inferenceId)} attempt=${active.attempt} event=${logValue(event.type)} attemptElapsedMs=${elapsed(active.attemptStartedAt)} elapsedMs=${elapsed(active.startedAt)}`,
                );
            }
        },

        afterInference: (
            ctx: Context,
            scope: AgentModuleScope,
            inference: AgentBaseInference,
        ): void => {
            const active = this.#activeInferences.get(scope.agent.id);
            if (active?.inferenceId === inference.inferenceId) {
                this.#activeInferences.delete(scope.agent.id);
            }
            const inferenceCtx = withLogContext(ctx, {
                agentId: scope.agent.id,
                inferenceId: inference.inferenceId,
                ...(inference.state === undefined ? {} : { state: inference.state }),
                ...(inference.tokens === undefined
                    ? {}
                    : {
                          inputTokens: inference.tokens.input,
                          outputTokens: inference.tokens.output,
                      }),
            });
            const message =
                `inference:finish agentId=${logValue(scope.agent.id)} inferenceId=${logValue(inference.inferenceId)} state=${logValue(inference.state ?? "missing")}` +
                (active === undefined ? "" : ` durationMs=${elapsed(active.startedAt)}`) +
                (inference.tokens === undefined
                    ? ""
                    : ` inputTokens=${inference.tokens.input} outputTokens=${inference.tokens.output}`);
            if (inference.errorMessage === undefined) {
                inferenceCtx.log.debug(message);
                return;
            }
            inferenceCtx.log.warn(`${message} error=${logValue(inference.errorMessage)}`);
        },

        beforeToolCall: (
            ctx: Context,
            scope: AgentModuleScope,
            call: AgentBaseToolCall,
        ): undefined => {
            this.#activeTools.set(toolKey(scope.agent.id, call.callId), {
                startedAt: Date.now(),
            });
            withLogContext(ctx, {
                agentId: scope.agent.id,
                callId: call.callId,
                tool: call.tool.name,
            }).log.debug(
                `tool:start agentId=${logValue(scope.agent.id)} callId=${logValue(call.callId)} tool=${logValue(call.tool.name)}`,
            );
            return undefined;
        },

        afterToolCall: (
            ctx: Context,
            scope: AgentModuleScope,
            outcome: AgentBaseToolOutcome,
        ): void => {
            const key = toolKey(scope.agent.id, outcome.callId);
            const active = this.#activeTools.get(key);
            this.#activeTools.delete(key);
            const callCtx = withLogContext(ctx, {
                agentId: scope.agent.id,
                callId: outcome.callId,
                tool: outcome.tool.name,
            });
            callCtx.log.debug(
                `tool:finish agentId=${logValue(scope.agent.id)} callId=${logValue(outcome.callId)} tool=${logValue(outcome.tool.name)} outcome=${outcome.isError ? "error" : "completed"}${active === undefined ? "" : ` durationMs=${elapsed(active.startedAt)}`}`,
            );
        },

        beforeCompaction: (ctx: Context, scope: AgentModuleScope, compaction): void => {
            this.#activeCompactions.set(scope.agent.id, {
                compactionId: compaction.compactionId,
                startedAt: Date.now(),
            });
            withLogContext(ctx, {
                agentId: scope.agent.id,
                compactionId: compaction.compactionId,
            }).log.debug(
                `compaction:start agentId=${logValue(scope.agent.id)} compactionId=${logValue(compaction.compactionId)}${numberField("contextTokens", compaction.contextTokens)}`,
            );
        },

        afterCompaction: (
            ctx: Context,
            scope: AgentModuleScope,
            compaction: AgentBaseCompaction,
        ): void => {
            const active = this.#activeCompactions.get(scope.agent.id);
            if (active?.compactionId === compaction.compactionId) {
                this.#activeCompactions.delete(scope.agent.id);
            }
            withLogContext(ctx, {
                agentId: scope.agent.id,
                compactionId: compaction.compactionId,
                outcome: compaction.result.status,
            }).log.info(
                `compaction:finish agentId=${logValue(scope.agent.id)} compactionId=${logValue(compaction.compactionId)} outcome=${compaction.result.status}${active === undefined ? "" : ` durationMs=${elapsed(active.startedAt)}`}`,
            );
        },

        afterAgentSettled: (
            ctx: Context,
            scope: AgentModuleScope,
            settlement: AgentBaseSettlement,
        ): void => {
            this.#activeCompactions.delete(scope.agent.id);
            this.#activeInferences.delete(scope.agent.id);
            const toolPrefix = `${scope.agent.id}\u0000`;
            for (const key of this.#activeTools.keys()) {
                if (key.startsWith(toolPrefix)) this.#activeTools.delete(key);
            }
            const settlementCtx = withLogContext(ctx, {
                agentId: scope.agent.id,
                loopId: settlement.loopId,
                settlementId: settlement.settlementId,
            });
            const message =
                `agent:run:finish agentId=${logValue(scope.agent.id)} loopId=${logValue(settlement.loopId)} settlementId=${logValue(settlement.settlementId)} outcome=${settlement.error === undefined ? "completed" : "error"}` +
                (settlement.error === undefined ? "" : ` error=${logValue(settlement.error)}`);
            if (settlement.error === undefined) settlementCtx.log.info(message);
            else settlementCtx.log.warn(message);
        },
    };

    readonly beforeStart = (): AgentModuleHooks => this.#hooks;
}

interface ActiveCompaction {
    readonly compactionId: string;
    readonly startedAt: number;
}

interface ActiveInference {
    activitySeen: boolean;
    attempt: number;
    attemptStartedAt: number;
    readonly inferenceId: string;
    readonly startedAt: number;
}

interface ActiveTool {
    readonly startedAt: number;
}

function toolKey(agentId: string, callId: string): string {
    return `${agentId}\u0000${callId}`;
}

function elapsed(startedAt: number): number {
    return Math.max(0, Date.now() - startedAt);
}

function stringField(name: string, value: string | undefined): string {
    return value === undefined ? "" : ` ${name}=${logValue(value)}`;
}

function numberField(name: string, value: number | undefined): string {
    return value === undefined ? "" : ` ${name}=${value}`;
}

function logValue(value: string): string {
    return JSON.stringify(value);
}
