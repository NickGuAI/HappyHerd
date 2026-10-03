import type {
    SessionCompaction,
    SessionDoneState,
    SessionMessage,
    SessionToolCallBlock,
} from "@slopus/happy-providers";
import { Type } from "@sinclair/typebox";
import { createRootContext, type Context } from "@steve.kite/stdlib";

import {
    AgentBase,
    AgentProviders,
    defineAgentTool,
    type AgentBaseMessageOptions,
    type AnyAgentTool,
} from "../../sources/index.js";
import { CrashingPersistence, isCrash } from "./CrashingPersistence.js";
import { InMemoryPersistence } from "./InMemoryPersistence.js";
import { DURABLE_TOOL, FRAGILE_TOOL, RespondingProvider } from "./RespondingProvider.js";

const ctx = createRootContext().named("happy-agent-base-chaos");

/**
 * The seeds a chaos suite runs. The default is small enough to belong in the ordinary suite;
 * `CHAOS_SEEDS` turns the same suites into a long hunt for rarer interleavings.
 */
export function chaosSeeds(): number[] {
    const count = Number(process.env.CHAOS_SEEDS ?? 60);
    return Array.from({ length: count }, (_, index) => index);
}

/** A tiny deterministic generator, so a failing seed reproduces exactly. */
export function random(seed: number): () => number {
    let state = (seed + 0x9e3779b9) >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

/** One tool execution that really happened, in the process that ran it. */
export interface Execution {
    readonly generation: number;
    readonly tool: string;
    readonly callId: string;
}

/**
 * The world outside the agent: the disk, which outlives every process, and the side effects the
 * tools left behind. `generation` is the process that is currently alive — a tool belonging to
 * any earlier one refuses to run, the way a dead process cannot.
 */
export class ChaosWorld {
    readonly disk = new InMemoryPersistence();
    readonly executions: Execution[] = [];
    generation = 0;

    /** The conversation the durable records rebuild, exactly as a restarted agent reads it. */
    get transcript(): SessionMessage[] {
        return transcriptOf(this.disk);
    }

    /** Every durable key that still represents work the agent owes someone. */
    get owed(): string[] {
        return [...this.disk.pending.keys()].filter(
            (key) =>
                key.startsWith("send.") || key.startsWith("steering.") || key.startsWith("tool."),
        );
    }
}

function toolsFor(world: ChaosWorld, generation: number): AnyAgentTool[] {
    const define = (name: string, durable: boolean) =>
        defineAgentTool({
            name,
            durable,
            parameters: Type.Object({ call: Type.String() }, { additionalProperties: false }),
            returnType: Type.Object({ call: Type.String() }),
            shouldReviewInAutoMode: () => false,
            execute: (_toolCtx, { call }) => {
                // A process that has already died cannot run anything, so a straggling call from
                // an abandoned agent must not count as a side effect of the world.
                if (generation !== world.generation) {
                    return Promise.reject(new Error("This process is gone."));
                }
                world.executions.push({ generation, tool: name, callId: call });
                return Promise.resolve({ call });
            },
            toLLM: ({ call }) => [{ type: "text", text: `did ${call}` }],
        });
    return [define(DURABLE_TOOL, true), define(FRAGILE_TOOL, false)];
}

/** One message the driver still has to get durably queued, and how it should be queued. */
export interface ChaosMessage {
    readonly text: string;
    readonly steering?: boolean;
    readonly options?: AgentBaseMessageOptions;
}

export interface ProcessOptions {
    /** The operation number that kills this process, or undefined for one that survives. */
    readonly crashAt?: number;
    /** Messages that must be durably queued during this process, in order. */
    readonly messages?: readonly ChaosMessage[];
    /** Ask for a compaction before the turn runs, answered with this replacement. */
    readonly compaction?: SessionCompaction;
    /** Abort the turn once the agent has emitted this many events. */
    readonly abortAfterEvents?: number;
}

export interface ProcessResult {
    readonly crashed: boolean;
    /** How many of the offered messages are now durably queued. */
    readonly queued: number;
    /** The state of the last turn this process finished, if it finished one. */
    readonly lastDone: SessionDoneState | undefined;
    /** Whether the requested compaction, if any, was applied. */
    readonly compacted: boolean;
}

/**
 * Live one process against the world's disk: build an agent, queue what it was given, and run
 * until it settles or its store dies under it. A dead store never throws out of the agent loop —
 * the turn is reported as failed instead — so the process is recognized as dead through the
 * store it can no longer reach.
 */
export async function runProcess(
    world: ChaosWorld,
    options: ProcessOptions = {},
): Promise<ProcessResult> {
    world.generation += 1;
    const generation = world.generation;
    const persistence = new CrashingPersistence(world.disk, options.crashAt);
    const providers = new AgentProviders();
    const provider = new RespondingProvider();
    if (options.compaction !== undefined) provider.compaction = options.compaction;
    providers.add("responding", provider, "gym");
    const dones: SessionDoneState[] = [];
    let events = 0;
    const agent = await AgentBase.create(ctx, {
        id: "chaos-agent",
        providers,
        provider: "responding",
        persistence,
        hooks: {
            onEvent: (eventCtx, event) => {
                events += 1;
                if (event.type === "done") dones.push(event.state);
                if (options.abortAfterEvents === events)
                    void agent.abort(eventCtx).catch(() => undefined);
            },
        },
        initialState: { tools: toolsFor(world, generation) },
    });
    const messages = options.messages ?? [];
    let queued = 0;
    let compacted = false;
    try {
        // A queued message either lands durably and is never queued again, or dies without a
        // trace and is offered to the next process. Nothing in between.
        for (const message of messages) {
            const content = {
                role: "user" as const,
                content: [{ type: "text" as const, text: message.text }],
            };
            if (message.steering === true) {
                await agent.steer(ctx, content, { ...message.options });
            } else {
                await agent.send(ctx, content, { ...message.options });
            }
            queued += 1;
        }
        if (options.compaction !== undefined) {
            // The compaction is requested, not awaited: the turn carries it out, and a crash
            // during it must leave the conversation whole either way.
            void agent.compact(ctx);
        }
        agent.start();
        await agent.waitForIdle();
        compacted = world.disk.records.some((record) => record.type === "compaction");
        if (!persistence.crashed) await agent.close();
        return {
            crashed: persistence.crashed,
            queued,
            lastDone: dones[dones.length - 1],
            compacted,
        };
    } catch (error: unknown) {
        if (!isCrash(error) && !persistence.crashed) throw error;
        return {
            crashed: true,
            queued,
            lastDone: dones[dones.length - 1],
            compacted: world.disk.records.some((record) => record.type === "compaction"),
        };
    }
}

export function transcriptOf(disk: InMemoryPersistence): SessionMessage[] {
    const messages: SessionMessage[] = [];
    for (const record of disk.records) {
        if (record.type === "compaction") {
            messages.length = 0;
            messages.push(...record.messages);
            continue;
        }
        if (record.type === "block") {
            const last = messages[messages.length - 1];
            if (last?.role === "assistant") {
                messages[messages.length - 1] = {
                    role: "assistant",
                    content: [...last.content, record.block],
                };
            } else {
                messages.push({ role: "assistant", content: [record.block] });
            }
            continue;
        }
        messages.push(record.message);
    }
    return messages;
}

export function toolCallsIn(messages: readonly SessionMessage[]): SessionToolCallBlock[] {
    return messages.flatMap((message) =>
        message.role === "assistant"
            ? message.content.filter(
                  (block): block is SessionToolCallBlock => block.type === "tool_call",
              )
            : [],
    );
}

export function textIn(messages: readonly SessionMessage[]): string[] {
    return messages.flatMap((message) =>
        message.role === "user" || message.role === "assistant"
            ? message.content.flatMap((block) => (block.type === "text" ? [block.text] : []))
            : [],
    );
}

/** The user messages of a conversation, as plain text. */
export function askedIn(messages: readonly SessionMessage[]): string[] {
    return textIn(messages.filter((message) => message.role === "user"));
}
