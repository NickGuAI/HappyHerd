import { Type } from "@sinclair/typebox";
import {
    createRootContext,
    withTracer,
    type Context,
    type TraceSpan,
    type Tracer,
} from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import { AgentBase, AgentKV, AgentSystemLocal, defineAgentTool } from "../sources/index.js";
import {
    InMemoryAgentStorage,
    inMemoryStorageLock,
    providersOf,
    textTurn,
    user,
} from "./gym/fixtures.js";
import { InMemoryPersistence } from "./gym/InMemoryPersistence.js";
import { ScriptedProvider, type ScriptedSession } from "./gym/ScriptedProvider.js";

/** One span the agent opened, keeping the parent it was opened under so nesting can be read. */
class RecordingSpan implements TraceSpan {
    ended = false;
    exception: unknown;
    readonly attributes: Record<string, unknown> = {};

    constructor(
        readonly name: string,
        readonly parent: RecordingSpan | undefined,
    ) {}

    end(): void {
        this.ended = true;
    }

    recordException(error: unknown): void {
        this.exception = error;
    }

    setAttributes(attributes: Readonly<Record<string, unknown>>): void {
        Object.assign(this.attributes, attributes);
    }
}

/** Records every span opened on the context it is installed on, in the order they were opened. */
class RecordingTracer implements Tracer {
    readonly spans: RecordingSpan[] = [];

    startSpan(name: string, parent: TraceSpan | undefined): TraceSpan {
        const span = new RecordingSpan(name, parent as RecordingSpan | undefined);
        this.spans.push(span);
        return span;
    }
}

/** A span's place in the tree, as `"outermost > ... > this one"`. */
function path(span: RecordingSpan): string {
    const names: string[] = [];
    for (let current: RecordingSpan | undefined = span; current !== undefined; ) {
        names.unshift(current.name);
        current = current.parent;
    }
    return names.join(" > ");
}

/**
 * Where every span the agent itself opened sits. Spans opened by the standard library underneath
 * it — a contended lock announcing its wait, say — are not the agent's tracing and are left out.
 */
function paths(tracer: RecordingTracer): string[] {
    return tracer.spans.filter((span) => span.name.startsWith("agent.")).map(path);
}

function tracingContext(tracer: RecordingTracer): Context {
    return withTracer(createRootContext().named("agent-tracing-test"), tracer);
}

function tool(name: string) {
    return defineAgentTool({
        name,
        returnType: Type.Object({}),
        shouldReviewInAutoMode: () => false,
        execute: () => Promise.resolve({}),
        toLLM: () => [{ type: "text", text: "ok" }],
    });
}

/** A scripted response that asks for every named tool at once and then ends in a tool call. */
function toolCallTurn(...names: readonly string[]) {
    return [
        ...names.flatMap((name, index) => [
            { type: "toolcall_start", callId: `call-${index}`, name } as const,
            { type: "toolcall_end", callId: `call-${index}`, arguments: "{}" } as const,
        ]),
        { type: "done", state: "tool_call", tokens: { input: 1, output: 1 } } as const,
    ];
}

function completedCompaction() {
    return {
        status: "completed",
        preservedMessages: [],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
        context: { instructions: "", messages: [] },
    } as const;
}

