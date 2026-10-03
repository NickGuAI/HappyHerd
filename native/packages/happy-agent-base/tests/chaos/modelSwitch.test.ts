import { createRootContext } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import { AgentBase, AgentProviders, type AgentBaseMessageOptions } from "../../sources/index.js";
import { CrashingPersistence, isCrash } from "../gym/CrashingPersistence.js";
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
 * Switching to an incompatible model throws the conversation away and starts a new one, which
 * makes it the second operation that destroys history — and the one that carries the new
 * settings a restart has to agree with. Crashing around the switch must leave the agent on one
 * side of it or the other: the old conversation with the old model, or the new conversation with
 * the new one, never the old history under the new model.
 */
describe("durability of a model switch under crashes", () => {
    const seeds: number[] = chaosSeeds();

    it.each(seeds)("lands on one side of the switch %i", async (seed) => {
        const next = random(seed);
        const disk = new InMemoryPersistence();
        const providers = new AgentProviders();
        // Two vendors that cannot share a conversation, so the switch really resets.
        providers.add("first", new RespondingProvider(), "codex");
        providers.add("second", new RespondingProvider(), "claude");

        // A message is offered only until it is durably queued: re-sending one a crashed
        // process had already accepted would ask the same question twice.
        const run = async (
            text: string | undefined,
            options: AgentBaseMessageOptions,
            crashAt: number | undefined,
        ): Promise<{ crashed: boolean; queued: boolean }> => {
            const persistence = new CrashingPersistence(disk, crashAt);
            const agent = await AgentBase.create(ctx, {
                id: "switching-agent",
                providers,
                provider: "first",
                persistence,
            });
            let queued = text === undefined;
            try {
                if (text !== undefined) {
                    await agent.send(ctx, user(text), { ...options });
                    queued = true;
                }
                agent.start();
                await agent.waitForIdle();
                if (!persistence.crashed) await agent.close();
                return { crashed: persistence.crashed, queued };
            } catch (error: unknown) {
                if (!isCrash(error) && !persistence.crashed) throw error;
                return { crashed: true, queued };
            }
        };

        // A conversation on the first model, then the switch, each retried until it gets through.
        const first = await run("before the switch", { model: "model-a" }, undefined);
        expect(first.crashed).toBe(false);
        expect(askedIn(transcriptOf(disk))).toEqual(["before the switch"]);

        let crashesLeft = 1 + Math.floor(next() * 4);
        let switched = false;
        let offered: string | undefined = "after the switch";
        for (let attempt = 0; attempt < 30; attempt += 1) {
            const result = await run(
                offered,
                { provider: "second", model: "model-b" },
                crashesLeft > 0 ? 1 + Math.floor(next() * 25) : undefined,
            );
            if (result.queued) offered = undefined;

            // Whenever the disk is read, the conversation is one whole side of the switch: it
            // still holds everything that was said before it, or it holds only what came after.
            const asked = askedIn(transcriptOf(disk));
            expect([
                "before the switch",
                "before the switch|after the switch",
                "after the switch",
            ]).toContain(asked.join("|"));

            if (result.crashed) {
                crashesLeft -= 1;
                continue;
            }
            if (offered === undefined) {
                switched = true;
                break;
            }
        }
        expect(switched).toBe(true);

        // The reset really happened and really stuck: the old conversation is gone, the new one
        // stands alone, and the settings the switch carried survived every crash on the way.
        const transcript = transcriptOf(disk);
        expect(askedIn(transcript)).toEqual(["after the switch"]);
        expect(disk.values.get("settings")).toMatchObject({
            provider: "second",
            model: "model-b",
        });

        // The new conversation is as well-formed as any other.
        const dispatched = toolCallsIn(transcript).map((call) => call.callId);
        const settled = transcript
            .filter((message) => message.role === "tool")
            .map((message) => message.callId);
        expect([...settled].sort()).toEqual([...dispatched].sort());
        expect(transcript.at(-1)?.role).toBe("assistant");
        expect(textIn(transcript).at(-1)).toBe("answer-1");
    });
});
