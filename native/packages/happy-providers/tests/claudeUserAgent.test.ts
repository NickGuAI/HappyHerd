import { testContext } from "./testContext.js";

import { describe, expect, it } from "vitest";

import { ClaudeAuthTokenCredential } from "@/vendors/claude/ClaudeAuthTokenCredential.js";
import { ClaudeProvider } from "@/vendors/claude/ClaudeProvider.js";
import type { ClaudeSdkQuery } from "@/vendors/claude/ClaudeSession.js";

describe("Claude user agent", () => {
    it("keeps the native user agent when the caller does not identify itself", async () => {
        const { env } = await runOnce({});

        expect(env?.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined();
    });

    it("identifies the caller through the header Claude Code applies last", async () => {
        const { env } = await runOnce({ userAgent: "rig/1.2.3" });

        expect(env?.ANTHROPIC_CUSTOM_HEADERS).toBe("User-Agent: rig/1.2.3");
    });

    it("adds the user agent to the custom headers the caller already set", async () => {
        const { env } = await runOnce({
            env: { ANTHROPIC_CUSTOM_HEADERS: "X-Trace: on" },
            userAgent: "rig/1.2.3",
        });

        expect(env?.ANTHROPIC_CUSTOM_HEADERS).toBe("X-Trace: on\nUser-Agent: rig/1.2.3");
    });
});

async function runOnce(options: {
    env?: NodeJS.ProcessEnv;
    userAgent?: string;
}): Promise<{ env: NodeJS.ProcessEnv | undefined }> {
    const credential = await ClaudeAuthTokenCredential.tryLoad({ authToken: "test-token" });
    if (credential === null) throw new Error("Expected test credential.");
    let env: NodeJS.ProcessEnv | undefined;
    const provider = new ClaudeProvider({
        credential,
        env: { PATH: process.env.PATH, ...options.env },
        model: "sonnet[1m]",
        query: ((parameters: { options?: { env?: NodeJS.ProcessEnv } }) => {
            env = parameters.options?.env;
            async function* messages() {
                yield {
                    type: "result",
                    subtype: "success",
                    result: "OK",
                    session_id: "user-agent-session",
                    uuid: "user-agent-result",
                };
            }
            const generator = messages();
            return Object.assign(generator, { close: () => {} });
        }) as unknown as ClaudeSdkQuery,
        ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
    });
    const session = await provider.session("user-agent-session", {
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
            // Draining the stream is what performs the SDK query under test.
        }
    } finally {
        session.destroy();
    }
    return { env };
}
