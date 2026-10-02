import { createRootContext, type Context } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import {
    AgentBase,
    agentBaseStoreOwesWork,
    AGENT_BASE_PENDING_KEY,
    type AgentBaseActivation,
} from "../sources/index.js";
import { InMemoryPersistence } from "./gym/InMemoryPersistence.js";
import { ScriptedProvider } from "./gym/ScriptedProvider.js";
import { providersOf, textTurn, user, userRecord } from "./gym/fixtures.js";

const ctx = createRootContext().named("happy-agent-base-activation");
const LOOP_ID = "l12345678901234567890123";

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

/**
 * The activation hook announces the moment a settled agent starts owing work: inside the
 * transaction that schedules a message onto it, or — after a restart — inside the transaction the
 * resumed run first records its stage in, with `restored` telling the two apart.
 */
describe("activation hook", () => {
    it("fires inside the scheduling transaction, before the message is accepted", async () => {
        const persistence = new InMemoryPersistence();
        const order: string[] = [];
        const provider = new ScriptedProvider([textTurn("answer")]);
        const agent = await AgentBase.create(ctx, {
            id: "activates-on-schedule",
            providers: providersOf(provider),
            provider: "scripted",
            persistence,
            hooks: {
                afterAgentActivatedTransact: (_hookCtx, activation: AgentBaseActivation) => {
                    order.push(`activated restored=${String(activation.restored)}`);
                },
                messageAcceptedTransact: () => {
                    order.push("accepted");
                },
            },
        });

        await agent.send(ctx, user("question"));
        // The announcement happened when the message was scheduled, before any turn consumed it.
        expect(order).toEqual(["activated restored=false"]);
        await agent.waitForIdle();

        expect(order).toEqual(["activated restored=false", "accepted"]);
        await agent.close();
    });

    it("fires once per active period, and again after the agent settles", async () => {
        const persistence = new InMemoryPersistence();
        const activations: boolean[] = [];
        const inferenceStarted = deferred();
        const releaseInference = deferred();
        let held = false;
        const provider = new ScriptedProvider([textTurn("one"), textTurn("two")]);
        const agent = await AgentBase.create(ctx, {
            id: "activates-per-period",
            providers: providersOf(provider),
            provider: "scripted",
            persistence,
            hooks: {
                afterAgentActivatedTransact: (_hookCtx, activation: AgentBaseActivation) => {
                    activations.push(activation.restored);
                },
                beforeInference: async () => {
                    if (held) return;
                    held = true;
                    inferenceStarted.resolve();
                    await releaseInference.promise;
                },
            },
        });

        await agent.send(ctx, user("first"));
        await inferenceStarted.promise;
        // A message scheduled onto an agent that is already working does not activate it again.
        await agent.steer(ctx, user("second"));
        releaseInference.resolve();
        await agent.waitForIdle();
        expect(activations).toEqual([false]);

        // Settled and asked again: this is a fresh activation.
        await agent.send(ctx, user("third"));
        await agent.waitForIdle();
        expect(activations).toEqual([false, false]);
        await agent.close();
    });

    it("announces a restart's resumed work as restored", async () => {
        const persistence = new InMemoryPersistence([userRecord("resume")]);
        persistence.values.set(AGENT_BASE_PENDING_KEY, {
            stage: "inference",
            loopId: LOOP_ID,
        });
        const activations: AgentBaseActivation[] = [];
        const restarted = await AgentBase.load(ctx, {
            id: "restarted",
            providers: providersOf(new ScriptedProvider([textTurn("recovered")])),
            provider: "scripted",
            persistence,
            hooks: {
                afterAgentActivatedTransact: (_hookCtx, activation: AgentBaseActivation) => {
                    activations.push(activation);
                },
            },
        });

        restarted.start();
        await restarted.waitForIdle();

        expect(activations).toEqual([{ restored: true }]);
        expect(await agentBaseStoreOwesWork(ctx, persistence)).toBe(false);
        await restarted.close();
    });

    it("rolls the scheduling back when the hook fails", async () => {
        const persistence = new InMemoryPersistence();
        const provider = new ScriptedProvider([textTurn("answer")]);
        const agent = await AgentBase.create(ctx, {
            id: "activation-rolls-back",
            providers: providersOf(provider),
            provider: "scripted",
            persistence,
            hooks: {
                afterAgentActivatedTransact: async (hookCtx: Context) => {
                    await persistence.writeValue(hookCtx, "awake", true);
                    throw new Error("the activation hook failed");
                },
            },
        });

        await expect(agent.send(ctx, user("question"))).rejects.toThrow(
            "the activation hook failed",
        );

        // Nothing the failed transaction wrote survived: the hook's own write, the queued
        // message, and the pending record all unwound together.
        expect(persistence.values.has("awake")).toBe(false);
        expect(persistence.values.has(AGENT_BASE_PENDING_KEY)).toBe(false);
        expect(await agentBaseStoreOwesWork(ctx, persistence)).toBe(false);
        await agent.close();
    });
});
