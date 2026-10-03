import type {
    SessionCompaction,
    SessionEvent,
    SessionToolResultMessage,
} from "@slopus/happy-providers";
import { Type } from "@sinclair/typebox";
import { createRootContext, type Context } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import {
    AgentBase,
    AgentKV,
    agentKV,
    AgentSystemLocal,
    defineAgentTool,
    type Agent,
    type AgentModule,
    type AgentStorageLock,
} from "../../sources/index.js";
import { InMemoryPersistence } from "../gym/InMemoryPersistence.js";
import { ScriptedProvider } from "../gym/ScriptedProvider.js";
import {
    InMemoryAgentStorage,
    inMemoryStorageLock,
    providersOf,
    textTurn,
    user,
} from "../gym/fixtures.js";

const ctx = createRootContext().named("happy-agent-base-self-reentrant-tool-calls");

type Observed =
    | { readonly state: "fulfilled" }
    | { readonly state: "rejected"; readonly message: string }
    | { readonly state: "pending" };

function toolCallTurn(name = "reenter"): SessionEvent[] {
    return [
        { type: "toolcall_start", callId: "self-call", name },
        { type: "toolcall_end", callId: "self-call", arguments: "{}" },
        { type: "done", state: "tool_call", tokens: { input: 1, output: 1 } },
    ];
}

function completedCompaction(): SessionCompaction {
    return {
        status: "completed",
        preservedMessages: [],
        usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
        },
        context: { instructions: "", messages: [] },
    };
}

async function observeWithin(work: Promise<unknown>, milliseconds = 40): Promise<Observed> {
    return Promise.race([
        work.then(
            () => ({ state: "fulfilled" }) as const,
            (error: unknown) =>
                ({
                    state: "rejected",
                    message: error instanceof Error ? error.message : String(error),
                }) as const,
        ),
        new Promise<{ readonly state: "pending" }>((resolve) => {
            setTimeout(() => resolve({ state: "pending" }), milliseconds);
        }),
    ]);
}

function toolResults(persistence: InMemoryPersistence): SessionToolResultMessage[] {
    return persistence.records.flatMap((record) =>
        record.type === "tool" ? [record.message] : [],
    );
}

function selfTool(
    execute: (callCtx: Context) => Promise<void>,
    name = "reenter",
): ReturnType<typeof defineAgentTool> {
    return defineAgentTool({
        name,
        parameters: Type.Object({}),
        returnType: Type.Object({}),
        shouldReviewInAutoMode: () => false,
        execute: async (callCtx) => {
            await execute(callCtx);
            return {};
        },
        toLLM: () => [{ type: "text", text: "finished" }],
    });
}

function managerKV(persistence: InMemoryPersistence): AgentKV {
    return new AgentKV(persistence, "agents.");
}

async function managerHarness(
    provider: ScriptedProvider,
    persistence: InMemoryPersistence,
    execute: (callCtx: Context) => Promise<void>,
    acquireLock: (ctx: Context) => Promise<AgentStorageLock> = inMemoryStorageLock(),
): Promise<{
    readonly manager: AgentSystemLocal;
    readonly managerPersistence: InMemoryPersistence;
}> {
    const tool = selfTool(execute);
    class SelfToolModule implements AgentModule {
        readonly name = "self-tool";

        beforeStart() {
            return {
                tools: (): readonly [typeof tool] => [tool],
            };
        }
    }

    const managerPersistence = new InMemoryPersistence();
    return {
        manager: await AgentSystemLocal.create(
            ctx,
            new InMemoryAgentStorage({
                acquireLock,
                kv: managerKV(managerPersistence),
                persistence: () => persistence,
            }),
            {
                modules: [new SelfToolModule()],
                providers: providersOf(provider),
                provider: "scripted",
                models: [],
            },
        ),
        managerPersistence,
    };
}

/**
 * A tool executes inside the turn whose completion is waiting for that tool result. Reaching
 * back into the same agent must therefore either finish without waiting for the turn, schedule
 * work for after the tool returns, or reject the cyclic wait immediately. Nothing is allowed to
 * hang, lose a durably accepted message, or start provider work before the tool result lands.
 */
