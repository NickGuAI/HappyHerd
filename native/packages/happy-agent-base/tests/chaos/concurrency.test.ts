import { createRootContext } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import { AgentBase, AgentProviders } from "../../sources/index.js";
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
 * Wait a random little while: a handful of microtasks lands a caller inside the turn's own
 * awaits, a timer lands it between them, and the mixture reaches both.
 */
async function pause(next: () => number): Promise<void> {
    if (next() < 0.5) {
        for (let tick = Math.floor(next() * 8); tick > 0; tick -= 1) await Promise.resolve();
        return;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.floor(next() * 3)));
}

/**
 * Nothing here crashes: the chaos is that everybody talks at once. Messages, interruptions and
 * starts arrive concurrently from callers that know nothing about each other, landing at every
 * point of a turn — while it loads, between its inferences, in the middle of a tool batch. The
 * conversation still has to come out consistent, which is what the database transactions and
 * durable queues exist for.
 */
describe("durability under concurrent callers", () => {
    const seeds: number[] = chaosSeeds();

    it.each(seeds)("keeps one consistent conversation %i", async (seed) => {
        const next = random(seed);
        const disk = new InMemoryPersistence();
        const providers = new AgentProviders();
        providers.add("responding", new RespondingProvider(), "gym");
        const build = async () =>
            await AgentBase.create(ctx, {
                id: "concurrent-agent",
                providers,
                provider: "responding",
                persistence: disk,
            });
        const agent = await build();

        // Everything at once, with no ordering between the callers beyond what the agent
        // imposes on itself.
        const texts = Array.from({ length: 6 }, (_, index) => `message-${index}`);
        const calls = texts.map((text, index) => async () => {
            // A caller that pauses for a random number of microtasks lands at a different point
            // in the turn each seed.
            await pause(next);
            const message = user(text);
            if (index % 3 === 0) {
                await agent.steer(ctx, message);
            } else {
                await agent.send(ctx, message);
            }
        });
        const disruptions = Array.from({ length: 3 }, () => async () => {
            await pause(next);
            if (next() < 0.5) {
                await agent.abort(ctx);
            } else {
                agent.start();
            }
        });
        await Promise.all([...calls, ...disruptions].map((run) => run()));
        await agent.waitForIdle();
        await agent.close();

        // A restart finishes whatever the interruptions left owed, the way a supervisor would.
        const resumed = await build();
        resumed.start();
        await resumed.waitForIdle();
        await resumed.close();

        const transcript = transcriptOf(disk);

        // Every message the callers were told had been accepted is in the conversation, exactly
        // once: concurrent writers never overwrite each other's queue entries, and a turn that
        // was interrupted mid-drain never consumed a message twice.
        expect([...askedIn(transcript)].sort()).toEqual([...texts].sort());

        // The conversation is well-formed however the turns were cut apart.
        const dispatched = toolCallsIn(transcript).map((call) => call.callId);
        const settled = transcript
            .filter((message) => message.role === "tool")
            .map((message) => message.callId);
        expect(new Set(dispatched).size).toBe(dispatched.length);
        expect([...settled].sort()).toEqual([...dispatched].sort());

        // And it settles: nothing queued, nothing pending, an answer at the end.
        expect(
            [...disk.pending.keys()].filter(
                (key) =>
                    key.startsWith("send.") ||
                    key.startsWith("steering.") ||
                    key.startsWith("tool."),
            ),
        ).toEqual([]);
        expect(transcript.at(-1)?.role).toBe("assistant");
        expect(textIn(transcript).at(-1)).toBe(`answer-${texts.length}`);
    });
});
