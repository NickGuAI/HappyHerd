import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    let unattended = false;
    return {
        claudeRemote: vi.fn(),
        setUnattended(value: boolean) {
            unattended = value;
        },
        permissionToolCall: vi.fn(async () => {
            if (unattended) throw new Error('Unattended Claude automation requested interactive permission for AskUserQuestion');
            return { behavior: 'allow' };
        }),
    };
});

vi.mock('./claudeRemote', () => ({ claudeRemote: mocks.claudeRemote }));
vi.mock('ink', () => ({ render: vi.fn() }));
vi.mock('@/ui/ink/messageBuffer', () => ({
    MessageBuffer: class {
        addMessage = vi.fn();
        clear = vi.fn();
    },
}));
vi.mock('@/ui/ink/RemoteModeDisplay', () => ({ RemoteModeDisplay: () => null }));
vi.mock('@/ui/messageFormatterInk', () => ({ formatClaudeMessageForInk: vi.fn() }));
vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), debugLargeJson: vi.fn() },
}));
vi.mock('./utils/permissionHandler', () => ({
    PermissionHandler: class {
        constructor(_session: unknown, options?: { unattended?: boolean }) {
            mocks.setUnattended(Boolean(options?.unattended));
        }
        reset = vi.fn();
        setOnPermissionRequest = vi.fn();
        getResponseLookup = vi.fn(() => new Map());
        handleToolCall = mocks.permissionToolCall;
        isAborted = vi.fn(() => false);
        handleModeChange = vi.fn();
        setPermissionModeUpdater = vi.fn();
        clearPermissionModeUpdater = vi.fn();
        getResponseForToolUseId = vi.fn();
    },
}));
vi.mock('./utils/SDKToLogConverter', () => ({
    SDKToLogConverter: class {
        convert = vi.fn(() => null);
        resetParentChain = vi.fn();
        updateSessionId = vi.fn();
        convertSidechainUserMessage = vi.fn(() => null);
        generateInterruptedToolResult = vi.fn(() => null);
    },
}));
vi.mock('./utils/OutgoingMessageQueue', () => ({
    OutgoingMessageQueue: class {
        enqueue = vi.fn();
        releaseToolCall = vi.fn();
        flush = vi.fn(async () => undefined);
        destroy = vi.fn();
    },
}));
vi.mock('./utils/questionNotification', () => ({ getAskUserQuestionToolCallIds: vi.fn(() => []) }));
vi.mock('@/utils/terminalStdinCleanup', () => ({ cleanupStdinAfterInk: vi.fn(async () => undefined) }));

import { MessageQueue2 } from '@/utils/MessageQueue2';
import type { AgentState } from '@/api/types';
import type { EnhancedMode } from './loop';
import { claudeRemoteLauncher } from './claudeRemoteLauncher';

function usageResult(uuid: string, session_id: string, inputTokens: number, costUSD: number): {
    type: 'result';
    uuid: string;
    session_id: string;
    subtype: 'success';
    is_error: false;
    modelUsage: Record<string, {
        inputTokens: number;
        outputTokens: number;
        cacheCreationInputTokens: number;
        cacheReadInputTokens: number;
        costUSD: number;
    }>;
} {
    return {
        type: 'result',
        uuid,
        session_id,
        subtype: 'success',
        is_error: false,
        modelUsage: {
            'claude-test': {
                inputTokens,
                outputTokens: 0,
                cacheCreationInputTokens: 0,
                cacheReadInputTokens: 0,
                costUSD,
            },
        },
    };
}

