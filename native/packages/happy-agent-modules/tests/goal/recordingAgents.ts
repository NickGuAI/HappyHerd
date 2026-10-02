import type { AgentMessageMetadata, AgentSystemRef } from "@slopus/happy-agent-base";
import type { Context } from "@steve.kite/stdlib";

/** One message Goal asked the collection to deliver to wake an agent. */
export interface RecordedWake {
    readonly agentId: string;
    readonly id: string | undefined;
    readonly text: string;
    readonly metadata: AgentMessageMetadata | undefined;
}

export interface RecordingAgents {
    readonly ref: AgentSystemRef;
    readonly wakes: RecordedWake[];
    /** Every agent Goal asked the collection to stop, in order. */
    readonly aborts: string[];
}

/** What the fake does when Goal asks it to stop an agent. */
export type InterceptAbort = (agentId: string) => void | Promise<void>;

export type RecordWake = (wake: RecordedWake) => void;
export type InterceptWake = (
    ctx: Context,
    wake: RecordedWake,
    record: RecordWake,
) => void | Promise<void>;

interface RecordedMessage {
    readonly content: readonly { readonly type: string; readonly text?: string }[];
}

/**
 * A stand-in for the deadlock-free `AgentSystemRef` Agent Base hands a module in `beforeStart`.
 * It records every wake Goal sends so a test can assert exactly what, and how often, was enqueued
 * without standing up a whole collection. The durable delivery and its atomicity are Agent Base's
 * own contract; this fake only proves the module's side of it.
 *
 * A transaction-aware test may intercept the send and defer `record` until its host transaction
 * commits. This models the intended same-database wiring without claiming that the module can
 * force Agent Base's queue transaction to join.
 */
export function recordingAgents(
    intercept?: InterceptWake,
    interceptAbort?: InterceptAbort,
): RecordingAgents {
    const wakes: RecordedWake[] = [];
    const aborts: string[] = [];
    const record = (wake: RecordedWake): void => {
        wakes.push(structuredClone(wake));
    };
    const ref = {
        abort: async (_ctx: Context, agentId: string): Promise<void> => {
            aborts.push(agentId);
            if (interceptAbort !== undefined) await interceptAbort(agentId);
        },
        send: (
            ctx: Context,
            agentId: string,
            message: RecordedMessage,
            options?: { readonly id?: string; readonly metadata?: AgentMessageMetadata },
        ): Promise<void> => {
            const text = message.content
                .map((block) =>
                    block.type === "text" && typeof block.text === "string" ? block.text : "",
                )
                .join("");
            const wake = {
                agentId,
                id: options?.id,
                metadata: options?.metadata,
                text,
            };
            if (intercept === undefined) {
                record(wake);
                return Promise.resolve();
            }
            return Promise.resolve(intercept(ctx, structuredClone(wake), record));
        },
    } as unknown as AgentSystemRef;
    return { ref, wakes, aborts };
}
