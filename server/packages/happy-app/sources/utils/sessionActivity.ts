import type { Session } from '@/sync/storageTypes';

/**
 * The timestamp the session list sorts on.
 *
 * Prefers `metadata.lastMeaningfulMessageAt`, which the agent publishes and
 * every device therefore agrees on. Agents that do not write it yet fall back
 * to `lastMessageSentAt` — this device's own record of the last message it
 * sent — and finally to creation, so a session always has an ordering key.
 *
 * Kept apart from sessionUtils, which reaches for React and the translation
 * table; this is plain arithmetic over stored fields.
 */
export function getSessionActivityAt(session: Session): number {
    return session.metadata?.lastMeaningfulMessageAt
        ?? session.lastMessageSentAt
        ?? session.createdAt;
}

/**
 * Stable ordering for session data before it is projected into display rows.
 * `seq` is the persisted server update sequence and therefore gives every
 * client the same answer when two activity timestamps are equal.
 */
export function compareSessionsByActivity(a: Session, b: Session): number {
    return getSessionActivityAt(b) - getSessionActivityAt(a)
        || b.seq - a.seq
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
