import { describe, expect, it } from "vitest";

import { DURABLE_TOOL, FRAGILE_TOOL, toolNameFor } from "../gym/RespondingProvider.js";
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
 * Each seed kills the agent at a different operation, over and over, until it finally gets
 * through. The invariants asserted here are the whole promise of the durable machinery, so they
 * must hold no matter where the process died.
 */
describe("durability under crashes", () => {
    const seeds: number[] = chaosSeeds();

    it.each(seeds)("survives crash schedule %i", async (seed) => {
        const next = random(seed);
        const world = new ChaosWorld();
        const asked = ["first", "second", "third"];
        let crashesLeft = 1 + Math.floor(next() * 5);
        let queued = 0;

        // Crash for a while, then let one process live: a machine that is never left alone can
        // finish nothing, and the interesting part is that it finishes correctly once it is.
        for (let process = 0; process < 40; process += 1) {
            const remaining: ChaosMessage[] = asked.slice(queued).map((text) => ({ text }));
            const attempt = await runProcess(world, {
                messages: remaining,
                ...(crashesLeft > 0 ? { crashAt: 1 + Math.floor(next() * 30) } : {}),
            });
            queued += attempt.queued;
            // Nothing is ever reported as finished before it is durable: a turn that ended
            // normally left its answer on the disk, even in a process that died right after.
            if (attempt.lastDone === "normal") {
                expect(world.transcript.at(-1)?.role).toBe("assistant");
            }
            if (attempt.crashed) {
                crashesLeft -= 1;
                continue;
            }
            if (queued === asked.length) break;
        }
        expect(queued).toBe(asked.length);

        const transcript = world.transcript;

        // 1. Every message reached the conversation exactly once: none lost by a crash between
        //    the durable queue and the context, none replayed by the resume that followed.
        expect(askedIn(transcript)).toEqual(asked);

        // 2. Every dispatched call is settled, exactly once, and no result exists without its
        //    call. A batch cut off mid-flight leaves no half-answered context behind.
        const calls = toolCallsIn(transcript);
        const results = transcript.filter((message) => message.role === "tool");
        const callIds = calls.map((call) => call.callId);
        expect(new Set(callIds).size).toBe(callIds.length);
        expect(results.map((result) => result.callId).sort()).toEqual([...callIds].sort());
        for (const result of results) {
            const callIndex = transcript.findIndex(
                (message) =>
                    message.role === "assistant" &&
                    message.content.some(
                        (block) => block.type === "tool_call" && block.callId === result.callId,
                    ),
            );
            expect(callIndex).toBeLessThan(transcript.indexOf(result));
        }

        // 3. A non-durable call never runs twice: an interrupted one is reported as an error
        //    rather than retried, because its side effect may already have happened.
        const fragile = world.executions.filter((run) => run.tool === FRAGILE_TOOL);
        expect(new Set(fragile.map((run) => run.callId)).size).toBe(fragile.length);
        // A durable call may well run again — that is what durable means — but the conversation
        // still holds exactly one result for it, asserted above.
        for (const call of calls.filter((entry) => entry.name === DURABLE_TOOL)) {
            expect(
                world.executions.filter((run) => run.callId === call.callId).length,
            ).toBeGreaterThanOrEqual(1);
        }

        // 4. Each call carries the name the model chose for its position, so a resumed batch is
        //    the same batch and not a new one that happens to look similar.
        for (const [index, call] of calls.entries()) {
            expect(call.name).toBe(toolNameFor(index));
        }

        // 5. The agent settled with nothing still owed: no queued message, no dispatched call
        //    without a result, and a final answer for the last thing that was asked.
        expect(world.owed).toEqual([]);
        expect(transcript[transcript.length - 1]?.role).toBe("assistant");
        expect(textIn(transcript).at(-1)).toBe(`answer-${asked.length}`);
    });
});
