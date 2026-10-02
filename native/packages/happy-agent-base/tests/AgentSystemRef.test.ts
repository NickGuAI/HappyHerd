import { Type } from "@sinclair/typebox";
import { createRootContext, type Context } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import {
    agentId,
    AgentKV,
    AgentRef,
    AgentSystemLocal,
    AgentSystemRef,
    defineAgentTool,
    withAgentContext,
    type AgentModule,
    type AgentModuleScope,
} from "../sources/index.js";
import { InMemoryPersistence } from "./gym/InMemoryPersistence.js";
import { ScriptedProvider } from "./gym/ScriptedProvider.js";
import {
    InMemoryAgentStorage,
    inMemoryStorageLock,
    providersOf,
    textTurn,
    user,
} from "./gym/fixtures.js";

const ctx = createRootContext().named("happy-agent-base-agent-system-ref");

async function localSystem(
    provider: ScriptedProvider,
    stores: Map<string, InMemoryPersistence>,
    modules: readonly AgentModule[] = [],
): Promise<AgentSystemLocal> {
    const managerDisk = new InMemoryPersistence();
    return await AgentSystemLocal.create(
        ctx,
        new InMemoryAgentStorage({
            acquireLock: inMemoryStorageLock(),
            kv: new AgentKV(managerDisk, "agents."),
            persistence: (id) => {
                const existing = stores.get(id);
                if (existing !== undefined) return existing;
                const created = new InMemoryPersistence();
                stores.set(id, created);
                return created;
            },
        }),
        { modules, providers: providersOf(provider), provider: "scripted", models: [] },
    );
}

/**
 * The reference exists so that code the run loop is waiting for cannot wait for the run loop.
 * These check the shape of that promise: what it hands back, and that its one asynchronous-looking
 * operation returns without the agent having acted.
 */
