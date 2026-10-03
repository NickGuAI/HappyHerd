import { Type } from "@sinclair/typebox";
import { createRootContext } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import { AGENT_BASE_PENDING_KEY, AgentBase, defineAgentTool } from "../../sources/index.js";
import { InMemoryPersistence } from "../gym/InMemoryPersistence.js";
import { ScriptedProvider } from "../gym/ScriptedProvider.js";
import { providersOf, queued, textTurn, user } from "../gym/fixtures.js";

const ctx = createRootContext().named("happy-agent-base-destructive-history-races");

interface Deferred {
    readonly promise: Promise<void>;
    readonly resolve: () => void;
}

function deferred(): Deferred {
    let resolve!: () => void;
    const promise = new Promise<void>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

async function observedWithin(work: Promise<unknown>, milliseconds = 500): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), milliseconds);
        void work.then(
            () => {
                clearTimeout(timeout);
                resolve(true);
            },
            () => {
                clearTimeout(timeout);
                resolve(true);
            },
        );
    });
}

/**
 * These cases attack destructive history rewrites and response assembly. They deliberately
 * coordinate exact consistency windows rather than depending on scheduler timing.
 */
describe("consistency across destructive history boundaries", () => {
    it("does not let sibling tool mappers append after a failed result commit ended the turn", async () => {
        const disk = new InMemoryPersistence();
        const firstResultFailed = deferred();
        const slowToolStarted = deferred();
        const releaseSlowTool = deferred();
        const lateToolAppend = deferred();
        const append = disk.append.bind(disk);
        let toolAppendAttempts = 0;
        disk.append = async (appendCtx, record) => {
            if (record.type === "tool") {
                toolAppendAttempts += 1;
                if (toolAppendAttempts === 1) {
                    firstResultFailed.resolve();
                    throw new Error("the first tool result could not commit");
                }
                lateToolAppend.resolve();
            }
            await append(appendCtx, record);
        };
        const provider = new ScriptedProvider([
            [
                { type: "toolcall_start", callId: "quick-call", name: "quick" },
                { type: "toolcall_end", callId: "quick-call", arguments: "{}" },
                { type: "toolcall_start", callId: "slow-call", name: "slow" },
                { type: "toolcall_end", callId: "slow-call", arguments: "{}" },
                { type: "done", state: "tool_call", tokens: { input: 1, output: 1 } },
            ],
        ]);
        const agent = await AgentBase.create(ctx, {
            id: "failed-result-with-live-sibling",
            providers: providersOf(provider),
            provider: "scripted",
            persistence: disk,
            initialState: {
                tools: [
                    defineAgentTool({
                        name: "quick",
                        returnType: Type.Object({ value: Type.String() }),
                        shouldReviewInAutoMode: () => false,
                        execute: () => Promise.resolve({ value: "quick result" }),
                        toLLM: (result) => [{ type: "text", text: result.value }],
                    }),
                    defineAgentTool({
                        name: "slow",
                        returnType: Type.Object({ value: Type.String() }),
                        shouldReviewInAutoMode: () => false,
                        execute: async () => {
                            slowToolStarted.resolve();
                            await releaseSlowTool.promise;
                            return { value: "slow result" };
                        },
                        toLLM: (result) => [{ type: "text", text: result.value }],
                    }),
                ],
            },
        });

        await agent.send(ctx, user("run both"));
        expect(await observedWithin(firstResultFailed.promise)).toBe(true);
        expect(await observedWithin(slowToolStarted.promise)).toBe(true);
        await agent.waitForIdle();
        expect(agent.active).toBe(true);
        expect(disk.values.has(AGENT_BASE_PENDING_KEY)).toBe(true);
        expect(disk.records.some((record) => record.type === "system")).toBe(false);
        const recordsAtBlockedResult = structuredClone(disk.records);

        releaseSlowTool.resolve();
        const staleMapperTriedToAppend = await observedWithin(lateToolAppend.promise);
        await agent.close();

        // The failed result leaves the run active and the call last in history for restart. A
        // sibling mapper from the failed batch no longer owns that tail and cannot write over it.
        expect(staleMapperTriedToAppend).toBe(false);
        expect(disk.records).toEqual(recordsAtBlockedResult);
    });

    it("keeps live and restarted context identical when normal done arrives without text_end", async () => {
        const disk = new InMemoryPersistence();
        disk.values.set("send.00000000000001.000000.seed", queued(user("first queued message")));
        disk.values.set("send.00000000000002.000000.seed", queued(user("second queued message")));
        disk.values.set("owed", true);
        const liveProvider = new ScriptedProvider([
            [
                { type: "text_start" },
                { type: "text_delta", delta: "text without an end event" },
                { type: "done", state: "normal", tokens: { input: 1, output: 1 } },
            ],
            textTurn("second answer"),
        ]);
        const live = await AgentBase.create(ctx, {
            id: "missing-text-end",
            providers: providersOf(liveProvider),
            provider: "scripted",
            persistence: disk,
        });

        live.start();
        await live.waitForIdle();
        const secondLiveContext = liveProvider.sessions[0]?.requests[1]?.context.messages;
        await live.close();

        const restartedProvider = new ScriptedProvider([textTurn("third answer")]);
        const restarted = await AgentBase.create(ctx, {
            id: "missing-text-end",
            providers: providersOf(restartedProvider),
            provider: "scripted",
            persistence: disk,
        });
        await restarted.send(ctx, user("message after restart"));
        await restarted.waitForIdle();
        const restartedContext = restartedProvider.sessions[0]?.requests[0]?.context.messages;
        await restarted.close();

        // A completed response block is either committed before memory sees it or omitted from
        // both. The next live request must therefore be a durable prefix of the request made
        // after restart; an unterminated block cannot exist only in the former.
        expect(restartedContext).toEqual([
            ...(secondLiveContext ?? []),
            {
                role: "assistant",
                content: [{ type: "text", text: "second answer" }],
            },
            user("message after restart"),
        ]);
    });
});
