import type { SessionCompaction } from "@slopus/happy-providers";
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

const SUMMARY = "everything so far, in short";

function summary(): SessionCompaction {
    return {
        status: "completed",
        preservedMessages: [],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
        context: {
            instructions: "",
            messages: [{ role: "user", content: [{ type: "text", text: SUMMARY }] }],
        },
    };
}

/**
 * Compacting a quiet conversation is the easy case. This one compacts a busy one: messages are
 * waiting in both queues, tool calls are being dispatched, and the process keeps dying. The
 * replacement supersedes what was said before it, but it must never swallow a message that was
 * accepted and not yet answered — those live in the durable queues, not in the conversation, and
 * are owed an answer on the other side of the compaction.
 */
describe("durability of compaction under load", () => {
    const seeds: number[] = chaosSeeds();

    it.each(seeds)("supersedes a prefix and answers the rest %i", async (seed) => {
        const next = random(seed);
        const world = new ChaosWorld();
        const offered: ChaosMessage[] = Array.from({ length: 4 }, (_, index) => ({
            text: `message-${index}`,
            ...(next() < 0.3 ? { steering: true } : {}),
        }));

        let crashesLeft = 1 + Math.floor(next() * 4);
        let queued = 0;
        let compacted = false;
        for (let process = 0; process < 40; process += 1) {
            const attempt = await runProcess(world, {
                messages: offered.slice(queued),
                // The compaction is asked for while the queues still hold messages, so the turn
                // has to carry out both.
                ...(compacted ? {} : { compaction: summary() }),
                ...(crashesLeft > 0 ? { crashAt: 1 + Math.floor(next() * 35) } : {}),
            });
            queued += attempt.queued;
            if (attempt.compacted) compacted = true;

            // Whatever it caught the agent doing, the disk holds at most one replacement and a
            // conversation that starts either at the beginning or at the summary.
            const seen = askedIn(world.transcript);
            expect(
                world.disk.records.filter((record) => record.type === "compaction").length,
            ).toBeLessThanOrEqual(1);
            expect(new Set(seen).size).toBe(seen.length);

            if (attempt.crashed) {
                crashesLeft -= 1;
                continue;
            }
            if (queued === offered.length && compacted) break;
        }
        expect(queued).toBe(offered.length);
        expect(compacted).toBe(true);

        const transcript = world.transcript;
        const asked = askedIn(transcript);

        // Nothing was said twice, and each queue still delivered in its own order: the
        // replacement supersedes what was already in the conversation without reshuffling what
        // was still waiting to enter it.
        expect(new Set(asked).size).toBe(asked.length);
        const remaining = asked.filter((text) => text !== SUMMARY);
        for (const steering of [true, false]) {
            const expected = offered
                .filter((message) => (message.steering === true) === steering)
                .map((message) => message.text);
            expect(remaining.filter((text) => expected.includes(text))).toEqual(
                expected.filter((text) => remaining.includes(text)),
            );
        }

        // The replacement is in the conversation, and it is the only one. A message that was
        // still waiting in a queue when it committed comes back on the other side of it, while
        // one that had already been answered is legitimately superseded — which is why the
        // messages left over vary by seed rather than being fixed.
        expect(asked).toContain(SUMMARY);
        expect(world.disk.records.filter((record) => record.type === "compaction")).toHaveLength(1);

        // And the compacted conversation is as well-formed as any other.
        const calls = toolCallsIn(transcript);
        const results = transcript.filter((message) => message.role === "tool");
        expect(results.map((result) => result.callId).sort()).toEqual(
            calls.map((call) => call.callId).sort(),
        );
        expect(world.owed).toEqual([]);
        if (world.disk.records.at(-1)?.type === "compaction") {
            // The compaction superseded everything, answers included, and a replacement is not
            // a question: the agent owes nothing and must not invent a response to its own
            // summary.
            expect(asked).toEqual([SUMMARY]);
        } else {
            expect(transcript.at(-1)?.role).toBe("assistant");
            expect(textIn(transcript).at(-1)?.startsWith("answer-")).toBe(true);
        }
    });
});
