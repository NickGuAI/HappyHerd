import type { Session } from './storageTypes';

/**
 * Select one stable pinned entry if malformed data contains multiple markers.
 * Creation time and id are immutable, so activity cannot change the winner.
 */
export function selectSuperSession<T extends Pick<Session, 'id' | 'createdAt' | 'metadata'>>(
    sessions: readonly T[],
): T | null {
    let selected: T | null = null;
    for (const session of sessions) {
        if (session.metadata?.isSuperSession !== true) continue;
        if (!selected
            || session.createdAt < selected.createdAt
            || (session.createdAt === selected.createdAt && session.id < selected.id)) {
            selected = session;
        }
    }
    return selected;
}
