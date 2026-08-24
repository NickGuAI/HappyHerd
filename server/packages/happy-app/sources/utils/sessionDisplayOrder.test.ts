import { describe, expect, it } from 'vitest';
import type { SessionListViewItem, SessionRowData } from '@/sync/storage';
import {
    buildActiveSessionDisplayGroups,
    buildExactDaemonDisplayIdentities,
    buildSessionProjectDisplayGroups,
    getSessionShortcutIdsInDisplayOrder,
} from './sessionDisplayOrder';

function session(
    id: string,
    machineId: string,
    path: string,
    createdAt = 0,
): SessionRowData {
    return {
        id,
        name: id,
        subtitle: '',
        avatarId: id,
        flavor: null,
        clientId: null,
        identityLine: null,
        providerKind: null,
        modelName: null,
        activitySummary: null,
        gitChangedFiles: null,
        gitCountsExact: true,
        gitDeletions: null,
        gitInsertions: null,
        state: 'waiting',
        createdAt,
        lastActivityAt: createdAt,
        updateSequence: 0,
        hasDraft: false,
        active: true,
        archived: false,
        machineId,
        daemonLabel: machineId,
        daemonShortId: machineId.slice(0, 8),
        commanderId: null,
        commanderName: null,
        machineOffline: false,
        path,
        homeDir: null,
        completedTodosCount: 0,
        totalTodosCount: 0,
        hasUnread: false,
        projectId: null,
        projectName: null,
        workspaceId: null,
        workspaceName: null,
    };
}

const machines = [
    { id: 'machine-z', metadata: { displayName: 'Zulu' } },
    { id: 'machine-a', metadata: { displayName: 'Alpha' } },
];

describe('session display order', () => {
    it('keeps the exact daemon label and extends colliding short IDs until unique', () => {
        const identities = buildExactDaemonDisplayIdentities([
            'daemon-123456-alpha',
            'daemon-123456-beta',
            'orphan-9',
        ], [
            { id: 'daemon-123456-alpha', metadata: { displayName: 'Mac mini' } },
            { id: 'daemon-123456-beta', metadata: { host: 'athena.internal' } },
        ]);

        expect(identities.get('daemon-123456-alpha')).toEqual({
            label: 'Mac mini',
            shortId: 'daemon-123456-a',
        });
        expect(identities.get('daemon-123456-beta')).toEqual({
            label: 'athena.internal',
            shortId: 'daemon-123456-b',
        });
        expect(identities.get('orphan-9')).toEqual({
            label: 'orphan-9',
            shortId: 'orphan-9',
        });
    });

    it('matches the sidebar machine, project, and session ordering', () => {
        const groups = buildActiveSessionDisplayGroups([
            session('zulu', 'machine-z', '/project-b'),
            session('alpha-new', 'machine-a', '/project-z', 20),
            session('alpha-old', 'machine-a', '/project-z', 10),
            session('alpha-first-project', 'machine-a', '/project-a'),
        ], machines, 'Unknown');

        expect(groups.map((group) => group.machineName)).toEqual(['Alpha', 'Zulu']);
        expect(Array.from(groups[0].projects.values())
            .sort((a, b) => a.displayPath.localeCompare(b.displayPath))
            .flatMap((project) => project.sessions.map((item) => item.id)))
            .toEqual(['alpha-first-project', 'alpha-new', 'alpha-old']);
    });

    it('numbers the first nine session rows from top to bottom', () => {
        const activeSessions = [
            session('zulu-recent', 'machine-z', '/project', 20),
            session('alpha-old', 'machine-a', '/project', 10),
        ];
        const inactiveSessions = Array.from({ length: 9 }, (_, index) => ({
            type: 'session' as const,
            session: session(`inactive-${index}`, 'machine-z', '/project'),
        }));
        const data: SessionListViewItem[] = [
            { type: 'active-sessions', sessions: activeSessions },
            ...inactiveSessions,
        ];

        expect(getSessionShortcutIdsInDisplayOrder(data, machines, 'Unknown')).toEqual([
            'zulu-recent',
            'alpha-old',
            'inactive-0',
            'inactive-1',
            'inactive-2',
            'inactive-3',
            'inactive-4',
            'inactive-5',
            'inactive-6',
        ]);
    });

    it('numbers sessions nested in the shared project-card layout', () => {
        const data: SessionListViewItem[] = [
            { type: 'projects-header', source: 'rig' },
            {
                type: 'project',
                source: 'rig',
                project: {
                    id: 'rig-project',
                    name: 'rig',
                    machineId: 'machine-a',
                    activeCount: 1,
                    sessionCount: 1,
                    workspaces: [{
                        id: '',
                        name: null,
                        sessions: [session('rig-session', 'machine-a', '/rig')],
                    }],
                },
            },
            { type: 'projects-header', source: 'happy' },
            {
                type: 'project',
                source: 'happy',
                project: {
                    id: 'happy-project',
                    name: 'happy',
                    machineId: 'machine-a',
                    activeCount: 1,
                    sessionCount: 1,
                    workspaces: [{
                        id: '',
                        name: null,
                        sessions: [session('happy-session', 'machine-a', '/happy')],
                    }],
                },
            },
        ];

        expect(getSessionShortcutIdsInDisplayOrder(data, machines, 'Unknown')).toEqual([
            'happy-session',
            'rig-session',
        ]);
    });

    it('groups project cards by machine and sorts projects within each machine', () => {
        const data: SessionListViewItem[] = [
            {
                type: 'project',
                source: 'happy',
                project: {
                    id: 'z-project',
                    name: 'Zulu project',
                    machineId: 'machine-a',
                    activeCount: 1,
                    sessionCount: 1,
                    workspaces: [{ id: '', name: null, sessions: [session('z', 'machine-a', '/z')] }],
                },
            },
            {
                type: 'project',
                source: 'happy',
                project: {
                    id: 'a-project',
                    name: 'Alpha project',
                    machineId: 'machine-a',
                    activeCount: 1,
                    sessionCount: 1,
                    workspaces: [{ id: '', name: null, sessions: [session('a', 'machine-a', '/a')] }],
                },
            },
            {
                type: 'project',
                source: 'happy',
                project: {
                    id: 'other-machine',
                    name: 'Other project',
                    machineId: 'machine-z',
                    activeCount: 1,
                    sessionCount: 1,
                    workspaces: [{ id: '', name: null, sessions: [session('other', 'machine-z', '/other')] }],
                },
            },
            {
                type: 'project',
                source: 'happy',
                project: {
                    id: 'unknown-machine',
                    name: 'Unknown project',
                    machineId: null,
                    activeCount: 1,
                    sessionCount: 1,
                    workspaces: [{ id: '', name: null, sessions: [session('unknown', '', '/unknown')] }],
                },
            },
        ];

        const groups = buildSessionProjectDisplayGroups(data, machines, 'Unknown');

        expect(groups.map(group => group.machineName)).toEqual(['Alpha', 'Zulu', '<Unknown>']);
        expect(groups[0].projects.map(item => item.project.name)).toEqual([
            'Alpha project',
            'Zulu project',
        ]);
    });
});
