import type { SessionListViewItem, SessionRowData } from '@/sync/storage';
import { getRepoPath, getWorktreeName, isWorktreePath } from '@/utils/worktreePaths';

/**
 * One session as the flat home list shows it: the session's own title, and the
 * project/worktree it belongs to spelled out on the row instead of being
 * implied by a card it sits inside.
 */
export interface FlatSessionRowData {
    session: SessionRowData;
    projectName: string;
    /** Null in a project's primary checkout, which needs no second name. */
    workspaceName: string | null;
}

/**
 * The five fields the existing Home search owns. Project/worktree labels are
 * deliberately absent: D4 keeps search as a small free-text affordance rather
 * than turning the flat inbox into a second filtering product.
 */
export function sessionMatchesFlatListSearch(
    session: SessionRowData,
    normalizedQuery: string,
): boolean {
    return [
        session.name,
        session.subtitle,
        session.path,
        session.machineId,
        session.flavor,
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
}

/**
 * Deterministic inbox order: visible user activity first, then the server's
 * monotonically increasing session update sequence, then the stable session
 * identifier. Connectivity is presentation state, not a competing sort mode.
 */
export function compareFlatSessionRows(
    a: FlatSessionRowData,
    b: FlatSessionRowData,
): number {
    return b.session.lastActivityAt - a.session.lastActivityAt
        || b.session.updateSequence - a.session.updateSequence
        || (a.session.id < b.session.id ? -1 : a.session.id > b.session.id ? 1 : 0);
}

/**
 * Flattens the project cards into one chronological list.
 *
 * Grouping by project is what loses the global ordering: sessions are sorted
 * once, then dealt into projects, so a project's older sessions end up directly
 * under its newest one. The flat list wants what the user last touched at the
 * top regardless of project, so it re-sorts the rows here.
 *
 * Archived rows (`type: 'session'`) and the headings above them are left alone
 * — they are already a flat, date-grouped tail that the caller appends.
 */
export function buildFlatSessionRows(
    items: readonly SessionListViewItem[],
): FlatSessionRowData[] {
    const rowsBySessionId = new Map<string, FlatSessionRowData>();

    for (const item of items) {
        if (item.type === 'active-sessions') {
            for (const session of item.sessions) {
                if (!rowsBySessionId.has(session.id)) {
                    rowsBySessionId.set(session.id, toFlatSessionRow(session));
                }
            }
            continue;
        }
        if (item.type !== 'project') continue;
        for (const workspace of item.project.workspaces) {
            for (const session of workspace.sessions) {
                // A compatibility payload can still contain the former
                // compact Active block as well as its project row. The
                // project projection wins because it carries native project
                // and worktree labels, but the session renders only once.
                rowsBySessionId.set(session.id, {
                    session,
                    projectName: item.project.name,
                    workspaceName: workspace.name ?? (workspace.id || null),
                });
            }
        }
    }

    return Array.from(rowsBySessionId.values()).sort(compareFlatSessionRows);
}

/**
 * Places a session that reached the list without a project card around it —
 * an archived row, or one of the active-sessions rows — using the same rule the
 * card grouping uses: a worktree names its repository as the project and itself
 * as the workspace.
 */
export function toFlatSessionRow(session: SessionRowData): FlatSessionRowData {
    const path = session.path?.trim() || '';
    const worktree = isWorktreePath(path);
    const projectPath = worktree ? getRepoPath(path) : path;
    return {
        session,
        projectName: session.projectName
            ?? projectPath.split(/[\\/]/).filter(Boolean).at(-1)
            ?? '',
        workspaceName: session.workspaceName ?? (worktree ? getWorktreeName(path) : null),
    };
}
