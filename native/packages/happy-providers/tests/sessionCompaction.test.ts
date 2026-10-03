import { testContext, testContextWith } from "./testContext.js";

import { describe, expect, it } from "vitest";

import { ResponsesSession } from "@/protocol/responses/ResponsesSession.js";

describe("SessionCompaction", () => {
    it("reports that a standard endpoint has no native compaction", async () => {
        const session = new ResponsesSession("session", {
            apiKey: "test-key",
            endpoint: "http://127.0.0.1:1/v1",
            nativeCompaction: false,
            instructions: "System prompt.",
        });

        const result = await session.compact(testContext, {
            context: {
                instructions: "System prompt.",
                messages: [
                    {
                        role: "system",
                        content: [{ type: "text" as const, text: "Preserved metadata." }],
                    },
                ],
            },
        });

        expect(result).toEqual({
            status: "failed",
            kind: "inference_error",
            message: "This Responses API endpoint does not provide native compaction.",
        });
    });

    it("returns cancellation separately and leaves context untouched", async () => {
        const context = {
            instructions: "System prompt.",
            messages: [
                {
                    role: "user" as const,
                    content: [{ type: "text" as const, text: "Original state." }],
                },
            ],
        };
        const session = new ResponsesSession("session", {
            apiKey: "test-key",
            endpoint: "http://127.0.0.1:1/v1",
            instructions: context.instructions,
        });
        const controller = new AbortController();
        controller.abort();

        await expect(
            session.compact(testContextWith(controller.signal), {
                context: {
                    instructions: context.instructions,
                    messages: context.messages,
                },
            }),
        ).resolves.toEqual({
            status: "cancelled",
            context,
        });
    });
});
