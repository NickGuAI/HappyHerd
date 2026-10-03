import {
    BaseProvider,
    BaseSession,
    type ProviderModality,
    type SessionCompaction,
    type SessionCompactionOptions,
    type SessionEvent,
    type SessionOptions,
    type SessionRunRequest,
    type SessionStream,
} from "@slopus/happy-providers";
import { Type } from "@sinclair/typebox";
import { createRootContext, type Context } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import {
    type Agent,
    agentId,
    AgentKV,
    AgentSystemLocal,
    type AgentSystem,
    agentSystem,
    defineAgentTool,
    type AgentModule,
    type AnyAgentTool,
} from "../../sources/index.js";
import { InMemoryPersistence } from "../gym/InMemoryPersistence.js";
import {
    InMemoryAgentStorage,
    inMemoryStorageLock,
    providersOf,
    system,
    textTurn,
    user,
} from "../gym/fixtures.js";

const ctx = createRootContext().named("happy-agent-base-cross-agent-reentrancy");

interface Deferred {
    readonly promise: Promise<void>;
    readonly resolve: () => void;
}

/**
 * What one agent's tool does with the collection. The identities are allocated by the
 * collection, so a scenario names the agents "A" and "B" and resolves those names to the real
 * IDs through `id` when it reaches for a peer.
 */
type ToolAction = (
    ctx: Context,
    owner: AgentSystem,
    self: string,
    id: (alias: string) => string,
) => Promise<void>;

/** The collection under test, which exists only once the modules it is built with do. */
interface OwnerHolder {
    owner?: AgentSystem;
}
type RunScript = readonly SessionEvent[] | ((ctx: Context) => SessionStream);

function deferred(): Deferred {
    let resolve!: () => void;
    const promise = new Promise<void>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

async function settlesWithin(work: Promise<unknown>, milliseconds = 100): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), milliseconds);
        void work.then(
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

function toolTurn(callId = "cross-call"): SessionEvent[] {
    return [
        { type: "toolcall_start", callId, name: "cross_agent" },
        { type: "toolcall_end", callId, arguments: "{}" },
        { type: "done", state: "tool_call", tokens: { input: 1, output: 1 } },
    ];
}

function completedCompaction(text: string): SessionCompaction {
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
            messages: [system(text)],
        },
    };
}

function userTexts(persistence: InMemoryPersistence): string[] {
    return persistence.records.flatMap((record) =>
        record.type === "user" && record.message.role !== "agent"
            ? record.message.content.flatMap((block) => (block.type === "text" ? [block.text] : []))
            : [],
    );
}

function toolResults(persistence: InMemoryPersistence): string[] {
    return persistence.records.flatMap((record) =>
        record.type === "tool" ? [record.message.callId] : [],
    );
}

class RoutedSession extends BaseSession {
    readonly requests: SessionRunRequest[] = [];
    readonly compactions: SessionCompactionOptions[] = [];
    destroyCalls = 0;

    readonly #scripts: RunScript[];
    readonly #compactionResults: SessionCompaction[];

    constructor(id: string, scripts: RunScript[], compactionResults: SessionCompaction[]) {
        super(id);
        this.#scripts = scripts;
        this.#compactionResults = compactionResults;
    }

    run(runCtx: Context, request: SessionRunRequest): SessionStream {
        this.requests.push(request);
        const script = this.#scripts.shift() ?? [];
        if (typeof script === "function") return script(runCtx);
        return (async function* () {
            yield* script;
        })();
    }

    compact(_compactCtx: Context, options: SessionCompactionOptions): Promise<SessionCompaction> {
        this.compactions.push(options);
        const result = this.#compactionResults.shift();
        return result === undefined
            ? Promise.reject(new Error(`No compaction scripted for agent "${this.id}".`))
            : Promise.resolve(result);
    }

    destroy(): void {
        this.destroyCalls += 1;
    }
}

class RoutedProvider extends BaseProvider {
    static override readonly name = "scripted";
    static override readonly inputTypes: readonly ProviderModality[] = ["text"];
    static override readonly outputTypes: readonly ProviderModality[] = ["text"];

