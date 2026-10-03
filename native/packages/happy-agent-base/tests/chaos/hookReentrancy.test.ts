import type {
    BaseSession,
    SessionCompaction,
    SessionEvent,
    SessionOptions,
} from "@slopus/happy-providers";
import { createRootContext, type Context } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import {
    AgentBase,
    agentId,
    AgentKV,
    AgentSystemLocal,
    agentSystem as agentsFromContext,
    type AgentModule,
} from "../../sources/index.js";
import { InMemoryPersistence } from "../gym/InMemoryPersistence.js";
import { ScriptedProvider, ScriptedSession } from "../gym/ScriptedProvider.js";
import {
    InMemoryAgentStorage,
    inMemoryStorageLock,
    providersOf,
    textTurn,
    user,
} from "../gym/fixtures.js";

const ctx = createRootContext().named("happy-agent-base-hook-reentrancy");

interface Deferred {
    readonly promise: Promise<void>;
    readonly resolve: () => void;
}

type Outcome<Value> =
    | { readonly status: "fulfilled"; readonly value: Value }
    | { readonly status: "rejected"; readonly reason: unknown };

function deferred(): Deferred {
    let resolve!: () => void;
    const promise = new Promise<void>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

function outcomeOf<Value>(promise: Promise<Value>): Promise<Outcome<Value>> {
    return promise.then(
        (value) => ({ status: "fulfilled", value }),
        (reason: unknown) => ({ status: "rejected", reason }),
    );
}

async function observedWithin<Value>(
    promise: Promise<Value>,
    milliseconds = 60,
): Promise<{ readonly status: "settled"; readonly value: Value } | { readonly status: "pending" }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ readonly status: "pending" }>((resolve) => {
        timer = setTimeout(() => resolve({ status: "pending" }), milliseconds);
    });
    const observed = await Promise.race([
        promise.then((value) => ({ status: "settled" as const, value })),
        timeout,
    ]);
    if (timer !== undefined) clearTimeout(timer);
    return observed;
}

function summary(text: string): SessionCompaction {
    return {
        status: "completed",
        preservedMessages: [],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
        context: {
            instructions: "",
            messages: [user(text)],
        },
    };
}

function managerKV(persistence: InMemoryPersistence): AgentKV {
    return new AgentKV(persistence, "agentSystem.");
}

async function collection(
    managerPersistence: InMemoryPersistence,
    persistences: Map<string, InMemoryPersistence>,
    provider: ScriptedProvider,
    modules: readonly AgentModule[],
): Promise<AgentSystemLocal> {
    return await AgentSystemLocal.create(
        ctx,
        new InMemoryAgentStorage({
            acquireLock: inMemoryStorageLock(),
            kv: managerKV(managerPersistence),
            persistence: (id) => {
                const existing = persistences.get(id);
                if (existing !== undefined) return existing;
                const created = new InMemoryPersistence();
                persistences.set(id, created);
                return created;
            },
        }),
        { modules, providers: providersOf(provider), provider: "scripted", models: [] },
    );
}

/**
 * Hooks run in the agent's own context and can reach the agent collection from that context.
 * These scenarios exercise those callbacks as real re-entrant callers: event observers enqueue
 * work while a response is being collected, lifecycle hooks call operations the loop normally
 * owns, and a model-change hook reaches back through AgentSystemLocal while persistence is locked.
 */
