import { describe, expect, it, vi } from 'vitest';
import { InvalidateSync } from '@/utils/sync';
import { requestVisibleSessionReconciliation } from './visibleSessionReconciliation';

describe('requestVisibleSessionReconciliation', () => {
    it.each([
        { source: 'app-state', state: 'active' } as const,
        { source: 'web-lifecycle', state: 'active' } as const,
        { source: 'network-online' } as const,
        { source: 'socket-reconnect' } as const,
    ])('reconciles the current session for $source', (trigger) => {
        const invalidateMessages = vi.fn();

        const sessionId = requestVisibleSessionReconciliation(trigger, {
            getCurrentViewingSessionId: () => 'session-1',
            invalidateMessages,
        });

        expect(sessionId).toBe('session-1');
        expect(invalidateMessages).toHaveBeenCalledOnce();
        expect(invalidateMessages).toHaveBeenCalledWith('session-1');
    });

    it.each([
        { source: 'app-state', state: 'background' } as const,
        { source: 'app-state', state: 'inactive' } as const,
        { source: 'web-lifecycle', state: 'background' } as const,
    ])('does not reconcile for an inactive $source signal', (trigger) => {
        const invalidateMessages = vi.fn();

        const sessionId = requestVisibleSessionReconciliation(trigger, {
            getCurrentViewingSessionId: () => 'session-1',
            invalidateMessages,
        });

        expect(sessionId).toBeNull();
        expect(invalidateMessages).not.toHaveBeenCalled();
    });

    it('does not fetch when no primary session is visible', () => {
        const invalidateMessages = vi.fn();

        const sessionId = requestVisibleSessionReconciliation(
            { source: 'socket-reconnect' },
            {
                getCurrentViewingSessionId: () => null,
                invalidateMessages,
            },
        );

        expect(sessionId).toBeNull();
        expect(invalidateMessages).not.toHaveBeenCalled();
    });

    it('relies on InvalidateSync to coalesce a lifecycle event storm', async () => {
        let releaseFirstRun: (() => void) | undefined;
        const firstRunGate = new Promise<void>((resolve) => {
            releaseFirstRun = resolve;
        });
        let runs = 0;
        const messagesSync = new InvalidateSync(async () => {
            runs += 1;
            if (runs === 1) {
                await firstRunGate;
            }
        });
        const dependencies = {
            getCurrentViewingSessionId: () => 'session-1',
            invalidateMessages: () => messagesSync.invalidate(),
        };

        requestVisibleSessionReconciliation({ source: 'app-state', state: 'active' }, dependencies);
        requestVisibleSessionReconciliation({ source: 'web-lifecycle', state: 'active' }, dependencies);
        requestVisibleSessionReconciliation({ source: 'web-lifecycle', state: 'active' }, dependencies);
        requestVisibleSessionReconciliation({ source: 'socket-reconnect' }, dependencies);

        expect(runs).toBe(1);
        releaseFirstRun?.();
        await messagesSync.awaitQueue();

        expect(runs).toBe(2);
    });
});
