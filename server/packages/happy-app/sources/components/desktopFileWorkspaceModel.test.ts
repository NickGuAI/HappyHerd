import { describe, expect, it } from 'vitest';

import {
    closeDesktopFile,
    defaultDesktopFileWorkspaceWidth,
    DESKTOP_FILE_WORKSPACE_DIVIDER_WIDTH,
    DESKTOP_FILE_WORKSPACE_MAX_SHARE,
    desktopFileIdentity,
    EMPTY_DESKTOP_FILE_WORKSPACE,
    openDesktopFile,
    resolveDesktopFileWorkspaceWidth,
    selectDesktopFile,
} from './desktopFileWorkspaceModel';

describe('desktop file workspace state', () => {
    it('opens unique paths once and focuses a reopened path', () => {
        const reference = { machineId: 'machine-1', source: 'session' as const };
        const first = openDesktopFile(EMPTY_DESKTOP_FILE_WORKSPACE, '/work/a.ts', reference);
        const second = openDesktopFile(first, '/work/b.ts', reference);
        const reopened = openDesktopFile(second, '/work/a.ts', reference);

        expect(first.paths).toEqual([desktopFileIdentity('/work/a.ts', 'machine-1')]);
        expect(second.paths).toEqual([
            desktopFileIdentity('/work/a.ts', 'machine-1'),
            desktopFileIdentity('/work/b.ts', 'machine-1'),
        ]);
        expect(reopened.activePath).toBe(desktopFileIdentity('/work/a.ts', 'machine-1'));
    });

    it('deduplicates one machine path, upgrades session transport, and retains link position', () => {
        const reply = openDesktopFile(EMPTY_DESKTOP_FILE_WORKSPACE, '/work/a.ts', {
            machineId: 'machine-1', source: 'session', line: 14, column: 3,
        });
        const chat = openDesktopFile(reply, '/work/a.ts', { machineId: 'machine-1', source: 'session' });
        const machine = openDesktopFile(chat, '/work/a.ts', { machineId: 'machine-1', source: 'machine' });
        const identity = desktopFileIdentity('/work/a.ts', 'machine-1');

        expect(machine.paths).toEqual([identity]);
        expect(machine.references[identity]).toEqual({ machineId: 'machine-1', source: 'machine', line: 14, column: 3 });
    });

    it('does not downgrade an upgraded machine transport when Chat Workspace reopens the path', () => {
        const session = openDesktopFile(EMPTY_DESKTOP_FILE_WORKSPACE, '/outside/a.ts', {
            machineId: 'machine-1', source: 'session', line: 14, column: 3,
        });
        const machine = openDesktopFile(session, '/outside/a.ts', {
            machineId: 'machine-1', source: 'machine',
        });
        const chat = openDesktopFile(machine, '/outside/a.ts', {
            machineId: 'machine-1', source: 'session',
        });
        const identity = desktopFileIdentity('/outside/a.ts', 'machine-1');

        expect(chat.references[identity]).toEqual({
            machineId: 'machine-1', source: 'machine', line: 14, column: 3,
        });
    });

    it('replaces an existing location completely when a later link omits its column', () => {
        const first = openDesktopFile(EMPTY_DESKTOP_FILE_WORKSPACE, '/work/a.ts', {
            machineId: 'machine-1', source: 'session', line: 14, column: 3,
        });
        const reopened = openDesktopFile(first, '/work/a.ts', {
            machineId: 'machine-1', source: 'session', line: 27,
        });
        const identity = desktopFileIdentity('/work/a.ts', 'machine-1');

        expect(reopened.references[identity]).toEqual({ machineId: 'machine-1', source: 'session', line: 27 });
    });

    it('keeps identical paths on separate machines in distinct tabs', () => {
        const first = openDesktopFile(EMPTY_DESKTOP_FILE_WORKSPACE, '/work/a.ts', {
            machineId: 'machine-1', source: 'session',
        });
        const second = openDesktopFile(first, '/work/a.ts', {
            machineId: 'machine-2', source: 'machine',
        });

        expect(second.paths).toEqual([
            desktopFileIdentity('/work/a.ts', 'machine-1'),
            desktopFileIdentity('/work/a.ts', 'machine-2'),
        ]);
    });

    it('selects only paths already in the workspace', () => {
        const state = { paths: ['/work/a.ts', '/work/b.ts'], activePath: '/work/a.ts', references: {} };

        expect(selectDesktopFile(state, '/work/b.ts')).toEqual({
            paths: state.paths,
            activePath: '/work/b.ts',
            references: state.references,
        });
        expect(selectDesktopFile(state, '/work/missing.ts')).toBe(state);
    });

    it('preserves the active path when a background tab closes', () => {
        expect(closeDesktopFile({
            paths: ['/work/a.ts', '/work/b.ts', '/work/c.ts'],
            activePath: '/work/c.ts',
            references: {},
        }, '/work/a.ts')).toEqual({
            paths: ['/work/b.ts', '/work/c.ts'],
            activePath: '/work/c.ts',
            references: {},
        });
    });

    it('selects the previous tab, then the next tab, when the active tab closes', () => {
        expect(closeDesktopFile({
            paths: ['/work/a.ts', '/work/b.ts', '/work/c.ts'],
            activePath: '/work/b.ts',
            references: {},
        }, '/work/b.ts')).toEqual({
            paths: ['/work/a.ts', '/work/c.ts'],
            activePath: '/work/a.ts',
            references: {},
        });
        expect(closeDesktopFile({
            paths: ['/work/a.ts', '/work/b.ts'],
            activePath: '/work/a.ts',
            references: {},
        }, '/work/a.ts')).toEqual({
            paths: ['/work/b.ts'],
            activePath: '/work/b.ts',
            references: {},
        });
    });

    it('returns to an empty workspace after the last tab closes', () => {
        expect(closeDesktopFile({ paths: ['/work/a.ts'], activePath: '/work/a.ts', references: {} }, '/work/a.ts'))
            .toEqual(EMPTY_DESKTOP_FILE_WORKSPACE);
    });

    it('ignores close requests for paths that are not open', () => {
        const state = { paths: ['/work/a.ts'], activePath: '/work/a.ts', references: {} };
        expect(closeDesktopFile(state, '/work/missing.ts')).toBe(state);
    });
});

describe('desktop file workspace width', () => {
    it('clamps to its fixed minimum and 75 percent of the available pane width', () => {
        expect(resolveDesktopFileWorkspaceWidth(100, 1600)).toBe(360);
        expect(resolveDesktopFileWorkspaceWidth(1600, 1600)).toBe(1194);
    });

    it('leaves 25 percent of the available pane width for chat', () => {
        const availableWidth = 1040;
        const paneWidth = availableWidth - DESKTOP_FILE_WORKSPACE_DIVIDER_WIDTH;
        const workspaceWidth = resolveDesktopFileWorkspaceWidth(availableWidth, availableWidth);

        expect(workspaceWidth).toBe(paneWidth * DESKTOP_FILE_WORKSPACE_MAX_SHARE);
        expect(paneWidth - workspaceWidth).toBe(paneWidth * 0.25);
        expect(resolveDesktopFileWorkspaceWidth(800, 1000)).toBe(744);
        expect(resolveDesktopFileWorkspaceWidth(500, 700)).toBe(500);
    });

    it('defaults to 45 percent before applying the same bounds', () => {
        expect(defaultDesktopFileWorkspaceWidth(1000)).toBe(450);
        expect(defaultDesktopFileWorkspaceWidth(2000)).toBe(900);
        expect(defaultDesktopFileWorkspaceWidth(700)).toBe(360);
    });
});
