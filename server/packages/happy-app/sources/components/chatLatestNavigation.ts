import type { Message } from '@/sync/typesMessage';

export function getConversationMessageIds(messages: readonly Message[]): string[] {
    return messages.flatMap((message) => {
        if (message.kind === 'user-text') {
            return [message.id];
        }
        if (message.kind === 'agent-text' && !message.isThinking && message.text.trim().length > 0) {
            return [message.id];
        }
        return [];
    });
}

/**
 * Messages are newest-first. Only the prefix before the previously newest
 * visible conversation message is new. Older-page pagination appends to the
 * tail and therefore never increments this count.
 */
export function countNewConversationMessages(
    previousNewestFirstIds: readonly string[],
    currentNewestFirstIds: readonly string[],
): number {
    if (previousNewestFirstIds.length === 0 || currentNewestFirstIds.length === 0) {
        return 0;
    }

    const previousIds = new Set(previousNewestFirstIds);
    const firstPreviouslySeenIndex = currentNewestFirstIds.findIndex((id) => previousIds.has(id));
    return firstPreviouslySeenIndex < 0 ? 0 : firstPreviouslySeenIndex;
}
