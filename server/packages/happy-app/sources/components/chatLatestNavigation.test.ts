import { describe, expect, it } from 'vitest';
import {
    countNewConversationMessages,
    planMessageFocusScrollRetry,
    resolveMessageFocusTarget,
} from './chatLatestNavigation';

describe('countNewConversationMessages', () => {
    it('counts the new newest-first prefix', () => {
        expect(countNewConversationMessages(
            ['m3', 'm2', 'm1'],
            ['m5', 'm4', 'm3', 'm2', 'm1'],
        )).toBe(2);
    });

    it('does not count an older-page append', () => {
        expect(countNewConversationMessages(
            ['m3', 'm2', 'm1'],
            ['m3', 'm2', 'm1', 'm0'],
        )).toBe(0);
    });

    it('fails closed when no prior anchor remains', () => {
        expect(countNewConversationMessages(['old'], ['new'])).toBe(0);
    });
});

describe('resolveMessageFocusTarget', () => {
    const userMessage = (id: string, localId: string | null = null) => ({
        type: 'message' as const,
        id,
        message: {
            kind: 'user-text' as const,
            id,
            localId,
            createdAt: 1,
            text: id,
        },
    });

    it('finds the receipt localId and counts newer visible conversation messages', () => {
        expect(resolveMessageFocusTarget([
            userMessage('agent-newer'),
            userMessage('persisted-id', 'receipt-local-id'),
            userMessage('older'),
        ], 'receipt-local-id')).toEqual({
            index: 1,
            newerConversationCount: 1,
        });
    });

    it('falls back to latest when the target is absent or collapsed', () => {
        expect(resolveMessageFocusTarget([
            {
                type: 'tool-group',
                id: 'group',
                messages: [],
                hasRunning: false,
                hasPendingPermission: false,
            },
        ], 'hidden-message')).toEqual({ index: null, newerConversationCount: 0 });
    });

    it('resolves the exact index when a previously absent optimistic record arrives', () => {
        const before = [userMessage('older')];
        expect(resolveMessageFocusTarget(before, 'receipt-local-id').index).toBeNull();

        const after = [
            userMessage('agent-newer'),
            userMessage('persisted-id', 'receipt-local-id'),
            ...before,
        ];
        expect(resolveMessageFocusTarget(after, 'receipt-local-id')).toEqual({
            index: 1,
            newerConversationCount: 1,
        });
    });
});

describe('planMessageFocusScrollRetry', () => {
    it('moves near the current target index and schedules one exact retry', () => {
        expect(planMessageFocusScrollRetry({
            state: { messageId: 'receipt', index: 12, didRetry: false },
            failedIndex: 12,
            averageItemLength: 84,
            currentTargetIndex: 14,
        })).toEqual({
            nextState: { messageId: 'receipt', index: 14, didRetry: true },
            offset: 1176,
            retryIndex: 14,
        });
    });

    it('does not retry twice or react to a stale failed-index callback', () => {
        expect(planMessageFocusScrollRetry({
            state: { messageId: 'receipt', index: 14, didRetry: true },
            failedIndex: 14,
            averageItemLength: 84,
            currentTargetIndex: 14,
        })).toBeNull();
        expect(planMessageFocusScrollRetry({
            state: { messageId: 'new-receipt', index: 3, didRetry: false },
            failedIndex: 12,
            averageItemLength: 84,
            currentTargetIndex: 3,
        })).toBeNull();
    });
});
