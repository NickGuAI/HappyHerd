import type {
    BaseSession,
    SessionCompactionOptions,
    SessionEvent,
    SessionOptions,
    SessionRunRequest,
    SessionStream,
} from "@slopus/happy-providers";
import { createRootContext, type Context } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import { AgentBase, agentKV } from "../../sources/index.js";
import { InMemoryPersistence } from "../gym/InMemoryPersistence.js";
import { ScriptedProvider, ScriptedSession } from "../gym/ScriptedProvider.js";
import { providersOf, system, textTurn, user, userRecord } from "../gym/fixtures.js";

const ctx = createRootContext().named("happy-agent-base-lifecycle-shutdown-gaps");

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

async function settlesWhileBlocked(promise: Promise<unknown>): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 50);
        void promise.then(
            () => {
                clearTimeout(timer);
                resolve(true);
            },
            () => {
                clearTimeout(timer);
                resolve(true);
            },
        );
    });
}

function oneDoneThenBlockedCleanup(
    runStarted: Deferred,
    cleanupStarted: Deferred,
    releaseCleanup: Deferred,
    onCleanup?: (active: boolean) => void,
): SessionStream {
    let delivered = false;
    const iterator: AsyncIterator<SessionEvent> & AsyncIterable<SessionEvent> = {
        async next() {
            runStarted.resolve();
            if (delivered) return { done: true, value: undefined };
            delivered = true;
            return {
                done: false,
                value: {
                    type: "done",
                    state: "normal",
                    tokens: { input: 1, output: 1 },
                },
            };
        },
        async return() {
            onCleanup?.(true);
            cleanupStarted.resolve();
            await releaseCleanup.promise;
            onCleanup?.(false);
            return { done: true, value: undefined };
        },
        [Symbol.asyncIterator]() {
            return this;
        },
    };
    return iterator;
}

/**
 * These scenarios stop the loop at lifecycle boundaries that are easy to mistake for idle.
 * Aborting, closing, recreating a stateful provider session, and committing a model switch must
 * each cover all work admitted into that lifetime, including hook and iterator cleanup work.
 */