describe("self-reentrant tool calls", () => {
    it("lets a tool await a send to itself and answers that message exactly once", async () => {
        const persistence = new InMemoryPersistence();
        const provider = new ScriptedProvider([
            toolCallTurn(),
            textTurn("first answer"),
            textTurn("self answer"),
        ]);
        let agent!: AgentBase;
        let sendCompleted = false;
        const tool = selfTool(async (callCtx) => {
            await agent.send(callCtx, user("sent by the tool"));
            sendCompleted = true;
        });
        agent = await AgentBase.create(ctx, {
            id: "await-self-send",
            providers: providersOf(provider),
            provider: "scripted",
            persistence,
            initialState: { tools: [tool] },
        });

        await agent.send(ctx, user("start"));
        await agent.waitForIdle();
        const requests = provider.sessions[0]?.requests ?? [];
        await agent.close();

        expect(sendCompleted).toBe(true);
        expect(requests).toHaveLength(3);
        expect(requests[1]?.context.messages.at(-1)?.role).toBe("tool");
        expect(requests[2]?.context.messages.at(-1)).toEqual(user("sent by the tool"));
        expect(
            requests[2]?.context.messages.filter(
                (message) =>
                    message.role === "user" &&
                    message.content.some(
                        (block) => block.type === "text" && block.text === "sent by the tool",
                    ),
            ),
        ).toHaveLength(1);
    });

    it("lets a tool await steering itself and injects it before the tool response", async () => {
        const persistence = new InMemoryPersistence();
        const provider = new ScriptedProvider([toolCallTurn(), textTurn("steered answer")]);
        let agent!: AgentBase;
        const tool = selfTool(async (callCtx) => {
            await agent.steer(callCtx, user("steered by the tool"));
        });
        agent = await AgentBase.create(ctx, {
            id: "await-self-steer",
            providers: providersOf(provider),
            provider: "scripted",
            persistence,
            initialState: { tools: [tool] },
        });

        await agent.send(ctx, user("start"));
        await agent.waitForIdle();
        const requests = provider.sessions[0]?.requests ?? [];
        await agent.close();

        expect(requests).toHaveLength(2);
        expect(requests[1]?.context.messages.at(-2)?.role).toBe("tool");
        expect(requests[1]?.context.messages.at(-1)).toEqual(user("steered by the tool"));
    });

    it("keeps a fire-and-forget self-send alive after the tool returns", async () => {
        const persistence = new InMemoryPersistence();
        const provider = new ScriptedProvider([
            toolCallTurn(),
            textTurn("first answer"),
            textTurn("deferred answer"),
        ]);
        let agent!: AgentBase;
        let sending!: Promise<unknown>;
        const tool = selfTool((callCtx) => {
            sending = agent.send(callCtx, user("fire-and-forget send"));
            return Promise.resolve();
        });
        agent = await AgentBase.create(ctx, {
            id: "fire-and-forget-self-send",
            providers: providersOf(provider),
            provider: "scripted",
            persistence,
            initialState: { tools: [tool] },
        });

        await agent.send(ctx, user("start"));
        await sending;
        await agent.waitForIdle();
        const requests = provider.sessions[0]?.requests ?? [];
        await agent.close();

        expect(requests).toHaveLength(3);
        expect(requests[2]?.context.messages.at(-1)).toEqual(user("fire-and-forget send"));
        expect(toolResults(persistence)).toHaveLength(1);
    });

    it("requests self-compaction promptly without poisoning a later compaction", async () => {
        const persistence = new InMemoryPersistence();
        const provider = new ScriptedProvider([toolCallTurn(), textTurn("after tool")]);
        let agent!: AgentBase;
        let insideResult!: Observed;
        const tool = selfTool(async (callCtx) => {
            insideResult = await observeWithin(agent.compact(callCtx));
        });
        agent = await AgentBase.create(ctx, {
            id: "await-self-compaction",
            providers: providersOf(provider),
            provider: "scripted",
            persistence,
            initialState: { tools: [tool] },
        });

        await agent.send(ctx, user("start"));
        await agent.waitForIdle();
        const session = provider.sessions[0];
        session?.compactionResults.push(completedCompaction());
        await agent.compact(ctx);
        await agent.waitForIdle();
        await agent.close();

        expect(insideResult).toMatchObject({
            state: "fulfilled",
        });
        expect(session?.compactions).toHaveLength(2);
    });

    it("lets a tool abort its own turn and durably closes its call", async () => {
        const persistence = new InMemoryPersistence();
        const events: SessionEvent[] = [];
        const provider = new ScriptedProvider([toolCallTurn(), textTurn("must not run")]);
        let agent!: AgentBase;
        let abortResult!: Observed;
        const tool = selfTool(async (callCtx) => {
            abortResult = await observeWithin(agent.abort(callCtx));
        });
        agent = await AgentBase.create(ctx, {
            id: "await-self-abort",
            providers: providersOf(provider),
            provider: "scripted",
            persistence,
            hooks: { onEvent: (_eventCtx, event) => events.push(event) },
            initialState: { tools: [tool] },
        });

        await agent.send(ctx, user("start"));
        await agent.waitForIdle();
        const results = toolResults(persistence);
        const requests = provider.sessions[0]?.requests ?? [];
        await agent.close();

        expect(abortResult).toEqual({ state: "fulfilled" });
        expect(requests).toHaveLength(1);
        expect(results).toMatchObject([
            {
                callId: "self-call",
                isError: true,
                content: [{ type: "text", text: "The tool call was aborted." }],
            },
        ]);
        expect(events.at(-1)).toEqual({ type: "done", state: "cancelled" });
    });

    it("rejects an awaited self-close promptly instead of creating a cyclic shutdown", async () => {
        const persistence = new InMemoryPersistence();
        const provider = new ScriptedProvider([toolCallTurn(), textTurn("after tool")]);
        let agent!: AgentBase;
        let closeResult!: Observed;
        const tool = selfTool(async () => {
            closeResult = await observeWithin(agent.close());
        });
        agent = await AgentBase.create(ctx, {
            id: "await-self-close",
            providers: providersOf(provider),
            provider: "scripted",
            persistence,
            initialState: { tools: [tool] },
        });

        await agent.send(ctx, user("start"));
        await agent.waitForIdle();
        await agent.close();

        expect(closeResult).toMatchObject({
            state: "rejected",
            message: expect.stringContaining("cannot finish"),
        });
        expect(provider.sessions[0]?.destroyCalls).toBe(1);
    });

    it("drains a fire-and-forget self-close after the tool releases the turn", async () => {
        const persistence = new InMemoryPersistence();
        const provider = new ScriptedProvider([toolCallTurn(), textTurn("after tool")]);
        let agent!: AgentBase;
        let closing!: Promise<void>;
        const tool = selfTool(() => {
            closing = agent.close();
            return Promise.resolve();
        });
        agent = await AgentBase.create(ctx, {
            id: "fire-and-forget-self-close",
            providers: providersOf(provider),
            provider: "scripted",
            persistence,
            initialState: { tools: [tool] },
        });

        await agent.send(ctx, user("start"));
        await agent.waitForIdle();
        const result = await observeWithin(closing, 200);

        expect(result).toEqual({ state: "fulfilled" });
        expect(toolResults(persistence)).toHaveLength(1);
        expect(provider.sessions[0]?.destroyCalls).toBe(1);
    });

    it("keeps the store locked until a reentrant system close actually finishes", async () => {
        const persistence = new InMemoryPersistence();
        const provider = new ScriptedProvider([toolCallTurn(), textTurn("after tool")]);
        let manager!: AgentSystemLocal;
        let released = false;
        let releasedInsideTool = true;
        let closeResult!: Observed;
        let toolFinished = (): void => undefined;
        const toolFinishedPromise = new Promise<void>((resolve) => {
            toolFinished = resolve;
        });
        const harness = await managerHarness(
            provider,
            persistence,
            async (callCtx) => {
                closeResult = await observeWithin(manager.close(callCtx));
                releasedInsideTool = released;
                toolFinished();
            },
            () =>
                Promise.resolve({
                    release: () => {
                        released = true;
                        return Promise.resolve();
                    },
                }),
        );
        manager = harness.manager;
        const agent = await manager.create(ctx, {});

        await agent.send(ctx, user("start"));
        await toolFinishedPromise;
        expect(closeResult).toMatchObject({
            state: "rejected",
            message: expect.stringContaining("inside one of its own agents"),
        });
        expect(releasedInsideTool).toBe(false);

        await manager.close(ctx);
        expect(released).toBe(true);
        expect(provider.sessions[0]?.destroyCalls).toBe(1);
    });

    it("revokes a detached tool store before the system releases its lock", async () => {
        const persistence = new InMemoryPersistence();
        const provider = new ScriptedProvider([toolCallTurn()]);
        let manager!: AgentSystemLocal;
        let released = false;
        let releaseTool = (): void => undefined;
        let toolStarted = (): void => undefined;
        let toolFinished = (): void => undefined;
        const toolStartedPromise = new Promise<void>((resolve) => {
            toolStarted = resolve;
        });
        const toolFinishedPromise = new Promise<void>((resolve) => {
            toolFinished = resolve;
        });
        let writeError: string | undefined;
        const harness = await managerHarness(
            provider,
            persistence,
            async (callCtx) => {
                toolStarted();
                await new Promise<void>((resolve) => {
                    releaseTool = resolve;
                });
                try {
                    await agentKV(callCtx)?.write(callCtx, "late", true);
                } catch (error: unknown) {
                    writeError = error instanceof Error ? error.message : String(error);
                } finally {
                    toolFinished();
                }
            },
            () =>
                Promise.resolve({
                    release: () => {
                        released = true;
                        return Promise.resolve();
                    },
                }),
        );
        manager = harness.manager;
        const agent = await manager.create(ctx, {});

        await agent.send(ctx, user("start"));
        await toolStartedPromise;
        await manager.close(ctx);
        expect(released).toBe(true);

        releaseTool();
        await toolFinishedPromise;
        expect(writeError).toContain("context belongs to has ended");
        expect([...persistence.values.keys()].some((key) => key.endsWith(".late"))).toBe(false);
    });

    it("lets a tool resolve its own manager-owned agent without waiting on manager state", async () => {
        const persistence = new InMemoryPersistence();
        const provider = new ScriptedProvider([toolCallTurn(), textTurn("after tool")]);
        let manager!: AgentSystemLocal;
        let agent!: Agent;
        let resolved!: Agent;
        const harness = await managerHarness(provider, persistence, async (callCtx) => {
            resolved = await manager.resolve(callCtx, agent.id);
        });
        manager = harness.manager;
        agent = await manager.create(ctx, {});

        await agent.send(ctx, user("start"));
        await agent.waitForIdle();
        await agent.close();

        expect(resolved).toBe(agent);
        expect(provider.sessions[0]?.requests).toHaveLength(2);
    });

    it("lets a tool await its manager sending to the same agent exactly once", async () => {
        const persistence = new InMemoryPersistence();
        const provider = new ScriptedProvider([
            toolCallTurn(),
            textTurn("first answer"),
            textTurn("manager answer"),
        ]);
        let manager!: AgentSystemLocal;
        let agent!: Agent;
        let managerSendResult!: Observed;
        const harness = await managerHarness(provider, persistence, async (callCtx) => {
            managerSendResult = await observeWithin(
                manager.send(callCtx, agent.id, user("sent through manager")),
            );
        });
        manager = harness.manager;
        agent = await manager.create(ctx, {});

        await agent.send(ctx, user("start"));
        await agent.waitForIdle();
        const requests = provider.sessions[0]?.requests ?? [];
        await agent.close();

        expect(managerSendResult).toEqual({ state: "fulfilled" });
        expect(requests).toHaveLength(3);
        expect(requests[2]?.context.messages.at(-1)).toEqual(user("sent through manager"));
        expect(
            requests[2]?.context.messages.filter(
                (message) =>
                    message.role === "user" &&
                    message.content.some(
                        (block) => block.type === "text" && block.text === "sent through manager",
                    ),
            ),
        ).toHaveLength(1);
    });

    it("requests manager compaction of the current tool's own agent without hanging", async () => {
        const persistence = new InMemoryPersistence();
        const provider = new ScriptedProvider([toolCallTurn(), textTurn("after tool")]);
        let manager!: AgentSystemLocal;
        let agent!: Agent;
        let compactResult!: Observed;
        const harness = await managerHarness(provider, persistence, async (callCtx) => {
            compactResult = await observeWithin(manager.compact(callCtx, agent.id));
        });
        manager = harness.manager;
        agent = await manager.create(ctx, {});

        await agent.send(ctx, user("start"));
        await agent.waitForIdle();
        const session = provider.sessions[0];
        session?.compactionResults.push(completedCompaction());
        await manager.compact(ctx, agent.id);
        await agent.waitForIdle();
        await agent.close();

        expect(compactResult).toMatchObject({
            state: "fulfilled",
        });
        expect(session?.compactions).toHaveLength(2);
    });
});