async function launchUsageResults(options: {
    results: any[];
    agentState?: AgentState;
    baseline?: { sessionId: string; available: boolean; modelUsage?: Record<string, any> };
    pendingAfterDurable?: boolean;
    afterResult?: (index: number) => void;
    beforeDurable?: (report: unknown, options?: { mutateAgentState?: (state: AgentState) => AgentState; onDurable?: () => void }) => Promise<void>;
}) {
    let agentState = options.agentState ?? {};
    const reports: unknown[] = [];
    const sendProviderUsageReport = vi.fn(async (report: unknown, deliveryOptions?: {
        mutateAgentState?: (state: AgentState) => AgentState;
        onDurable?: () => void;
    }) => {
        const durableOptions = deliveryOptions ? {
            ...deliveryOptions,
            onDurable: () => {
                if (deliveryOptions.mutateAgentState) {
                    agentState = deliveryOptions.mutateAgentState(agentState);
                }
                deliveryOptions.onDurable?.();
            },
        } : undefined;
        if (options.beforeDurable) {
            await options.beforeDurable(report, durableOptions);
        } else {
            durableOptions?.onDurable?.();
        }
        reports.push(report);
        if (options.pendingAfterDurable) await new Promise<void>(() => {});
    });
    const client = {
        sessionId: 'happyherd-session-one',
        getAgentState: () => agentState,
        rpcHandlerManager: { registerHandler: vi.fn() },
        updateAgentState: vi.fn(async (update: (state: AgentState) => AgentState) => {
            agentState = update(agentState);
        }),
        updateMetadata: vi.fn(),
        closeClaudeSessionTurn: vi.fn(),
        sendSessionEvent: vi.fn(),
        sendClaudeSessionMessage: vi.fn(),
        sendProviderUsageReport,
        sendProviderUsageLimitation: vi.fn(),
        getMetadata: vi.fn(() => ({})),
    };
    const queue = new MessageQueue2<EnhancedMode>((mode) => JSON.stringify(mode));
    queue.push('usage test prompt', { permissionMode: 'default' });
    queue.close();
    mocks.claudeRemote.mockImplementation(async (remoteOptions: any) => {
        await remoteOptions.nextMessage();
        if (options.baseline) await remoteOptions.onUsageBaseline(options.baseline);
        for (const [index, result] of options.results.entries()) {
            remoteOptions.onMessage(result);
            options.afterResult?.(index);
        }
        await remoteOptions.onReady();
    });

    await claudeRemoteLauncher({
        sessionId: 'claude-session-one',
        path: '/srv/app',
        logPath: '/tmp/claude.log',
        allowedTools: [],
        mcpServers: {},
        hookSettingsPath: '/tmp/settings.json',
        jsRuntime: 'node',
        queue,
        client,
        api: { push: () => ({ sendSessionNotification: vi.fn() }) },
        onAbort: vi.fn(),
        onSessionFound: vi.fn(),
        onThinkingChange: vi.fn(),
        clearSessionId: vi.fn(),
        consumeOneTimeFlags: vi.fn(),
    } as any);

    return { agentState, reports, sendProviderUsageReport, updateAgentState: client.updateAgentState };
}

