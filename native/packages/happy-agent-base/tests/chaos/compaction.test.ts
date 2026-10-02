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
} from "../gym/chaosWorld.js";

/** A replacement context that stands in for everything said before it. */
function summary(text: string): SessionCompaction {
    return {
        status: "completed",
        preservedMessages: [],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
        context: {
            instructions: "",
            messages: [{ role: "user", content: [{ type: "text", text }] }],
        },
    };
}

/**
 * Compaction is the one operation that destroys history: it deletes every record and writes the
 * replacement. That is why it happens in a single transaction, and why crashing inside it is
 * worth doing on purpose. A conversation must come back either whole or replaced — never
 * half-erased, and never with the replacement stacked on top of the records it replaced.
 */
describe("durability of compaction under crashes", () => {
    const seeds: number[] = chaosSeeds();

    it.each(seeds)("never loses the conversation to a crash mid-compaction %i", async (seed) => {
        const next = random(seed);
        const world = new ChaosWorld();
        const replacement = summary("everything so far, in short");

        // A first conversation, so there is real history for the compaction to destroy.
        await runProcess(world, { messages: [{ text: "first" }] });
        const before = world.transcript;
        expect(askedIn(before)).toEqual(["first"]);

        // Now compact while dying at a randomly chosen operation, again and again.
        let crashesLeft = 1 + Math.floor(next() * 4);
        let compacted = false;
        for (let process = 0; process < 20; process += 1) {
            const attempt = await runProcess(world, {
                compaction: replacement,
                ...(crashesLeft > 0 ? { crashAt: 1 + Math.floor(next() * 20) } : {}),
            });

            // Whenever the disk is inspected, the conversation is one of the two whole states:
            // the one that existed before the compaction, or the replaced one. A crash inside
            // the transaction leaves neither a truncated history nor a doubled one.
            const now = world.transcript;
            const asked = askedIn(now);
            expect(
                asked.join("|") === askedIn(before).join("|") ||
                    asked[0] === "everything so far, in short",
            ).toBe(true);
            expect(now.length).toBeGreaterThan(0);

            if (attempt.compacted) compacted = true;
            if (attempt.crashed) {
                crashesLeft -= 1;
                continue;
            }
            if (compacted) break;
        }
        expect(compacted).toBe(true);

        // The replacement really took over: exactly one compaction record, holding the summary,
        // and no leftovers from the conversation it replaced.
        const compactions = world.disk.records.filter((record) => record.type === "compaction");
        expect(compactions).toHaveLength(1);
        expect(askedIn(world.transcript)[0]).toBe("everything so far, in short");

        // And the compacted agent still works: it answers the next thing it is asked, on top of
        // the replacement rather than the history that is gone.
        const after = await runProcess(world, { messages: [{ text: "next" }] });
        expect(after.crashed).toBe(false);
        const transcript = world.transcript;
        expect(askedIn(transcript)).toEqual(["everything so far, in short", "next"]);
        expect(textIn(transcript).at(-1)).toBe("answer-2");
        const calls = toolCallsIn(transcript);
        const results = transcript.filter((message) => message.role === "tool");
        expect(results.map((result) => result.callId).sort()).toEqual(
            calls.map((call) => call.callId).sort(),
        );
        expect(world.owed).toEqual([]);
    });
});