    readonly sessions = new Map<string, RoutedSession>();
    readonly #scripts: Map<string, RunScript[]>;
    readonly #compactions: Map<string, SessionCompaction[]>;
    /** A session is opened for an agent's real ID; the scripts are written against its name. */
    readonly #aliasOf: (id: string) => string;

    constructor(
        scripts: ReadonlyMap<string, readonly RunScript[]>,
        compactions: ReadonlyMap<string, readonly SessionCompaction[]>,
        aliasOf: (id: string) => string,
    ) {
        super();
        this.#scripts = new Map([...scripts].map(([alias, turns]) => [alias, [...turns]]));
        this.#compactions = new Map(
            [...compactions].map(([alias, results]) => [alias, [...results]]),
        );
        this.#aliasOf = aliasOf;
    }

    session(id: string, _options: SessionOptions): Promise<BaseSession> {
        const alias = this.#aliasOf(id);
        const session = new RoutedSession(
            id,
            this.#scripts.get(alias) ?? [],
            this.#compactions.get(alias) ?? [],
        );
        this.sessions.set(alias, session);
        return Promise.resolve(session);
    }
}

function crossAgentModule(
    actions: ReadonlyMap<string, ToolAction>,
    holder: OwnerHolder,
    names: AgentNames,
): AgentModule {
    return new (class implements AgentModule {
        readonly name = "cross-agent-reentrancy";
        readonly #tool: AnyAgentTool = defineAgentTool({
            name: "cross_agent",
            parameters: Type.Object({}),
            returnType: Type.Object({}),
            durable: false,
            shouldReviewInAutoMode: () => false,
            execute: async (toolCtx) => {
                const self = names.aliasOf(agentId(toolCtx) ?? "");
                const action = actions.get(self);
                if (action === undefined) {
                    throw new Error(`No cross-agent action for "${self}".`);
                }
                // These scenarios are about the owner's surface being used from inside a
                // tool, so they reach for the collection itself rather than the reference a
                // context carries.
                const owner = holder.owner;
                if (owner === undefined) throw new Error("The collection is not built yet.");
                await action(toolCtx, owner, self, (alias) => names.idOf(alias));
                return {};
            },
            toLLM: () => [{ type: "text", text: "Cross-agent operation completed." }],
        });

        beforeStart() {
            return {
                tools: (hookCtx: Context): readonly AnyAgentTool[] => {
                    // A module is given the collection as a reference, and nothing more.
                    if (agentSystem(hookCtx) === undefined) {
                        throw new Error("Cross-agent module requires its owning collection.");
                    }
                    return [this.#tool];
                },
            };
        }
    })();
}

/** The two-way mapping between the names a scenario uses and the IDs the collection allocated. */
class AgentNames {
    readonly #ids = new Map<string, string>();
    readonly #aliases = new Map<string, string>();

    register(alias: string, id: string): void {
        this.#ids.set(alias, id);
        this.#aliases.set(id, alias);
    }

    idOf(alias: string): string {
        const id = this.#ids.get(alias);
        if (id === undefined) throw new Error(`No agent named "${alias}".`);
        return id;
    }

    aliasOf(id: string): string {
        return this.#aliases.get(id) ?? id;
    }
}

function managerKV(persistence: InMemoryPersistence): AgentKV {
    return new AgentKV(persistence, "agentSystem.");
}

/** One scenario's collection, with its agents reachable by the names the scenario gave them. */
interface World {
    readonly owner: AgentSystemLocal;
    readonly provider: RoutedProvider;
    readonly manager: InMemoryPersistence;
    readonly id: (alias: string) => string;
    readonly agent: (alias: string) => Agent;
    readonly persistence: (alias: string) => InMemoryPersistence;
    readonly session: (alias: string) => RoutedSession | undefined;
}

