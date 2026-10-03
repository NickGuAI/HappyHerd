import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
    AnthropicBedrockSession,
    AnthropicProvider,
    BedrockBearerTokenCredential,
    ClaudeApiKeyCredential,
    ClaudeAuthTokenCredential,
    ClaudeCodeCredential,
    ClaudeOAuthCredential,
    ClaudeSession,
    type AnthropicCredential,
} from "@/index.js";

const sessions: Array<AnthropicBedrockSession | ClaudeSession> = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
    for (const session of sessions.splice(0)) session.destroy();
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
});

describe("AnthropicProvider", () => {
    it("uses the Claude session implementation for Anthropic credentials", async () => {
        const credentials = await Promise.all([
            ClaudeApiKeyCredential.tryLoad({ apiKey: "api-key" }),
            ClaudeAuthTokenCredential.tryLoad({ authToken: "auth-token" }),
            ClaudeOAuthCredential.tryLoad({ oauthToken: "oauth-token" }),
            loadClaudeCodeCredential(),
        ]);

        for (const credential of credentials) {
            if (credential === null) throw new Error("Expected an Anthropic test credential.");
            const provider = new AnthropicProvider({ credential });
            const session = await provider.session(`claude-${credential.name}`, {
                instructions: "",
                tools: [],
            });
            sessions.push(session);

            expect(provider.name).toBe("claude");
            expect(provider.credential).toBe(credential);
            expect(session).toBeInstanceOf(ClaudeSession);
        }
    });

    it("uses the Bedrock session implementation for a Bedrock credential", async () => {
        const credential = await BedrockBearerTokenCredential.tryLoad({
            bearerToken: "bedrock-token",
        });
        if (credential === null) throw new Error("Expected a Bedrock test credential.");
        const provider = new AnthropicProvider({
            credential,
            model: "anthropic.claude-sonnet-4-5-20250929-v1:0",
            region: "us-east-1",
        });
        const session = await provider.session("bedrock", { instructions: "", tools: [] });
        sessions.push(session);

        expect(provider.name).toBe("claude");
        expect(provider.credential).toBe(credential);
        expect(session).toBeInstanceOf(AnthropicBedrockSession);
    });
});

async function loadClaudeCodeCredential(): Promise<AnthropicCredential | null> {
    const configDir = await mkdtemp(join(tmpdir(), "happy-providers-claude-code-"));
    temporaryDirectories.push(configDir);
    await writeFile(
        join(configDir, ".credentials.json"),
        JSON.stringify({ claudeAiOauth: { accessToken: "claude-code-token" } }),
    );
    return ClaudeCodeCredential.tryLoad({ configDir, env: {} });
}
