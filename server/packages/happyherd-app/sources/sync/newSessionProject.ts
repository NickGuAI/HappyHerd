import { getActiveFocusMode, type FocusMode } from './focusMode';
import type { Project } from './projectTypes';

/** Account grouping is independent of the agent's directory and workspace project. */
export function resolveNewSessionProjectId(
    selection: string | null | undefined,
    focusMode: FocusMode | null | undefined,
    projects: Readonly<Record<string, Pick<Project, 'kind'>>>,
    now = Date.now(),
): string | null {
    if (selection !== undefined) return selection;
    const focus = getActiveFocusMode(focusMode ?? null, now);
    return focus && projects[focus.projectId]?.kind === 'personal' ? focus.projectId : null;
}
