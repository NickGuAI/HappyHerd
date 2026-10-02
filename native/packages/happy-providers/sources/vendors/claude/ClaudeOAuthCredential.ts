import { BaseCredential } from "@/core/BaseCredential.js";

export type ClaudeOAuthCredentialValue = {
    readonly accessToken: string;
};

export interface ClaudeOAuthCredentialLoadOptions {
    env?: NodeJS.ProcessEnv;
    oauthToken?: string;
}

export class ClaudeOAuthCredential extends BaseCredential<
    "claude-oauth",
    ClaudeOAuthCredentialValue
> {
    static async tryLoad(
        options: ClaudeOAuthCredentialLoadOptions = {},
    ): Promise<ClaudeOAuthCredential | null> {
        const accessToken =
            options.oauthToken?.trim() ??
            (options.env ?? process.env).CLAUDE_CODE_OAUTH_TOKEN?.trim();
        return accessToken ? new ClaudeOAuthCredential({ accessToken }) : null;
    }

    private constructor(credential: ClaudeOAuthCredentialValue) {
        super("claude-oauth", credential);
    }
}
