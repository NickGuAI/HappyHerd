import { describe, expect, it } from 'vitest';
import type { SessionListViewItem, SessionRowData } from '@/sync/storage';
import { buildProjectSessionList } from './projectSessionList';

function session(id: string, overrides: Partial<SessionRowData> = {}): SessionRowData {
    return {
        id, name: id, subtitle: '', avatarId: id, flavor: null, clientId: null,
        identityLine: null, providerKind: null, modelName: null, activitySummary: null,
        gitChangedFiles: null, gitCountsExact: true, gitDeletions: null, gitInsertions: null,
        state: 'waiting', createdAt: 0, lastActivityAt: 0, updateSequence: 0,
        hasDraft: false, active: true, archived: false, machineId: 'machine-a',
        daemonLabel: 'Machine', daemonShortId: 'machine-a', commanderId: null,
        commanderName: null, machineOffline: false, botId: null, botUsername: null,
        machineName: null, path: '/work/shared', homeDir: null, completedTodosCount: 0,
        totalTodosCount: 0, hasUnread: false, projectId: 'project-a', projectName: 'Launch',
        workspaceId: null, workspaceName: null, ...overrides,
    };
}

function group(sessions: SessionRowData[]): SessionListViewItem {
    return {
        type: 'project', source: 'personal',
        project: {
            id: 'project-a', name: 'Launch', machineId: null,
            sessionCount: sessions.length, activeCount: sessions.length,
            workspaces: [{ id: '', name: null, sessions }],
        },
    };
}

describe('buildProjectSessionList', () => {
    it('includes assigned sessions from every row shape and pins the assigned Super Session once', () => {
        const ordinary = session('ordinary', { lastActivityAt: 30 });
        const pinned = session('assistant', { commanderId: 'commander', lastActivityAt: 1 });
        const data: SessionListViewItem[] = [
            group([ordinary, pinned]),
            { type: 'active-sessions', sessions: [ordinary, session('active', { lastActivityAt: 20 })] },
            { type: 'super-session', session: pinned },
            { type: 'bots', sessions: [session('bot', { botId: 'bot-id', lastActivityAt: 40 })] },
            { type: 'header', title: 'Yesterday' },
            { type: 'session', session: session('archive', { archived: true, lastActivityAt: 50 }) },
        ];

        const result = buildProjectSessionList(data, 'project-a');

        expect(result.sessions.map((row) => row.session.id)).toEqual(['assistant', 'bot', 'ordinary', 'active']);
        expect(result.archivedSessions.map((row) => row.session.id)).toEqual(['archive']);
        expect(result.superSessionId).toBe('assistant');
        expect(result.sessions.find((row) => row.session.id === 'bot')?.session.botId).toBe('bot-id');
    });

    it('matches exact project IDs across machines and ignores equal names, paths and surrounding group IDs', () => {
        const result = buildProjectSessionList([
            group([
                session('machine-a'),
                session('machine-b', { machineId: 'machine-b', path: '/elsewhere', machineOffline: true }),
                session('same-name-other-project', { projectId: 'project-b' }),
                session('unassigned', { projectId: null }),
            ]),
            { type: 'super-session', session: session('other-assistant', { projectId: 'project-b' }) },
            { type: 'session', session: session('other-archive', { projectId: 'project-b', archived: true }) },
        ], 'project-a');

        expect(result.sessions.map((row) => row.session.id)).toEqual(['machine-a', 'machine-b']);
        expect(result.archivedSessions).toEqual([]);
        expect(result.superSessionId).toBeNull();
    });

    it('separates actual archives while keeping disconnected ordinary work visible', () => {
        const result = buildProjectSessionList([
            group([session('offline', { active: false, machineOffline: true, state: 'disconnected' })]),
            { type: 'session', session: session('older-archive', { archived: true, lastActivityAt: 10 }) },
            { type: 'session', session: session('newer-archive', { archived: true, lastActivityAt: 20 }) },
        ], 'project-a');

        expect(result.sessions.map((row) => row.session.id)).toEqual(['offline']);
        expect(result.archivedSessions.map((row) => row.session.id)).toEqual(['newer-archive', 'older-archive']);
    });

    it('orders normal rows by meaningful activity, update sequence and stable ID without mutating the source', () => {
        const rows = [
            session('z', { lastActivityAt: 10, updateSequence: 2 }),
            session('a', { lastActivityAt: 10, updateSequence: 2 }),
            session('sequence', { lastActivityAt: 10, updateSequence: 3 }),
            session('activity', { lastActivityAt: 20, updateSequence: 1 }),
        ];
        const data = [group(rows)];
        const before = JSON.stringify(data);

        expect(buildProjectSessionList(data, 'project-a').sessions.map((row) => row.session.id))
            .toEqual(['activity', 'sequence', 'a', 'z']);
        expect(JSON.stringify(data)).toBe(before);
    });

    it('retains membership after rename and follows reassignment in the next synced projection', () => {
        const original = session('move-me');
        expect(buildProjectSessionList([group([original])], 'project-a').sessions).toHaveLength(1);
        const renamed = { ...original, projectName: 'Renamed' };
        expect(buildProjectSessionList([group([renamed])], 'project-a').sessions[0].session.id).toBe('move-me');
        const reassigned = { ...renamed, projectId: 'project-b' };
        const data: SessionListViewItem[] = [{ type: 'active-sessions', sessions: [reassigned] }];

        expect(buildProjectSessionList(data, 'project-a').sessions).toEqual([]);
        expect(buildProjectSessionList(data, 'project-b').sessions[0].session.id).toBe('move-me');
    });

    it('distinguishes an archive-only project from an empty project', () => {
        const data: SessionListViewItem[] = [
            { type: 'session', session: session('archive', { archived: true }) },
        ];
        const archived = buildProjectSessionList(data, 'project-a');
        expect(archived.sessions).toEqual([]);
        expect(archived.archivedSessions).toHaveLength(1);
        expect(buildProjectSessionList(data, 'empty-project')).toEqual({
            sessions: [], archivedSessions: [], superSessionId: null,
        });
        expect(buildProjectSessionList([], 'project-a')).toEqual({
            sessions: [], archivedSessions: [], superSessionId: null,
        });
    });
});
