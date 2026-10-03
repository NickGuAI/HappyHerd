import { testContext } from "./testContext.js";

import { describe, expect, it } from "vitest";

import { ClaudeAuthTokenCredential } from "@/vendors/claude/ClaudeAuthTokenCredential.js";
import { ClaudeProvider } from "@/vendors/claude/ClaudeProvider.js";
import type { ClaudeSdkQuery } from "@/vendors/claude/ClaudeSession.js";

describe("Claude working directory", () => {
    it("does not pass an agent working directory to Claude Code", async () => {
        const credential = await ClaudeAuthTokenCredential.tryLoad({ authToken: "test-token" });
        if (credential === null) throw new Error("Expected test credential.");
        let sdkOptions: Record<string, unknown> | undefined;
        const provider = new ClaudeProvider({
            credential,
            env: { PATH: process.env.PATH },
            model: "sonnet[1m]",
            query: ((parameters: { options?: Record<string, unknown> }) => {
                sdkOptions = parameters.options;
                async function* messages() {
                    yield {
                        type: "result",
                        subtype: "success",
                        result: "OK",
                        session_id: "working-directory-session",
                        uuid: "working-directory-result",
                    };
                }
                return Object.assign(messages(), { close: () => {} });
            }) as unknown as ClaudeSdkQuery,
        });
        const session = await provider.session("working-directory-session", {
            instructions: "",
            tools: [],
        });

        try {
            for await (const _event of session.run(testContext, {
                context: {
                    instructions: "",
                    messages: [
                        {
                            role: "user",
                            content: [{ type: "text" as const, text: "Hello." }],
                        },
                    ],
                },
            })) {
                // Drain the stream so the query options are observable.
            }
        } finally {
            session.destroy();
        }

        expect(sdkOptions).not.toHaveProperty("cwd");
    });
});
