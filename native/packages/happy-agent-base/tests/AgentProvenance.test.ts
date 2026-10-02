import { Type } from "@sinclair/typebox";
import { createRootContext, type Context } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import {
    AgentKV,
    AgentSystemLocal,
    agentCreatedAt,
    agentCreatedBy,
    agentProvenance,
    defineAgentTool,
    withAgentConfig,
    type AgentModule,
} from "../sources/index.js";
import {
    InMemoryAgentStorage,
    inMemoryStorageLock,
    providersOf,
    textTurn,
    user,
} from "./gym/fixtures.js";
import { InMemoryPersistence } from "./gym/InMemoryPersistence.js";
import { ScriptedProvider } from "./gym/ScriptedProvider.js";

const ctx = createRootContext().named("agent-provenance-test");

/** A response that calls one tool, so what that tool does runs on the calling agent's context. */
function toolCallTurn(name: string) {
    return [
        { type: "toolcall_start", callId: "call-0", name } as const,
        { type: "toolcall_end", callId: "call-0", arguments: "{}" } as const,
        { type: "done", state: "tool_call", tokens: { input: 1, output: 1 } } as const,
    ];
}

/** A collection backed entirely by memory. Each agent gets a store and a scripted reply of its own. */
async function systemOf(modules: readonly AgentModule[] = [], script = [textTurn("hello")]) {
    return await AgentSystemLocal.create(
        ctx,
        new InMemoryAgentStorage({
            acquireLock: inMemoryStorageLock(),
            kv: new AgentKV(new InMemoryPersistence(), "agentSystem."),
            persistence: () => new InMemoryPersistence(),
        }),
        {
            modules: [...modules],
            providers: providersOf(new ScriptedProvider(script)),
            provider: "scripted",
            models: [],
        },
    );
}

describe("agent provenance", () => {
    it("records when an agent was created", async () => {
        const system = await systemOf();
        const before = Date.now();
        const created = await system.create(ctx, {});
        const after = Date.now();

        const config = await system.config(ctx, created.id);
        expect(config?.provenance?.createdAt).toBeGreaterThanOrEqual(before);
        expect(config?.provenance?.createdAt).toBeLessThanOrEqual(after);
    });

    it("leaves an agent nobody created without a creator", async () => {
        const system = await systemOf();
        // The call came from a plain context: a person or the daemon asked for this agent, so it
        // is attributed to nothing rather than to a guess.
        const created = await system.create(ctx, {});

        const config = await system.config(ctx, created.id);
        expect(config?.provenance?.createdBy).toBeUndefined();
    });

    it("records the agent whose own work created another as its creator", async () => {
        let childId: string | undefined;
        // A tool runs on its own agent's context, so an agent it creates is created by that agent
        // rather than by whoever set the whole turn going.
        const spawner: AgentModule = {
            name: "spawner",
            beforeStart: () => ({
                tools: () => [
                    defineAgentTool({
                        name: "spawn",
                        returnType: Type.Object({}),
                        shouldReviewInAutoMode: () => false,
                        execute: async (toolCtx) => {
                            childId = (await system.create(toolCtx, {})).id;
                            return {};
                        },
                        toLLM: () => [{ type: "text", text: "spawned" }],
                    }),
                ],
            }),
        };
        const system = await systemOf([spawner], [toolCallTurn("spawn"), textTurn("spawned one")]);
        const parent = await system.create(ctx, {});

        await parent.send(ctx, user("spawn one"));
        await parent.waitForIdle();

        if (childId === undefined) throw new Error("The tool never created an agent.");
        const config = await system.config(ctx, childId);
        expect(config?.provenance?.createdBy).toBe(parent.id);
    });

    it("keeps what an agent came from across a metadata update", async () => {
        const system = await systemOf();
        const created = await system.create(ctx, {});
        const before = await system.config(ctx, created.id);

        await created.updateMetadata(ctx, { title: "renamed" });
        const after = await system.config(ctx, created.id);

        // Metadata merges into the configuration, and where the agent came from is not metadata.
        expect(after?.provenance).toEqual(before?.provenance);
        expect(after?.metadata?.title).toBe("renamed");
    });

    it("reads what an agent came from off the context its work runs on", async () => {
        const system = await systemOf();
        const created = await system.create(ctx, {});
        const config = await system.config(ctx, created.id);
        if (config === undefined) throw new Error("The created agent has no configuration.");
        const agentCtx: Context = withAgentConfig(ctx, config);

        expect(agentProvenance(agentCtx)).toEqual(config.provenance);
        expect(agentCreatedAt(agentCtx)).toBe(config.provenance?.createdAt);
        expect(agentCreatedBy(agentCtx)).toBeUndefined();
    });

    it("answers nothing on a context no agent has attached a configuration to", () => {
        expect(agentProvenance(ctx)).toBeUndefined();
        expect(agentCreatedAt(ctx)).toBeUndefined();
        expect(agentCreatedBy(ctx)).toBeUndefined();
    });
});
