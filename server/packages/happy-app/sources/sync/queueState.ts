import type { AgentMessageQueueState } from '@slopus/happy-wire';

export function appendPendingQueueMessageId(
    state: AgentMessageQueueState,
    messageId: string,
): AgentMessageQueueState {
    if (state.pendingMessageIds.includes(messageId) || state.currentMessageIds.includes(messageId)) {
        return state;
    }
    return {
        pendingMessageIds: [...state.pendingMessageIds, messageId],
        currentMessageIds: state.currentMessageIds,
    };
}

/** Remove local optimistic IDs after their outbox records are abandoned. */
export function removeQueueMessageIds(
    state: AgentMessageQueueState,
    messageIds: Iterable<string>,
): AgentMessageQueueState {
    const removed = new Set(messageIds);
    if (removed.size === 0) return state;

    const pendingMessageIds = state.pendingMessageIds.filter((id) => !removed.has(id));
    // A current ID proves the CLI already accepted that record, even if the
    // app missed the HTTP acknowledgement. Never override runtime authority.
    if (pendingMessageIds.length === state.pendingMessageIds.length) {
        return state;
    }
    return { pendingMessageIds, currentMessageIds: state.currentMessageIds };
}
