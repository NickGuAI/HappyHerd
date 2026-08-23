import type { NormalizedMessage } from './typesRaw';

export type PreparedLocalMessage = {
    localId: string;
    content: string;
    normalized: NormalizedMessage | null;
};

export function hasCompleteRequiredAttachmentBatch(args: {
    requireAllAttachments: boolean;
    requestedCount: number;
    effectiveCount: number;
}): boolean {
    return !args.requireAllAttachments
        || args.requestedCount === 0
        || args.requestedCount === args.effectiveCount;
}

export function canCommitPreparedMessage<TEncryption>(args: {
    sessionExists: boolean;
    preparedEncryption: TEncryption;
    currentEncryption: TEncryption | null;
}): boolean {
    return args.sessionExists
        && args.currentEncryption === args.preparedEncryption;
}

export type OutboxBatchPolicy = 'background-fail-fast' | 'retain-until-server-accepted';

export type OutboxBatchRecord = {
    batchId: string;
    batchPolicy: OutboxBatchPolicy;
};

type OutboxLocalRecord = {
    localId: string;
};

export function partitionOutboxByBatchPolicy<T extends OutboxBatchRecord>(
    messages: readonly T[],
): { failFast: T[]; retained: T[] } {
    const retainedBatchIds = new Set(
        messages
            .filter((message) => message.batchPolicy === 'retain-until-server-accepted')
            .map((message) => message.batchId),
    );
    const failFast: T[] = [];
    const retained: T[] = [];
    for (const message of messages) {
        (retainedBatchIds.has(message.batchId) ? retained : failFast).push(message);
    }
    return { failFast, retained };
}

export function removeOutboxBatchesInPlace<T extends OutboxBatchRecord>(
    messages: T[],
    batchIds: ReadonlySet<string>,
): void {
    messages.splice(
        0,
        messages.length,
        ...messages.filter((message) => !batchIds.has(message.batchId)),
    );
}

export function removeOutboxRecordsInPlace<T extends OutboxLocalRecord>(
    messages: T[],
    localIds: ReadonlySet<string>,
): void {
    messages.splice(
        0,
        messages.length,
        ...messages.filter((message) => !localIds.has(message.localId)),
    );
}

export function isTerminalOutboxRejectionStatus(status: number): boolean {
    return status >= 400
        && status < 500
        && status !== 408
        && status !== 425
        && status !== 429;
}

export async function prepareEveryAttachment<TAttachment, TPrepared>(
    attachments: TAttachment[],
    prepare: (attachment: TAttachment) => Promise<TPrepared>,
): Promise<TPrepared[]> {
    const prepared: TPrepared[] = [];
    for (const attachment of attachments) {
        prepared.push(await prepare(attachment));
    }
    return prepared;
}

export function buildAtomicLocalMessageBatch(
    attachments: PreparedLocalMessage[],
    text: PreparedLocalMessage,
): {
    normalized: NormalizedMessage[];
    outbox: Array<{ localId: string; content: string }>;
} {
    const records = [...attachments, text];
    return {
        normalized: records.flatMap((record) => record.normalized ? [record.normalized] : []),
        outbox: records.map(({ localId, content }) => ({ localId, content })),
    };
}

export function commitAtomicLocalMessageBatch(args: {
    batch: ReturnType<typeof buildAtomicLocalMessageBatch>;
    enqueueOptimistic: (messages: NormalizedMessage[]) => void;
    appendOutbox: (messages: Array<{ localId: string; content: string }>) => void;
}): void {
    // Enqueue the complete optimistic projection first. If that owning call
    // rejects synchronously, no outbox record has been appended and the
    // caller can safely keep the Viewer draft for retry.
    if (args.batch.normalized.length > 0) {
        args.enqueueOptimistic(args.batch.normalized);
    }
    args.appendOutbox(args.batch.outbox);
}