describe('claudeRemoteLauncher heartbeat receipt', () => {
    it.each([false, true])('persists a failed terminal receipt for a Claude error result (quota exhaustion: %s)', async (quotaExhausted) => {
        let agentState: AgentState = {};
        const receiptStates: AgentState[] = [];
        const sendProviderUsageReport = vi.fn(async (
            _report: unknown,
            options?: { onDurable?: () => void },
        ) => {
            options?.onDurable?.();
        });
        const client = {
            sessionId: 'session-one',
            rpcHandlerManager: { registerHandler: vi.fn() },
            updateAgentState: vi.fn(async (update: (state: AgentState) => AgentState) => {
                agentState = update(agentState);
                receiptStates.push(agentState);
            }),
            updateMetadata: vi.fn(),
            closeClaudeSessionTurn: vi.fn(),
            sendSessionEvent: vi.fn(),
            sendClaudeSessionMessage: vi.fn(),
            sendProviderUsageReport,
            getMetadata: vi.fn(() => ({})),
        };
        const queue = new MessageQueue2<EnhancedMode>((mode) => JSON.stringify({
            permissionMode: mode.permissionMode,
        }));
        queue.pushIsolated('heartbeat prompt', {
            permissionMode: 'default',
            heartbeat: {
                schemaVersion: 1,
                automationId: '11111111-1111-4111-8111-111111111111',
                occurrenceId: '22222222-2222-4222-8222-222222222222',
            },
        }, undefined, '22222222-2222-4222-8222-222222222222');

        let launch = 0;
        mocks.claudeRemote.mockImplementation(async (options: any) => {
            launch += 1;
            const message = await options.nextMessage();
            if (launch === 1) {
                expect(message).toBeNull();
                return;
            }
            expect(message).toMatchObject({
                message: 'heartbeat prompt',
                queueMessageIds: ['22222222-2222-4222-8222-222222222222'],
            });
            await options.onMessageHandoff({
                mode: message.mode,
                queueMessageIds: message.queueMessageIds,
            });
            options.onMessage({
                type: 'result',
                uuid: 'failed-result-zero-usage',
                subtype: 'error_max_turns',
                is_error: true,
                errors: ['maximum turns reached'],
                modelUsage: {
                    'claude-test': {
                        inputTokens: 0,
                        outputTokens: 0,
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUSD: 0,
                    },
                },
            });
            if (!quotaExhausted) await options.onReady();
            queue.close();
            if (quotaExhausted) return 'quota-exhausted';
            return;
        });
        const onProviderResult = vi.fn();

        await expect(claudeRemoteLauncher({
            sessionId: 'claude-session-one',
            path: '/srv/app',
            logPath: '/tmp/claude.log',
            allowedTools: [],
            mcpServers: {},
            hookSettingsPath: '/tmp/settings.json',
            jsRuntime: 'node',
            queue,
            client,
            api: { push: () => ({ sendSessionNotification: vi.fn() }) },
            onAbort: vi.fn(),
            onSessionFound: vi.fn(),
            onThinkingChange: vi.fn(),
            clearSessionId: vi.fn(),
            consumeOneTimeFlags: vi.fn(),
        } as any, { onProviderResult })).resolves.toBe('exit');

        expect(receiptStates.map((state) => state.heartbeatDelivery?.status)).toEqual(['started', 'failed']);
        expect(agentState.heartbeatDelivery).toMatchObject({
            automationId: '11111111-1111-4111-8111-111111111111',
            occurrenceId: '22222222-2222-4222-8222-222222222222',
            status: 'failed',
            message: 'maximum turns reached',
        });
        expect(onProviderResult).toHaveBeenCalledWith({
            status: 'failed',
            message: 'maximum turns reached',
        });
        expect(client.closeClaudeSessionTurn).toHaveBeenCalledWith(quotaExhausted ? 'failed' : 'completed');
        expect(queue.getQueueState().currentMessageIds).toEqual([]);
        expect(sendProviderUsageReport.mock.calls[0][0]).toMatchObject({
            provider: 'claude',
            tokensAvailable: false,
            costAvailable: false,
            limitations: ['tokens-not-reported-by-provider', 'cost-not-reported-by-provider'],
        });
    });

    it('re-enters the Human mode after an isolated heartbeat query', async () => {
        let agentState: AgentState = {};
        const sendProviderUsageReport = vi.fn(async (
            _report: unknown,
            options?: { onDurable?: () => void },
        ) => {
            options?.onDurable?.();
        });
        const client = {
            sessionId: 'session-one',
            rpcHandlerManager: { registerHandler: vi.fn() },
            updateAgentState: vi.fn(async (update: (state: AgentState) => AgentState) => {
                agentState = update(agentState);
            }),
            updateMetadata: vi.fn(),
            closeClaudeSessionTurn: vi.fn(),
            sendSessionEvent: vi.fn(),
            sendClaudeSessionMessage: vi.fn(),
            sendProviderUsageReport,
            sendProviderUsageLimitation: vi.fn(),
            getMetadata: vi.fn(() => ({})),
        };
        const queue = new MessageQueue2<EnhancedMode>((mode) => JSON.stringify({
            permissionMode: mode.permissionMode,
            appendSystemPrompt: mode.appendSystemPrompt,
        }));
        queue.push('Human enabled', {
            permissionMode: 'default',
            appendSystemPrompt: 'Human safeguard enabled',
        });
        queue.pushIsolated('heartbeat prompt', {
            permissionMode: 'default',
            appendSystemPrompt: 'Automation safeguard suppressed',
            heartbeat: {
                schemaVersion: 1,
                automationId: '11111111-1111-4111-8111-111111111111',
                occurrenceId: '22222222-2222-4222-8222-222222222222',
            },
        }, undefined, '22222222-2222-4222-8222-222222222222');
        queue.push('Human restored', {
            permissionMode: 'default',
            appendSystemPrompt: 'Human safeguard enabled',
        });

        const queryPrompts: Array<string | undefined> = [];
        let launch = 0;
        mocks.claudeRemote.mockImplementation(async (options: any) => {
            launch += 1;
            const initial = await options.nextMessage();
            queryPrompts.push(initial?.mode.appendSystemPrompt);
            if (launch <= 2) {
                const result = {
                    type: 'result',
                    uuid: `result-${launch}`,
                    subtype: 'success',
                    is_error: false,
                    modelUsage: {
                        'claude-test': launch === 1
                            ? { inputTokens: 130, outputTokens: 55, costUSD: 0.014 }
                            : { inputTokens: 140, outputTokens: 60, costUSD: 0.02 },
                    },
                };
                options.onMessage(result);
                if (launch === 1) options.onMessage(result);
            }
            await options.onReady();

            if (launch < 3) {
                // The next different/isolated mode must end this query and be
                // retained as the initial batch for the following query.
                expect(await options.nextMessage()).toBeNull();
            } else {
                queue.close();
            }
        });

        await expect(claudeRemoteLauncher({
            sessionId: 'claude-session-one',
            path: '/srv/app',
            logPath: '/tmp/claude.log',
            allowedTools: [],
            mcpServers: {},
            hookSettingsPath: '/tmp/settings.json',
            jsRuntime: 'node',
            queue,
            client,
            api: { push: () => ({ sendSessionNotification: vi.fn() }) },
            onAbort: vi.fn(),
            onSessionFound: vi.fn(),
            onThinkingChange: vi.fn(),
            clearSessionId: vi.fn(),
            consumeOneTimeFlags: vi.fn(),
        } as any)).resolves.toBe('exit');

        expect(queryPrompts).toEqual([
            'Human safeguard enabled',
            'Automation safeguard suppressed',
            'Human safeguard enabled',
        ]);
        expect(sendProviderUsageReport.mock.calls[0][0]).toEqual(expect.objectContaining({
            key: 'usage-v2:claude:sdk-result:result-1:claude-test',
            tokens: expect.objectContaining({ total: 185 }),
            cost: { total: 0.014 },
        }));
        expect(sendProviderUsageReport.mock.calls[1][0]).toEqual(expect.objectContaining({
            key: 'usage-v2:claude:sdk-result:result-2:claude-test',
            tokens: expect.objectContaining({ total: 15 }),
            cost: { total: 0.006 },
        }));
    });

    it('counts resumed cumulative usage once and restores the cursor after a launcher restart', async () => {
        const first = await launchUsageResults({
            results: [usageResult('result-100', 'claude-provider-session', 100, 0.10)],
        });
        expect(first.reports).toHaveLength(1);
        expect(first.reports[0]).toMatchObject({ tokens: { total: 100 }, cost: { total: 0.10 } });

        const resumed = await launchUsageResults({
            agentState: first.agentState,
            results: [usageResult('result-130', 'claude-provider-session', 130, 0.13)],
        });
        expect(resumed.reports).toHaveLength(1);
        expect(resumed.reports[0]).toMatchObject({ tokens: { total: 30 }, cost: { total: 0.03 } });
    });

    it('uses the provider baseline as the resumed query cursor without reporting inherited usage', async () => {
        const result = await launchUsageResults({
            baseline: {
                sessionId: 'claude-provider-session',
                available: true,
                modelUsage: {
                    'claude-test': {
                        inputTokens: 100,
                        outputTokens: 0,
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUSD: 0.10,
                    },
                },
            },
            results: [usageResult('resumed-after-inherited-history', 'claude-provider-session', 130, 0.13)],
        });

        expect(result.reports).toHaveLength(1);
        expect(result.reports[0]).toMatchObject({ tokens: { total: 30 }, cost: { total: 0.03 } });
        expect(result.agentState.usageCursors?.claudeTokens).toMatchObject({
            'claude-provider-session': {
                'claude-test': {
                    tokens: { total: 130 },
                    costUsd: 0.13,
                },
            },
        });
        expect(result.updateAgentState).not.toHaveBeenCalled();
    });

    it('treats an empty provider baseline as a reset and counts the next larger result whole', async () => {
        const result = await launchUsageResults({
            agentState: {
                usageCursors: {
                    claudeTokens: {
                        'claude-provider-session': {
                            'claude-test': {
                                tokens: { total: 100, input: 100, output: 0, cacheCreation: 0, cacheRead: 0, reasoning: 0 },
                                costUsd: 0.10,
                            },
                        },
                    },
                },
            },
            baseline: { sessionId: 'claude-provider-session', available: true, modelUsage: {} },
            results: [usageResult('after-empty-ledger', 'claude-provider-session', 200, 0.20)],
        });

        expect(result.reports[0]).toMatchObject({ tokens: { total: 200 }, cost: { total: 0.20 } });
    });

    it('preserves a saved cursor when resumed baseline lookup fails', async () => {
        const result = await launchUsageResults({
            agentState: {
                usageCursors: {
                    claudeTokens: {
                        'claude-provider-session': {
                            'claude-test': {
                                tokens: { total: 100, input: 100, output: 0, cacheCreation: 0, cacheRead: 0, reasoning: 0 },
                                costUsd: 0.10,
                            },
                        },
                    },
                },
            },
            baseline: { sessionId: 'claude-provider-session', available: false },
            results: [usageResult('after-failed-baseline', 'claude-provider-session', 130, 0.13)],
        });

        expect(result.reports[0]).toMatchObject({ tokens: { total: 30 }, cost: { total: 0.03 } });
    });

    it('marks the first result unavailable after a missing baseline, then counts later increments', async () => {
        const result = await launchUsageResults({
            baseline: { sessionId: 'claude-provider-session', available: false },
            results: [
                usageResult('unknown-baseline-first', 'claude-provider-session', 130, 0.13),
                usageResult('unknown-baseline-next', 'claude-provider-session', 150, 0.15),
            ],
        });

        expect(result.reports).toHaveLength(2);
        expect(result.reports[0]).toMatchObject({
            tokens: { total: 0 },
            cost: { total: 0 },
            tokensAvailable: false,
            costAvailable: false,
            limitations: expect.arrayContaining(['resumed-session-baseline-unavailable']),
        });
        expect(result.reports[1]).toMatchObject({ tokens: { total: 20 } });
        expect((result.reports[1] as any).cost.total).toBeCloseTo(0.02);
        expect(result.agentState.usageCursors?.claudeTokens).toMatchObject({
            'claude-provider-session': {
                'claude-test': {
                    tokens: { total: 150 },
                    costUsd: 0.15,
                },
            },
        });
    });

    it('keeps failed baseline state scoped after a zero failure when a fresh provider session starts', async () => {
        const failedPlaceholder = {
            ...usageResult('resumed-zero-failure', 'resumed-provider-session', 0, 0),
            subtype: 'error_during_execution',
            is_error: true,
        };
        const result = await launchUsageResults({
            baseline: { sessionId: 'resumed-provider-session', available: false },
            results: [
                failedPlaceholder,
                usageResult('fresh-session-first-result', 'fresh-provider-session', 200, 0.20),
            ],
        });

        expect(result.reports).toHaveLength(2);
        expect(result.reports[0]).toMatchObject({
            tokensAvailable: false,
            limitations: expect.arrayContaining(['resumed-session-baseline-unavailable']),
        });
        expect(result.reports[1]).toMatchObject({
            tokens: { total: 200 },
            cost: { total: 0.20 },
            tokensAvailable: true,
            costAvailable: true,
        });
    });

    it('starts a new provider session at zero even when its counters exceed the prior session', async () => {
        const result = await launchUsageResults({
            results: [
                usageResult('first-session', 'claude-provider-session-one', 100, 0.10),
                usageResult('new-session', 'claude-provider-session-two', 200, 0.20),
            ],
        });

        expect(result.reports.map((report: any) => report.tokens.total)).toEqual([100, 200]);
        expect(result.reports.map((report: any) => report.cost.total)).toEqual([0.10, 0.20]);
    });

    it('counts a real counter reset from zero and ignores a duplicate result id', async () => {
        const duplicate = usageResult('same-result', 'claude-provider-session', 100, 0.10);
        const result = await launchUsageResults({
            results: [
                duplicate,
                duplicate,
                usageResult('after-clear', 'claude-provider-session', 8, 0.01),
                usageResult('after-reset', 'claude-provider-session', 12, 0.02),
            ],
        });

        expect(result.reports.map((report: any) => report.tokens.total)).toEqual([100, 8, 4]);
        expect(result.reports.map((report: any) => report.cost.total)).toEqual([0.10, 0.01, 0.01]);
    });

    it('keeps cumulative baselines separate for each model', async () => {
        const first = usageResult('models-first', 'claude-provider-session', 100, 0.10);
        first.modelUsage['claude-other'] = {
            inputTokens: 50,
            outputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            costUSD: 0.05,
        };
        const second = usageResult('models-second', 'claude-provider-session', 130, 0.13);
        second.modelUsage['claude-other'] = {
            inputTokens: 70,
            outputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            costUSD: 0.07,
        };
        const result = await launchUsageResults({ results: [first, second] });

        expect(result.reports.map((report: any) => [report.model, report.tokens.total])).toEqual([
            ['claude-test', 100],
            ['claude-other', 50],
            ['claude-test', 30],
            ['claude-other', 20],
        ]);
    });

    it('persists both model cursors together and restores both deltas when baseline lookup fails', async () => {
        const initial = usageResult('two-models-first', 'claude-provider-session', 100, 0.10);
        initial.modelUsage['claude/other:model'] = {
            inputTokens: 50,
            outputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            costUSD: 0.05,
        };
        const first = await launchUsageResults({ results: [initial] });
        expect(first.agentState.usageCursors?.claudeTokens?.['claude-provider-session']).toEqual({
            'claude-test': expect.objectContaining({ tokens: expect.objectContaining({ total: 100 }), costUsd: 0.10 }),
            'claude/other:model': expect.objectContaining({ tokens: expect.objectContaining({ total: 50 }), costUsd: 0.05 }),
        });

        const resumed = usageResult('two-models-next', 'claude-provider-session', 130, 0.13);
        resumed.modelUsage['claude/other:model'] = {
            inputTokens: 70,
            outputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            costUSD: 0.07,
        };
        const second = await launchUsageResults({
            agentState: first.agentState,
            baseline: { sessionId: 'claude-provider-session', available: false },
            results: [resumed],
        });

        expect(second.reports.map((report: any) => [report.model, report.tokens.total])).toEqual([
            ['claude-test', 30],
            ['claude/other:model', 20],
        ]);
    });

    it('durably replaces a resumed session cursor map after an authoritative empty baseline', async () => {
        const first = usageResult('before-provider-reset', 'claude-provider-session', 100, 0.10);
        first.modelUsage['removed-model'] = {
            inputTokens: 40,
            outputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            costUSD: 0.04,
        };
        const saved = await launchUsageResults({ results: [first] });
        const afterReset = await launchUsageResults({
            agentState: saved.agentState,
            baseline: { sessionId: 'claude-provider-session', available: true, modelUsage: {} },
            results: [usageResult('after-provider-reset', 'claude-provider-session', 200, 0.20)],
        });

        expect(afterReset.agentState.usageCursors?.claudeTokens?.['claude-provider-session']).toEqual({
            'claude-test': expect.objectContaining({ tokens: expect.objectContaining({ total: 200 }), costUsd: 0.20 }),
        });
        expect(afterReset.agentState.usageCursors?.claudeTokens?.['claude-provider-session']).not.toHaveProperty('removed-model');
    });

    it('does not advance the cursor for a failed zero placeholder', async () => {
        const results = [
            usageResult('before-error', 'claude-provider-session', 100, 0.10),
            {
                ...usageResult('failed-zero', 'claude-provider-session', 0, 0),
                subtype: 'error_during_execution',
                is_error: true,
            },
            usageResult('after-error', 'claude-provider-session', 130, 0.13),
        ];
        const result = await launchUsageResults({ results });

        expect(result.reports).toHaveLength(3);
        expect(result.reports.map((report: any) => report.tokens.total)).toEqual([100, 0, 30]);
        expect(result.reports[1]).toMatchObject({ tokensAvailable: false, costAvailable: false });
        expect(result.agentState.usageCursors?.claudeTokens).toEqual(expect.objectContaining({
            'claude-provider-session': expect.objectContaining({
                'claude-test': expect.objectContaining({
                    tokens: expect.objectContaining({ total: 130 }),
                    costUsd: 0.13,
                }),
            }),
        }));
    });

    it('serializes result accounting until the report and cursor are durable', async () => {
        let releaseFirst: (() => void) | undefined;
        let sendCount = 0;
        const reports: unknown[] = [];
        const run = launchUsageResults({
            results: [
                usageResult('serial-first', 'claude-provider-session', 100, 0.10),
                usageResult('serial-second', 'claude-provider-session', 130, 0.13),
            ],
            beforeDurable: async (report, deliveryOptions) => {
                sendCount += 1;
                reports.push(report);
                if (sendCount === 1) {
                    await new Promise<void>((resolve) => { releaseFirst = resolve; });
                    deliveryOptions?.onDurable?.();
                } else {
                    deliveryOptions?.onDurable?.();
                }
            },
        });

        await vi.waitFor(() => expect(sendCount).toBe(1));
        releaseFirst?.();
        const result = await run;

        expect(reports.map((report: any) => report.tokens.total)).toEqual([100, 30]);
        expect(sendCount).toBe(2);
        expect(result.agentState.usageCursors?.claudeTokens).toMatchObject({
            'claude-provider-session': {
                'claude-test': {
                    tokens: { total: 130 },
                    costUsd: 0.13,
                },
            },
        });
    });

    it('continues result accounting and finishes when report delivery stays pending after durability', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
        const results = [
            usageResult('offline-first', 'claude-provider-session', 100, 0.10),
            usageResult('offline-second', 'claude-provider-session', 130, 0.13),
        ];
        const completion = launchUsageResults({
            results,
            pendingAfterDurable: true,
            afterResult: () => now.mockReturnValue(Date.now() + 1_000),
        });

        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            const result = await Promise.race([
                completion,
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('launcher waited for provider flush')), 1_000);
                }),
            ]);

            expect(result.reports.map((report: any) => report.tokens.total)).toEqual([100, 30]);
            expect(result.agentState.usageCursors?.claudeTokens).toMatchObject({
                'claude-provider-session': {
                    'claude-test': {
                        tokens: { total: 130 },
                        costUsd: 0.13,
                    },
                },
            });
            expect(result.reports.map((report: any) => report.occurredAt)).toEqual([1_000, 2_000]);
        } finally {
            if (timeout) clearTimeout(timeout);
            now.mockRestore();
        }
    });

    it('turns an unexpected unattended permission callback into a terminal provider failure', async () => {
        const client = {
            sessionId: 'session-one',
            rpcHandlerManager: { registerHandler: vi.fn() },
            updateAgentState: vi.fn(),
            updateMetadata: vi.fn(),
            closeClaudeSessionTurn: vi.fn(),
            sendSessionEvent: vi.fn(),
            sendClaudeSessionMessage: vi.fn(),
            getMetadata: vi.fn(() => ({})),
        };
        const queue = new MessageQueue2<EnhancedMode>((mode) => JSON.stringify(mode));
        queue.push('ask before running', { permissionMode: 'bypassPermissions' });
        queue.close();

        mocks.claudeRemote.mockImplementation(async (options: any) => {
            const message = await options.nextMessage();
            expect(message).toMatchObject({ message: 'ask before running' });
            return options.canCallTool('AskUserQuestion', {}, {
                signal: new AbortController().signal,
                toolUseID: 'question-one',
                requestId: 'request-one',
            });
        });
        const onProviderResult = vi.fn();

        await expect(claudeRemoteLauncher({
            sessionId: 'claude-session-one',
            path: '/srv/app',
            logPath: '/tmp/claude.log',
            allowedTools: [],
            mcpServers: {},
            hookSettingsPath: '/tmp/settings.json',
            jsRuntime: 'node',
            queue,
            client,
            api: { push: () => ({ sendSessionNotification: vi.fn() }) },
            onAbort: vi.fn(),
            onSessionFound: vi.fn(),
            onThinkingChange: vi.fn(),
            clearSessionId: vi.fn(),
            consumeOneTimeFlags: vi.fn(),
        } as any, { onProviderResult, unattended: true })).resolves.toBe('exit');

        expect(onProviderResult).toHaveBeenCalledWith({
            status: 'failed',
            message: expect.stringContaining('requested interactive permission'),
        });
    });
});
