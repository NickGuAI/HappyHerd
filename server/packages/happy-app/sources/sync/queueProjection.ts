import type { AgentMessageQueueState } from '@slopus/happy-wire';

import type { Message, ToolCallMessage, UserTextMessage } from './typesMessage';

export type QueuedMessageProjectionItem = {
    id: string;
    message: UserTextMessage;
    attachments: ToolCallMessage[];
};

export type SessionQueueProjection = {
    pendingItems: QueuedMessageProjectionItem[];
    currentItems: QueuedMessageProjectionItem[];
    pendingCount: number;
    currentCount: number;
    transcriptMessages: Message[];
};

function userQueueMessageId(message: UserTextMessage): string | null {
    if (message.meta?.deliveryMode !== 'queue') return null;
    return message.meta.queueMessageId ?? message.localId ?? message.id;
}
/**
 * Join runtime-owned queue IDs to immutable message content.
 *
 * Only pending IDs are filtered from chat. Current IDs have been dequeued for
 * processing, so their original records become ordinary transcript messages
 * while the panel may still show that the runtime is working on them.
 */
export function projectSessionQueue(
    messages: Message[],
    queueState?: AgentMessageQueueState,
): SessionQueueProjection {
    if (!queueState) {
        return {
            pendingItems: [],
            currentItems: [],
            pendingCount: 0,
            currentCount: 0,
            transcriptMessages: messages,
        };
    }

    const messagesByQueueId = new Map<string, UserTextMessage>();
    const attachmentsByQueueId = new Map<string, ToolCallMessage[]>();
    for (const message of messages) {
        if (message.kind === 'user-text') {
            const queueMessageId = userQueueMessageId(message);
            if (queueMessageId && !messagesByQueueId.has(queueMessageId)) {
                messagesByQueueId.set(queueMessageId, message);
            }
            continue;
        }
        if (message.kind === 'tool-call' && message.meta?.queueMessageId) {
            const attachments = attachmentsByQueueId.get(message.meta.queueMessageId) ?? [];
            attachments.push(message);
            attachmentsByQueueId.set(message.meta.queueMessageId, attachments);
        }
    }

    const projectIds = (ids: readonly string[]): QueuedMessageProjectionItem[] => (
        ids.flatMap((id) => {
            const message = messagesByQueueId.get(id);
            return message ? [{
                id,
                message,
                attachments: attachmentsByQueueId.get(id) ?? [],
            }] : [];
        })
    );

    const pendingIds = new Set(queueState.pendingMessageIds);
    const transcriptMessages = messages.filter((message) => {
        if (message.kind === 'user-text') {
            const queueMessageId = userQueueMessageId(message);
            return !queueMessageId || !pendingIds.has(queueMessageId);
        }
        const parentQueueMessageId = message.meta?.queueMessageId;
        return !parentQueueMessageId || !pendingIds.has(parentQueueMessageId);
    });

    return {
        pendingItems: projectIds(queueState.pendingMessageIds),
        currentItems: projectIds(queueState.currentMessageIds),
        pendingCount: queueState.pendingMessageIds.length,
        currentCount: queueState.currentMessageIds.length,
        transcriptMessages,
    };
}