describe("AgentSystemRef", () => {
    it("hands back a reference rather than the agent itself", async () => {
        const stores = new Map<string, InMemoryPersistence>();
        const system = await localSystem(new ScriptedProvider([textTurn("answered")]), stores);
        const ref = new AgentSystemRef(system);

        const created = await ref.create(ctx, {});
        const resolved = await ref.resolve(ctx, created.id);

        expect({
            created: created instanceof AgentRef,
            resolved: resolved instanceof AgentRef,
            id: created.id,
            // Nothing that waits for a run loop is reachable through the reference.
            reachable: Object.getOwnPropertyNames(Object.getPrototypeOf(created)).sort(),
        }).toEqual({
            created: true,
            resolved: true,
            id: created.id,
            reachable: ["abort", "compact", "constructor", "id", "send", "steer", "updateMetadata"],
        });

        expect(created.id).toMatch(/^[a-z0-9]+$/);
        await system.delete(ctx, created.id);
    });

    it("sends and steers through the reference exactly as the agent does", async () => {
        const stores = new Map<string, InMemoryPersistence>();
        const provider = new ScriptedProvider([textTurn("first"), textTurn("second")]);
        const system = await localSystem(provider, stores);
        const ref = new AgentSystemRef(system);

        const agent = await ref.create(ctx, {});
        await agent.send(ctx, user("hello"));
        await (await system.resolve(ctx, agent.id)).waitForIdle();
        await agent.steer(ctx, user("and this"));
        await (await system.resolve(ctx, agent.id)).waitForIdle();

        const asked = provider.sessions.flatMap((session) =>
            session.requests.flatMap((request) =>
                request.context.messages.flatMap((message) =>
                    message.role === "user"
                        ? message.content.flatMap((block) =>
                              block.type === "text" ? [block.text] : [],
                          )
                        : [],
                ),
            ),
        );
        await system.delete(ctx, agent.id);

        expect(asked).toEqual(["hello", "hello", "and this"]);
    });

    it("reports whether another agent accepted a message, and never waits on the caller's own", async () => {
        const stores = new Map<string, InMemoryPersistence>();
        const system = await localSystem(new ScriptedProvider([textTurn("answered")]), stores);
        const ref = new AgentSystemRef(system);
        const target = await ref.create(ctx, {});
        const store = stores.get(target.id);
        if (store === undefined) throw new Error("The agent's store was not created.");
        const writeValue = store.writeValue.bind(store);
        store.writeValue = (writeCtx, key, value) =>
            key.startsWith("steering.")
                ? Promise.reject(new Error("queue write unavailable"))
                : writeValue(writeCtx, key, value);

        // From another agent, acceptance is a durable write this caller may be told about.
        const fromElsewhere = withAgentContext(ctx, {
            id: "caller",
            provider: "scripted",
            permissionMode: "auto",
        });
        const elsewhere = await ref
            .steer(fromElsewhere, target.id, user("from another agent"))
            .then(() => "accepted")
            .catch((error: unknown) => (error as Error).message);

        // From inside the target's own loop, the write is the loop's to make: the message is
        // queued and nothing is waited for.
        const fromItself = withAgentContext(ctx, {
            id: target.id,
            provider: "scripted",
            permissionMode: "auto",
        });
        const itself = await ref
            .steer(fromItself, target.id, user("from itself"))
            .then(() => "queued")
            .catch((error: unknown) => (error as Error).message);

        store.writeValue = writeValue;
        await system.delete(ctx, target.id);

        expect({ elsewhere, itself }).toEqual({
            elsewhere: "queue write unavailable",
            itself: "queued",
        });
    });

    it("returns from a compaction as soon as it is asked for", async () => {
        const stores = new Map<string, InMemoryPersistence>();
        const provider = new ScriptedProvider([textTurn("answered")]);
        const system = await localSystem(provider, stores);
        const ref = new AgentSystemRef(system);
        const agent = await ref.create(ctx, {});
        await agent.send(ctx, user("hello"));
        const live = await system.resolve(ctx, agent.id);
        await live.waitForIdle();
        const session = provider.sessions[0];
        if (session === undefined) throw new Error("The provider session was not created.");
        session.compactionResults = [
            {
                status: "completed",
                preservedMessages: [],
                usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
                context: { instructions: "", messages: [] },
            },
        ];

        await agent.compact(ctx);
        const compactedWhenAsked = session.compactions.length;
        await live.waitForIdle();
        const compactedAfterTheTurn = session.compactions.length;
        await system.delete(ctx, agent.id);

        // The request is the whole answer: it resolves before the compaction has run, which is
        // exactly what makes it safe to ask for from inside the turn that would run it.
        expect({ compactedWhenAsked, compactedAfterTheTurn }).toEqual({
            compactedWhenAsked: 0,
            compactedAfterTheTurn: 1,
        });
    });

    it("lets a tool compact its own agent through the reference without deadlocking", async () => {
        const stores = new Map<string, InMemoryPersistence>();
        const provider = new ScriptedProvider([
            [
                { type: "toolcall_start", callId: "a", name: "compact_me" },
                { type: "toolcall_end", callId: "a", arguments: "{}" },
                { type: "done", state: "tool_call", tokens: { input: 1, output: 1 } },
            ],
            textTurn("done"),
        ]);
        let failure: string | undefined;
        const module: AgentModule = new (class implements AgentModule {
            readonly name = "self-compacting";

            beforeStart() {
                return {
                    tools: () => [
                        defineAgentTool({
                            name: "compact_me",
                            parameters: Type.Object({}),
                            returnType: Type.Object({}),
                            shouldReviewInAutoMode: () => false,
                            execute: async (callCtx: Context) => {
                                try {
                                    await reference.compact(callCtx, agentId(callCtx) ?? "");
                                } catch (error: unknown) {
                                    failure =
                                        error instanceof Error ? error.message : String(error);
                                }
                                return {};
                            },
                            toLLM: () => [{ type: "text", text: "asked" }],
                        }),
                    ],
                };
            }
        })();
        const system = await localSystem(provider, stores, [module]);
        const reference = new AgentSystemRef(system);

        const agent = await system.create(ctx, {});
        await agent.send(ctx, user("go"));
        await agent.waitForIdle();
        await system.delete(ctx, agent.id);

        // The direct `compact` refuses this exact call; through the reference it is a request,
        // so the tool returns, its result settles, and compaction runs before the continuation.
        expect(failure).toBeUndefined();
    });

    it("lets a hook abort its own turn through the reference without deadlocking", async () => {
        const stores = new Map<string, InMemoryPersistence>();
        const provider = new ScriptedProvider([textTurn("first"), textTurn("second")]);
        const events: string[] = [];
        let asked = false;
        const module: AgentModule = new (class implements AgentModule {
            readonly name = "self-aborting";

            beforeStart() {
                return {
                    onEvent: (
                        _hookCtx: Context,
                        _scope: AgentModuleScope,
                        event: { readonly type: string; readonly state?: string },
                    ) => {
                        if (event.type === "done") events.push(event.state ?? "unknown");
                    },
                    beforeInference: async (hookCtx: Context) => {
                        if (asked) return;
                        asked = true;
                        // `agent.abort()` here would wait for the loop that is waiting for this hook.
                        await reference.abort(hookCtx, agentId(hookCtx) ?? "");
                    },
                };
            }
        })();
        const system = await localSystem(provider, stores, [module]);
        const reference = new AgentSystemRef(system);

        const agent = await system.create(ctx, {});
        await agent.send(ctx, user("go"));
        await agent.waitForIdle();
        await system.delete(ctx, agent.id);

        // `agent.abort()` from this hook never returns. Through the reference the hook returns,
        // the loop unwinds, and the turn really was cancelled rather than merely allowed to end.
        expect({ asked, events }).toEqual({ asked: true, events: ["cancelled"] });
    });
});
