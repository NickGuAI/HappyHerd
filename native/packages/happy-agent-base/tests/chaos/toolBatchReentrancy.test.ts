import type { SessionEvent, SessionToolResultMessage } from "@slopus/happy-providers";
import { Type } from "@sinclair/typebox";
import { createRootContext, type Context } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import { AgentBase, agentKV, defineAgentTool } from "../../sources/index.js";
import { InMemoryPersistence } from "../gym/InMemoryPersistence.js";
import { ScriptedProvider } from "../gym/ScriptedProvider.js";
import { providersOf, textTurn, user } from "../gym/fixtures.js";

const ctx = createRootContext().named("happy-agent-base-tool-batch-reentrancy");

function toolCallsTurn(
    calls: readonly { readonly callId: string; readonly name: string }[],
): SessionEvent[] {
    return [
        ...calls.flatMap(({ callId, name }) => [
            { type: "toolcall_start", callId, name } as const,
            { type: "toolcall_end", callId, arguments: "{}" } as const,
        ]),
        { type: "done", state: "tool_call", tokens: { input: 1, output: 1 } },
    ];
}

function resultsIn(persistence: InMemoryPersistence): SessionToolResultMessage[] {
    return persistence.records.flatMap((record) =>
        record.type === "tool" ? [record.message] : [],
    );
}

/**
 * A batch runs its calls at the same time, and a running tool can reach back into the agent that
 * is waiting for it. These scenarios pin down which of those reaches the agent survives, which
 * it refuses outright, and what it does with a batch whose calls cannot be told apart.
 */
describe("tool batch concurrency and re-entrancy", () => {
    it("keeps each call of a concurrent batch in its own persistence scope", async () => {
        const observed: unknown[] = [];
        let entered = 0;
        let bothInside!: () => void;
        const both = new Promise<void>((resolve) => {
            bothInside = resolve;
        });
        const tool = defineAgentTool({
            name: "concurrent",
            parameters: Type.Object({}),
            returnType: Type.Object({}),
            shouldReviewInAutoMode: () => false,
            execute: async (callCtx: Context) => {
                const kv = agentKV(callCtx);
                entered += 1;
                const mine = entered;
                await kv?.write(callCtx, "mine", mine);
                if (entered === 2) bothInside();
                // Neither call returns until both have written, so a shared scope would show up
                // as one call reading the other's value.
                await both;
                observed.push(await kv?.read(callCtx, "mine"));
                return {};
            },
            toLLM: () => [{ type: "text", text: "ran" }],
        });
        const agent = await AgentBase.create(ctx, {
            id: "concurrent-scopes",
            providers: providersOf(
                new ScriptedProvider([
                    toolCallsTurn([
                        { callId: "first", name: "concurrent" },
                        { callId: "second", name: "concurrent" },
                    ]),
                    textTurn("after"),
                ]),
            ),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            initialState: { tools: [tool] },
        });

        await agent.send(ctx, user("go"));
        await agent.waitForIdle();
        await agent.close();

        expect({ entered, observed }).toEqual({ entered: 2, observed: [1, 2] });
    });

    it("requests compaction from inside the turn without waiting for it", async () => {
        let failure: string | undefined;
        let agent!: AgentBase;
        const tool = defineAgentTool({
            name: "reenter",
            parameters: Type.Object({}),
            returnType: Type.Object({}),
            shouldReviewInAutoMode: () => false,
            execute: async (callCtx: Context) => {
                try {
                    await agent.compact(callCtx);
                } catch (error: unknown) {
                    failure = error instanceof Error ? error.message : String(error);
                }
                return {};
            },
            toLLM: () => [{ type: "text", text: "ran" }],
        });
        agent = await AgentBase.create(ctx, {
            id: "reentrant-compaction",
            providers: providersOf(
                new ScriptedProvider([
                    toolCallsTurn([{ callId: "a", name: "reenter" }]),
                    textTurn("after"),
                ]),
            ),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            initialState: { tools: [tool] },
        });

        await agent.send(ctx, user("go"));
        await agent.waitForIdle();
        await agent.close();

        expect(failure).toBeUndefined();
    });

    it("requests compaction from a hook without waiting for it", async () => {
        let failure: string | undefined;
        let asked = false;
        let agent!: AgentBase;
        agent = await AgentBase.create(ctx, {
            id: "reentrant-hook-compaction",
            providers: providersOf(new ScriptedProvider([textTurn("answered")])),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            hooks: {
                afterTurn: async (hookCtx: Context) => {
                    if (asked) return undefined;
                    asked = true;
                    try {
                        await agent.compact(hookCtx);
                    } catch (error: unknown) {
                        failure = error instanceof Error ? error.message : String(error);
                    }
                    return undefined;
                },
            },
        });

        await agent.send(ctx, user("go"));
        await agent.waitForIdle();
        await agent.close();

        expect(failure).toBeUndefined();
    });

    it("still lets a running tool abort the turn it belongs to", async () => {
        const events: SessionEvent[] = [];
        let agent!: AgentBase;
        const tool = defineAgentTool({
            name: "stop",
            parameters: Type.Object({}),
            returnType: Type.Object({}),
            shouldReviewInAutoMode: () => false,
            execute: async (callCtx: Context) => {
                // The asking form of abort is what a tool may use: the cancellation is complete
                // once it is signalled, so nothing here waits for the turn it just cancelled.
                await agent.abort(callCtx);
                return {};
            },
            toLLM: () => [{ type: "text", text: "ran" }],
        });
        agent = await AgentBase.create(ctx, {
            id: "tool-aborts-its-turn",
            providers: providersOf(
                new ScriptedProvider([
                    toolCallsTurn([{ callId: "a", name: "stop" }]),
                    textTurn("never"),
                ]),
            ),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            hooks: { onEvent: (_hookCtx, event) => events.push(event) },
            initialState: { tools: [tool] },
        });

        await agent.send(ctx, user("go"));
        await agent.waitForIdle();
        await agent.close();

        expect(events.at(-1)).toEqual({ type: "done", state: "cancelled" });
    });

    it("queues messages from inside the turn without waiting on itself", async () => {
        let failure: string | undefined;
        let agent!: AgentBase;
        const tool = defineAgentTool({
            name: "report",
            parameters: Type.Object({}),
            returnType: Type.Object({}),
            shouldReviewInAutoMode: () => false,
            execute: async (callCtx: Context) => {
                try {
                    await agent.send(callCtx, user("waited"));
                } catch (error: unknown) {
                    failure = error instanceof Error ? error.message : String(error);
                }
                // The asking form is what a tool may use, and it lands like any other message.
                await agent.send(callCtx, user("asked for"));
                return {};
            },
            toLLM: () => [{ type: "text", text: "ran" }],
        });
        const provider = new ScriptedProvider([
            toolCallsTurn([{ callId: "a", name: "report" }]),
            textTurn("after the tool"),
            textTurn("after the message"),
        ]);
        agent = await AgentBase.create(ctx, {
            id: "waited-message-from-tool",
            providers: providersOf(provider),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            initialState: { tools: [tool] },
        });

        await agent.send(ctx, user("go"));
        await agent.waitForIdle();
        const lastRequest = provider.sessions[0]?.requests.at(-1);
        await agent.close();

        expect(failure).toBeUndefined();
        expect(lastRequest?.context.messages.at(-1)).toEqual(user("asked for"));
    });
});
