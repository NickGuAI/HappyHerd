import { testContext } from "./testContext.js";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ClaudeCodeCredential } from "@/vendors/claude/ClaudeCodeCredential.js";
import { ClaudeOAuthCredential } from "@/vendors/claude/ClaudeOAuthCredential.js";
import { ClaudeSession, type ClaudeSdkQuery } from "@/vendors/claude/ClaudeSession.js";
import type { ClaudeCredential } from "@/vendors/VendorCredential.js";

const roots = new Set<string>();

afterEach(async () => {
    await Promise.all([...roots].map((root) => rm(root, { force: true, recursive: true })));
    roots.clear();
});

describe("Claude credentials", () => {
    it("represents native Claude Code authentication without retaining its token", async () => {
        const configDir = await createClaudeConfig("native-secret-token");

        const credential = await ClaudeCodeCredential.tryLoad({ configDir, env: {} });

        expect(credential?.name).toBe("claude-code");
        expect(credential?.credential).toBeUndefined();
        expect(JSON.stringify(credential)).not.toContain("native-secret-token");
    });

    it("keeps an explicitly supplied OAuth token as an external credential", async () => {
        const credential = await ClaudeOAuthCredential.tryLoad({
            env: { CLAUDE_CODE_OAUTH_TOKEN: "external-oauth-token" },
        });

        expect(credential?.name).toBe("claude-oauth");
        expect(credential?.credential.accessToken).toBe("external-oauth-token");
    });

    it("lets the Claude Code subprocess own native credential refresh", async () => {
        const configDir = await createClaudeConfig("refreshable-native-token");
        const credential = await ClaudeCodeCredential.tryLoad({ configDir, env: {} });
        if (credential === null) expect.fail("Expected native Claude Code authentication.");

        const childEnvironment = await captureChildEnvironment(credential, {
            CLAUDE_CODE_OAUTH_TOKEN: "stale-parent-token",
            CLAUDE_CONFIG_DIR: configDir,
            PATH: process.env.PATH,
        });

        expect(childEnvironment.CLAUDE_CONFIG_DIR).toBe(configDir);
        expect(childEnvironment).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
    });

    it("passes an explicit OAuth credential to the Claude Code subprocess", async () => {
        const credential = await ClaudeOAuthCredential.tryLoad({
            oauthToken: "external-oauth-token",
        });
        if (credential === null) expect.fail("Expected explicit Claude OAuth authentication.");

        const childEnvironment = await captureChildEnvironment(credential, {
            CLAUDE_CODE_OAUTH_TOKEN: "wrong-parent-token",
            PATH: process.env.PATH,
        });

        expect(childEnvironment.CLAUDE_CODE_OAUTH_TOKEN).toBe("external-oauth-token");
    });
});

async function captureChildEnvironment(
    credential: ClaudeCredential,
    env: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
    let childEnvironment: NodeJS.ProcessEnv | undefined;
    const query = ((parameters) => {
        childEnvironment = parameters.options?.env;
        async function* messages() {
            yield successfulResult();
        }
        return Object.assign(messages(), { close: () => {} });
    }) as ClaudeSdkQuery;
    const session = new ClaudeSession("native-credential-session", {
        instructions: "",
        credential,
        env,
        model: "sonnet[1m]",
        query,
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
            // Drain the successful result.
        }
        if (childEnvironment === undefined) {
            throw new Error("Claude SDK query did not capture its child environment.");
        }
        return childEnvironment;
    } finally {
        session.destroy();
    }
}

async function createClaudeConfig(accessToken: string): Promise<string> {
    const configDir = await mkdtemp(join(tmpdir(), "rig-claude-code-credential-"));
    roots.add(configDir);
    await writeFile(
        join(configDir, ".credentials.json"),
        JSON.stringify({ claudeAiOauth: { accessToken, refreshToken: "native-refresh-token" } }),
        "utf8",
    );
    return configDir;
}

function successfulResult() {
    return {
        type: "result",
        subtype: "success",
        duration_ms: 1,
        duration_api_ms: 1,
        is_error: false,
        num_turns: 1,
        result: "OK",
        stop_reason: "end_turn",
        total_cost_usd: 0,
        usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: "result-id",
        session_id: "native-credential-session",
    } as const;
}
