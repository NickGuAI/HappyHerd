import type {
    BaseSession,
    SessionEvent,
    SessionOptions,
    SessionRunRequest,
    SessionStream,
} from "@slopus/happy-providers";
import { createRootContext, type Context } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import { AgentBase, agentKV, type AgentKV } from "../../sources/index.js";
import { InMemoryPersistence } from "../gym/InMemoryPersistence.js";
import { ScriptedProvider, ScriptedSession } from "../gym/ScriptedProvider.js";
import { providersOf, textTurn, user } from "../gym/fixtures.js";

const ctx = createRootContext().named("happy-agent-base-core-loop-consistency-gaps");

interface Deferred {
    readonly promise: Promise<void>;
    readonly resolve: () => void;
}

function deferred(): Deferred {
    let resolve!: () => void;
    const promise = new Promise<void>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

/** How a promise settled, so a rejection can be asserted rather than thrown. */
async function outcomeOf(
    work: Promise<unknown>,
): Promise<{ readonly status: "fulfilled" | "rejected" }> {
    try {
        await work;
        return { status: "fulfilled" };
    } catch {
        return { status: "rejected" };
    }
}

async function flushMicrotasks(): Promise<void> {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

/**
 * These scenarios deliberately stop the loop at exact ownership handoffs. They assert that a
 * lifecycle operation is one consistency boundary: its lock cannot escape, its action batch
 * cannot be split, a consumed request cannot leave a phantom turn behind, close has one shared
 * completion, and one response has exactly one terminal event.
 */
describe("core loop consistency gaps", () => {
    it("does not let a model-change hook write through its KV after the hook returns", async () => {
        const persistence = new InMemoryPersistence();
        const provider = new ScriptedProvider([textTurn("switched"), textTurn("after the switch")]);
        let escapedKV: AgentKV | undefined;
        let escapedCtx: Context | undefined;
        const agent = await AgentBase.create(ctx, {
            id: "escaped-model-change-kv",
            providers: providersOf(provider),
            provider: "scripted",
            persistence,
            model: "anthropic/claude",
            hooks: {
                modelChanged: (hookCtx) => {
                    escapedKV = agentKV(hookCtx);
                    escapedCtx = hookCtx;
                    return undefined;
                },
            },
        });

        await agent.send(ctx, user("switch models"), { model: "openai/gpt" });
        await agent.waitForIdle();
        if (escapedKV === undefined || escapedCtx === undefined) {
            throw new Error("The model-change hook did not receive KV.");
        }

        const queueWriteStarted = deferred();
        const releaseQueueWrite = deferred();
        const originalWriteValue = persistence.writeValue.bind(persistence);
        let queueWriteActive = false;
        let escapedWriteOverlappedQueueWrite = false;
        persistence.writeValue = async (writeCtx, key, value) => {
            if (key.startsWith("send.")) {
                queueWriteActive = true;
                queueWriteStarted.resolve();
                await releaseQueueWrite.promise;
                await originalWriteValue(writeCtx, key, value);
                queueWriteActive = false;
                return;
            }
            if (key === "kv.escaped-model-change-kv.after-hook") {
                escapedWriteOverlappedQueueWrite = queueWriteActive;
            }
            await originalWriteValue(writeCtx, key, value);
        };

        const sending = agent.send(ctx, user("ordinary serialized write"));
        await queueWriteStarted.promise;
        const escapedWrite = await outcomeOf(escapedKV.write(escapedCtx, "after-hook", "escaped"));
        const escapedValueLandedBeforeQueueLockReleased =
            persistence.values.get("kv.escaped-model-change-kv.after-hook") === "escaped";

        releaseQueueWrite.resolve();
        await sending;
        await agent.waitForIdle();
        await agent.close();

        // modelChanged runs on the context of the transaction it is invoked inside, and that
        // context ends with the hook. A store is only a scope, so what a retained handle may do
        // is decided by the context it is used with: given the hook's own, it refuses outright
        // rather than accepting a write it will not make.
        expect({
            escapedWrite: escapedWrite.status,
            escapedWriteOverlappedQueueWrite,
            escapedValueLandedBeforeQueueLockReleased,
        }).toEqual({
            escapedWrite: "rejected",
            escapedWriteOverlappedQueueWrite: false,
            escapedValueLandedBeforeQueueLockReleased: false,
        });
    });

    it("does not let an external send split one hook action batch", async () => {
        const persistence = new InMemoryPersistence();
        const provider = new ScriptedProvider([textTurn("first"), textTurn("batched")]);
        const actionA = user("action A");
        const actionB = user("action B");
        const external = user("external");
        let returnedActions = false;
        let externalSend: Promise<unknown> | undefined;
        let agent!: AgentBase;

        const originalWriteValue = persistence.writeValue.bind(persistence);
        persistence.writeValue = async (writeCtx, key, value) => {
            await originalWriteValue(writeCtx, key, value);
            const envelope = value as {
                readonly message?: { readonly content?: readonly unknown[] };
            };
            if (
                key.startsWith("send.") &&
                JSON.stringify(envelope.message) === JSON.stringify(actionA) &&
                externalSend === undefined
            ) {
                // Calling send during action A races an external writer against the action
                // batch; the database transaction must still keep A and B contiguous.
                externalSend = persistence.outsideTransaction(() => agent.send(ctx, external));
            }
        };

        agent = await AgentBase.create(ctx, {
            id: "atomic-hook-actions",
            providers: providersOf(provider),
            provider: "scripted",
            persistence,
            sendMode: "all",
            hooks: {
                afterTurn: () => {
                    if (returnedActions) return undefined;
                    returnedActions = true;
                    return [
                        { type: "send", message: actionA },
                        { type: "send", message: actionB },
                    ];
                },
            },
        });

        await agent.send(ctx, user("begin"));
        await agent.waitForIdle();
        await externalSend;
        await agent.waitForIdle();
        const secondRequest = provider.sessions[0]?.requests[1];
        await agent.close();

        // The two actions came from one hook decision and therefore occupy one contiguous,
        // ordered batch. A caller arriving during their application belongs after that batch.
        expect(secondRequest?.context.messages.slice(-3)).toEqual([actionA, actionB, external]);
    });

    it("does not run a ghost empty turn after consuming a send accepted mid-inference", async () => {
        const provider = new ScriptedProvider([textTurn("first"), textTurn("second")]);
        const firstRunStarted = deferred();
        const releaseFirstRun = deferred();
        const originalSession = provider.session.bind(provider);

        provider.session = async (id: string, options: SessionOptions): Promise<BaseSession> => {
            const session = (await originalSession(id, options)) as ScriptedSession;
            const originalRun = session.run.bind(session);
            let runs = 0;
            session.run = (runCtx, request: SessionRunRequest): SessionStream => {
                const stream = originalRun(runCtx, request);
                runs += 1;
                if (runs !== 1) return stream;
                return (async function* () {
                    firstRunStarted.resolve();
                    await releaseFirstRun.promise;
                    yield* stream;
                })();
            };
            return session;
        };

        let turnsStarted = 0;
        let turnsFinished = 0;
        let inferences = 0;
        const agent = await AgentBase.create(ctx, {
            id: "mid-inference-send",
            providers: providersOf(provider),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            hooks: {
                beforeTurn: () => {
                    turnsStarted += 1;
                    return undefined;
                },
                afterInference: () => {
                    inferences += 1;
                },
                afterTurn: () => {
                    turnsFinished += 1;
                    return undefined;
                },
            },
        });

        await agent.send(ctx, user("first"));
        await firstRunStarted.promise;
        await agent.send(ctx, user("accepted while inference is active"));
        releaseFirstRun.resolve();
        await agent.waitForIdle();
        const requests = provider.sessions[0]?.requests.length;
        await agent.close();

        // The accepted send was drained by the already-running turn. It must not also leave the
        // turn-request flag set and run lifecycle hooks around an empty phantom turn.
        expect({
            requests,
            inferences,
            turnsStarted,
            turnsFinished,
        }).toEqual({
            requests: 2,
            inferences: 2,
            turnsStarted: 1,
            turnsFinished: 1,
        });
    });

    it("makes a reentrant concurrent close await the first session destruction", async () => {
        const provider = new ScriptedProvider([textTurn("ready to close")]);
        const agent = await AgentBase.create(ctx, {
            id: "concurrent-close",
            providers: providersOf(provider),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
        });
        await agent.send(ctx, user("create the session"));
        await agent.waitForIdle();

        const session = provider.sessions[0];
        if (session === undefined) throw new Error("The provider session was not created.");
        const releaseFirstDestroy = deferred();
        let destroyCalls = 0;
        let secondClose: Promise<void> | undefined;
        let secondCloseResolved = false;
        session.destroy = () => {
            destroyCalls += 1;
            if (destroyCalls === 1) {
                // The first close has entered destroy(), but has not yet assigned its shared
                // closing promise. A synchronous participant can therefore enter close again.
                secondClose = agent.close().then(() => {
                    secondCloseResolved = true;
                });
                return releaseFirstDestroy.promise;
            }
            return Promise.resolve();
        };

        const firstClose = agent.close();
        await flushMicrotasks();
        const secondCloseResolvedWhileFirstDestroyWasBlocked = secondCloseResolved;

        releaseFirstDestroy.resolve();
        await Promise.all([firstClose, secondClose]);

        // Every close caller shares one destruction barrier. No caller may finish while the
        // first destroy is blocked, and reentry must not invoke session destruction twice.
        expect({
            secondCloseResolvedWhileFirstDestroyWasBlocked,
            destroyCalls,
        }).toEqual({
            secondCloseResolvedWhileFirstDestroyWasBlocked: false,
            destroyCalls: 1,
        });
    });

    it("emits only one terminal event when normal completion synchronously triggers abort", async () => {
        const provider = new ScriptedProvider([textTurn("finished")]);
        const events: SessionEvent[] = [];
        let aborting: Promise<void> | undefined;
        let agent!: AgentBase;
        agent = await AgentBase.create(ctx, {
            id: "abort-from-normal-done",
            providers: providersOf(provider),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            hooks: {
                onEvent: (hookCtx, event) => {
                    events.push(event);
                    if (
                        event.type === "done" &&
                        event.state === "normal" &&
                        aborting === undefined
                    ) {
                        // abort flips the turn's signal synchronously while collect() is still
                        // handling the provider's normal terminal event.
                        aborting = agent.abort(hookCtx);
                    }
                },
            },
        });

        await agent.send(ctx, user("finish normally"));
        await agent.waitForIdle();
        await aborting;
        const terminalEvents = events.filter((event) => event.type === "done");
        await agent.close();

        // One provider response has one terminal outcome. Cancellation observed after a normal
        // done cannot append a second, contradictory terminal event for that same response.
        expect(terminalEvents).toEqual([
            {
                type: "done",
                state: "normal",
                tokens: { input: 1, output: 1 },
            },
        ]);
    });
});
