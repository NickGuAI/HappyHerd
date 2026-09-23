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
    if (!focus) return null;
    // Settings can arrive before the catalog; an unloaded name must not turn
    // the active Focus selection into an explicit No project choice.
    const project = projects[focus.projectId];
    return !project || project.kind === 'personal' ? focus.projectId : null;
}
