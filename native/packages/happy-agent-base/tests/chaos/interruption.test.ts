import { describe, expect, it } from "vitest";

import { FRAGILE_TOOL } from "../gym/RespondingProvider.js";
import {
    ChaosWorld,
    askedIn,
    chaosSeeds,
    random,
    runProcess,
    textIn,
    toolCallsIn,
} from "../gym/chaosWorld.js";

/**
 * An interruption is the ordinary counterpart of a crash: the user stops the turn wherever it
 * happens to be — mid-response, mid-tool-batch — and the agent has to leave a conversation that
 * a later turn can pick up. Each seed aborts at a different point in the event stream, and some
 * seeds crash on top of that, so the two recovery paths are exercised against each other.
 */
describe("durability under interruptions", () => {
    const seeds: number[] = chaosSeeds();

    it.each(seeds)("leaves a conversation a later turn can continue %i", async (seed) => {
        const next = random(seed);
        const world = new ChaosWorld();
        const asked = ["first", "second"];
        let queued = 0;
        let interruptions = 2 + Math.floor(next() * 4);

        for (let process = 0; process < 40; process += 1) {
            const interrupting = interruptions > 0;
            const attempt = await runProcess(world, {
                messages: asked.slice(queued).map((text) => ({ text })),
                // Aborting after a randomly chosen number of events lands anywhere: between
                // blocks, inside a tool batch, or after the response is already complete.
                ...(interrupting ? { abortAfterEvents: 1 + Math.floor(next() * 8) } : {}),
                // Every other seed also dies while being interrupted.
                ...(interrupting && next() < 0.4 ? { crashAt: 1 + Math.floor(next() * 30) } : {}),
            });
            queued += attempt.queued;

            // However a turn ended, the durable conversation is always well-formed: no result
            // without its call, and never two results for one call.
            const during = world.transcript;
            const dispatched = toolCallsIn(during).map((call) => call.callId);
            const settled = during
                .filter((message) => message.role === "tool")
                .map((message) => message.callId);
            expect(new Set(settled).size).toBe(settled.length);
            for (const callId of settled) expect(dispatched).toContain(callId);

            if (interrupting) {
                interruptions -= 1;
                continue;
            }
            if (queued === asked.length) break;
        }
        expect(queued).toBe(asked.length);

        const transcript = world.transcript;

        // An interrupted turn keeps its queued messages, so nothing was consumed and thrown
        // away with the turn that was cancelled, and nothing was answered twice.
        expect(askedIn(transcript)).toEqual(asked);

        // Every call the conversation holds is settled — an aborted call by an error result
        // rather than a missing one, so the context is never left owing the model an answer.
        const calls = toolCallsIn(transcript);
        const results = transcript.filter((message) => message.role === "tool");
        expect(results.map((result) => result.callId).sort()).toEqual(
            calls.map((call) => call.callId).sort(),
        );

        // An interrupted non-durable tool is never run a second time, no matter how the turn
        // that dispatched it ended.
        const fragile = world.executions.filter((run) => run.tool === FRAGILE_TOOL);
        expect(new Set(fragile.map((run) => run.callId)).size).toBe(fragile.length);

        // The agent settles owing nothing and having answered the last thing it was asked.
        expect(world.owed).toEqual([]);
        expect(transcript.at(-1)?.role).toBe("assistant");
        expect(textIn(transcript).at(-1)).toBe(`answer-${asked.length}`);
    });
});
