import { describe, expect, it } from "vitest";

import {
    ChaosWorld,
    askedIn,
    chaosSeeds,
    random,
    runProcess,
    textIn,
    toolCallsIn,
    type ChaosMessage,
} from "../gym/chaosWorld.js";

/**
 * Two durable queues, drained by different rules — steering injects at every stop, a sent
 * message only when the agent would otherwise settle — and both have to survive a crash between
 * the write that accepted a message and the turn that answers it. Each seed queues a different
 * mixture while the process keeps dying underneath it.
 */
describe("durability of the message queues under crashes", () => {
    const seeds: number[] = chaosSeeds();

    it.each(seeds)("keeps every queued message exactly once %i", async (seed) => {
        const next = random(seed);
        const world = new ChaosWorld();
        // A mixture of both kinds, in a fixed order the queues must each preserve.
        const offered: ChaosMessage[] = Array.from({ length: 5 }, (_, index) => ({
            text: `message-${index}`,
            ...(next() < 0.4 ? { steering: true } : {}),
        }));
        let crashesLeft = 1 + Math.floor(next() * 5);
        let queued = 0;

        for (let process = 0; process < 40; process += 1) {
            const attempt = await runProcess(world, {
                messages: offered.slice(queued),
                ...(crashesLeft > 0 ? { crashAt: 1 + Math.floor(next() * 35) } : {}),
            });
            queued += attempt.queued;
            if (attempt.crashed) {
                crashesLeft -= 1;
                continue;
            }
            if (queued === offered.length) break;
        }
        expect(queued).toBe(offered.length);

        const transcript = world.transcript;
        const asked = askedIn(transcript);

        // Every message arrived, exactly once. A crash between the durable write and the turn
        // that consumes it loses nothing, and the resume that follows duplicates nothing.
        expect([...asked].sort()).toEqual(offered.map((message) => message.text).sort());

        // Each queue is sorted, so messages of the same kind keep the order they were accepted
        // in — across restarts, where a fresh process starts its own numbering.
        for (const steering of [true, false]) {
            const expected = offered
                .filter((message) => (message.steering === true) === steering)
                .map((message) => message.text);
            expect(asked.filter((text) => expected.includes(text))).toEqual(expected);
        }

        // Nothing is left owed and the conversation is answered and well-formed.
        expect(world.owed).toEqual([]);
        const calls = toolCallsIn(transcript);
        const results = transcript.filter((message) => message.role === "tool");
        expect(results.map((result) => result.callId).sort()).toEqual(
            calls.map((call) => call.callId).sort(),
        );
        expect(transcript.at(-1)?.role).toBe("assistant");
        expect(textIn(transcript).at(-1)).toBe(`answer-${offered.length}`);
    });
});
