import { BaseCredential } from "@/core/BaseCredential.js";
import { readClaudeCodeOAuthToken } from "@/vendors/claude/impl/auth.js";

export interface ClaudeCodeCredentialLoadOptions {
    configDir?: string;
    env?: NodeJS.ProcessEnv;
}

export class ClaudeCodeCredential extends BaseCredential<"claude-code", undefined> {
    static async tryLoad(
        options: ClaudeCodeCredentialLoadOptions = {},
    ): Promise<ClaudeCodeCredential | null> {
        const env: NodeJS.ProcessEnv = {
            ...(options.env ?? process.env),
            ...(options.configDir === undefined ? {} : { CLAUDE_CONFIG_DIR: options.configDir }),
        };
        delete env.CLAUDE_CODE_OAUTH_TOKEN;
        if ((await readClaudeCodeOAuthToken({ env })) === undefined) return null;
        return new ClaudeCodeCredential();
    }

    private constructor() {
        super("claude-code", undefined);
    }
}
