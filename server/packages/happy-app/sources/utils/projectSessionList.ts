import type { SessionListViewItem } from '@/sync/storage';
import { buildFlatSessionRows, compareFlatSessionRows, toFlatSessionRow, type FlatSessionRowData } from './flatSessionList';

export interface ProjectSessionList {
    sessions: FlatSessionRowData[];
    archivedSessions: FlatSessionRowData[];
    superSessionId: string | null;
}

/** Reads every top-level row shape, independent of Home grouping or archive visibility. */
export function buildProjectSessionList(
    data: readonly SessionListViewItem[],
    projectId: string,
): ProjectSessionList {
    const rows = new Map(buildFlatSessionRows(data).map((row) => [row.session.id, row]));
    let superSessionId: string | null = null;
    for (const item of data) {
        if (item.type !== 'super-session' && item.type !== 'session') continue;
        rows.set(item.session.id, toFlatSessionRow(item.session));
        if (item.type === 'super-session' && item.session.projectId === projectId) {
            superSessionId = item.session.id;
        }
    }

    const assigned = Array.from(rows.values())
        .filter((row) => row.session.projectId === projectId)
        .sort(compareFlatSessionRows);
    const sessions = assigned.filter((row) => row.session.id === superSessionId || !row.session.archived);
    const superIndex = sessions.findIndex((row) => row.session.id === superSessionId);
    if (superIndex > 0) sessions.unshift(...sessions.splice(superIndex, 1));

    return {
        sessions,
        archivedSessions: assigned.filter((row) => row.session.id !== superSessionId && row.session.archived),
        superSessionId,
    };
}
