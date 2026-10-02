import { createRootContext, withLifetime, type Context } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import { agentStorageTransaction, withAgentStorageTransaction } from "../sources/AgentContexts.js";
import {
    AgentBase,
    agentDatabase,
    withAgentDatabase,
    type AgentDatabase,
} from "../sources/index.js";
import { providersOf, textTurn, user } from "./gym/fixtures.js";
import { InMemoryPersistence } from "./gym/InMemoryPersistence.js";
import { ScriptedProvider } from "./gym/ScriptedProvider.js";

/**
 * A caller in the middle of its own work: it can be cancelled, and it is writing through a
 * transaction facade that stops being usable the moment the call it belongs to commits.
 */
function callerContext(persistence: InMemoryPersistence): {
    readonly ctx: Context;
    readonly abort: AbortController;
    readonly facade: AgentDatabase;
} {
    const abort = new AbortController();
    const facadeLifetime = new AbortController();
    // A stand-in for the facade a transaction installs. It is a different object from the real
    // database, so a context that kept it would visibly be writing through the caller's write.
    const facade = Object.create(persistence.database) as AgentDatabase;
    const ctx = withAgentStorageTransaction(
        withLifetime(
            withAgentDatabase(createRootContext().named("caller"), persistence.database),
            abort.signal,
        ),
        { database: facade, root: persistence.database, lifetime: facadeLifetime.signal },
    );
    return { ctx, abort, facade };
}

/** Runs one turn and hands back the context the agent gave its own work while running it. */
async function agentWorkContext(
    ctx: Context,
    persistence: InMemoryPersistence,
): Promise<{ readonly captured: Context; readonly agent: AgentBase }> {
    let captured: Context | undefined;
    const agent = await AgentBase.create(ctx, {
        id: "detached-agent",
        providers: providersOf(new ScriptedProvider([textTurn("hello")])),
        provider: "scripted",
        persistence,
        hooks: {
            instructions: (hookCtx) => {
                captured ??= hookCtx;
                return "";
            },
        },
    });
    // Delivery happens after the creating call has committed and returned, so it is made from a
    // context of its own — the agent refuses to be spoken to from inside an open transaction.
    await agent.send(createRootContext().named("later"), user("hi"));
    await agent.waitForIdle();
    if (captured === undefined) throw new Error("The instructions hook was never called.");
    return { captured, agent };
}

describe("agent context detachment", () => {
    it("runs on a root of the caller's context rather than on the caller's context", async () => {
        const persistence = new InMemoryPersistence();
        const { ctx } = callerContext(persistence);
        const { captured, agent } = await agentWorkContext(ctx, persistence);
        await agent.close();

        // The caller's cancellation and its in-flight write are facts about the call that asked
        // for the agent, and the agent outlives that call, so neither reached its work.
        expect(captured.lifetime).toBeUndefined();
        expect(agentStorageTransaction(captured)).toBeUndefined();
        // It named the root it made, so what the agent does reads as the agent's own and not as
        // the caller's, whose name the detach dropped.
        expect(captured.name).toBe("agent.detached-agent");
    });

    it("writes through the storage it was given, not the caller's transaction facade", async () => {
        const persistence = new InMemoryPersistence();
        const { ctx, facade } = callerContext(persistence);
        const { captured, agent } = await agentWorkContext(ctx, persistence);
        await agent.close();

        expect(agentDatabase(captured)).toBe(persistence.database);
        expect(agentDatabase(captured)).not.toBe(facade);
    });

    it("keeps running after the call that created it is cancelled", async () => {
        const persistence = new InMemoryPersistence();
        const { ctx, abort } = callerContext(persistence);
        const agent = await AgentBase.create(ctx, {
            id: "detached-agent",
            providers: providersOf(new ScriptedProvider([textTurn("hello")])),
            provider: "scripted",
            persistence,
        });
        // The call returns and takes its cancellation with it. What it started keeps running.
        abort.abort();

        await agent.send(createRootContext().named("later"), user("hi"));
        await agent.waitForIdle();
        await agent.close();

        expect(persistence.records).toContainEqual({
            type: "block",
            block: { type: "text", text: "hello" },
        });
    });
});
