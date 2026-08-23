import type { Message } from '@/sync/typesMessage';
import type { DisplayItem } from '@/hooks/useGroupedMessages';

export type MessageFocusTarget = {
    index: number | null;
    newerConversationCount: number;
};

export function shouldFollowLatestForMessageFocus(target: MessageFocusTarget): boolean {
    // A resolved explicit focus is an anchor, including when the requested
    // message happens to be newest at the instant it is focused. Otherwise a
    // concurrent row can pull the inverted list away from that receipt.
    return target.index === null;
}

export type MessageFocusScrollRetryState = {
    messageId: string;
    index: number;
    didRetry: boolean;
};

export type MessageFocusScrollRetryPlan = {
    nextState: MessageFocusScrollRetryState;
    offset: number;
    retryIndex: number;
};

export function refreshMessageFocusScrollRetryState(
    state: MessageFocusScrollRetryState | null,
    currentTargetIndex: number | null,
): MessageFocusScrollRetryState | null {
    if (!state?.didRetry || currentTargetIndex === null) return null;
    return { ...state, index: currentTargetIndex };
}

export function planMessageFocusScrollRetry(input: {
    state: MessageFocusScrollRetryState | null;
    failedIndex: number;
    averageItemLength: number;
    currentTargetIndex: number | null;
}): MessageFocusScrollRetryPlan | null {
    if (!input.state || input.state.didRetry || input.state.index !== input.failedIndex) {
        return null;
    }
    const retryIndex = input.currentTargetIndex ?? input.state.index;
    return {
        nextState: {
            ...input.state,
            index: retryIndex,
            didRetry: true,
        },
        offset: Math.max(0, input.averageItemLength) * retryIndex,
        retryIndex,
    };
}

function displayItemMatchesMessage(item: DisplayItem, messageId: string): boolean {
    return item.type === 'message' && (
        item.message.id === messageId
        || ('localId' in item.message && item.message.localId === messageId)
    );
}

function isVisibleConversationItem(item: DisplayItem): boolean {
    if (item.type !== 'message') return false;
    if (item.message.kind === 'user-text') return true;
    return item.message.kind === 'agent-text'
        && !item.message.isThinking
        && item.message.text.trim().length > 0;
}

export function resolveMessageFocusTarget(
    displayItems: readonly DisplayItem[],
    messageId: string,
): MessageFocusTarget {
    const index = displayItems.findIndex((item) => displayItemMatchesMessage(item, messageId));
    if (index < 0) {
        return { index: null, newerConversationCount: 0 };
    }
    return {
        index,
        newerConversationCount: displayItems.slice(0, index).filter(isVisibleConversationItem).length,
    };
}

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
