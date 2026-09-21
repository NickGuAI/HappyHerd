import { describe, expect, it } from 'vitest';

import { appendPendingQueueMessageId, removeQueueMessageIds } from './queueState';

describe('local queue state reconciliation', () => {
    it('appends optimistic IDs in order without duplicating runtime-owned IDs', () => {
        const initial = {
            pendingMessageIds: ['queue-1'],
            currentMessageIds: ['queue-current'],
        };

        expect(appendPendingQueueMessageId(initial, 'queue-2')).toEqual({
            pendingMessageIds: ['queue-1', 'queue-2'],
            currentMessageIds: ['queue-current'],
        });
        expect(appendPendingQueueMessageId(initial, 'queue-1')).toBe(initial);
        expect(appendPendingQueueMessageId(initial, 'queue-current')).toBe(initial);
    });

    it('removes abandoned outbox IDs so a failed send cannot leave a ghost count', () => {
        const state = {
            pendingMessageIds: ['queue-failed', 'queue-kept'],
            currentMessageIds: ['queue-current'],
        };

        expect(removeQueueMessageIds(state, ['attachment-local-id', 'queue-failed', 'queue-current'])).toEqual({
            pendingMessageIds: ['queue-kept'],
            currentMessageIds: ['queue-current'],
        });
        expect(removeQueueMessageIds(state, ['unrelated-id'])).toBe(state);
    });
});
