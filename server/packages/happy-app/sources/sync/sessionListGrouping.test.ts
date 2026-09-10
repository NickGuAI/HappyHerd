import { describe, expect, it } from 'vitest';
import { buildPersonalSessionGroups, buildSessionWorkspaceGroups } from './projectGroups';
import type { Project } from './projectTypes';
import type { SessionRowData } from './storage';
import type { Session } from './storageTypes';

function session(id: string, machineId: string, path: string, projectId: string | null = null): Session {
    return {
        id, projectId, seq: 1, createdAt: 1, updatedAt: 1,
        active: true, activeAt: 1, metadataVersion: 1,
        metadata: { machineId, path, host: machineId },
        agentState: null, agentStateVersion: 1, thinking: false, thinkingAt: 0, presence: 'online',
    };
}

function row(value: Session): SessionRowData {
    return {
        id: value.id, active: value.active, hasUnread: true,
        machineId: value.metadata?.machineId ?? null,
        projectId: value.projectId ?? value.metadata?.project?.id ?? null,
        lastActivityAt: 50, updateSequence: 3,
    } as SessionRowData;
}

function project(id: string, name: string, kind: Project['kind'] = 'personal'): Project {
    return { id, name, kind, externalId: id, metadataVersion: 1, avatar: null, createdAt: 1, updatedAt: 1 };
}

describe('session list grouping views', () => {
    it('groups workspaces by machine and path independently of personal assignments', () => {
        const sessions = [
            session('newest', 'machine-a', '/work/shared', 'launch'),
            session('other-project', 'machine-a', '/work/shared', 'research'),
            session('other-machine', 'machine-b', '/work/shared', 'launch'),
            session('other-path', 'machine-a', '/work/elsewhere', 'launch'),
        ];
        const rows = sessions.map(row);
        const before = structuredClone(sessions);
        const groups = buildSessionWorkspaceGroups(rows, sessions);

        expect(groups.map(({ project }) => [project.machineId, project.name, project.sessionCount])).toEqual([
            ['machine-a', 'shared', 2], ['machine-b', 'shared', 1], ['machine-a', 'elsewhere', 1],
        ]);
        expect(groups[0].project.workspaces[0].sessions).toEqual([rows[0], rows[1]]);
        expect(groups[0].project.workspaces[0].sessions[0]).toBe(rows[0]);
        expect(sessions).toEqual(before);
        expect(rows[0].projectId).toBe('launch');
    });

    it('retains Rig project/worktree identities and separates the same project on two machines', () => {
        const rig = (id: string, machineId: string, workspaceId?: string) => {
            const value = session(id, machineId, '/rig/repo', 'launch');
            value.metadata = {
                ...value.metadata!, client: { id: 'rig', name: 'Rig', version: 'test' },
                project: { id: 'rig-repo', name: 'Native repository', kind: 'regular' },
                ...(workspaceId ? { workspace: { id: workspaceId, name: 'Feature tree', kind: 'git_worktree' as const } } : {}),
            };
            return value;
        };
        const sessions = [rig('feature', 'machine-a', 'tree'), rig('primary', 'machine-a'), rig('remote', 'machine-b')];
        const rows = sessions.map(row);
        const groups = buildSessionWorkspaceGroups(rows, sessions);

        expect(groups.map(({ source, project }) => [source, project.id, project.machineId])).toEqual([
            ['rig', 'rig-repo', 'machine-a'], ['rig', 'rig-repo', 'machine-b'],
        ]);
        expect(groups[0].project.workspaces.map(value => [value.id, value.sessions.map(value => value.id)])).toEqual([
            ['', ['primary']], ['tree', ['feature']],
        ]);
        expect(groups[0].project.workspaces[1].sessions[0]).toBe(rows[0]);
        expect(rows[0].projectId).toBe('launch');
    });

    it('groups named projects across machines by their IDs, with unmatched assignments last', () => {
        const sessions = [
            session('unassigned', 'machine-a', '/work/shared'),
            session('one', 'machine-a', '/work/shared', 'launch'),
            session('two', 'machine-b', '/other/path', 'launch'),
            session('same-name', 'machine-a', '/work/shared', 'research'),
            session('missing', 'machine-a', '/work/shared', 'not-loaded'),
            session('repository', 'machine-a', '/work/shared', 'repository'),
        ];
        sessions[0].metadata!.project = { id: 'launch', name: 'Rig descriptor', kind: 'regular' };
        const rows = sessions.map(row);
        const projects = {
            launch: project('launch', 'Same name'), research: project('research', 'Same name'),
            repository: project('repository', 'Repository', 'repository'), empty: project('empty', 'Empty'),
        };
        const groups = buildPersonalSessionGroups(rows, sessions, projects);

        expect(groups.map(value => [value.projectId, value.name, value.sessions.map(value => value.id)])).toEqual([
            ['launch', 'Same name', ['one', 'two']],
            ['research', 'Same name', ['same-name']],
            [null, null, ['unassigned', 'missing', 'repository']],
        ]);
        expect(groups[0].sessions[0]).toBe(rows[1]);
        expect(rows[0].projectId).toBe('launch');
        expect(sessions[4].projectId).toBe('not-loaded');
        expect(buildPersonalSessionGroups([], sessions, projects)).toEqual([]);
    });

    it('projects only visible rows and reflects catalog rename or late hydration without assignment writes', () => {
        const sessions = [session('visible', 'machine-a', '/work', 'launch'), session('filtered', 'machine-a', '/work', 'launch')];
        const rows = [row(sessions[0])];
        expect(buildPersonalSessionGroups(rows, sessions, {})[0]).toMatchObject({ projectId: null, sessions: rows });
        const loaded = { launch: project('launch', 'New name') };
        expect(buildPersonalSessionGroups(rows, sessions, loaded)).toEqual([{ projectId: 'launch', name: 'New name', sessions: rows }]);
        expect(buildSessionWorkspaceGroups(rows, sessions)[0].project.sessionCount).toBe(1);
        expect(sessions.map(value => value.projectId)).toEqual(['launch', 'launch']);
    });
});
