import type { SDKMessage } from '@/claude/sdk';

const RETRY_GUIDANCE = 'This is separate from HappyHerd account login. After fixing it, review the conversation and resend your prompt if needed; HappyHerd has not retried it.';
const LOGIN_GUIDANCE = 'Run claude auth login on the host machine running this session, with the same OS user and Claude configuration.';

export const CLAUDE_LOGIN_EXPIRED_MESSAGE = `Claude Code login expired on the host. ${LOGIN_GUIDANCE} ${RETRY_GUIDANCE}`;
const PROVIDER_AUTH_MESSAGE = `Claude provider authentication failed on the host. Check this session's provider credentials/configuration. If you use Claude Code login: ${LOGIN_GUIDANCE} ${RETRY_GUIDANCE}`;

function authMessage(expired: boolean, managedAccount?: string): string {
    if (!managedAccount) return expired ? CLAUDE_LOGIN_EXPIRED_MESSAGE : PROVIDER_AUTH_MESSAGE;
    const diagnosis = expired ? 'Claude Code login expired on the host.' : 'Claude provider authentication failed on the host.';
    return `${diagnosis} In HappyHerd Settings, open Credentials & Accounts, select this session's machine and Claude account, then choose Log In Again. ${RETRY_GUIDANCE}`;
}

function isOAuthExpired(text: string): boolean {
    // Narrow fallback for SDK result/exception surfaces without an auth code.
    // Do not classify arbitrary 401s, MCP failures, or quoted conversation text.
    return /^Failed to authenticate: OAuth session expired and could not be refreshed(?:[.!]?(?:\s|$))/i.test(text.trim());
}

/** Called only for exceptions from the Claude remote launcher, not HappyHerd auth. */
export function claudeProviderAuthErrorMessage(error: unknown, managedAccount?: string): string | null {
    return error instanceof Error && isOAuthExpired(error.message) ? authMessage(true, managedAccount) : null;
}

/** Only SDK error surfaces count; normal assistant/user/tool text never does. */
export function claudeProviderAuthMessage(message: SDKMessage, managedAccount?: string): string | null {
    if (message.type === 'assistant' && message.error === 'authentication_failed' && !message.parent_tool_use_id) {
        const expired = message.message.content.some(block => block.type === 'text' && isOAuthExpired(block.text));
        return authMessage(expired, managedAccount);
    }
    if (message.type === 'result' && message.is_error) {
        const errors = message.subtype === 'success' ? [message.result] : message.errors;
        return errors.some(isOAuthExpired) ? authMessage(true, managedAccount) : null;
    }
    return null;
}