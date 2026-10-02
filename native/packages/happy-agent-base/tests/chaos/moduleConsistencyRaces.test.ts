import type { SessionEvent } from "@slopus/happy-providers";
import { Type } from "@sinclair/typebox";
import { asyncLock, createRootContext, type Context } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import {
    Agent,
    agentKV,
    AgentKV,
    defineAgentTool,
    withAgentDatabase,
    type AgentModuleHooks,
    type AgentModuleRuntime,
} from "../../sources/index.js";
import { providersOf, sharedKV, testAgentDatabase, textTurn, user } from "../gym/fixtures.js";
import { InMemoryPersistence } from "../gym/InMemoryPersistence.js";
import { ScriptedProvider } from "../gym/ScriptedProvider.js";

const ctx = withAgentDatabase(
    createRootContext().named("module-consistency-races-test"),
    testAgentDatabase(),
);

function runtime(name: string, hooks: AgentModuleHooks): AgentModuleRuntime {
    return { name, module: { name }, hooks };
}

describe("module consistency races", () => {
    it("isolates a dotted KV scope segment from an equivalent dotted relative key", async () => {
        const persistence = new InMemoryPersistence();
        const root = directKV(persistence, "kv.");
        const dottedScope = root.scoped("alpha.beta");
        const dottedKey = root.scoped("alpha");

        await dottedScope.write(ctx, "state", "scope value");
        await dottedKey.write(ctx, "beta.state", "key value");

        expect.soft(await dottedScope.read(ctx, "state")).toBe("scope value");
        expect.soft(await dottedKey.read(ctx, "beta.state")).toBe("key value");
        expect.soft(persistence.values).toHaveLength(2);
    });

    it("isolates dotted module names from dots in another module's relative keys", async () => {
        const persistence = new InMemoryPersistence();
        const provider = new ScriptedProvider([textTurn("first"), textTurn("second")]);
        let dottedModuleObserved: unknown;
        let dottedModuleCalls = 0;
        const dottedModule = runtime("alpha.beta", {
            instructions: async (moduleCtx) => {
                const kv = requiredKV(moduleCtx);
                dottedModuleCalls += 1;
                if (dottedModuleCalls === 1) {
                    await kv.write(moduleCtx, "state", "dotted module");
                } else {
                    dottedModuleObserved = await kv.read(moduleCtx, "state");
                }
                return "";
            },
        });
        const dottedKeyModule = runtime("alpha", {
            instructions: async (moduleCtx) => {
                await requiredKV(moduleCtx).write(moduleCtx, "beta.state", "dotted key");
                return "";
            },
        });
        const agent = await Agent.create(ctx, {
            id: "module-scope-collision",
            providers: providersOf(provider),
            provider: "scripted",
            persistence,
            sharedKV: sharedKV(),
            modules: [dottedModule, dottedKeyModule],
        });

        try {
            await agent.send(ctx, user("first"));
            await agent.waitForIdle();
            await agent.send(ctx, user("second"));
            await agent.waitForIdle();

            expect(dottedModuleObserved).toBe("dotted module");
        } finally {
            await agent.close();
        }
    });

    it("isolates dotted tool call IDs from dots in another call's relative keys", async () => {
        const persistence = new InMemoryPersistence();
        const bothWritesFinished = deferred<void>();
        let writes = 0;
        let dottedCallObserved: unknown;
        let dottedKeyCallObserved: unknown;
        const recordWrite = (): void => {
            writes += 1;
            if (writes === 2) bothWritesFinished.resolve();
        };
        const dottedCallTool = defineAgentTool({
            name: "dotted_call",
            parameters: Type.Object({}),
            returnType: Type.Object({}),
            shouldReviewInAutoMode: () => false,
            execute: async (callCtx) => {
                const kv = requiredKV(callCtx);
                await kv.write(callCtx, "state", "dotted call");
                recordWrite();
                await bothWritesFinished.promise;
                dottedCallObserved = await kv.read(callCtx, "state");
                return {};
            },
            toLLM: () => [{ type: "text", text: "dotted call done" }],
        });
        const dottedKeyTool = defineAgentTool({
            name: "dotted_key",
            parameters: Type.Object({}),
            returnType: Type.Object({}),
            shouldReviewInAutoMode: () => false,
            execute: async (callCtx) => {
                const kv = requiredKV(callCtx);
                await kv.write(callCtx, "one.state", "dotted key");
                recordWrite();
                await bothWritesFinished.promise;
                dottedKeyCallObserved = await kv.read(callCtx, "one.state");
                return {};
            },
            toLLM: () => [{ type: "text", text: "dotted key done" }],
        });
        const toolsModule = runtime("collision-tools", {
            tools: () => [dottedCallTool, dottedKeyTool],
        });
        const provider = new ScriptedProvider([
            toolCallsTurn([
                { callId: "part.one", name: "dotted_call" },
                { callId: "part", name: "dotted_key" },
            ]),
            textTurn("done"),
        ]);
        const agent = await Agent.create(ctx, {
            id: "tool-call-scope-collision",
            providers: providersOf(provider),
            provider: "scripted",
            persistence,
            sharedKV: sharedKV(),
            modules: [toolsModule],
        });

        try {
            await agent.send(ctx, user("run both"));
            await agent.waitForIdle();

            expect.soft(dottedCallObserved).toBe("dotted call");
            expect.soft(dottedKeyCallObserved).toBe("dotted key");
        } finally {
            await agent.close();
        }
    });
});

function directKV(persistence: InMemoryPersistence, prefix: string): AgentKV {
    return new AgentKV(persistence, prefix);
}

function requiredKV(operationCtx: Context): AgentKV {
    const kv = agentKV(operationCtx);
    if (kv === undefined) throw new Error("Expected a scoped AgentKV.");
    return kv;
}

function deferred<Value>(): {
    readonly promise: Promise<Value>;
    readonly resolve: (value: Value) => void;
} {
    let resolve!: (value: Value) => void;
    const promise = new Promise<Value>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function toolCallsTurn(
    calls: readonly { readonly callId: string; readonly name: string }[],
): SessionEvent[] {
    return [
        ...calls.flatMap(({ callId, name }) => [
            { type: "toolcall_start", callId, name } as const,
            { type: "toolcall_end", callId, arguments: "{}" } as const,
        ]),
        {
            type: "done",
            state: "tool_call",
            tokens: { input: 1, output: 1 },
        },
    ];
}
