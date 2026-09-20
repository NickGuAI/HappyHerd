import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeRemote } from './claudeRemote';
import { query } from '@/claude/sdk';
import { MessageQueue2, queueMessageIdsForResume } from '@/utils/MessageQueue2';
import type { EnhancedMode } from './loop';

vi.mock('@/claude/sdk', () => ({
    query: vi.fn(),
    AbortError: class AbortError extends Error {},
}));

const mode: EnhancedMode = { permissionMode: 'default' };
const rejected = {
    type: 'rate_limit_event',
    rate_limit_info: {
        status: 'rejected',
        rateLimitType: 'five_hour',
        resetsAt: 2_000_000_000,
    },
};
const apiLimit = {
    type: 'assistant',
    error: 'rate_limit',
    message: {
        role: 'assistant',
        content: [{ type: 'text', text: "You've reached your Fable 5 limit." }],
    },
};
const failedResult = { type: 'result', subtype: 'error_during_execution' };

function sdkStream(events: unknown[], usage?: () => Promise<unknown>): void {
    vi.mocked(query).mockReturnValue({
        setPermissionMode: vi.fn(),
        ...(usage ? { usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: usage } : {}),
        async *[Symbol.asyncIterator]() {
            for (const event of events) yield event;
        },
    } as any);
}

function queuedTurn(queueFollowUp = true) {
    const queue = new MessageQueue2<EnhancedMode>(() => 'default');
    queue.push('Finish the original task', mode, undefined, 'original-request');
    let first = true;
    const nextMessage = vi.fn(async () => {
        if (!first) return null;
        first = false;
        const batch = await queue.waitForMessagesAndGetAsString();
        if (!batch) throw new Error('Missing test batch');
        queue.markBatchStarted(batch.queueMessageIds);
        if (queueFollowUp) queue.push('Later follow-up', mode, undefined, 'later-request');
        return { message: batch.message, mode: batch.mode };
    });
    const onReady = vi.fn(() => queue.completeCurrentBatch());
    const onProviderHardLimit = vi.fn(async () => true);
    const options: Parameters<typeof claudeRemote>[0] = {
        sessionId: null,
        path: process.cwd(),
        allowedTools: [],
        hookSettingsPath: '/tmp/happy-rotation-test-settings.json',
        nextMessage,
        onReady,
        onProviderHardLimit,
        onUsageLimits: vi.fn(),
        canCallTool: async () => ({ behavior: 'allow' }) as any,
        isAborted: () => false,
        onSessionFound: vi.fn(),
        onMessage: vi.fn(),
    };
    return { queue, nextMessage, onReady, onProviderHardLimit, options };
}

function expectInterrupted(turn: ReturnType<typeof queuedTurn>): void {
    expect(turn.onReady).not.toHaveBeenCalled();
    expect(turn.nextMessage).toHaveBeenCalledTimes(1);
    expect(turn.queue.getQueueState()).toEqual({
        currentMessageIds: ['original-request'],
        pendingMessageIds: ['later-request'],
    });
    expect(queueMessageIdsForResume(turn.queue.getQueueState())).toEqual([
        'original-request', 'later-request',
    ]);
}

