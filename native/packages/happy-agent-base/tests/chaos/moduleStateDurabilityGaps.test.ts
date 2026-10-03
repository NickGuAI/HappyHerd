import type { SessionEvent } from "@slopus/happy-providers";
import { createRootContext } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import { AgentBase } from "../../sources/index.js";
import { InMemoryPersistence } from "../gym/InMemoryPersistence.js";
import { ScriptedProvider } from "../gym/ScriptedProvider.js";
import { providersOf, user } from "../gym/fixtures.js";

const ctx = createRootContext().named("happy-agent-base-module-state-durability-gaps");

describe("module and metadata durability gaps", () => {
    it("does not let failed context-token persistence change only the live agent's decisions", async () => {
        const persistence = new InMemoryPersistence();
        const originalWriteValue = persistence.writeValue.bind(persistence);
        persistence.writeValue = (writeCtx, key, value) =>
            key === "context"
                ? Promise.reject(new Error("context metadata unavailable"))
                : originalWriteValue(writeCtx, key, value);
        const liveStarts: (number | undefined)[] = [];
        const liveProvider = new ScriptedProvider([
            tokenTurn("first answer", 100, 20),
            tokenTurn("second answer", 20, 5),
        ]);
        const live = await AgentBase.create(ctx, {
            id: "token-metadata",
            providers: providersOf(liveProvider),
            provider: "scripted",
            persistence,
            hooks: {
                beforeTurn: (_hookCtx, turn) => {
                    liveStarts.push(turn.contextTokens);
                    return undefined;
                },
            },
        });

        await live.send(ctx, user("first"));
        await live.waitForIdle();
        await live.send(ctx, user("second"));
        await live.waitForIdle();
        await live.close();

        const restartedStarts: (number | undefined)[] = [];
        const restarted = await AgentBase.create(ctx, {
            id: "token-metadata",
            providers: providersOf(new ScriptedProvider([])),
            provider: "scripted",
            persistence,
            hooks: {
                beforeTurn: (_hookCtx, turn) => {
                    restartedStarts.push(turn.contextTokens);
                    return undefined;
                },
            },
        });
        restarted.start();
        await restarted.waitForIdle();
        await restarted.close();

        const liveDurableKnowledge = liveStarts.filter(
            (value): value is number => value !== undefined,
        );
        const restartedDurableKnowledge = restartedStarts.filter(
            (value): value is number => value !== undefined,
        );
        expect(liveDurableKnowledge).toEqual(restartedDurableKnowledge);
    });
});

function tokenTurn(text: string, input: number, output: number): SessionEvent[] {
    return [
        { type: "text_start" },
        { type: "text_delta", delta: text },
        { type: "text_end" },
        { type: "done", state: "normal", tokens: { input, output } },
    ];
}
