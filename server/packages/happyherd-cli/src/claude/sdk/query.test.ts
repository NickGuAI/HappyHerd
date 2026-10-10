import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sdkQuery, resolveExecutable } = vi.hoisted(() => ({
    sdkQuery: vi.fn(() => ({
        async *[Symbol.asyncIterator]() {
            // The adapter contract is proven from the options passed to the
            // official SDK; no provider process is needed for this unit test.
        },
    })),
    resolveExecutable: vi.fn(() => '/installed/claude'),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    query: sdkQuery,
}));
vi.mock('./claudeExecutable', () => ({ resolveClaudeCodeExecutable: resolveExecutable }));

import { query } from './query';

describe('Claude SDK query adapter', () => {
    beforeEach(() => {
        sdkQuery.mockClear();
    });

    it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)(
        'passes optional Fable 5.1 and %s effort unchanged to the supported SDK',
        (effort) => {
            query({ prompt: 'Describe this code', options: { model: 'claude-fable-5-1', effort } });
            expect(sdkQuery).toHaveBeenCalledWith(expect.objectContaining({
                options: expect.objectContaining({ model: 'claude-fable-5-1', effort }),
            }));
        },
    );

    it('adds the SDK-required opt-in whenever the adapter starts in bypass mode', () => {
        query({
            prompt: 'run the task',
            options: {
                permissionMode: 'bypassPermissions',
            },
        });

        expect(sdkQuery).toHaveBeenCalledWith(expect.objectContaining({
            options: expect.objectContaining({
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
            }),
        }));
    });

    it('forwards an explicit opt-in for a later live switch into bypass mode', () => {
        query({
            prompt: 'run the task',
            options: {
                permissionMode: 'default',
                allowDangerouslySkipPermissions: true,
            },
        });

        expect(sdkQuery).toHaveBeenCalledWith(expect.objectContaining({
            options: expect.objectContaining({
                permissionMode: 'default',
                allowDangerouslySkipPermissions: true,
            }),
        }));
    });

    it('uses the resolved local executable and treats a supplied environment as complete', () => {
        const secretKey = 'HAPPYHERD_TEST_PARENT_ONLY_SECRET';
        const previous = process.env[secretKey];
        process.env[secretKey] = 'parent-only';
        try {
            query({
                prompt: 'run the task',
                options: {
                    env: { PATH: '/safe/bin', HAPPYHERD_PROVIDER_ACCOUNT: 'work' },
                },
            });

            expect(sdkQuery).toHaveBeenCalledWith(expect.objectContaining({
                options: expect.objectContaining({
                    pathToClaudeCodeExecutable: '/installed/claude',
                    env: expect.objectContaining({ HAPPYHERD_PROVIDER_ACCOUNT: 'work' }),
                }),
            }));
            const lastCall = sdkQuery.mock.calls.at(-1) as unknown as [{ options: { env?: Record<string, string> } }] | undefined;
            const childEnvironment = lastCall?.[0]?.options.env;
            expect(childEnvironment).not.toHaveProperty(secretKey);
            expect(childEnvironment).toMatchObject({ PATH: '/safe/bin' });
        } finally {
            if (previous === undefined) delete process.env[secretKey];
            else process.env[secretKey] = previous;
        }
    });
});
