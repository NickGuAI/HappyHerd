import type { SessionListViewItem, SessionRowData } from '@/sync/storage';
import { buildFlatSessionRows, compareFlatSessionRows, toFlatSessionRow } from './flatSessionList';

type SessionProjectListItem = Extract<SessionListViewItem, { type: 'project' }>;

export interface SessionDisplayMachine {
    id: string;
    metadata?: {
        displayName?: string | null;
        host?: string | null;
    } | null;
}

export interface ActiveSessionDisplayProject {
    displayPath: string;
    sessions: SessionRowData[];
}

export interface ActiveSessionDisplayMachineGroup {
    machineId: string;
    machineName: string;
    projects: Map<string, ActiveSessionDisplayProject>;
}

export interface SessionProjectDisplayMachineGroup {
    machineId: string | null;
    machineName: string;
    projects: SessionProjectListItem[];
}

export interface ExactDaemonDisplayIdentity {
    /** Human label published by this exact daemon registration. */
    label: string;
    /** Collision-safe prefix of the exact registration ID. */
    shortId: string;
}

/**
 * Builds display identity without ever resolving through a host, path, or
 * sibling registration. Equal paths on different daemons therefore remain
 * visibly distinct choices.
 */
export function buildExactDaemonDisplayIdentities(
    machineIds: readonly string[],
    machines: readonly SessionDisplayMachine[],
): ReadonlyMap<string, ExactDaemonDisplayIdentity> {
    const ids = Array.from(new Set(machineIds.filter(Boolean)));
    const machinesById = new Map(machines.map((machine) => [machine.id, machine]));
    const identities = new Map<string, ExactDaemonDisplayIdentity>();

    for (const id of ids) {
        let length = Math.min(8, id.length);
        while (
            length < id.length
            && ids.some((other) => other !== id && other.startsWith(id.slice(0, length)))
        ) {
            length += 1;
        }

        const machine = machinesById.get(id);
        identities.set(id, {
            label: machine?.metadata?.displayName || machine?.metadata?.host || id,
            shortId: id.slice(0, length),
        });
    }

    return identities;
}

export function formatSessionDisplayPath(path: string, homeDir?: string): string {
    if (!homeDir) {
        return path;
    }
    const normalizedHome = homeDir.endsWith('/') ? homeDir.slice(0, -1) : homeDir;
    if (!path.startsWith(normalizedHome)) {
        return path;
    }
    const relativePath = path.slice(normalizedHome.length);
    if (relativePath.startsWith('/')) {
        return `~${relativePath}`;
    }
    return relativePath === '' ? '~' : `~/${relativePath}`;
}

export function buildActiveSessionDisplayGroups(
    sessions: readonly SessionRowData[],
    machines: readonly SessionDisplayMachine[],
    unknownText: string,
): ActiveSessionDisplayMachineGroup[] {
    const machinesMap = new Map(machines.map((machine) => [machine.id, machine]));
    const byMachine = new Map<string, ActiveSessionDisplayMachineGroup>();

    sessions.forEach((session) => {
        const machineId = session.machineId || unknownText;
        const machine = machineId !== unknownText ? machinesMap.get(machineId) : null;
        const machineName = machine?.metadata?.displayName
            || machine?.metadata?.host
            || (machineId !== unknownText ? machineId : `<${unknownText}>`);

        let machineGroup = byMachine.get(machineId);
        if (!machineGroup) {
            machineGroup = { machineId, machineName, projects: new Map() };
            byMachine.set(machineId, machineGroup);
        }

        const projectPath = session.path || '';
        let projectGroup = machineGroup.projects.get(projectPath);
        if (!projectGroup) {
            projectGroup = {
                displayPath: formatSessionDisplayPath(projectPath, session.homeDir ?? undefined),
                sessions: [],
            };
            machineGroup.projects.set(projectPath, projectGroup);
        }
        projectGroup.sessions.push(session);
    });

    byMachine.forEach((machineGroup) => {
        machineGroup.projects.forEach((projectGroup) => {
            projectGroup.sessions.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        });
    });

    return Array.from(byMachine.values()).sort((a, b) => (
        Number(a.machineId === unknownText) - Number(b.machineId === unknownText)
        || a.machineName.localeCompare(b.machineName)
    ));
}

/**
 * Restores the home list's original top-level hierarchy: machine first, then
 * projects, with worktrees and sessions kept inside each project.
 */
export function buildSessionProjectDisplayGroups(
    data: readonly SessionListViewItem[],
    machines: readonly SessionDisplayMachine[],
    unknownText: string,
): SessionProjectDisplayMachineGroup[] {
    const machinesMap = new Map(machines.map((machine) => [machine.id, machine]));
    const byMachine = new Map<string | null, SessionProjectDisplayMachineGroup>();

    data.forEach((item) => {
        if (item.type !== 'project') return;

        const machineId = item.project.machineId;
        const machine = machineId ? machinesMap.get(machineId) : null;
        const machineName = machine?.metadata?.displayName
            || machine?.metadata?.host
            || (machineId ?? `<${unknownText}>`);
        let group = byMachine.get(machineId);
        if (!group) {
            group = { machineId, machineName, projects: [] };
            byMachine.set(machineId, group);
        }
        group.projects.push(item);
    });

    byMachine.forEach((group) => {
        group.projects.sort((a, b) => (
            a.project.name.localeCompare(b.project.name)
            || a.project.id.localeCompare(b.project.id)
        ));
    });

    return Array.from(byMachine.values()).sort((a, b) => (
        Number(a.machineId === null) - Number(b.machineId === null)
        || a.machineName.localeCompare(b.machineName)
    ));
}

export function getSessionShortcutIdsInDisplayOrder(
    data: readonly SessionListViewItem[] | null,
    _machines: readonly SessionDisplayMachine[],
    _unknownText: string,
): string[] {
    if (!data) {
        return [];
    }

    const primary = buildFlatSessionRows(data);
    const archived = data
        .filter((item): item is Extract<SessionListViewItem, { type: 'session' }> => item.type === 'session')
        .map((item) => toFlatSessionRow(item.session))
        .sort(compareFlatSessionRows);

    return [...primary, ...archived]
        .map((row) => row.session.id)
        .slice(0, 9);
}
