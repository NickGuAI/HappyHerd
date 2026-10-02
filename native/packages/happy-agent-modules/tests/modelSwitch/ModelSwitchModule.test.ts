import { Agent } from "@slopus/happy-agent-base";
import type { SessionEvent } from "@slopus/happy-providers";
import { createRootContext } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import { ModelSwitchModule } from "../../sources/modelSwitch/ModelSwitchModule.js";
import { agentWorld } from "../support/agentWorld.js";
import { providersOf, sharedKV, textTurn, user } from "../support/fixtures.js";
import { resolveModuleRuntime } from "../support/moduleHooks.js";
import { ScriptedProvider } from "../support/ScriptedProvider.js";

const ctx = createRootContext().named("happy-agent-modules-model-switch");

/** One agent running the model-switch module, started without a model of its own. */
async function modelSwitchAgent(agentId: string, script: SessionEvent[][]) {
    const world = await agentWorld();
    const provider = new ScriptedProvider(script);
    const agent = await Agent.create(ctx, {
        id: agentId,
        providers: providersOf(provider),
        provider: "scripted",
        persistence: world.storage.persistence(agentId),
        sharedKV: sharedKV(),
        modules: [await resolveModuleRuntime(ctx, new ModelSwitchModule())],
    });
    return { agent, provider };
}

/** Every notice the agent put in front of a model, across all of its provider sessions. */
function switchNotices(provider: ScriptedProvider): string[] {
    return provider.sessions.flatMap((session) =>
        session.requests.flatMap((request) =>
            request.context.messages.flatMap((message) =>
                message.role === "system"
                    ? message.content.flatMap((block) =>
                          block.type === "text" &&
                          block.text.includes("<model-switch-history-context>")
                              ? [block.text]
                              : [],
                      )
                    : [],
            ),
        ),
    );
}

describe("ModelSwitchModule", () => {
    it("says nothing when a new agent's first message settles its model", async () => {
        const { agent, provider } = await modelSwitchAgent("first-selection-agent", [
            textTurn("hello"),
        ]);

        await agent.send(ctx, user("hi"), { model: "openai/gpt-5.6-sol" });
        await agent.waitForIdle();
        await agent.close();

        expect(switchNotices(provider)).toEqual([]);
    });

    it("explains an incompatible switch that erases a conversation", async () => {
        const { agent, provider } = await modelSwitchAgent("switching-agent", [
            textTurn("hello"),
            textTurn("still here"),
        ]);

        await agent.send(ctx, user("hi"), { model: "openai/gpt-5.6-sol" });
        await agent.waitForIdle();
        await agent.send(ctx, user("carry on"), { model: "anthropic/opus-5" });
        await agent.waitForIdle();
        await agent.close();

        const notices = switchNotices(provider);
        expect(notices).toHaveLength(1);
        expect(notices[0]).toContain("openai/gpt-5.6-sol");
        expect(notices[0]).toContain("anthropic/opus-5");
    });

    it("does not add a notice when the provider keeps a compatible model family", async () => {
        const { agent, provider } = await modelSwitchAgent("compatible-agent", [
            textTurn("hello"),
            textTurn("still here"),
        ]);

        await agent.send(ctx, user("hi"), { model: "openai/gpt-5.6-sol" });
        await agent.waitForIdle();
        await agent.send(ctx, user("carry on"), { model: "openai/gpt-5.4" });
        await agent.waitForIdle();
        await agent.close();

        expect(switchNotices(provider)).toEqual([]);
        expect(provider.sessions).toHaveLength(2);
        expect(provider.sessions[1]?.requests[0]?.context.messages).toContainEqual(user("hi"));
    });
});
