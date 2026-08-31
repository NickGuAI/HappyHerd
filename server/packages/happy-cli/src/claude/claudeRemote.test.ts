import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeRemote } from './claudeRemote';
import { query } from '@/claude/sdk';
import { notifyDaemonProviderLimited } from '@/daemon/controlClient';
import {
    reportProviderHardLimitOnce,
    resetProviderLimitNoticeForTests,
} from '@/credentialPool/providerLimitNotice';
import type { EnhancedMode } from './loop';

vi.mock('@/claude/sdk', () => ({
    query: vi.fn(),
    AbortError: class AbortError extends Error {},
}));

vi.mock('@/daemon/controlClient', () => ({
    notifyDaemonProviderLimited: vi.fn(),
}));

const mode: EnhancedMode = {
    permissionMode: 'default',
};

describe('claudeRemote', () => {
    beforeEach(() => {
        vi.mocked(query).mockReset();
        vi.mocked(notifyDaemonProviderLimited).mockReset();
        resetProviderLimitNoticeForTests();
        delete process.env.HAPPYHERD_PROVIDER_ACCOUNT;
        delete process.env.HAPPYHERD_PROVIDER_ACCOUNT_TYPE;
    });

    afterEach(() => {
        delete process.env.HAPPYHERD_PROVIDER_ACCOUNT;
        delete process.env.HAPPYHERD_PROVIDER_ACCOUNT_TYPE;
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
        process.env.HAPPYHERD_PROVIDER_ACCOUNT = 'personal';
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
            providerAccount: 'personal',
            windows: [expect.objectContaining({
                id: 'five_hour',
                status: 'rejected',
            })],
        }));
    });

    it('stamps a named provider account onto full usage snapshots', async () => {
        process.env.HAPPYHERD_PROVIDER_ACCOUNT = 'work';
        vi.mocked(query).mockReturnValue({
            setPermissionMode: vi.fn(),
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: vi.fn(async () => ({
                rate_limits_available: true,
                rate_limits: {
                    five_hour: { utilization: 21, resets_at: null },
                },
            })),
            async *[Symbol.asyncIterator]() {
                yield { type: 'result', subtype: 'success' };
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
                return messageCount === 1 ? { message: 'continue', mode } : null;
            },
            onReady: vi.fn(),
            canCallTool: async () => ({ behavior: 'allow' }) as any,
            isAborted: () => false,
            onSessionFound: vi.fn(),
            onMessage: vi.fn(),
            onUsageLimits,
        });

        await vi.waitFor(() => {
            expect(onUsageLimits).toHaveBeenCalledOnce();
        });
        expect(onUsageLimits).toHaveBeenCalledWith(expect.objectContaining({
            providerAccount: 'work',
            replace: true,
            windows: [expect.objectContaining({ id: 'five_hour', utilization: 21 })],
        }));
    });

    it('delivers a rejected full usage snapshot as a provider hard limit', async () => {
        process.env.HAPPYHERD_PROVIDER_ACCOUNT = 'work';
        const resetsAt = '2035-01-01T00:00:00Z';
        vi.mocked(query).mockReturnValue({
            setPermissionMode: vi.fn(),
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: vi.fn(async () => ({
                rate_limits_available: true,
                rate_limits: {
                    five_hour: { utilization: 100, resets_at: resetsAt },
                },
            })),
            async *[Symbol.asyncIterator]() {
                yield { type: 'result', subtype: 'error_during_execution' };
            },
        } as any);
        const onUsageLimits = vi.fn();
        const onProviderHardLimit = vi.fn();
        let messageCount = 0;

        await claudeRemote({
            sessionId: null,
            path: process.cwd(),
            allowedTools: [],
            hookSettingsPath: '/tmp/happy-test-settings.json',
            nextMessage: async () => {
                messageCount += 1;
                return messageCount === 1 ? { message: 'continue', mode } : null;
            },
            onReady: vi.fn(),
            canCallTool: async () => ({ behavior: 'allow' }) as any,
            isAborted: () => false,
            onSessionFound: vi.fn(),
            onMessage: vi.fn(),
            onUsageLimits,
            onProviderHardLimit,
        });

        await vi.waitFor(() => {
            expect(onProviderHardLimit).toHaveBeenCalledOnce();
        });
        expect(onUsageLimits).toHaveBeenCalledWith(expect.objectContaining({
            replace: true,
            windows: [expect.objectContaining({
                id: 'five_hour',
                status: 'rejected',
            })],
        }));
        expect(onProviderHardLimit).toHaveBeenCalledWith({
            provider: 'claude',
            limitedUntil: Date.parse(resetsAt),
        });
    });

    it('waits through delayed result handling so a trailing typed reset wins', async () => {
        vi.mocked(query).mockReturnValue({
            setPermissionMode: vi.fn(),
            async *[Symbol.asyncIterator]() {
                yield {
                    type: 'assistant',
                    error: 'rate_limit',
                    message: {
                        role: 'assistant',
                        content: [{ type: 'text', text: "You've reached your Fable 5 limit." }],
                    },
                };
                yield { type: 'result', subtype: 'error_during_execution' };
                yield {
                    type: 'rate_limit_event',
                    rate_limit_info: {
                        status: 'rejected',
                        rateLimitType: 'seven_day_overage_included',
                        resetsAt: 2_000_000_000,
                    },
                };
            },
        } as any);
        const onProviderHardLimit = vi.fn();
        let messageCount = 0;

        await claudeRemote({
            sessionId: null,
            path: process.cwd(),
            allowedTools: [],
            hookSettingsPath: '/tmp/happy-test-settings.json',
            nextMessage: async () => {
                messageCount += 1;
                return messageCount === 1 ? { message: 'continue', mode } : null;
            },
            onReady: vi.fn(async () => {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }),
            canCallTool: async () => ({ behavior: 'allow' }) as any,
            isAborted: () => false,
            onSessionFound: vi.fn(),
            onMessage: vi.fn(),
            onProviderHardLimit,
        });

        expect(onProviderHardLimit).toHaveBeenCalledOnce();
        expect(onProviderHardLimit).toHaveBeenCalledWith({
            provider: 'claude',
            limitedUntil: 2_000_000_000_000,
        });
    });

    it('uses the synthetic API-error fallback when no typed limit event arrives', async () => {
        vi.mocked(query).mockReturnValue({
            setPermissionMode: vi.fn(),
            async *[Symbol.asyncIterator]() {
                yield {
                    type: 'assistant',
                    error: 'rate_limit',
                    message: {
                        role: 'assistant',
                        content: [{ type: 'text', text: 'Fable 5 requires usage credits to continue.' }],
                    },
                };
                yield { type: 'result', subtype: 'error_during_execution' };
            },
        } as any);
        const onProviderHardLimit = vi.fn();
        let messageCount = 0;
        const startedAt = Date.now();

        await claudeRemote({
            sessionId: null,
            path: process.cwd(),
            allowedTools: [],
            hookSettingsPath: '/tmp/happy-test-settings.json',
            nextMessage: async () => {
                messageCount += 1;
                return messageCount === 1 ? { message: 'continue', mode } : null;
            },
            onReady: vi.fn(),
            canCallTool: async () => ({ behavior: 'allow' }) as any,
            isAborted: () => false,
            onSessionFound: vi.fn(),
            onMessage: vi.fn(),
            onProviderHardLimit,
        });

        expect(onProviderHardLimit).toHaveBeenCalledOnce();
        expect(onProviderHardLimit).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'claude',
            limitedUntil: expect.any(Number),
        }));
        expect(onProviderHardLimit.mock.calls[0][0].limitedUntil).toBeGreaterThan(startedAt);
    });

    it('allows a later hard-limit signal to retry an unacknowledged daemon notice', async () => {
        process.env.HAPPYHERD_PROVIDER_ACCOUNT = 'work-primary';
        process.env.HAPPYHERD_PROVIDER_ACCOUNT_TYPE = 'claude';
        vi.mocked(notifyDaemonProviderLimited)
            .mockRejectedValueOnce(new Error('daemon transport failed'))
            .mockResolvedValueOnce({ status: 'scheduled' });
        vi.mocked(query).mockReturnValue({
            setPermissionMode: vi.fn(),
            async *[Symbol.asyncIterator]() {
                yield {
                    type: 'rate_limit_event',
                    rate_limit_info: {
                        status: 'rejected',
                        rateLimitType: 'five_hour',
                        resetsAt: 2_000_000_000,
                    },
                };
                yield {
                    type: 'rate_limit_event',
                    rate_limit_info: {
                        status: 'rejected',
                        rateLimitType: 'seven_day',
                        resetsAt: 2_100_000_000,
                    },
                };
            },
        } as any);
        const onProviderHardLimit = vi.fn((hardLimit) => reportProviderHardLimitOnce({
            sessionId: 'happy-session-provider-limit-retry',
            ...hardLimit,
        }));
        let messageCount = 0;

        await claudeRemote({
            sessionId: null,
            path: process.cwd(),
            allowedTools: [],
            hookSettingsPath: '/tmp/happy-test-settings.json',
            nextMessage: async () => {
                messageCount += 1;
                return messageCount === 1 ? { message: 'continue', mode } : null;
            },
            onReady: vi.fn(),
            canCallTool: async () => ({ behavior: 'allow' }) as any,
            isAborted: () => false,
            onSessionFound: vi.fn(),
            onMessage: vi.fn(),
            onProviderHardLimit,
        });

        expect(onProviderHardLimit).toHaveBeenCalledTimes(2);
        expect(notifyDaemonProviderLimited).toHaveBeenCalledTimes(2);
        expect(onProviderHardLimit.mock.calls.map(([limit]) => limit.limitedUntil)).toEqual([
            2_000_000_000_000,
            2_100_000_000_000,
        ]);
    });
});
