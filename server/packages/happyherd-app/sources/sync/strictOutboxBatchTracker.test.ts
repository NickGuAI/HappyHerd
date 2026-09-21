import { describe, expect, it, vi } from 'vitest';

import { StrictOutboxBatchTracker } from './strictOutboxBatchTracker';
import {
    partitionOutboxByBatchPolicy,
    removeOutboxBatchesInPlace,
    type OutboxBatchPolicy,
} from './sendMessageLocalBatch';

type PendingRecord = {
    localId: string;
    batchId: string;
    batchPolicy: OutboxBatchPolicy;
};

describe('strict outbox batch lifecycle', () => {
    it('publishes the staged optimistic batch before releasing an accepted send', async () => {
        const tracker = new StrictOutboxBatchTracker<string>();
        const lifecycle: string[] = [];
        const accepted = tracker.register('strict-batch', ['file', 'text'])
            .then(() => lifecycle.push('released'));

        tracker.settle('strict-batch', {
            applyOptimistic: (messages) => {
                lifecycle.push(`applied:${messages.join(',')}`);
            },
        });
        await accepted;

        expect(lifecycle).toEqual(['applied:file,text', 'released']);
    });

    it('rejects a terminally rejected send without publishing ghost messages', async () => {
        const tracker = new StrictOutboxBatchTracker<string>();
        const applyOptimistic = vi.fn();
        const pending = tracker.register('strict-batch', ['file', 'text']);

        tracker.settle('strict-batch', {
            error: new Error('Failed to send messages: 404'),
            applyOptimistic,
        });

        await expect(pending).rejects.toThrow('404');
        expect(applyOptimistic).not.toHaveBeenCalled();
    });

    it('drops only the rejected strict batch, leaves ordinary work, and permits a strict retry', async () => {
        const tracker = new StrictOutboxBatchTracker<string>();
        const pending: PendingRecord[] = [
            { localId: 'strict-file', batchId: 'strict-text', batchPolicy: 'retain-until-server-accepted' },
            { localId: 'strict-text', batchId: 'strict-text', batchPolicy: 'retain-until-server-accepted' },
            { localId: 'ordinary-text', batchId: 'ordinary-text', batchPolicy: 'background-fail-fast' },
        ];
        const firstAttempt = tracker.register('strict-text', ['strict-file', 'strict-text']);

        const { retained } = partitionOutboxByBatchPolicy(pending);
        const rejectedBatchIds = new Set(retained.map((message) => message.batchId));
        removeOutboxBatchesInPlace(pending, rejectedBatchIds);
        tracker.settle('strict-text', {
            error: new Error('Failed to send messages: 422'),
            applyOptimistic: () => undefined,
        });

        await expect(firstAttempt).rejects.toThrow('422');
        expect(pending).toEqual([
            { localId: 'ordinary-text', batchId: 'ordinary-text', batchPolicy: 'background-fail-fast' },
        ]);

        const applied: string[] = [];
        const retry = tracker.register('strict-text', ['retry-file', 'retry-text']);
        tracker.settle('strict-text', {
            applyOptimistic: (messages) => applied.push(...messages),
        });
        await expect(retry).resolves.toBeUndefined();
        expect(applied).toEqual(['retry-file', 'retry-text']);
    });

    it('keeps a strict waiter retryable when the ordinary batch beside it hits the watchdog', async () => {
        const tracker = new StrictOutboxBatchTracker<string>();
        const pending: PendingRecord[] = [
            { localId: 'strict-file', batchId: 'strict-text', batchPolicy: 'retain-until-server-accepted' },
            { localId: 'strict-text', batchId: 'strict-text', batchPolicy: 'retain-until-server-accepted' },
            { localId: 'ordinary-text', batchId: 'ordinary-text', batchPolicy: 'background-fail-fast' },
        ];
        let released = false;
        const strictSend = tracker.register('strict-text', ['strict-file', 'strict-text'])
            .then(() => {
                released = true;
            });

        const { retained } = partitionOutboxByBatchPolicy(pending);
        pending.splice(0, pending.length, ...retained);
        await Promise.resolve();

        expect(released).toBe(false);
        expect(pending.map((message) => message.localId)).toEqual(['strict-file', 'strict-text']);

        tracker.settle('strict-text', { applyOptimistic: () => undefined });
        await strictSend;
        expect(released).toBe(true);
    });

    it('rejects a deleted session strict batch without disturbing other sessions', async () => {
        const tracker = new StrictOutboxBatchTracker<string>();
        const applyOptimistic = vi.fn();
        const deletedSessionOutbox: PendingRecord[] = [
            { localId: 'strict-file', batchId: 'strict-text', batchPolicy: 'retain-until-server-accepted' },
            { localId: 'strict-text', batchId: 'strict-text', batchPolicy: 'retain-until-server-accepted' },
            { localId: 'ordinary-text', batchId: 'ordinary-text', batchPolicy: 'background-fail-fast' },
        ];
        const deletedSessionSend = tracker.register('strict-text', ['file', 'text']);
        const otherSessionSend = tracker.register('other-session', ['other']);

        const { retained } = partitionOutboxByBatchPolicy(deletedSessionOutbox);
        for (const batchId of new Set(retained.map((message) => message.batchId))) {
            tracker.settle(batchId, {
                error: new Error('origin session deleted'),
                applyOptimistic,
            });
        }
        deletedSessionOutbox.splice(0, deletedSessionOutbox.length);

        await expect(deletedSessionSend).rejects.toThrow('origin session deleted');
        expect(applyOptimistic).not.toHaveBeenCalled();

        tracker.settle('other-session', { applyOptimistic });
        await expect(otherSessionSend).resolves.toBeUndefined();
        expect(applyOptimistic).toHaveBeenCalledWith(['other']);

        const retry = tracker.register('strict-text', ['retry']);
        tracker.settle('strict-text', { applyOptimistic });
        await expect(retry).resolves.toBeUndefined();
    });
});
