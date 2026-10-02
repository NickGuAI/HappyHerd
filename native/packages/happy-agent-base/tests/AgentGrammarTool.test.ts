import { Type } from "@sinclair/typebox";
import { createRootContext } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import { AgentBase, agentGrammarToolParameters, defineAgentTool } from "../sources/index.js";
import { providersOf, textTurn, user } from "./gym/fixtures.js";
import { InMemoryPersistence } from "./gym/InMemoryPersistence.js";
import { ScriptedProvider } from "./gym/ScriptedProvider.js";

/** The patch body a freeform tool is called with: its own syntax, and not JSON at any point. */
const PATCH = "*** Begin Patch\n*** Update File: a.txt\n@@\n-old\n+new\n*** End Patch\n";

/**
 * A grammar tool, as Codex custom tools are declared: the model is constrained by a Lark grammar
 * rather than a JSON schema, so what arrives is the raw text the grammar produced.
 */
function grammarTool(received: { value?: unknown }) {
    return defineAgentTool({
        name: "apply_patch",
        description: "A FREEFORM tool: do not wrap the patch in JSON.",
        grammar: {
            type: "lark",
            grammar: 'start: "*** Begin Patch" /(.|\\n)*/ "*** End Patch"',
        },
        returnType: Type.Object({ text: Type.String() }),
        shouldReviewInAutoMode: () => false,
        execute: (_ctx, args) => {
            // The tool declared no parameters, so this reads `input` purely on the strength of the
            // grammar. It would not compile if the arguments were typed as anything else.
            received.value = args;
            return Promise.resolve({ text: args.input.includes("Begin Patch") ? "applied" : "no" });
        },
        toLLM: (result) => [{ type: "text", text: result.text }],
    });
}

/** A response that calls the tool with raw grammar output, then finishes on the next turn. */
function patchTurn() {
    return [
        { type: "toolcall_start", callId: "call-0", name: "apply_patch" } as const,
        { type: "toolcall_end", callId: "call-0", arguments: PATCH } as const,
        { type: "done", state: "tool_call", tokens: { input: 1, output: 1 } } as const,
    ];
}

describe("grammar tools", () => {
    it("hands a freeform call its raw text instead of trying to read it as JSON", async () => {
        const received: { value?: unknown } = {};
        const ctx = createRootContext().named("grammar-tool-test");
        const persistence = new InMemoryPersistence();
        const agent = await AgentBase.create(ctx, {
            id: "grammar-agent",
            providers: providersOf(new ScriptedProvider([patchTurn(), textTurn("done")])),
            provider: "scripted",
            persistence,
            initialState: { tools: [grammarTool(received)] },
        });

        await agent.send(ctx, user("edit the file"));
        await agent.waitForIdle();
        await agent.close();

        // The grammar produced this text, so the tool is handed exactly it. Nothing tried to read
        // a patch as JSON, and the call was not refused for failing to be JSON.
        expect(received.value).toEqual({ input: PATCH });
        // The call is recorded with the patch exactly as the grammar wrote it, and what goes back
        // to the model is the tool's own result rather than a complaint about JSON.
        const history = JSON.stringify(persistence.records);
        expect(persistence.records).toContainEqual(
            expect.objectContaining({
                type: "block",
                block: expect.objectContaining({ type: "tool_call", arguments: PATCH }),
            }),
        );
        expect(history).toContain("applied");
        expect(history).not.toContain("valid JSON");
    });

    it("gives a freeform tool the parameters the agent validates its calls against", () => {
        const tool = grammarTool({});

        // The tool wrote no schema, so this is the one the definition installed for it. The agent
        // checks every call against it, which is what keeps the type and the runtime in agreement.
        expect(tool.parameters).toEqual(agentGrammarToolParameters);
    });

    it("refuses a tool that claims both a grammar and parameters of its own", () => {
        expect(() =>
            defineAgentTool({
                name: "apply_patch",
                grammar: { type: "lark", grammar: "start: X" },
                // A grammar tool does not get to describe its own arguments: the grammar already
                // decided them. Written as a cast because the types reject this on their own.
                parameters: Type.Object({ patch: Type.String() }),
                returnType: Type.Object({ text: Type.String() }),
                shouldReviewInAutoMode: () => false,
                execute: () => Promise.resolve({ text: "ok" }),
                toLLM: () => [{ type: "text", text: "ok" }],
            } as unknown as Parameters<typeof defineAgentTool>[0]),
        ).toThrow(/both a grammar and parameters/);
    });
});
