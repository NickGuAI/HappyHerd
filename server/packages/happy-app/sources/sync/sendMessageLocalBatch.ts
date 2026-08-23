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

export function hasServerAcceptanceBarrier(
    messages: readonly { retainUntilServerAccepted?: boolean }[],
): boolean {
    return messages.some((message) => message.retainUntilServerAccepted === true);
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