describe('Claude account rotation preserves interrupted work', () => {
    beforeEach(() => {
        vi.mocked(query).mockReset();
        vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT', 'primary');
        vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_TYPE', 'claude');
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
    });

    it.each([
        ['typed rejection before result', [rejected, failedResult]],
        ['synthetic API rejection without a typed event', [apiLimit, failedResult]],
        ['typed reset trailing a synthetic rejection and result', [apiLimit, failedResult, rejected]],
    ])('retains the original batch on %s', async (_name, events) => {
        sdkStream(events as unknown[]);
        const turn = queuedTurn();
        await claudeRemote(turn.options);
        expectInterrupted(turn);
        expect(turn.onProviderHardLimit).toHaveBeenCalledTimes(1);
    });

    it('uses a trailing typed reset without completing the interrupted batch', async () => {
        sdkStream([apiLimit, failedResult, rejected]);
        const turn = queuedTurn();
        await claudeRemote(turn.options);
        expectInterrupted(turn);
        expect(turn.onProviderHardLimit).toHaveBeenCalledWith({
            provider: 'claude', limitedUntil: 2_000_000_000_000,
        });
    });

    it.each(['five_hour', 'seven_day_sonnet', undefined])('uses the actual rejection reset (%s) instead of an unrelated exhausted snapshot window', async (rateLimitType) => {
        sdkStream([{
            ...rejected,
            rate_limit_info: { ...rejected.rate_limit_info, rateLimitType },
        }, failedResult], async () => ({
            rate_limits_available: true,
            rate_limits: {
                seven_day_opus: { utilization: 100, resets_at: '2035-01-01T00:00:00Z' },
            },
        }));
        const turn = queuedTurn();
        await claudeRemote(turn.options);
        expectInterrupted(turn);
        expect(turn.onProviderHardLimit).toHaveBeenCalledTimes(1);
        expect(turn.onProviderHardLimit).toHaveBeenCalledWith({
            provider: 'claude', limitedUntil: 2_000_000_000_000,
        });
    });

    it.each(['refused', 'thrown'] as const)('does not discard work after a %s rotation notice', async (failure) => {
        sdkStream([rejected, failedResult]);
        const turn = queuedTurn();
        if (failure === 'refused') turn.onProviderHardLimit.mockResolvedValue(false);
        else turn.onProviderHardLimit.mockRejectedValue(new Error('daemon unavailable'));
        await claudeRemote(turn.options);
        expectInterrupted(turn);
    });

    it.each(['refused', 'thrown'] as const)('retries a %s notice after the rejected stream closes', async (failure) => {
        vi.useFakeTimers();
        sdkStream([rejected]);
        const turn = queuedTurn();
        if (failure === 'refused') turn.onProviderHardLimit.mockResolvedValueOnce(false);
        else turn.onProviderHardLimit.mockRejectedValueOnce(new Error('daemon unavailable'));
        const controller = new AbortController();
        let settled = false;
        const running = claudeRemote({ ...turn.options, signal: controller.signal })
            .then(() => { settled = true; });
        try {
            await vi.waitFor(() => expect(turn.onProviderHardLimit).toHaveBeenCalledTimes(1));
            expectInterrupted(turn);
            await vi.advanceTimersByTimeAsync(1_000);
            expect(turn.onProviderHardLimit).toHaveBeenCalledTimes(2);
            expect(turn.onProviderHardLimit).toHaveBeenLastCalledWith({
                provider: 'claude', limitedUntil: 2_000_000_000_000,
            });
            await vi.advanceTimersByTimeAsync(5_000);
            expect(turn.onProviderHardLimit).toHaveBeenCalledTimes(2);
            expect(settled).toBe(false);
            expectInterrupted(turn);
        } finally {
            controller.abort();
            await running;
        }
        expect(settled).toBe(true);
    });

    it('cancels a pending notice retry when the launcher aborts', async () => {
        vi.useFakeTimers();
        sdkStream([rejected]);
        const turn = queuedTurn();
        turn.onProviderHardLimit.mockResolvedValue(false);
        const controller = new AbortController();
        const running = claudeRemote({ ...turn.options, signal: controller.signal });
        try {
            await vi.waitFor(() => expect(turn.onProviderHardLimit).toHaveBeenCalledTimes(1));
            expectInterrupted(turn);
        } finally {
            controller.abort();
            await running;
        }
        await vi.advanceTimersByTimeAsync(5_000);
        expect(turn.onProviderHardLimit).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rehydrates the interrupted request before later work for the replacement account', async () => {
        sdkStream([rejected, failedResult]);
        const turn = queuedTurn();
        await claudeRemote(turn.options);
        const ids = queueMessageIdsForResume(turn.queue.getQueueState());
        const restored = new MessageQueue2<EnhancedMode>(() => 'default');
        restored.restorePendingQueueMessageIds(ids);
        for (const id of ids) {
            restored.pushIsolated(
                id === 'original-request' ? 'Finish the original task' : 'Later follow-up',
                mode,
                undefined,
                id,
            );
        }
        const resumed = await restored.waitForMessagesAndGetAsString();
        expect(resumed?.message).toBe('Finish the original task');
        expect(resumed?.queueMessageIds).toEqual(['original-request']);
        expect(restored.getQueueState().pendingMessageIds).toEqual([
            'original-request', 'later-request',
        ]);
    });

    it('does not re-enter the old account when its rejected SDK stream closes', async () => {
        sdkStream([rejected, failedResult]);
        const turn = queuedTurn();
        const controller = new AbortController();
        let settled = false;
        const running = claudeRemote({ ...turn.options, signal: controller.signal })
            .then(() => { settled = true; });
        try {
            await vi.waitFor(() => expect(turn.onProviderHardLimit).toHaveBeenCalledTimes(1));
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(settled).toBe(false);
            expectInterrupted(turn);
        } finally {
            controller.abort();
            await running;
        }
        expect(settled).toBe(true);
    });

    it.each([
        ['typed rejection with result', [rejected, apiLimit, failedResult]],
        ['typed rejection followed by stream close', [rejected]],
        ['synthetic rejection with result', [apiLimit, failedResult]],
        ['trailing typed reset', [apiLimit, failedResult, rejected]],
    ])('releases unmanaged auth after %s and processes only a later Human turn', async (_name, events) => {
        vi.useFakeTimers();
        vi.setSystemTime(2_000_000_000_000 - 60_000);
        vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT', '');
        sdkStream(events);
        const turn = queuedTurn(false);
        const controller = new AbortController();
        let outcome: unknown;
        const running = claudeRemote({ ...turn.options, signal: controller.signal })
            .then((result) => { outcome = result; });
        try {
            await vi.advanceTimersByTimeAsync(10 * 60_000);
            expect(outcome).toBe('quota-exhausted');
            expect(controller.signal.aborted).toBe(false);
            expect(turn.onReady).not.toHaveBeenCalled();
            expect(turn.nextMessage).toHaveBeenCalledTimes(1);
            expect(turn.onProviderHardLimit).toHaveBeenCalledTimes(1);
            for (const event of events) expect(turn.options.onMessage).toHaveBeenCalledWith(event);
            expect(query).toHaveBeenCalledTimes(1);

            // The launcher retires the failed batch, never replaying its prompt.
            turn.queue.completeCurrentBatch();
            turn.queue.push('Later follow-up', mode, undefined, 'later-request');
            sdkStream([{ type: 'result', subtype: 'success' }]);
            const nextMessage = vi.fn(async () => {
                const batch = await turn.queue.waitForMessagesAndGetAsString();
                if (batch) turn.queue.markBatchStarted(batch.queueMessageIds);
                return batch;
            });
            turn.queue.close();
            await claudeRemote({ ...turn.options, nextMessage, signal: controller.signal });
            const prompt = vi.mocked(query).mock.calls[1][0].prompt as AsyncIterable<any>;
            const sent = await prompt[Symbol.asyncIterator]().next();
            expect(sent.value.message.content).toBe('Later follow-up');
            expect(turn.onReady).toHaveBeenCalledTimes(1);
            expect(turn.queue.getQueueState().currentMessageIds).toEqual([]);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            controller.abort();
            await running;
        }
    });

    it.each([
        ['success', { type: 'result', subtype: 'success' }],
        ['non-quota error', failedResult],
    ])('preserves normal completion behavior for %s', async (_name, result) => {
        sdkStream([result]);
        const turn = queuedTurn();
        await claudeRemote(turn.options);
        expect(turn.onReady).toHaveBeenCalledTimes(1);
        expect(turn.nextMessage).toHaveBeenCalledTimes(2);
        expect(turn.queue.getQueueState().currentMessageIds).toEqual([]);
        expect(turn.onProviderHardLimit).not.toHaveBeenCalled();
    });

    it('does not treat ordinary assistant prose about a quota as a provider limit', async () => {
        sdkStream([
            { ...apiLimit, error: undefined },
            { type: 'result', subtype: 'success' },
        ]);
        const turn = queuedTurn();
        await claudeRemote(turn.options);
        expect(turn.onReady).toHaveBeenCalledTimes(1);
        expect(turn.onProviderHardLimit).not.toHaveBeenCalled();
    });
});
