import type { Session } from './storageTypes';

const noSideChats: Session[] = [];

/**
 * Resolve the live side-chat sessions belonging to one exact parent.
 *
 * Archived children disappear from the open tab strip, while an externally
 * created child becomes discoverable as soon as it hydrates into the store.
 * Oldest-first ordering keeps existing tabs stable as new children arrive.
 */
export function selectSideChatSessions(
    sessions: Readonly<Record<string, Session>>,
    parentSessionId: string | null,
): Session[] {
    if (!parentSessionId) {
        return noSideChats;
    }

    const result: Session[] = [];
    for (const session of Object.values(sessions)) {
        if (
            session.metadata?.isSideChat
            && session.metadata.parentSessionId === parentSessionId
            && session.metadata.lifecycleState !== 'archived'
        ) {
            result.push(session);
        }
    }

    if (result.length === 0) {
        return noSideChats;
    }

    result.sort((a, b) => a.createdAt - b.createdAt);
    return result;
}
