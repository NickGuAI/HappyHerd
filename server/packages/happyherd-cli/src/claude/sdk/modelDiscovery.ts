import type { ModelInfo, Query } from '@anthropic-ai/claude-agent-sdk';
import { query } from './query';
import { resolveClaudeCodeExecutable } from './claudeExecutable';

export const CLAUDE_MODEL_DISCOVERY_TIMEOUT_MS = 15_000;

async function* waitForNoPrompt(signal: AbortSignal): AsyncGenerator<never, void, unknown> {
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
    });
}

export async function discoverClaudeModels(
    processEnvironment?: NodeJS.ProcessEnv,
    timeoutMs = CLAUDE_MODEL_DISCOVERY_TIMEOUT_MS,
): Promise<ModelInfo[]> {
    const executable = resolveClaudeCodeExecutable();
    if (!executable) throw new Error('Claude Code executable could not be resolved');

    const controller = new AbortController();
    const session: Query = query({
        prompt: waitForNoPrompt(controller.signal),
        options: {
            cwd: process.cwd(),
            abort: controller.signal,
            env: processEnvironment ? Object.fromEntries(
                Object.entries(processEnvironment).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
            ) : undefined,
            pathToClaudeCodeExecutable: executable,
            persistSession: false,
            tools: [],
            mcpServers: {},
            strictMcpConfig: true,
            settingSources: [],
        },
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            (async () => {
                await session.initializationResult();
                return session.supportedModels();
            })(),
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error('Claude model discovery timed out')), timeoutMs);
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
        controller.abort();
        session.close();
    }
}