describe("abort and shutdown lifecycle gaps", () => {
    it("cancels a run aborted while beforeAgentLoop is still blocked", async () => {
        const provider = new ScriptedProvider([textTurn("must not run")]);
        const hookStarted = deferred();
        const releaseHook = deferred();
        const agent = await AgentBase.create(ctx, {
            id: "abort-before-agent-loop",
            providers: providersOf(provider),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            hooks: {
                beforeAgentLoop: async () => {
                    hookStarted.resolve();
                    await releaseHook.promise;
                },
            },
        });

        await agent.send(ctx, user("cancel during startup"));
        await hookStarted.promise;
        const aborting = agent.abort(ctx);
        releaseHook.resolve();
        await aborting;
        await agent.waitForIdle();
        const requests = provider.sessions.flatMap((session) => session.requests);
        await agent.close();

        // beforeAgentLoop is part of the run being cancelled. Abort must not miss it merely
        // because the per-turn controller had not yet been installed when the hook began.
        expect(requests).toHaveLength(0);
    });

    it("does not launch an uncancelled turn from an afterTurn action returned after abort", async () => {
        const provider = new ScriptedProvider([
            textTurn("first answer"),
            textTurn("must not answer the late action"),
        ]);
        const hookStarted = deferred();
        const releaseHook = deferred();
        let hookCalls = 0;
        const agent = await AgentBase.create(ctx, {
            id: "abort-during-after-turn",
            providers: providersOf(provider),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            hooks: {
                afterTurn: async () => {
                    hookCalls += 1;
                    if (hookCalls !== 1) return undefined;
                    hookStarted.resolve();
                    await releaseHook.promise;
                    return [{ type: "send", message: user("late hook follow-up") }];
                },
            },
        });

        await agent.send(ctx, user("first request"));
        await hookStarted.promise;
        const aborting = agent.abort(ctx);
        releaseHook.resolve();
        await aborting;
        await agent.waitForIdle();
        const requests = provider.sessions.flatMap((session) => session.requests);
        await agent.close();

        // An abort owns the rest of the active turn, including actions from a hook that was
        // already running. Such an action cannot silently escape into a fresh abort lifetime.
        expect(requests).toHaveLength(1);
    });

    it("passes the active abort lifetime to provider compaction and settles it on abort", async () => {
        const persistence = new InMemoryPersistence([
            userRecord("history to compact"),
            { type: "block", block: { type: "text", text: "old answer" } },
        ]);
        const provider = new ScriptedProvider([]);
        const compactionStarted = deferred();
        const releaseCompaction = deferred();
        const originalSession = provider.session.bind(provider);
        let compactionSignal: AbortSignal | undefined;

        provider.session = async (id: string, options: SessionOptions): Promise<BaseSession> => {
            const session = (await originalSession(id, options)) as ScriptedSession;
            session.compact = async (compactCtx, compactOptions: SessionCompactionOptions) => {
                session.compactions.push(compactOptions);
                compactionSignal = compactCtx.lifetime;
                compactionStarted.resolve();
                await Promise.race([
                    releaseCompaction.promise,
                    new Promise<void>((resolve) => {
                        compactionSignal?.addEventListener("abort", () => resolve(), {
                            once: true,
                        });
                    }),
                ]);
                if (compactionSignal?.aborted === true) {
                    throw new Error("provider compaction aborted");
                }
                return {
                    status: "completed",
                    preservedMessages: [],
                    usage: {
                        input: 10,
                        output: 2,
                        cacheRead: 0,
                        cacheWrite: 0,
                        totalTokens: 12,
                    },
                    context: {
                        instructions: "",
                        messages: [system("compacted")],
                    },
                };
            };
            return session;
        };

        const agent = await AgentBase.create(ctx, {
            id: "abort-provider-compaction",
            providers: providersOf(provider),
            provider: "scripted",
            persistence,
        });
        let compactionSettled = false;
        const compacting = agent.compact(ctx).then(
            () => {
                compactionSettled = true;
            },
            () => {
                compactionSettled = true;
            },
        );
        await compactionStarted.promise;

        const aborting = agent.abort(ctx);
        const abortSettledBeforeRelease = await settlesWhileBlocked(aborting);
        const compactionSettledBeforeRelease = compactionSettled;
        const signalAbortedBeforeRelease = compactionSignal?.aborted === true;

        releaseCompaction.resolve();
        await Promise.all([aborting, compacting]);
        await agent.close();

        // Provider compaction is active turn work just like streaming inference. It receives
        // that turn's lifetime, and cancelling it must settle both public waiters without an
        // unrelated party having to release the provider operation.
        expect({
            receivedAbortLifetime: compactionSignal !== undefined,
            signalAbortedBeforeRelease,
            abortSettledBeforeRelease,
            compactionSettledBeforeRelease,
        }).toEqual({
            receivedAbortLifetime: true,
            signalAbortedBeforeRelease: true,
            abortSettledBeforeRelease: true,
            compactionSettledBeforeRelease: true,
        });
    });

    it("waits for provider stream cleanup before close destroys the session", async () => {
        const provider = new ScriptedProvider([]);
        const runStarted = deferred();
        const cleanupStarted = deferred();
        const releaseCleanup = deferred();
        const originalSession = provider.session.bind(provider);
        let cleanupActive = false;
        let destroyOverlappedCleanup = false;

        provider.session = async (id: string, options: SessionOptions): Promise<BaseSession> => {
            const session = (await originalSession(id, options)) as ScriptedSession;
            session.run = (runCtx, request: SessionRunRequest): SessionStream => {
                session.requestContexts.push(runCtx);
                session.requests.push(request);
                return oneDoneThenBlockedCleanup(
                    runStarted,
                    cleanupStarted,
                    releaseCleanup,
                    (active) => {
                        cleanupActive = active;
                    },
                );
            };
            session.destroy = () => {
                session.destroyCalls += 1;
                session.destroyed = true;
                destroyOverlappedCleanup ||= cleanupActive;
            };
            return session;
        };

        const agent = await AgentBase.create(ctx, {
            id: "close-stream-cleanup",
            providers: providersOf(provider),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
        });
        await agent.send(ctx, user("open a stream"));
        await Promise.all([runStarted.promise, cleanupStarted.promise]);

        const closing = agent.close();
        const closeSettledBeforeCleanupRelease = await settlesWhileBlocked(closing);
        releaseCleanup.resolve();
        await closing;

        // Close is the final ownership boundary for the provider session. Destruction and
        // completion must both wait until the response iterator has released that session.
        expect({
            closeSettledBeforeCleanupRelease,
            destroyOverlappedCleanup,
        }).toEqual({
            closeSettledBeforeCleanupRelease: false,
            destroyOverlappedCleanup: false,
        });
    });

    it("waits for old stream cleanup before destroying a session during recreation", async () => {
        const provider = new ScriptedProvider([textTurn("second answer")]);
        const firstRunStarted = deferred();
        const cleanupStarted = deferred();
        const releaseCleanup = deferred();
        const firstDestroyStarted = deferred();
        const originalSession = provider.session.bind(provider);
        let cleanupActive = false;
        let destroyOverlappedCleanup = false;

        provider.session = async (id: string, options: SessionOptions): Promise<BaseSession> => {
            const session = (await originalSession(id, options)) as ScriptedSession;
            if (provider.sessions.length === 1) {
                session.run = (runCtx, request: SessionRunRequest): SessionStream => {
                    session.requestContexts.push(runCtx);
                    session.requests.push(request);
                    return oneDoneThenBlockedCleanup(
                        firstRunStarted,
                        cleanupStarted,
                        releaseCleanup,
                        (active) => {
                            cleanupActive = active;
                        },
                    );
                };
                session.destroy = () => {
                    session.destroyCalls += 1;
                    session.destroyed = true;
                    destroyOverlappedCleanup ||= cleanupActive;
                    firstDestroyStarted.resolve();
                };
            }
            return session;
        };

        const agent = await AgentBase.create(ctx, {
            id: "recreate-stream-cleanup",
            providers: providersOf(provider),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            initialState: { instructions: "first configuration" },
        });
        await agent.send(ctx, user("first request"));
        await Promise.all([firstRunStarted.promise, cleanupStarted.promise]);

        agent.state.instructions = "second configuration";
        await agent.send(ctx, user("force session recreation"));
        const destroyStartedBeforeCleanupRelease = await settlesWhileBlocked(
            firstDestroyStarted.promise,
        );

        releaseCleanup.resolve();
        await firstDestroyStarted.promise;
        await agent.waitForIdle();
        await agent.close();

        // Reconfiguration transfers the same stateful provider identity to a new session.
        // The old stream must release it before destroy begins, not merely before the new run.
        expect({
            destroyStartedBeforeCleanupRelease,
            destroyOverlappedCleanup,
        }).toEqual({
            destroyStartedBeforeCleanupRelease: false,
            destroyOverlappedCleanup: false,
        });
    });

    it("waits for old stream cleanup before destroying a session after a model switch", async () => {
        const provider = new ScriptedProvider([textTurn("second answer")]);
        const firstRunStarted = deferred();
        const cleanupStarted = deferred();
        const releaseCleanup = deferred();
        const switchObserved = deferred();
        const firstDestroyStarted = deferred();
        const originalSession = provider.session.bind(provider);
        let cleanupActive = false;
        let destroyOverlappedCleanup = false;

        provider.session = async (id: string, options: SessionOptions): Promise<BaseSession> => {
            const session = (await originalSession(id, options)) as ScriptedSession;
            if (provider.sessions.length === 1) {
                session.run = (runCtx, request: SessionRunRequest): SessionStream => {
                    session.requestContexts.push(runCtx);
                    session.requests.push(request);
                    return oneDoneThenBlockedCleanup(
                        firstRunStarted,
                        cleanupStarted,
                        releaseCleanup,
                        (active) => {
                            cleanupActive = active;
                        },
                    );
                };
                session.destroy = () => {
                    session.destroyCalls += 1;
                    session.destroyed = true;
                    destroyOverlappedCleanup ||= cleanupActive;
                    firstDestroyStarted.resolve();
                };
            }
            return session;
        };

        const agent = await AgentBase.create(ctx, {
            id: "model-switch-stream-cleanup",
            providers: providersOf(provider),
            provider: "scripted",
            model: "anthropic/claude-a",
            persistence: new InMemoryPersistence(),
            hooks: {
                modelChanged: () => {
                    switchObserved.resolve();
                    return undefined;
                },
            },
        });
        await agent.send(ctx, user("first request"));
        await Promise.all([firstRunStarted.promise, cleanupStarted.promise]);

        await agent.send(ctx, user("switch models"), {
            model: "anthropic/claude-b",
        });
        await switchObserved.promise;
        const destroyStartedBeforeCleanupRelease = await settlesWhileBlocked(
            firstDestroyStarted.promise,
        );

        releaseCleanup.resolve();
        await firstDestroyStarted.promise;
        await agent.waitForIdle();
        await agent.close();

        // A compatible model switch keeps history but still transfers ownership to a fresh,
        // model-bound session. The old stream must release that session before destruction.
        expect({
            destroyStartedBeforeCleanupRelease,
            destroyOverlappedCleanup,
            sessions: provider.sessions.length,
        }).toEqual({
            destroyStartedBeforeCleanupRelease: false,
            destroyOverlappedCleanup: false,
            sessions: 2,
        });
    });

    it("lets a second abort settle while the next turn waits for prior stream cleanup", async () => {
        const persistence = new InMemoryPersistence();
        const provider = new ScriptedProvider([]);
        const firstRunStarted = deferred();
        const cleanupStarted = deferred();
        const releaseCleanup = deferred();
        const secondMessageConsumed = deferred();
        const originalSession = provider.session.bind(provider);
        const originalAppend = persistence.append.bind(persistence);

        persistence.append = async (appendCtx, record) => {
            await originalAppend(appendCtx, record);
            if (
                record.type === "user" &&
                record.message.role === "user" &&
                record.message.content[0]?.type === "text" &&
                record.message.content[0].text === "second request"
            ) {
                secondMessageConsumed.resolve();
            }
        };
        provider.session = async (id: string, options: SessionOptions): Promise<BaseSession> => {
            const session = (await originalSession(id, options)) as ScriptedSession;
            let runs = 0;
            session.run = (runCtx, request: SessionRunRequest): SessionStream => {
                session.requestContexts.push(runCtx);
                session.requests.push(request);
                runs += 1;
                if (runs === 1) {
                    const iterator: AsyncIterator<SessionEvent> & AsyncIterable<SessionEvent> = {
                        async next() {
                            firstRunStarted.resolve();
                            return await new Promise<IteratorResult<SessionEvent>>(() => {});
                        },
                        async return() {
                            cleanupStarted.resolve();
                            await releaseCleanup.promise;
                            return { done: true, value: undefined };
                        },
                        [Symbol.asyncIterator]() {
                            return this;
                        },
                    };
                    return iterator;
                }
                return (async function* () {
                    yield* textTurn("must be cancelled");
                })();
            };
            return session;
        };

        const agent = await AgentBase.create(ctx, {
            id: "abort-while-settling",
            providers: providersOf(provider),
            provider: "scripted",
            persistence,
        });
        await agent.send(ctx, user("first request"));
        await firstRunStarted.promise;
        await agent.abort(ctx);
        await cleanupStarted.promise;

        await agent.send(ctx, user("second request"));
        await secondMessageConsumed.promise;
        const secondAbort = agent.abort(ctx);
        const secondAbortSettledBeforeCleanupRelease = await settlesWhileBlocked(secondAbort);

        releaseCleanup.resolve();
        await secondAbort;
        await agent.waitForIdle();
        await agent.close();

        // A cleanup intentionally detached from the first abort cannot make a later abort hang.
        // The second turn may wait for that cleanup before using the session, but cancellation
        // must interrupt the wait without requiring the cleanup itself to cooperate.
        expect(secondAbortSettledBeforeCleanupRelease).toBe(true);
    });

    it("does not report idle while an already-admitted send is blocked in persistence", async () => {
        const persistence = new InMemoryPersistence();
        const provider = new ScriptedProvider([textTurn("answer")]);
        const writeStarted = deferred();
        const releaseWrite = deferred();
        const originalWriteValue = persistence.writeValue.bind(persistence);

        persistence.writeValue = async (writeCtx, key, value) => {
            if (key.startsWith("send.")) {
                writeStarted.resolve();
                await releaseWrite.promise;
            }
            await originalWriteValue(writeCtx, key, value);
        };

        const agent = await AgentBase.create(ctx, {
            id: "idle-admitted-send",
            providers: providersOf(provider),
            provider: "scripted",
            persistence,
        });
        const sending = agent.send(ctx, user("already admitted"));
        await writeStarted.promise;
        const idle = agent.waitForIdle();
        const idleSettledBeforeWriteRelease = await settlesWhileBlocked(idle);

        releaseWrite.resolve();
        await Promise.all([sending, idle]);
        await agent.waitForIdle();
        await agent.close();

        // Admission happens before the persistence wait. From then on waitForIdle must include
        // the accepted operation and the turn it starts, even though #runPromise is not set yet.
        expect(idleSettledBeforeWriteRelease).toBe(false);
    });

    it("rolls back modelChanged module KV when the switch transaction later fails", async () => {
        const persistence = new InMemoryPersistence();
        const provider = new ScriptedProvider([]);
        const originalAppend = persistence.append.bind(persistence);

        persistence.append = async (appendCtx, record) => {
            if (
                record.type === "user" &&
                record.message.role === "user" &&
                record.message.content[0]?.type === "text" &&
                record.message.content[0].text === "switch models"
            ) {
                throw new Error("switch transaction failed");
            }
            await originalAppend(appendCtx, record);
        };

        const agent = await AgentBase.create(ctx, {
            id: "model-change-kv-rollback",
            providers: providersOf(provider),
            provider: "scripted",
            persistence,
            model: "anthropic/claude",
            hooks: {
                modelChanged: async (hookCtx, change) => {
                    const kv = agentKV(hookCtx);
                    if (kv === undefined) throw new Error("No model-change KV.");
                    await kv.write(hookCtx, "selected-model", change.model);
                    return system("handoff");
                },
            },
        });

        await agent.send(ctx, user("switch models"), { model: "openai/gpt" });
        await agent.waitForIdle();
        const escapedValue = persistence.values.get("kv.model-change-kv-rollback.selected-model");
        await agent.close();

        // The hook write describes the same switch as the queue claim, reset, injected handoff,
        // consumed message, and settings write. A failure in that transaction must retain none
        // of those effects, including module state written by the hook.
        expect(escapedValue).toBeUndefined();
    });
});