async function harness(
    actions: ReadonlyMap<string, ToolAction>,
    scripts: ReadonlyMap<string, readonly RunScript[]>,
    compactions: ReadonlyMap<string, readonly SessionCompaction[]> = new Map(),
): Promise<World> {
    const manager = new InMemoryPersistence();
    const persistences = new Map<string, InMemoryPersistence>();
    const names = new AgentNames();
    const provider = new RoutedProvider(scripts, compactions, (id) => names.aliasOf(id));
    const holder: OwnerHolder = {};
    const owner = await AgentSystemLocal.create(
        ctx,
        new InMemoryAgentStorage({
            acquireLock: inMemoryStorageLock(),
            kv: managerKV(manager),
            persistence: (id) => {
                const existing = persistences.get(id);
                if (existing !== undefined) return existing;
                const created = new InMemoryPersistence();
                persistences.set(id, created);
                return created;
            },
        }),
        {
            modules: [crossAgentModule(actions, holder, names)],
            providers: providersOf(provider),
            provider: "scripted",
            models: [],
        },
    );
    holder.owner = owner;
    // Every agent a scenario scripts or gives an action to, created in name order so the
    // scenario can talk about "A" and "B" without choosing their identities.
    const agents = new Map<string, Agent>();
    for (const alias of [...new Set([...scripts.keys(), ...actions.keys()])].sort()) {
        const agent = await owner.create(ctx, {});
        names.register(alias, agent.id);
        agents.set(alias, agent);
    }
    return {
        owner,
        provider,
        manager,
        id: (alias) => names.idOf(alias),
        agent: (alias) => {
            const agent = agents.get(alias);
            if (agent === undefined) throw new Error(`No agent named "${alias}".`);
            return agent;
        },
        persistence: (alias) => {
            const persistence = persistences.get(names.idOf(alias));
            if (persistence === undefined) throw new Error(`No store for agent "${alias}".`);
            return persistence;
        },
        session: (alias) => provider.sessions.get(alias),
    };
}

/**
 * A tool is part of one agent's turn but may use the collection to reach another agent. These
 * scenarios exercise the resulting lock graph at the public boundary: messages are durably
 * admitted exactly once, recursive calls settle, and operations that wait for the target's
 * lifetime do not accidentally turn two independent agentSystem into one global lock.
 */
