import { describe, expect, it } from "vitest";

import type { SessionAssistantMessage, SessionMessage } from "@/core/SessionContext.js";
import { getCodexContextSuffix } from "@/vendors/codex/impl/getCodexContextSuffix.js";

describe("getCodexContextSuffix", () => {
    it("keeps provider context when tool argument JSON is reformatted", () => {
        const previous = [
            {
                role: "user",
                content: [{ type: "text" as const, text: "Read it." }],
            },
            assistant('{"file_path": "/tmp/input", "line": 1}'),
        ] satisfies SessionMessage[];
        const current = [
            {
                role: "user",
                content: [{ type: "text" as const, text: "Read it." }],
            },
            assistant('{"line":1,"file_path":"/tmp/input"}'),
            {
                role: "tool",
                content: [{ type: "text" as const, text: "done" }],
                callId: "call-1",
            },
        ] satisfies SessionMessage[];

        expect(getCodexContextSuffix(previous, current)).toEqual([current[2]]);
    });

    it("rebuilds context when a tool argument value changes", () => {
        const previous = [assistant('{"line":1}')] satisfies SessionMessage[];
        const current = [assistant('{"line":2}')] satisfies SessionMessage[];

        expect(getCodexContextSuffix(previous, current)).toBeUndefined();
    });

    it("ignores caller-projected reasoning while retaining native provider state", () => {
        const previous = [
            {
                ...assistant('{"line":1}'),
                content: [
                    {
                        type: "reasoning" as const,
                        reasoning: '{"type":"reasoning","encrypted_content":"opaque"}',
                    },
                    ...assistant('{"line":1}').content,
                ],
            },
        ] satisfies SessionMessage[];
        const current = [
            {
                ...assistant('{"line":1}'),
                content: [
                    { type: "reasoning" as const, text: "Visible summary." },
                    ...assistant('{"line":1}').content,
                ],
            },
            {
                role: "tool",
                content: [{ type: "text" as const, text: "done" }],
                callId: "call-1",
            },
        ] satisfies SessionMessage[];

        expect(getCodexContextSuffix(previous, current)).toEqual([current[1]]);
    });

    it("keeps custom tool input byte-sensitive", () => {
        const customVendor = { provider: "codex", type: "custom_tool_call" };
        const previous = [assistant('{"line": 1}', customVendor)] satisfies SessionMessage[];
        const current = [assistant('{"line":1}', customVendor)] satisfies SessionMessage[];

        expect(getCodexContextSuffix(previous, current)).toBeUndefined();
    });
});

function assistant(argumentsJson: string, vendor?: unknown): SessionAssistantMessage {
    return {
        role: "assistant" as const,
        content: [
            {
                type: "tool_call",
                callId: "call-1",
                name: "Read",
                arguments: argumentsJson,
                ...(vendor === undefined ? {} : { vendor }),
            },
        ],
    };
}
