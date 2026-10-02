import { createRootContext } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import { AgentBase, AgentProviders } from "../../sources/index.js";
import { FlakyPersistence } from "../gym/CrashingPersistence.js";
import { InMemoryPersistence } from "../gym/InMemoryPersistence.js";
import { RespondingProvider } from "../gym/RespondingProvider.js";
import {
    askedIn,
    chaosSeeds,
    random,
    textIn,
    toolCallsIn,
    transcriptOf,
} from "../gym/chaosWorld.js";
import { user } from "../gym/fixtures.js";

const ctx = createRootContext().named("happy-agent-base-chaos");

/**
 * A store that fails without dying is the awkward case: the agent keeps running, so it has to
 * cope with a write that did not happen rather than simply stopping. Each seed fails a different
 * scatter of operations, then heals, and the agent has to end up with a conversation that is
 * consistent and complete — with nothing accepted from the caller quietly dropped along the way.
 */
describe("durability under a flaky store", () => {
    const seeds: number[] = chaosSeeds();

    it.each(seeds)("stays consistent while the store misbehaves %i", async (seed) => {
        const next = random(seed);
        const disk = new InMemoryPersistence();
        // A scattering of failures over the operations a few turns take, then quiet.
        const broken = new Set(
            Array.from({ length: 3 + Math.floor(next() * 5) }, () => 1 + Math.floor(next() * 45)),
        );
        const persistence = new FlakyPersistence(disk, (operation) => broken.has(operation));
        const providers = new AgentProviders();
        providers.add("responding", new RespondingProvider(), "gym");
        const agent = await AgentBase.create(ctx, {
            id: "flaky-agent",
            providers,
            provider: "responding",
            persistence,
        });

        const asked = ["first", "second", "third"];
        const accepted: string[] = [];
        for (const text of asked) {
            // A send either resolves, and the message is the agent's responsibility from then
            // on, or throws, and the caller knows it was never accepted.
            try {
                await agent.send(ctx, user(text));
                accepted.push(text);
            } catch {
                // The caller would retry; this scenario deliberately does not, so that a
                // dropped message shows up as a missing answer rather than being papered over.
            }
            await agent.waitForIdle();

            // The conversation on disk is well-formed after every turn, however it went: no
            // duplicated message, no result without its call, no two results for one call.
            const during = transcriptOf(disk);
            expect(new Set(askedIn(during)).size).toBe(askedIn(during).length);
            const dispatched = toolCallsIn(during).map((call) => call.callId);
            const settled = during
                .filter((message) => message.role === "tool")
                .map((message) => message.callId);
            expect(new Set(settled).size).toBe(settled.length);
            for (const callId of settled) expect(dispatched).toContain(callId);
        }
        await agent.close();
        expect(persistence.failures).toBeGreaterThan(0);

        // The store is healthy again and the agent restarts, the way a supervisor would restart
        // it. Every message the caller was told had been accepted is now answered, exactly once
        // and in order: a failure that struck between the durable queue and the conversation
        // costs a turn, never the message.
        const healthy = await AgentBase.create(ctx, {
            id: "flaky-agent",
            providers,
            provider: "responding",
            persistence: new FlakyPersistence(disk, () => false),
        });
        healthy.start();
        await healthy.waitForIdle();
        await healthy.close();

        const transcript = transcriptOf(disk);
        expect(askedIn(transcript)).toEqual(accepted);
        // A run where the store rejected every single send has nothing to answer, and that is a
        // correct outcome: the caller was told each time that the message was not accepted.
        if (accepted.length === 0) {
            expect(transcript).toEqual([]);
            return;
        }
        const calls = toolCallsIn(transcript);
        const results = transcript.filter((message) => message.role === "tool");
        expect(results.map((result) => result.callId).sort()).toEqual(
            calls.map((call) => call.callId).sort(),
        );
        expect(
            [...disk.pending.keys()].filter(
                (key) =>
                    key.startsWith("send.") ||
                    key.startsWith("steering.") ||
                    key.startsWith("tool."),
            ),
        ).toEqual([]);
        expect(transcript.at(-1)?.role).toBe("assistant");
        expect(textIn(transcript).at(-1)).toBe(`answer-${accepted.length}`);
    });
});
