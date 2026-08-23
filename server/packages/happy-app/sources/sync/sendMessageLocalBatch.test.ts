import { describe, expect, it, vi } from 'vitest';
import type { NormalizedMessage } from './typesRaw';
import {
    buildAtomicLocalMessageBatch,
    commitAtomicLocalMessageBatch,
    hasCompleteRequiredAttachmentBatch,
    isTerminalOutboxRejectionStatus,
    partitionOutboxByBatchPolicy,
    prepareEveryAttachment,
    removeOutboxRecordsInPlace,
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

    it('partitions background cleanup by batch when strict and ordinary sends share a session', () => {
        const strictAttachment = {
            localId: 'strict-attachment',
            batchId: 'strict-text',
            batchPolicy: 'background-fail-fast' as const,
        };
        const strictText = {
            localId: 'strict-text',
            batchId: 'strict-text',
            batchPolicy: 'retain-until-server-accepted' as const,
        };
        const ordinaryText = {
            localId: 'ordinary-text',
            batchId: 'ordinary-text',
            batchPolicy: 'background-fail-fast' as const,
        };

        expect(partitionOutboxByBatchPolicy([
            strictAttachment,
            strictText,
            ordinaryText,
        ])).toEqual({
            failFast: [ordinaryText],
            retained: [strictAttachment, strictText],
        });
    });

    it('classifies only non-retryable client responses as terminal outbox rejection', () => {
        expect(isTerminalOutboxRejectionStatus(400)).toBe(true);
        expect(isTerminalOutboxRejectionStatus(404)).toBe(true);
        expect(isTerminalOutboxRejectionStatus(422)).toBe(true);
        expect(isTerminalOutboxRejectionStatus(408)).toBe(false);
        expect(isTerminalOutboxRejectionStatus(425)).toBe(false);
        expect(isTerminalOutboxRejectionStatus(429)).toBe(false);
        expect(isTerminalOutboxRejectionStatus(500)).toBe(false);
    });

    it('removes only records accepted from a snapshot after mixed-session cleanup reorders pending work', () => {
        const strictAccepted = { localId: 'strict-a', batchId: 'strict-a', batchPolicy: 'retain-until-server-accepted' as const };
        const laterStrict = { localId: 'strict-c', batchId: 'strict-c', batchPolicy: 'retain-until-server-accepted' as const };
        const pending = [strictAccepted, laterStrict];

        removeOutboxRecordsInPlace(pending, new Set(['strict-a', 'ordinary-b']));

        expect(pending).toEqual([laterStrict]);
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
});
