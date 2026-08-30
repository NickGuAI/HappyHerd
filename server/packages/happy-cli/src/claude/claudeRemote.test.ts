import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeRemote } from './claudeRemote';
import { query } from '@/claude/sdk';
import type { EnhancedMode } from './loop';

vi.mock('@/claude/sdk', () => ({
    query: vi.fn(),
    AbortError: class AbortError extends Error {},
}));

const mode: EnhancedMode = {
    permissionMode: 'default',
};

describe('claudeRemote', () => {
    beforeEach(() => {
        vi.mocked(query).mockReset();
    });

    it('marks /clear as a completed reset turn', async () => {
        const callbackOrder: string[] = [];
        const onCompletionEvent = vi.fn((message: string) => {
            callbackOrder.push(`event:${message}`);
        });
        const onSessionReset = vi.fn(() => {
            callbackOrder.push('reset');
        });
        const onReady = vi.fn(() => {
            callbackOrder.push('ready');
        });

        await claudeRemote({
            sessionId: null,
            path: process.cwd(),
            allowedTools: [],
            hookSettingsPath: '/tmp/happy-test-settings.json',
            nextMessage: async () => ({
                message: '/clear',
                mode,
            }),
            onReady,
            canCallTool: async () => ({ behavior: 'allow' }) as any,
            isAborted: () => false,
            onSessionFound: vi.fn(),
            onThinkingChange: vi.fn(),
            onMessage: vi.fn(),
            onCompletionEvent,
            onSessionReset,
        });

        expect(onCompletionEvent).toHaveBeenCalledWith('Context was reset');
        expect(onSessionReset).toHaveBeenCalledOnce();
        expect(onReady).toHaveBeenCalledOnce();
        expect(callbackOrder).toEqual(['event:Context was reset', 'reset', 'ready']);
    });

    it('marks assistant messages from /compact as compact summaries', async () => {
        const setPermissionMode = vi.fn();
        vi.mocked(query).mockReturnValue({
            setPermissionMode,
            async *[Symbol.asyncIterator]() {
                yield {
                    type: 'assistant',
                    message: {
                        role: 'assistant',
                        content: [{ type: 'text', text: 'Long compaction summary' }],
                    },
                };
                yield {
                    type: 'result',
                    subtype: 'success',
                };
            },
        } as any);

        const onMessage = vi.fn();
        let messageCount = 0;

        await claudeRemote({
            sessionId: null,
            path: process.cwd(),
            allowedTools: [],
            hookSettingsPath: '/tmp/happy-test-settings.json',
            nextMessage: async () => {
                messageCount += 1;
                return messageCount === 1
                    ? {
                        message: '/compact',
                        mode,
                    }
                    : null;
            },
            onReady: vi.fn(),
            canCallTool: async () => ({ behavior: 'allow' }) as any,
            isAborted: () => false,
            onSessionFound: vi.fn(),
            onThinkingChange: vi.fn(),
            onMessage,
            onCompletionEvent: vi.fn(),
            onSessionReset: vi.fn(),
        });

        expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'assistant',
            isCompactSummary: true,
        }));
    });

    it('delivers Commander context through the SDK system layer and disables project settings', async () => {
        vi.mocked(query).mockReturnValue({
            setPermissionMode: vi.fn(),
            async *[Symbol.asyncIterator]() {
                yield { type: 'result', subtype: 'success' };
            },
        } as any);
        let messageCount = 0;

        await claudeRemote({
            sessionId: null,
            path: process.cwd(),
            allowedTools: [],
            hookSettingsPath: '/tmp/happy-test-settings.json',
            nextMessage: async () => {
                messageCount += 1;
                return messageCount === 1
                    ? {
                        message: 'verify the instruction layer',
                        mode: {
                            permissionMode: 'default',
                            appendSystemPrompt: 'global + commander + project',
                        },
                    }
                    : null;
            },
            onReady: vi.fn(),
            canCallTool: async () => ({ behavior: 'allow' }) as any,
            isAborted: () => false,
            onSessionFound: vi.fn(),
            onThinkingChange: vi.fn(),
            onMessage: vi.fn(),
            onCompletionEvent: vi.fn(),
            onSessionReset: vi.fn(),
        });

        expect(query).toHaveBeenCalledWith(expect.objectContaining({
            options: expect.objectContaining({
                appendSystemPrompt: expect.stringContaining('global + commander + project'),
                settingSources: ['user', 'local'],
            }),
        }));
    });

    it.each([
        'auto',
        'default',
        'acceptEdits',
        'dontAsk',
        'bypassPermissions',
        'plan',
    ] as const)('passes advertised %s mode with live bypass eligibility to the SDK', async (permissionMode) => {
        vi.mocked(query).mockReturnValue({
            setPermissionMode: vi.fn(),
            async *[Symbol.asyncIterator]() {
                yield { type: 'result', subtype: 'success' };
            },
        } as any);
        let messageCount = 0;

        await claudeRemote({
            sessionId: null,
            path: process.cwd(),
            allowedTools: [],
            hookSettingsPath: '/tmp/happy-test-settings.json',
            nextMessage: async () => {
                messageCount += 1;
                return messageCount === 1
                    ? { message: 'verify permissions', mode: { permissionMode } }
                    : null;
            },
            onReady: vi.fn(),
            canCallTool: async () => ({ behavior: 'allow' }) as any,
            isAborted: () => false,
            onSessionFound: vi.fn(),
            onThinkingChange: vi.fn(),
            onMessage: vi.fn(),
        });

        expect(query).toHaveBeenCalledWith(expect.objectContaining({
            options: expect.objectContaining({
                permissionMode,
                allowDangerouslySkipPermissions: true,
            }),
        }));
    });

    it('keeps the bypass opt-in when resuming an existing provider session', async () => {
        vi.mocked(query).mockReturnValue({
            setPermissionMode: vi.fn(),
            async *[Symbol.asyncIterator]() {
                yield { type: 'result', subtype: 'success' };
            },
        } as any);
        let messageCount = 0;

        await claudeRemote({
            sessionId: null,
            path: process.cwd(),
            claudeArgs: ['--resume', '11111111-2222-3333-4444-555555555555'],
            allowedTools: [],
            hookSettingsPath: '/tmp/happy-test-settings.json',
            nextMessage: async () => {
                messageCount += 1;
                return messageCount === 1
                    ? { message: 'resume safely', mode: { permissionMode: 'bypassPermissions' } }
                    : null;
            },
            onReady: vi.fn(),
            canCallTool: async () => ({ behavior: 'allow' }) as any,
            isAborted: () => false,
            onSessionFound: vi.fn(),
            onThinkingChange: vi.fn(),
            onMessage: vi.fn(),
        });

        expect(query).toHaveBeenCalledWith(expect.objectContaining({
            options: expect.objectContaining({
                resume: '11111111-2222-3333-4444-555555555555',
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
            }),
        }));
    });

    it('propagates a queued-mode update failure instead of ending the query as success', async () => {
        vi.mocked(query).mockReturnValue({
            setPermissionMode: vi.fn(),
            async *[Symbol.asyncIterator]() {
                yield { type: 'result', subtype: 'success' };
                await Promise.resolve();
            },
        } as any);
        let messageCount = 0;

        await expect(claudeRemote({
            sessionId: null,
            path: process.cwd(),
            allowedTools: [],
            hookSettingsPath: '/tmp/happy-test-settings.json',
            nextMessage: async () => {
                messageCount += 1;
                if (messageCount === 1) {
                    return { message: 'first turn', mode: { permissionMode: 'default' } };
                }
                throw new Error('native mode rejected');
            },
            onReady: vi.fn(),
            canCallTool: async () => ({ behavior: 'allow' }) as any,
            isAborted: () => false,
            onSessionFound: vi.fn(),
            onMessage: vi.fn(),
        })).rejects.toThrow('native mode rejected');
    });

    it('reports a rejected rate-limit event without waiting for a result message', async () => {
        vi.mocked(query).mockReturnValue({
            setPermissionMode: vi.fn(),
            async *[Symbol.asyncIterator]() {
                yield {
                    type: 'rate_limit_event',
                    rate_limit_info: {
                        status: 'rejected',
                        rateLimitType: 'five_hour',
                        utilization: 1,
                        resetsAt: 1_800_000_000,
                    },
                };
            },
        } as any);
        const onUsageLimits = vi.fn();
        let messageCount = 0;

        await claudeRemote({
            sessionId: null,
            path: process.cwd(),
            allowedTools: [],
            hookSettingsPath: '/tmp/happy-test-settings.json',
            nextMessage: async () => {
                messageCount += 1;
                return messageCount === 1
                    ? { message: 'continue', mode }
                    : null;
            },
            onReady: vi.fn(),
            canCallTool: async () => ({ behavior: 'allow' }) as any,
            isAborted: () => false,
            onSessionFound: vi.fn(),
            onThinkingChange: vi.fn(),
            onMessage: vi.fn(),
            onCompletionEvent: vi.fn(),
            onSessionReset: vi.fn(),
            onUsageLimits,
        });

        expect(onUsageLimits).toHaveBeenCalledOnce();
        expect(onUsageLimits).toHaveBeenCalledWith(expect.objectContaining({
            windows: [expect.objectContaining({
                id: 'five_hour',
                status: 'rejected',
            })],
        }));
    });
});