describe("agent tracing", () => {
    it("traces a turn as an inference inside a turn inside the run", async () => {
        const tracer = new RecordingTracer();
        const ctx = tracingContext(tracer);
        const agent = await AgentBase.create(ctx, {
            id: "test-agent",
            providers: providersOf(new ScriptedProvider([textTurn("hello")])),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
        });

        await agent.send(ctx, user("hi"));
        await agent.waitForIdle();
        await agent.close();

        expect(paths(tracer)).toEqual([
            "agent.run",
            "agent.run > agent.turn",
            "agent.run > agent.turn > agent.inference",
            "agent.run > agent.settle",
        ]);
        expect(tracer.spans.every((span) => span.ended)).toBe(true);
    });

    it("attributes every agent span without recording conversation content", async () => {
        const tracer = new RecordingTracer();
        const ctx = tracingContext(tracer);
        const agent = await AgentBase.create(ctx, {
            id: "test-agent",
            providers: providersOf(new ScriptedProvider([textTurn("hello")])),
            provider: "scripted",
            model: "scripted-model",
            effort: "low",
            serviceTier: "priority",
            permissionMode: "read_only",
            persistence: new InMemoryPersistence(),
        });

        await agent.send(ctx, user("private prompt"));
        await agent.waitForIdle();
        await agent.close();

        const agentSpans = tracer.spans.filter((span) => span.name.startsWith("agent."));
        expect(agentSpans).not.toHaveLength(0);
        for (const span of agentSpans) {
            expect(span.attributes).toMatchObject({
                "agent.id": "test-agent",
                "agent.provider": "scripted",
                "agent.model": "scripted-model",
                "agent.effort": "low",
                "agent.service_tier": "priority",
                "agent.permission_mode": "read_only",
            });
            expect(JSON.stringify(span.attributes)).not.toContain("private prompt");
        }
        const turn = agentSpans.find((span) => span.name === "agent.turn");
        const inference = agentSpans.find((span) => span.name === "agent.inference");
        expect(turn?.attributes["agent.loop.id"]).toEqual(expect.any(String));
        expect(inference?.attributes).toMatchObject({
            "agent.loop.id": turn?.attributes["agent.loop.id"],
            "agent.turn.id": expect.any(String),
            "agent.inference.id": expect.any(String),
        });
    });

    it("gives every call of a tool batch its own span inside the batch's own", async () => {
        const tracer = new RecordingTracer();
        const ctx = tracingContext(tracer);
        const agent = await AgentBase.create(ctx, {
            id: "test-agent",
            providers: providersOf(
                new ScriptedProvider([toolCallTurn("first", "second"), textTurn("done")]),
            ),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            initialState: { tools: [tool("first"), tool("second")] },
        });

        await agent.send(ctx, user("use the tools"));
        await agent.waitForIdle();
        await agent.close();

        const observed = paths(tracer);
        expect(observed.filter((name) => name === "agent.run > agent.turn > agent.tools")).toEqual([
            "agent.run > agent.turn > agent.tools",
        ]);
        expect(
            observed.filter((name) => name === "agent.run > agent.turn > agent.tools > agent.tool"),
        ).toHaveLength(2);
        expect(
            tracer.spans
                .filter((span) => span.name === "agent.tool")
                .map((span) => span.attributes["agent.tool.name"])
                .sort(),
        ).toEqual(["first", "second"]);
        expect(
            observed.filter((name) => name === "agent.run > agent.turn > agent.inference"),
        ).toHaveLength(2);
        expect(tracer.spans.every((span) => span.ended)).toBe(true);
    });

    it("traces a compaction as work of the turn that carries it out", async () => {
        const tracer = new RecordingTracer();
        const ctx = tracingContext(tracer);
        const provider = new ScriptedProvider([textTurn("first"), textTurn("after compaction")]);
        const agent = await AgentBase.create(ctx, {
            id: "test-agent",
            providers: providersOf(provider),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
        });

        await agent.send(ctx, user("hi"));
        await agent.waitForIdle();
        const session = provider.sessions[0] as ScriptedSession;
        session.compactionResults.push(completedCompaction());
        await agent.compact(ctx);
        await agent.waitForIdle();
        await agent.close();

        expect(session.compactions).toHaveLength(1);
        expect(paths(tracer)).toContain("agent.run > agent.turn > agent.compaction");
    });

    it("records a failed request on the inference span without failing the turn", async () => {
        const tracer = new RecordingTracer();
        const ctx = tracingContext(tracer);
        const failure = new Error("The instructions could not be built.");
        const agent = await AgentBase.create(ctx, {
            id: "test-agent",
            providers: providersOf(new ScriptedProvider([textTurn("never asked for")])),
            provider: "scripted",
            persistence: new InMemoryPersistence(),
            hooks: {
                instructions: () => {
                    throw failure;
                },
            },
        });

        await agent.send(ctx, user("hi"));
        await agent.waitForIdle();
        await agent.close();

        const inference = tracer.spans.find((span) => span.name === "agent.inference");
        expect(inference?.exception).toBe(failure);
        expect(inference?.ended).toBe(true);
        // The turn caught it and surfaced it to the conversation, so nothing above it failed.
        const turn = tracer.spans.find((span) => span.name === "agent.turn");
        expect(turn?.exception).toBeUndefined();
    });

    it("opens an agent's run outside the call that brought the agent into existence", async () => {
        const tracer = new RecordingTracer();
        const ctx = tracingContext(tracer);
        const persistence = new InMemoryPersistence();
        const system = await AgentSystemLocal.create(
            ctx,
            new InMemoryAgentStorage({
                acquireLock: inMemoryStorageLock(),
                kv: new AgentKV(new InMemoryPersistence(), "agentSystem."),
                persistence: () => persistence,
            }),
            {
                modules: [],
                providers: providersOf(new ScriptedProvider([textTurn("hello")])),
                provider: "scripted",
                models: [],
            },
        );
        const created = await ctx.span("caller", (callerCtx) => system.create(callerCtx, {}));

        await system.send(ctx, created.id, user("hi"));
        const agent = await system.resolve(ctx, created.id);
        await agent.waitForIdle();
        await agent.close();

        expect(paths(tracer)).toContain("agent.system.start");
        const runs = tracer.spans.filter((span) => span.name === "agent.run");
        expect(runs.length).toBeGreaterThan(0);
        // The run outlives the call that created the agent, so it hangs off the collection's own
        // context rather than under whichever caller happened to ask for the agent.
        expect(runs.map(path)).toEqual(runs.map(() => "agent.run"));
    });
});
