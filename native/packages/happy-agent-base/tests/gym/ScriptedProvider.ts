import {
    BaseProvider,
    BaseSession,
    type ProviderModality,
    type SessionCompaction,
    type SessionCompactionOptions,
    type SessionOptions,
    type SessionEvent,
    type SessionRunRequest,
    type SessionStream,
} from "@slopus/happy-providers";
import type { Context } from "@steve.kite/stdlib";

/**
 * A fake session that answers each run with the next scripted event batch and records every
 * request for assertions.
 */
export class ScriptedSession extends BaseSession {
    readonly requests: SessionRunRequest[] = [];
    readonly requestContexts: Context[] = [];
    readonly options: SessionOptions;
    /** Every compaction request received, in order. */
    readonly compactions: SessionCompactionOptions[] = [];
    /** Scripted answers for compaction requests, consumed one per call. */
    compactionResults: SessionCompaction[] = [];
    destroyed = false;
    destroyCalls = 0;

    readonly #script: SessionEvent[][];

    constructor(id: string, script: SessionEvent[][], options: SessionOptions) {
        super(id);
        this.#script = script;
        this.options = options;
    }

    run(ctx: Context, request: SessionRunRequest): SessionStream {
        this.requestContexts.push(ctx);
        this.requests.push(request);
        const events = this.#script.shift() ?? [];
        return (async function* () {
            yield* events;
        })();
    }

    compact(_ctx: Context, options: SessionCompactionOptions): Promise<SessionCompaction> {
        this.compactions.push(options);
        const result = this.compactionResults.shift();
        if (result === undefined) {
            return Promise.reject(new Error("No scripted compaction result."));
        }
        return Promise.resolve(result);
    }

    destroy(): void {
        this.destroyCalls += 1;
        this.destroyed = true;
    }
}

/** A fake provider whose sessions share one scripted event sequence, one batch per run. */
export class ScriptedProvider extends BaseProvider {
    static override readonly name = "scripted";
    static override readonly inputTypes: readonly ProviderModality[] = ["text"];
    static override readonly outputTypes: readonly ProviderModality[] = ["text"];

    sessions: ScriptedSession[] = [];

    readonly #script: SessionEvent[][];

    constructor(script: SessionEvent[][]) {
        super();
        this.#script = script;
    }

    session(id: string, options: SessionOptions): Promise<BaseSession> {
        const session = new ScriptedSession(id, this.#script, options);
        this.sessions.push(session);
        return Promise.resolve(session);
    }
}
