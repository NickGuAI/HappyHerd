import {
    BaseProvider,
    BaseSession,
    type SessionCompaction,
    type ProviderModality,
    type SessionEvent,
    type SessionMessage,
    type SessionOptions,
    type SessionRunRequest,
    type SessionStream,
} from "@slopus/happy-providers";
import type { Context } from "@steve.kite/stdlib";

/**
 * A model that answers from the conversation it is given rather than from a script, so it says
 * the same thing to a restarted agent as it did to the one that died. Each user message earns
 * one tool call, and the tool's result earns the answer; a context that already ends in an
 * answer gets another one, so an agent that resumes a finished conversation still settles.
 *
 * Call IDs come from the number of calls already in the context, which makes a resumed call
 * carry the very same ID it did before the crash — exactly what a durable tool batch needs to
 * be recognizable as the same batch.
 */
export class RespondingSession extends BaseSession {
    readonly requests: SessionRunRequest[] = [];
    destroyed = false;

    /** The answer to any compaction request; without one the conversation never compacts. */
    compaction: SessionCompaction | undefined;

    constructor(id: string, compaction?: SessionCompaction) {
        super(id);
        this.compaction = compaction;
    }

    run(_ctx: Context, request: SessionRunRequest): SessionStream {
        this.requests.push(request);
        const events = respond(request.context.messages);
        return (async function* () {
            yield* events;
        })();
    }

    compact(): Promise<SessionCompaction> {
        if (this.compaction === undefined) {
            return Promise.reject(new Error("This conversation never compacts."));
        }
        return Promise.resolve(this.compaction);
    }

    destroy(): void {
        this.destroyed = true;
    }
}

export class RespondingProvider extends BaseProvider {
    static override readonly name = "responding";
    static override readonly inputTypes: readonly ProviderModality[] = ["text"];
    static override readonly outputTypes: readonly ProviderModality[] = ["text"];

    readonly sessions: RespondingSession[] = [];

    /** Handed to every session this provider opens, so a restarted agent compacts alike. */
    compaction: SessionCompaction | undefined;

    session(id: string, _options: SessionOptions): Promise<BaseSession> {
        const session = new RespondingSession(id, this.compaction);
        this.sessions.push(session);
        return Promise.resolve(session);
    }
}

/** The two tools the conversation uses, chosen per call so both kinds get exercised. */
export const DURABLE_TOOL = "durable_tool";
export const FRAGILE_TOOL = "fragile_tool";

export function toolNameFor(callIndex: number): string {
    return callIndex % 2 === 0 ? DURABLE_TOOL : FRAGILE_TOOL;
}

function respond(messages: readonly SessionMessage[]): SessionEvent[] {
    const last = messages[messages.length - 1];
    const tokens = { input: 10 * messages.length, output: 5 };
    if (last?.role === "user") {
        const index = countToolCalls(messages);
        const callId = `call-${index}`;
        return [
            { type: "toolcall_start", callId, name: toolNameFor(index) },
            { type: "toolcall_end", callId, arguments: JSON.stringify({ call: callId }) },
            { type: "done", state: "tool_call", tokens },
        ];
    }
    const answered = messages.filter((message) => message.role === "user").length;
    return [
        { type: "text_start" },
        { type: "text_delta", delta: `answer-${answered}` },
        { type: "text_end" },
        { type: "done", state: "normal", tokens },
    ];
}

function countToolCalls(messages: readonly SessionMessage[]): number {
    let count = 0;
    for (const message of messages) {
        if (message.role !== "assistant") continue;
        for (const block of message.content) {
            if (block.type === "tool_call") count += 1;
        }
    }
    return count;
}