describe("cross-agent tool re-entrancy", () => {
    it("lets agent A's tool await a durable send to agent B", async () => {
        let executions = 0;
        const world = await harness(
            new Map([
                [
                    "A",
                    async (toolCtx, owner, _self, id) => {
                        executions += 1;
                        await owner.send(toolCtx, id("B"), user("message from A's tool"));
                    },
                ],
            ]),
            new Map([
                ["A", [toolTurn(), textTurn("A finished")]],
                ["B", [textTurn("B answered")]],
            ]),
        );
        const a = world.agent("A");
        const b = world.agent("B");

        await a.send(ctx, user("start A"));
        await Promise.all([a.waitForIdle(), b.waitForIdle()]);
        const observed = {
            executions,
            bUsers: userTexts(world.persistence("B")),
            aToolResults: toolResults(world.persistence("A")),
            aRuns: world.session("A")?.requests.length,
            bRuns: world.session("B")?.requests.length,
        };
        await Promise.all([a.close(), b.close()]);

        expect(observed).toEqual({
            executions: 1,
            bUsers: ["message from A's tool"],
            aToolResults: ["cross-call"],
            aRuns: 2,
            bRuns: 1,
        });
    });

    it("lets agent A's tool await priority steering to agent B", async () => {
        const world = await harness(
            new Map([
                [
                    "A",
                    async (toolCtx, owner, _self, id) => {
                        await owner.steer(toolCtx, id("B"), user("steering from A's tool"));
                    },
                ],
            ]),
            new Map([
                ["A", [toolTurn(), textTurn("A finished")]],
                ["B", [textTurn("B handled steering")]],
            ]),
        );
        const a = world.agent("A");
        const b = world.agent("B");

        await a.send(ctx, user("start A"));
        await Promise.all([a.waitForIdle(), b.waitForIdle()]);
        const observed = {
            bUsers: userTexts(world.persistence("B")),
            aToolResults: toolResults(world.persistence("A")),
            bRuns: world.session("B")?.requests.length,
        };
        await Promise.all([a.close(), b.close()]);

        expect(observed).toEqual({
            bUsers: ["steering from A's tool"],
            aToolResults: ["cross-call"],
            bRuns: 1,
        });
    });

    it("lets agent A's tool compact an idle agent B without corrupting either history", async () => {
        const world = await harness(
            new Map([
                [
                    "A",
                    async (toolCtx, owner, _self, id) => {
                        await owner.compact(toolCtx, id("B"));
                    },
                ],
            ]),
            new Map([
                ["A", [toolTurn(), textTurn("A finished after B compacted")]],
                ["B", [textTurn("B's old answer")]],
            ]),
            new Map([["B", [completedCompaction("summary of B only")]]]),
        );
        const a = world.agent("A");
        const b = world.agent("B");
        await b.send(ctx, user("seed B history"));
        await b.waitForIdle();

        await a.send(ctx, user("compact B"));
        await Promise.all([a.waitForIdle(), b.waitForIdle()]);
        const observed = {
            bRecordTypes: world.persistence("B").records.map((record) => record.type),
            bUsers: userTexts(world.persistence("B")),
            aUsers: userTexts(world.persistence("A")),
            aToolResults: toolResults(world.persistence("A")),
            bCompactions: world.session("B")?.compactions.length,
        };
        await Promise.all([a.close(), b.close()]);

        expect(observed).toEqual({
            bRecordTypes: ["compaction"],
            bUsers: [],
            aUsers: ["compact B"],
            aToolResults: ["cross-call"],
            bCompactions: 1,
        });
    });

    it("settles a cycle where B's tool sends back to A while A awaits its send to B", async () => {
        const executions: string[] = [];
        const world = await harness(
            new Map([
                [
                    "A",
                    async (toolCtx, owner, _self, id) => {
                        executions.push("A");
                        await owner.send(toolCtx, id("B"), user("A asks B"));
                    },
                ],
                [
                    "B",
                    async (toolCtx, owner, _self, id) => {
                        executions.push("B");
                        await owner.send(toolCtx, id("A"), user("B replies to A"));
                    },
                ],
            ]),
            new Map([
                [
                    "A",
                    [
                        toolTurn("A-to-B"),
                        textTurn("A closed its tool call"),
                        textTurn("A answered B's reply"),
                    ],
                ],
                ["B", [toolTurn("B-to-A"), textTurn("B closed its tool call")]],
            ]),
        );
        const a = world.agent("A");
        const b = world.agent("B");

        await a.send(ctx, user("start cycle"));
        const settled = await settlesWithin(Promise.all([a.waitForIdle(), b.waitForIdle()]), 500);
        const observed = {
            settled,
            executions,
            aUsers: userTexts(world.persistence("A")),
            bUsers: userTexts(world.persistence("B")),
            aToolResults: toolResults(world.persistence("A")),
            bToolResults: toolResults(world.persistence("B")),
            aRuns: world.session("A")?.requests.length,
            bRuns: world.session("B")?.requests.length,
        };
        await Promise.all([a.close(), b.close()]);

        expect(observed).toEqual({
            settled: true,
            executions: ["A", "B"],
            aUsers: ["start cycle", "B replies to A"],
            bUsers: ["A asks B"],
            aToolResults: ["A-to-B"],
            bToolResults: ["B-to-A"],
            aRuns: 3,
            bRuns: 2,
        });
    });

    it("settles when two active agentSystem tool-call each other concurrently", async () => {
        const bothToolsStarted = deferred();
        let started = 0;
        const cross = (target: string, text: string): ToolAction => {
            return async (toolCtx, owner, _self, id) => {
                started += 1;
                if (started === 2) bothToolsStarted.resolve();
                await bothToolsStarted.promise;
                await owner.send(toolCtx, id(target), user(text));
            };
        };
        const world = await harness(
            new Map([
                ["A", cross("B", "concurrent message from A")],
                ["B", cross("A", "concurrent message from B")],
            ]),
            new Map([
                ["A", [toolTurn("A-cross"), textTurn("A tool settled"), textTurn("A answered B")]],
                ["B", [toolTurn("B-cross"), textTurn("B tool settled"), textTurn("B answered A")]],
            ]),
        );
        const a = world.agent("A");
        const b = world.agent("B");

        await Promise.all([a.send(ctx, user("start A")), b.send(ctx, user("start B"))]);
        const settled = await settlesWithin(Promise.all([a.waitForIdle(), b.waitForIdle()]), 500);
        const observed = {
            settled,
            aUsers: userTexts(world.persistence("A")),
            bUsers: userTexts(world.persistence("B")),
            aToolResults: toolResults(world.persistence("A")),
            bToolResults: toolResults(world.persistence("B")),
            aRuns: world.session("A")?.requests.length,
            bRuns: world.session("B")?.requests.length,
        };
        await Promise.all([a.close(), b.close()]);

        expect(observed).toEqual({
            settled: true,
            aUsers: ["start A", "concurrent message from B"],
            bUsers: ["start B", "concurrent message from A"],
            aToolResults: ["A-cross"],
            bToolResults: ["B-cross"],
            aRuns: 3,
            bRuns: 3,
        });
    });

    it("rejects or schedules mutual cross-agent compaction instead of deadlocking both tools", async () => {
        const bothToolsStarted = deferred();
        let started = 0;
        const compactPeer = (target: string): ToolAction => {
            return async (toolCtx, owner, _self, id) => {
                started += 1;
                if (started === 2) bothToolsStarted.resolve();
                await bothToolsStarted.promise;
                await owner.compact(toolCtx, id(target));
            };
        };
        const world = await harness(
            new Map([
                ["A", compactPeer("B")],
                ["B", compactPeer("A")],
            ]),
            new Map([
                ["A", [toolTurn("A-compacts-B"), textTurn("A continued")]],
                ["B", [toolTurn("B-compacts-A"), textTurn("B continued")]],
            ]),
            new Map([
                ["A", [completedCompaction("A summary")]],
                ["B", [completedCompaction("B summary")]],
            ]),
        );
        const a = world.agent("A");
        const b = world.agent("B");

        await Promise.all([a.send(ctx, user("start A")), b.send(ctx, user("start B"))]);
        await bothToolsStarted.promise;
        const settledWithoutIntervention = await settlesWithin(
            Promise.all([a.waitForIdle(), b.waitForIdle()]),
        );
        await Promise.all([a.abort(ctx), b.abort(ctx)]);
        await Promise.all([a.waitForIdle(), b.waitForIdle()]);
        const observed = {
            settledWithoutIntervention,
            aPending: [...world.persistence("A").pending.keys()],
            bPending: [...world.persistence("B").pending.keys()],
            aToolResults: toolResults(world.persistence("A")),
            bToolResults: toolResults(world.persistence("B")),
        };
        await Promise.all([a.close(), b.close()]);

        expect(observed).toEqual({
            settledWithoutIntervention: true,
            aPending: [],
            bPending: [],
            aToolResults: [],
            bToolResults: [],
        });
    });

    it("does not deadlock when two active tools close each other's agentSystem", async () => {
        const bothToolsStarted = deferred();
        let started = 0;
        const closePeer = (target: string): ToolAction => {
            return async (_toolCtx, owner, _self, id) => {
                started += 1;
                if (started === 2) bothToolsStarted.resolve();
                await bothToolsStarted.promise;
                await (await owner.resolve(ctx, id(target))).close();
            };
        };
        const world = await harness(
            new Map([
                ["A", closePeer("B")],
                ["B", closePeer("A")],
            ]),
            new Map([
                ["A", [toolTurn("A-closes-B"), textTurn("A continued")]],
                ["B", [toolTurn("B-closes-A"), textTurn("B continued")]],
            ]),
        );
        const a = world.agent("A");
        const b = world.agent("B");

        await Promise.all([a.send(ctx, user("start A")), b.send(ctx, user("start B"))]);
        await bothToolsStarted.promise;
        const settledWithoutIntervention = await settlesWithin(
            Promise.all([a.waitForIdle(), b.waitForIdle()]),
        );
        await Promise.all([a.abort(ctx), b.abort(ctx)]);
        await Promise.all([a.close(), b.close()]);
        const observed = {
            settledWithoutIntervention,
            aPending: [...world.persistence("A").pending.keys()],
            bPending: [...world.persistence("B").pending.keys()],
            aDestroyCalls: world.session("A")?.destroyCalls,
            bDestroyCalls: world.session("B")?.destroyCalls,
        };

        expect(observed).toEqual({
            settledWithoutIntervention: true,
            aPending: [],
            bPending: [],
            aDestroyCalls: 1,
            bDestroyCalls: 1,
        });
    });

    it("does not deadlock when two active tools delete each other's agentSystem", async () => {
        const bothToolsStarted = deferred();
        let started = 0;
        const deletePeer = (target: string): ToolAction => {
            return async (toolCtx, owner, _self, id) => {
                started += 1;
                if (started === 2) bothToolsStarted.resolve();
                await bothToolsStarted.promise;
                await owner.delete(toolCtx, id(target));
            };
        };
        const world = await harness(
            new Map([
                ["A", deletePeer("B")],
                ["B", deletePeer("A")],
            ]),
            new Map([
                ["A", [toolTurn("A-deletes-B"), textTurn("A continued")]],
                ["B", [toolTurn("B-deletes-A"), textTurn("B continued")]],
            ]),
        );
        const a = world.agent("A");
        const b = world.agent("B");

        await Promise.all([a.send(ctx, user("start A")), b.send(ctx, user("start B"))]);
        await bothToolsStarted.promise;
        const settledWithoutIntervention = await settlesWithin(
            Promise.all([a.waitForIdle(), b.waitForIdle()]),
        );
        await Promise.all([a.abort(ctx), b.abort(ctx)]);
        await Promise.all([a.close(), b.close()]);
        const observed = {
            settledWithoutIntervention,
            aConfig: await world.owner.config(ctx, world.id("A")),
            bConfig: await world.owner.config(ctx, world.id("B")),
            aPending: [...world.persistence("A").pending.keys()],
            bPending: [...world.persistence("B").pending.keys()],
        };

        expect(observed).toEqual({
            settledWithoutIntervention: true,
            // Each close revokes the peer tool that was carrying the matching delete. The
            // conversations settle without a cycle, while both recoverable identities remain.
            aConfig: { provenance: { createdAt: expect.any(Number) } },
            bConfig: { provenance: { createdAt: expect.any(Number) } },
            aPending: [],
            bPending: [],
        });
    });

    it("lets agent A's tool abort active agent B without waiting for B's blocked stream", async () => {
        const bStarted = deferred();
        const releaseB = deferred();
        const abortStarted = deferred();
        const world = await harness(
            new Map([
                [
                    "A",
                    async (toolCtx, owner, _self, id) => {
                        abortStarted.resolve();
                        await owner.abort(toolCtx, id("B"));
                    },
                ],
            ]),
            new Map([
                ["A", [toolTurn(), textTurn("A finished aborting B")]],
                [
                    "B",
                    [
                        () =>
                            (async function* () {
                                bStarted.resolve();
                                yield { type: "text_start" };
                                await releaseB.promise;
                                yield { type: "text_delta", delta: "late B text" };
                                yield { type: "text_end" };
                                yield {
                                    type: "done",
                                    state: "normal",
                                    tokens: { input: 1, output: 1 },
                                };
                            })(),
                    ],
                ],
            ]),
        );
        const a = world.agent("A");
        const b = world.agent("B");
        await b.send(ctx, user("block B"));
        await bStarted.promise;

        await a.send(ctx, user("abort B"));
        await abortStarted.promise;
        const aSettledWhileBBlocked = await settlesWithin(a.waitForIdle());
        releaseB.resolve();
        await Promise.all([a.waitForIdle(), b.waitForIdle()]);
        const observed = {
            aSettledWhileBBlocked,
            aToolResults: toolResults(world.persistence("A")),
            bBlocks: world.persistence("B").records.filter((record) => record.type === "block")
                .length,
        };
        await Promise.all([a.close(), b.close()]);

        expect(observed).toEqual({
            aSettledWhileBBlocked: true,
            aToolResults: ["cross-call"],
            bBlocks: 0,
        });
    });

    it("lets agent A's tool close active agent B once B's admitted work settles", async () => {
        const bStarted = deferred();
        const releaseB = deferred();
        const closeStarted = deferred();
        const world = await harness(
            new Map([
                [
                    "A",
                    async (_toolCtx, owner, _self, id) => {
                        closeStarted.resolve();
                        await (await owner.resolve(ctx, id("B"))).close();
                    },
                ],
            ]),
            new Map([
                ["A", [toolTurn(), textTurn("A finished closing B")]],
                [
                    "B",
                    [
                        () =>
                            (async function* () {
                                bStarted.resolve();
                                yield { type: "text_start" };
                                await releaseB.promise;
                                yield { type: "text_delta", delta: "B finished before close" };
                                yield { type: "text_end" };
                                yield {
                                    type: "done",
                                    state: "normal",
                                    tokens: { input: 1, output: 1 },
                                };
                            })(),
                    ],
                ],
            ]),
        );
        const a = world.agent("A");
        const b = world.agent("B");
        await b.send(ctx, user("finish B before close"));
        await bStarted.promise;

        await a.send(ctx, user("close B"));
        await closeStarted.promise;
        const closedBeforeRelease = await settlesWithin(a.waitForIdle(), 40);
        releaseB.resolve();
        const settledAfterRelease = await settlesWithin(a.waitForIdle(), 500);
        const observed = {
            closedBeforeRelease,
            settledAfterRelease,
            bRecordTypes: world.persistence("B").records.map((record) => record.type),
            aToolResults: toolResults(world.persistence("A")),
            bDestroyCalls: world.session("B")?.destroyCalls,
        };
        await Promise.all([a.close(), b.close()]);

        expect(observed).toEqual({
            closedBeforeRelease: false,
            settledAfterRelease: true,
            bRecordTypes: ["user", "block"],
            aToolResults: ["cross-call"],
            bDestroyCalls: 1,
        });
    });

    it("lets agent A's tool delete active agent B atomically after B settles", async () => {
        const bStarted = deferred();
        const releaseB = deferred();
        const deleteStarted = deferred();
        const world = await harness(
            new Map([
                [
                    "A",
                    async (toolCtx, owner, _self, id) => {
                        deleteStarted.resolve();
                        await owner.delete(toolCtx, id("B"));
                    },
                ],
            ]),
            new Map([
                ["A", [toolTurn(), textTurn("A finished deleting B")]],
                [
                    "B",
                    [
                        () =>
                            (async function* () {
                                bStarted.resolve();
                                yield { type: "text_start" };
                                await releaseB.promise;
                                yield { type: "text_delta", delta: "B committed before deletion" };
                                yield { type: "text_end" };
                                yield {
                                    type: "done",
                                    state: "normal",
                                    tokens: { input: 1, output: 1 },
                                };
                            })(),
                    ],
                ],
            ]),
        );
        const a = world.agent("A");
        const b = world.agent("B");
        await b.send(ctx, user("finish before deletion"));
        await bStarted.promise;

        await a.send(ctx, user("delete B"));
        await deleteStarted.promise;
        const deletedBeforeRelease = await settlesWithin(a.waitForIdle(), 40);
        releaseB.resolve();
        const settledAfterRelease = await settlesWithin(a.waitForIdle(), 500);
        const observed = {
            deletedBeforeRelease,
            settledAfterRelease,
            durableConfig: await world.owner.config(ctx, world.id("B")),
            bRecordTypes: world.persistence("B").records.map((record) => record.type),
            aToolResults: toolResults(world.persistence("A")),
        };
        await Promise.all([a.close(), b.close()]);

        expect(observed).toEqual({
            deletedBeforeRelease: false,
            settledAfterRelease: true,
            durableConfig: undefined,
            bRecordTypes: ["user", "block"],
            aToolResults: ["cross-call"],
        });
    });
});
