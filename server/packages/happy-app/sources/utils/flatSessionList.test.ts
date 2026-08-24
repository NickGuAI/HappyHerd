import { describe, expect, it } from 'vitest';
import { buildFlatSessionRows, sessionMatchesFlatListSearch } from './flatSessionList';
import type { SessionListViewItem, SessionRowData } from '@/sync/storage';

function row(overrides: Partial<SessionRowData> & { id: string }): SessionRowData {
    return {
        name: overrides.id,
        subtitle: '',
        avatarId: overrides.id,
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
        createdAt: 0,
        lastActivityAt: 0,
        updateSequence: 0,
        hasDraft: false,
        active: true,
        archived: false,
        machineId: 'machine',
        daemonLabel: 'Machine',
        daemonShortId: 'machine',
        commanderId: null,
        commanderName: null,
        machineOffline: false,
        path: null,
        homeDir: null,
        completedTodosCount: 0,
        totalTodosCount: 0,
        hasUnread: false,
        projectId: null,
        projectName: null,
        workspaceId: null,
        workspaceName: null,
        ...overrides,
    };
}

function project(
    name: string,
    workspaces: { id: string; name: string | null; sessions: SessionRowData[] }[],
): SessionListViewItem {
    return {
        type: 'project',
        source: 'happy',
        project: {
            id: name,
            name,
            machineId: 'machine',
            workspaces,
            sessionCount: workspaces.reduce((total, w) => total + w.sessions.length, 0),
            activeCount: 0,
        },
    };
}

describe('buildFlatSessionRows', () => {
    it('names the project and worktree each session belongs to', () => {
        const rows = buildFlatSessionRows([
            project('happy', [
                { id: '', name: null, sessions: [row({ id: 'primary' })] },
                { id: '/wt/innsbruck', name: 'innsbruck', sessions: [row({ id: 'worktree' })] },
            ]),
        ]);

        expect(rows.map((r) => [r.session.id, r.projectName, r.workspaceName])).toEqual([
            ['primary', 'happy', null],
            ['worktree', 'happy', 'innsbruck'],
        ]);
    });

    it('renders a compatibility Active row only once and keeps project identity', () => {
        const duplicate = row({ id: 'same-session', path: '/fallback/path' });
        const rows = buildFlatSessionRows([
            { type: 'active-sessions', sessions: [duplicate] },
            project('native-project', [{ id: 'native-worktree', name: 'feature', sessions: [duplicate] }]),
        ]);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            projectName: 'native-project',
            workspaceName: 'feature',
        });
    });

    it('falls back to the worktree path when the group has no name', () => {
        const rows = buildFlatSessionRows([
            project('happy', [{ id: '/wt/innsbruck', name: null, sessions: [row({ id: 'a' })] }]),
        ]);

        expect(rows[0].workspaceName).toBe('/wt/innsbruck');
    });

    it('restores global recency across projects without a connectivity partition', () => {
        const rows = buildFlatSessionRows([
            project('alpha', [{
                id: '',
                name: null,
                sessions: [
                    row({ id: 'alpha-new', lastActivityAt: 300 }),
                    row({ id: 'alpha-old', lastActivityAt: 100 }),
                ],
            }]),
            project('beta', [{
                id: '',
                name: null,
                sessions: [
                    row({ id: 'beta-mid', lastActivityAt: 200 }),
                    row({ id: 'beta-dead', lastActivityAt: 400, active: false }),
                ],
            }]),
        ]);

        expect(rows.map((r) => r.session.id)).toEqual([
            'beta-dead',
            'alpha-new',
            'beta-mid',
            'alpha-old',
        ]);
    });

    it('breaks activity ties by update sequence and then stable session id', () => {
        const rows = buildFlatSessionRows([
            project('alpha', [{
                id: '',
                name: null,
                sessions: [
                    row({ id: 'z-stable', lastActivityAt: 900, updateSequence: 4 }),
                    row({ id: 'a-stable', lastActivityAt: 900, updateSequence: 4 }),
                    row({ id: 'newer-update', lastActivityAt: 900, updateSequence: 5 }),
                ],
            }]),
        ]);

        expect(rows.map((r) => r.session.id)).toEqual([
            'newer-update',
            'a-stable',
            'z-stable',
        ]);
    });

    it('ignores archived rows and headings, which stay a separate tail', () => {
        const rows = buildFlatSessionRows([
            { type: 'header', title: 'Today' },
            { type: 'session', session: row({ id: 'archived', archived: true }) },
            { type: 'projects-header', source: 'happy' },
            project('alpha', [{ id: '', name: null, sessions: [row({ id: 'live' })] }]),
        ]);

        expect(rows.map((r) => r.session.id)).toEqual(['live']);
    });
});

describe('sessionMatchesFlatListSearch', () => {
    const searchable = row({
        id: 'session-id',
        name: 'Planning',
        subtitle: 'Waiting on Nick',
        path: '/srv/HappyHerd',
        machineId: 'daemon-a1b2c3d4',
        flavor: 'codex',
        projectName: 'Not searchable project',
        workspaceName: 'not-searchable-worktree',
    });

    it.each([
        'planning',
        'waiting on',
        '/srv/happyherd',
        'a1b2c3',
        'codex',
    ])('matches the retained search field %s', (query) => {
        expect(sessionMatchesFlatListSearch(searchable, query)).toBe(true);
    });

    it('does not expand search into project or worktree filters', () => {
        expect(sessionMatchesFlatListSearch(searchable, 'not searchable')).toBe(false);
        expect(sessionMatchesFlatListSearch(searchable, 'not-searchable')).toBe(false);
    });
});
