import type { Session } from './storageTypes';

/**
 * Whether a session belongs in conversation-first, top-level lists.
 *
 * Side chats render under their parent session. Automation runs remain in the
 * synchronized store for direct navigation, resume, and audit, but their
 * canonical entry point is Automation History rather than Home or Recent.
 */
export function isSessionVisibleInTopLevelLists(
    session: Pick<Session, 'metadata'>,
): boolean {
    return !session.metadata?.isSideChat
        && !session.metadata?.automationId
        && !session.metadata?.automationKind;
}

export function filterSessionsForTopLevelLists<T extends Pick<Session, 'metadata'>>(
    sessions: readonly T[],
): T[] {
    return sessions.filter(isSessionVisibleInTopLevelLists);
}

export function getRecentTopLevelSessions<
    T extends Pick<Session, 'metadata' | 'updatedAt'>,
>(sessions: readonly T[], limit = 5): T[] {
    return filterSessionsForTopLevelLists(sessions)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit);
}
