import { describe, expect, it, vi } from 'vitest';
import type { NormalizedMessage } from './typesRaw';
import {
    buildAtomicLocalMessageBatch,
    commitAtomicLocalMessageBatch,
    dispatchPreparedOutbox,
    hasCompleteRequiredAttachmentBatch,
    prepareEveryAttachment,
} from './sendMessageLocalBatch';

function prepared(localId: string): {
    localId: string;
    content: string;
    normalized: NormalizedMessage;
} {
    return {
        localId,
        content: `encrypted:${localId}`,
        normalized: { localId } as NormalizedMessage,
    };
}

describe('atomic local message batches', () => {
    it('rejects capability or policy filtering only for all-required sends', () => {
        expect(hasCompleteRequiredAttachmentBatch({
            requireAllAttachments: true,
            requestedCount: 2,
            effectiveCount: 1,
        })).toBe(false);
        expect(hasCompleteRequiredAttachmentBatch({
            requireAllAttachments: false,
            requestedCount: 2,
            effectiveCount: 1,
        })).toBe(true);
    });

    it('does not return a partial prepared batch when attachment encryption fails', async () => {
        const prepare = vi.fn(async (attachment: string) => {
            if (attachment === 'file-2') throw new Error('encryption failed');
            return `encrypted:${attachment}`;
        });

        await expect(prepareEveryAttachment(['file-1', 'file-2', 'file-3'], prepare))
            .rejects.toThrow('encryption failed');
        expect(prepare).toHaveBeenCalledTimes(2);
    });

    it('assembles every file and the owning text as one ordered optimistic/outbox batch', () => {
        const result = buildAtomicLocalMessageBatch(
            [prepared('file-1'), prepared('file-2')],
            prepared('text-1'),
        );

        expect(result.normalized.map((message) => message.localId)).toEqual([
            'file-1',
            'file-2',
            'text-1',
        ]);
        expect(result.outbox).toEqual([
            { localId: 'file-1', content: 'encrypted:file-1' },
            { localId: 'file-2', content: 'encrypted:file-2' },
            { localId: 'text-1', content: 'encrypted:text-1' },
        ]);
    });

    it('returns strict sends after scheduling the complete local outbox', async () => {
        const invalidate = vi.fn();
        const invalidateAndAwait = vi.fn();

        await dispatchPreparedOutbox({
            returnAfterLocalAcceptance: true,
            invalidate,
            invalidateAndAwait,
        });

        expect(invalidate).toHaveBeenCalledOnce();
        expect(invalidateAndAwait).not.toHaveBeenCalled();
    });

    it('does not append the outbox when the complete optimistic enqueue is rejected', () => {
        const batch = buildAtomicLocalMessageBatch([prepared('file-1')], prepared('text-1'));
        const enqueueOptimistic = vi.fn(() => {
            throw new Error('enqueue failed');
        });
        const appendOutbox = vi.fn();

        expect(() => commitAtomicLocalMessageBatch({
            batch,
            enqueueOptimistic,
            appendOutbox,
        })).toThrow('enqueue failed');

        expect(enqueueOptimistic).toHaveBeenCalledWith(batch.normalized);
        expect(appendOutbox).not.toHaveBeenCalled();
    });

    it('preserves the existing awaited delivery behavior for ordinary Chat sends', async () => {
        const invalidate = vi.fn();
        const invalidateAndAwait = vi.fn().mockResolvedValue(undefined);

        await dispatchPreparedOutbox({
            returnAfterLocalAcceptance: false,
            invalidate,
            invalidateAndAwait,
        });

        expect(invalidate).not.toHaveBeenCalled();
        expect(invalidateAndAwait).toHaveBeenCalledOnce();
    });
});
