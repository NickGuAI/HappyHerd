import { describe, expect, it } from "vitest";

import type { SessionAgentMessage } from "@/core/SessionContext.js";
import { toAnthropicMessages } from "@/protocol/anthropic/toAnthropicMessages.js";
import { toOpenAIResponseInput } from "@/protocol/responses/toOpenAIResponseInput.js";
import { toGrokResponseInput } from "@/vendors/grok/impl/toGrokResponseInput.js";

const review: SessionAgentMessage = {
    role: "agent",
    author: { id: "agt_reviewer", description: "the reviewer" },
    content: [
        { type: "reasoning", text: "Checked the diff twice." },
        { type: "text", text: "The migration is safe to land." },
    ],
};

const reminderText =
    "<system-reminder>\n" +
    "Message from agent the reviewer (agt_reviewer):\n\n" +
    "Checked the diff twice.\n\n" +
    "The migration is safe to land.\n" +
    "</system-reminder>";

describe("messages from another agent", () => {
    it("reaches Responses as a developer notification naming the author", () => {
        expect(toOpenAIResponseInput({ instructions: "", messages: [review] })).toEqual([
            {
                type: "message",
                role: "developer",
                content: [
                    { type: "input_text", text: "Message from agent the reviewer (agt_reviewer):" },
                    { type: "input_text", text: "Checked the diff twice." },
                    { type: "input_text", text: "The migration is safe to land." },
                ],
            },
        ]);
    });

    it("reaches Anthropic as a system reminder naming the author", () => {
        expect(toAnthropicMessages([review])).toEqual([
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: reminderText,
                        cache_control: { type: "ephemeral" },
                    },
                ],
            },
        ]);
    });

    it("reaches Grok as a system reminder naming the author", () => {
        const [, notification] = toGrokResponseInput({ instructions: "", messages: [review] });
        expect(notification).toEqual({ type: "message", role: "user", content: reminderText });
    });

    it("carries an image through the notification rather than dropping it", () => {
        const withImage: SessionAgentMessage = {
            role: "agent",
            author: { id: "agt_designer", description: "the designer" },
            content: [
                { type: "text", text: "Here is the mock." },
                { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
            ],
        };
        const [item] = toOpenAIResponseInput({ instructions: "", messages: [withImage] });

        expect(item).toMatchObject({ type: "message", role: "developer" });
        expect((item as { content: readonly unknown[] }).content).toHaveLength(3);
    });

    it("omits reasoning that is only an opaque provider payload", () => {
        const opaque: SessionAgentMessage = {
            role: "agent",
            author: { id: "agt_worker", description: "" },
            content: [
                { type: "reasoning", reasoning: "signed-and-unreadable" },
                { type: "text", text: "Done." },
            ],
        };

        expect(toOpenAIResponseInput({ instructions: "", messages: [opaque] })).toEqual([
            {
                type: "message",
                role: "developer",
                content: [
                    { type: "input_text", text: "Message from agent agt_worker:" },
                    { type: "input_text", text: "Done." },
                ],
            },
        ]);
    });
});