describe("hook and event re-entrancy", () => {
    it("accepts an asynchronous self-send from onEvent exactly once without a ghost turn", async () => {
        const provider = new ScriptedProvider([textTurn("first"), textTurn("second")]);
        const events: SessionEvent[] = [];
        let selfSend: Promise<unknown> | undefined;
        let turnsStarted = 0;
        let turnsFinished = 0;
        let agent!: AgentBase;
        agent = await AgentBase.create(ctx, {
            id: "event-self-send",
            providers: providersOf(provider),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            hooks: {
                onEvent: async (hookCtx, event) => {
                    events.push(event);
                    if (event.type === "text_end" && selfSend === undefined) {
                        selfSend = agent.send(hookCtx, user("sent by my own event hook"));
                        await selfSend;
                    }
                },
                beforeTurn: () => {
                    turnsStarted += 1;
                    return undefined;
                },
                afterTurn: () => {
                    turnsFinished += 1;
                    return undefined;
                },
            },
        });

        await agent.send(ctx, user("begin"));
        await selfSend;
        await agent.waitForIdle();
        const requests = provider.sessions[0]?.requests ?? [];
        const terminalEvents = events.filter((event) => event.type === "done");
        await agent.close();

        expect({
            requests: requests.length,
            secondTail: requests[1]?.context.messages.at(-1),
            terminalEvents: terminalEvents.length,
            turnsStarted,
            turnsFinished,
        }).toEqual({
            requests: 2,
            secondTail: user("sent by my own event hook"),
            terminalEvents: 2,
            turnsStarted: 1,
            turnsFinished: 1,
        });
    });

    it("accepts a synchronous self-steer from onEvent before an already queued send", async () => {
        const provider = new ScriptedProvider([
            textTurn("first"),
            textTurn("steered"),
            textTurn("sent"),
        ]);
        let steering: Promise<unknown> | undefined;
        let laterSend: Promise<unknown> | undefined;
        let agent!: AgentBase;
        agent = await AgentBase.create(ctx, {
            id: "event-self-steer",
            providers: providersOf(provider),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            hooks: {
                onEvent: (hookCtx, event) => {
                    if (event.type !== "text_start" || steering !== undefined) return;
                    laterSend = agent.send(hookCtx, user("ordinary follow-up"));
                    steering = agent.steer(hookCtx, user("urgent self-steering"));
                },
            },
        });

        await agent.send(ctx, user("begin"));
        await Promise.all([steering, laterSend]);
        await agent.waitForIdle();
        const requests = provider.sessions[0]?.requests ?? [];
        await agent.close();

        expect(requests.map((request) => request.context.messages.at(-1))).toEqual([
            user("begin"),
            user("urgent self-steering"),
            user("ordinary follow-up"),
        ]);
    });

    it("cancels from onEvent with one terminal outcome and no later normal completion", async () => {
        const events: SessionEvent[] = [];
        let aborting: Promise<void> | undefined;
        let agent!: AgentBase;
        agent = await AgentBase.create(ctx, {
            id: "event-self-abort",
            providers: providersOf(new ScriptedProvider([textTurn("must be interrupted")])),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            hooks: {
                onEvent: (hookCtx, event) => {
                    events.push(event);
                    if (event.type === "text_delta" && aborting === undefined) {
                        aborting = agent.abort(hookCtx);
                    }
                },
            },
        });

        await agent.send(ctx, user("stop yourself"));
        await aborting;
        await agent.waitForIdle();
        const terminalEvents = events.filter((event) => event.type === "done");
        await agent.close();

        expect(terminalEvents).toEqual([{ type: "done", state: "cancelled" }]);
    });

    it("lets onEvent close itself without truncating or duplicating the active response", async () => {
        const provider = new ScriptedProvider([textTurn("finish before closing")]);
        const events: SessionEvent[] = [];
        const hookEntered = deferred();
        let closing: Promise<void> | undefined;
        let agent!: AgentBase;
        agent = await AgentBase.create(ctx, {
            id: "event-self-close",
            providers: providersOf(provider),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            hooks: {
                onEvent: (_hookCtx, event) => {
                    events.push(event);
                    if (event.type === "text_start" && closing === undefined) {
                        closing = agent.close();
                        hookEntered.resolve();
                    }
                },
            },
        });

        await agent.send(ctx, user("close from the stream"));
        await hookEntered.promise;
        await closing;
        const terminalEvents = events.filter((event) => event.type === "done");

        expect({
            terminalEvents,
            destroyCalls: provider.sessions[0]?.destroyCalls,
        }).toEqual({
            terminalEvents: [
                {
                    type: "done",
                    state: "normal",
                    tokens: { input: 1, output: 1 },
                },
            ],
            destroyCalls: 1,
        });
    });

    it("schedules compaction requested from onEvent without waiting on its own turn", async () => {
        const provider = new ScriptedProvider([textTurn("ready")]);
        const originalSession = provider.session.bind(provider);
        provider.session = async (id: string, options: SessionOptions): Promise<BaseSession> => {
            const session = (await originalSession(id, options)) as ScriptedSession;
            session.compactionResults = [summary("compacted from onEvent")];
            return session;
        };
        const hookEntered = deferred();
        let compacting: Promise<Outcome<void>> | undefined;
        let agent!: AgentBase;
        agent = await AgentBase.create(ctx, {
            id: "event-self-compact",
            providers: providersOf(provider),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            hooks: {
                onEvent: (hookCtx, event) => {
                    if (event.type === "done" && compacting === undefined) {
                        compacting = outcomeOf(agent.compact(hookCtx));
                        hookEntered.resolve();
                    }
                },
            },
        });

        await agent.send(ctx, user("compact when done"));
        await hookEntered.promise;
        const compactOutcome = await compacting;
        await agent.waitForIdle();
        const compactions = provider.sessions[0]?.compactions.length;
        await agent.close();

        expect({ compactOutcome: compactOutcome?.status, compactions }).toEqual({
            compactOutcome: "fulfilled",
            compactions: 1,
        });
    });

    it("includes a self-send awaited by beforeTurn without opening an empty extra turn", async () => {
        const provider = new ScriptedProvider([textTurn("first"), textTurn("second")]);
        let turnsStarted = 0;
        let turnsFinished = 0;
        let sent = false;
        let agent!: AgentBase;
        agent = await AgentBase.create(ctx, {
            id: "before-turn-self-send",
            providers: providersOf(provider),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            hooks: {
                beforeTurn: async (hookCtx) => {
                    turnsStarted += 1;
                    if (!sent) {
                        sent = true;
                        await agent.send(hookCtx, user("queued by beforeTurn"));
                    }
                    return undefined;
                },
                afterTurn: () => {
                    turnsFinished += 1;
                    return undefined;
                },
            },
        });

        await agent.send(ctx, user("begin"));
        await agent.waitForIdle();
        const requests = provider.sessions[0]?.requests ?? [];
        await agent.close();

        expect({
            requestTails: requests.map((request) => request.context.messages.at(-1)),
            turnsStarted,
            turnsFinished,
        }).toEqual({
            requestTails: [user("begin"), user("queued by beforeTurn")],
            turnsStarted: 1,
            turnsFinished: 1,
        });
    });

    it("does not deadlock when beforeInference awaits an abort of its own turn", async () => {
        const hookEntered = deferred();
        let agent!: AgentBase;
        agent = await AgentBase.create(ctx, {
            id: "before-inference-self-abort",
            providers: providersOf(new ScriptedProvider([textTurn("must not run")])),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            hooks: {
                beforeInference: async (hookCtx) => {
                    hookEntered.resolve();
                    await agent.abort(hookCtx);
                },
            },
        });

        await agent.send(ctx, user("abort in the hook"));
        await hookEntered.promise;
        const idle = await observedWithin(outcomeOf(agent.waitForIdle()));

        expect(idle.status === "settled" ? idle.value.status : "pending").toBe("fulfilled");
    });

    it("runs steering awaited by afterInference exactly once in the same turn", async () => {
        const provider = new ScriptedProvider([textTurn("first"), textTurn("steered")]);
        let turnsStarted = 0;
        let turnsFinished = 0;
        let inferences = 0;
        let agent!: AgentBase;
        agent = await AgentBase.create(ctx, {
            id: "after-inference-self-steer",
            providers: providersOf(provider),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            hooks: {
                beforeTurn: () => {
                    turnsStarted += 1;
                    return undefined;
                },
                afterInference: async (hookCtx) => {
                    inferences += 1;
                    if (inferences === 1) {
                        await agent.steer(hookCtx, user("steered by afterInference"));
                    }
                },
                afterTurn: () => {
                    turnsFinished += 1;
                    return undefined;
                },
            },
        });

        await agent.send(ctx, user("begin"));
        await agent.waitForIdle();
        const requests = provider.sessions[0]?.requests ?? [];
        await agent.close();

        expect({
            requestTails: requests.map((request) => request.context.messages.at(-1)),
            inferences,
            turnsStarted,
            turnsFinished,
        }).toEqual({
            requestTails: [user("begin"), user("steered by afterInference")],
            inferences: 2,
            turnsStarted: 1,
            turnsFinished: 1,
        });
    });

    it("does not deadlock when afterTurn awaits closing its own agent", async () => {
        const hookEntered = deferred();
        let agent!: AgentBase;
        agent = await AgentBase.create(ctx, {
            id: "after-turn-self-close",
            providers: providersOf(new ScriptedProvider([textTurn("complete first")])),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            hooks: {
                afterTurn: async () => {
                    hookEntered.resolve();
                    await agent.close();
                    return undefined;
                },
            },
        });

        await agent.send(ctx, user("close after the turn"));
        await hookEntered.promise;
        const closed = await observedWithin(outcomeOf(agent.close()));

        expect(closed.status === "settled" ? closed.value.status : "pending").toBe("fulfilled");
    });

    it("runs a self-send from afterAgentSettled as one fresh exact-once turn", async () => {
        const provider = new ScriptedProvider([textTurn("first"), textTurn("second")]);
        let settlements = 0;
        const loopIds: string[] = [];
        let selfSend: Promise<unknown> | undefined;
        let agent!: AgentBase;
        agent = await AgentBase.create(ctx, {
            id: "settled-self-send",
            providers: providersOf(provider),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            hooks: {
                afterAgentSettled: async (hookCtx, settlement) => {
                    settlements += 1;
                    loopIds.push(settlement.loopId);
                    if (selfSend !== undefined) return;
                    selfSend = agent.send(hookCtx, user("wake yourself"));
                    await selfSend;
                },
            },
        });

        await agent.send(ctx, user("first request"));
        await selfSend;
        await agent.waitForIdle();
        const requests = provider.sessions[0]?.requests ?? [];
        await agent.close();

        expect({
            requests: requests.length,
            secondTail: requests[1]?.context.messages.at(-1),
            settlements,
            uniqueLoops: new Set(loopIds).size,
        }).toEqual({
            requests: 2,
            secondTail: user("wake yourself"),
            settlements: 2,
            uniqueLoops: 2,
        });
    });

    it("lets afterAgentSettled await compaction without rejecting or deadlocking", async () => {
        const provider = new ScriptedProvider([textTurn("ready")]);
        const originalSession = provider.session.bind(provider);
        provider.session = async (id: string, options: SessionOptions): Promise<BaseSession> => {
            const session = (await originalSession(id, options)) as ScriptedSession;
            session.compactionResults = [summary("compacted after settlement")];
            return session;
        };
        const hookEntered = deferred();
        let compacting: Promise<Outcome<void>> | undefined;
        let agent!: AgentBase;
        agent = await AgentBase.create(ctx, {
            id: "settled-self-compact",
            providers: providersOf(provider),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            hooks: {
                afterAgentSettled: async (hookCtx) => {
                    if (compacting !== undefined) return;
                    hookEntered.resolve();
                    compacting = outcomeOf(agent.compact(hookCtx));
                    await compacting;
                },
            },
        });

        await agent.send(ctx, user("compact once settled"));
        await hookEntered.promise;
        if (compacting === undefined)
            throw new Error("The settle hook did not request compaction.");
        const observed = await observedWithin(compacting);

        expect(observed.status === "settled" ? observed.value.status : "pending").toBe("fulfilled");
    });

    it("does not deadlock when modelChanged sends to its own agent through AgentSystemLocal", async () => {
        const managerDisk = new InMemoryPersistence();
        const disks = new Map<string, InMemoryPersistence>();
        const hookEntered = deferred();
        const reentrantModule: AgentModule = new (class implements AgentModule {
            readonly name = "model-change-self-send";

            beforeStart() {
                return {
                    modelChanged: async (hookCtx: Context): Promise<undefined> => {
                        hookEntered.resolve();
                        const owner = agentsFromContext(hookCtx);
                        if (owner === undefined) throw new Error("missing collection");
                        await owner.send(
                            hookCtx,
                            agentId(hookCtx) ?? "",
                            user("message from modelChanged"),
                        );
                        return undefined;
                    },
                };
            }
        })();
        const owner = await collection(
            managerDisk,
            disks,
            new ScriptedProvider([textTurn("after switch"), textTurn("after self-send")]),
            [reentrantModule],
        );
        const agent = await owner.create(ctx, {});
        await agent.waitForIdle();

        await owner.send(ctx, agent.id, user("switch"), { model: "openai/gpt" });
        await hookEntered.promise;
        const idle = await observedWithin(outcomeOf(agent.waitForIdle()));

        expect(idle.status === "settled" ? idle.value.status : "pending").toBe("fulfilled");
    });

    it("allows modelChanged to send to another agent without coupling their locks", async () => {
        const managerDisk = new InMemoryPersistence();
        const disks = new Map<string, InMemoryPersistence>();
        // The identities are allocated by the collection, so the module learns them from the
        // agents it is about to serve rather than from a name the test chose.
        let sourceId: string | undefined;
        let targetId: string | undefined;
        const reentrantModule: AgentModule = new (class implements AgentModule {
            readonly name = "model-change-cross-send";

            beforeStart() {
                return {
                    modelChanged: async (hookCtx: Context): Promise<undefined> => {
                        if (agentId(hookCtx) !== sourceId) return undefined;
                        const owner = agentsFromContext(hookCtx);
                        if (owner === undefined) throw new Error("missing collection");
                        await owner.send(
                            hookCtx,
                            targetId ?? "",
                            user("message from source modelChanged"),
                        );
                        return undefined;
                    },
                };
            }
        })();
        const provider = new ScriptedProvider([textTurn("target"), textTurn("source")]);
        const owner = await collection(managerDisk, disks, provider, [reentrantModule]);
        const source = await owner.create(ctx, {});
        const target = await owner.create(ctx, {});
        sourceId = source.id;
        targetId = target.id;
        await Promise.all([source.waitForIdle(), target.waitForIdle()]);

        await owner.send(ctx, source.id, user("switch"), { model: "openai/gpt" });
        const observed = await observedWithin(
            outcomeOf(Promise.all([source.waitForIdle(), target.waitForIdle()])),
        );
        const targetUsers = (disks.get(target.id)?.records ?? []).filter(
            (record) => record.type === "user",
        );
        if (observed.status === "settled" && observed.value.status === "fulfilled") {
            await Promise.all([source.close(), target.close()]);
        }

        expect({
            outcome: observed.status === "settled" ? observed.value.status : observed.status,
            targetUsers: targetUsers.length,
        }).toEqual({
            outcome: "fulfilled",
            targetUsers: 1,
        });
    });
});
