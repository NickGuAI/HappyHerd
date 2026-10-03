import { describe, expect, it } from "vitest";

import type { SessionMessage } from "@/core/SessionContext.js";
import { getCodexTurnKey } from "@/vendors/codex/impl/getCodexTurnKey.js";

describe("getCodexTurnKey", () => {
    it("keeps one turn across continuations after the user message that opened it", () => {
        const human: SessionMessage = {
            role: "user",
            content: [{ type: "text", text: "Original task" }],
        };

        expect(getCodexTurnKey([human])).toBe(
            getCodexTurnKey([
                human,
                { role: "assistant", content: [{ type: "text", text: "Working." }] },
                {
                    role: "tool",
                    callId: "call-1",
                    content: [{ type: "text", text: "done" }],
                },
            ]),
        );
    });

    it("does not treat a message from another agent as a new turn", () => {
        const human: SessionMessage = {
            role: "user",
            content: [{ type: "text", text: "Original task" }],
        };
        const queued: SessionMessage = {
            role: "agent",
            author: { id: "agent-1", description: "the reviewer" },
            content: [{ type: "text", text: "I finished the review." }],
        };

        expect(getCodexTurnKey([human, queued])).toBe(getCodexTurnKey([human]));
    });

    it("treats every user message as a new turn boundary", () => {
        const first: SessionMessage = {
            role: "user",
            content: [{ type: "text", text: "Original task" }],
        };
        const next: SessionMessage = {
            role: "user",
            content: [{ type: "text", text: "Background context" }],
        };

        expect(getCodexTurnKey([first, next])).not.toBe(getCodexTurnKey([first]));
    });
});
