import { describe, expect, it } from 'vitest';

import {
    closeDesktopFile,
    defaultDesktopFileWorkspaceWidth,
    EMPTY_DESKTOP_FILE_WORKSPACE,
    openDesktopFile,
    resolveDesktopFileWorkspaceWidth,
    selectDesktopFile,
} from './desktopFileWorkspaceModel';

describe('desktop file workspace state', () => {
    it('opens unique paths once and focuses a reopened path', () => {
        const first = openDesktopFile(EMPTY_DESKTOP_FILE_WORKSPACE, '/work/a.ts');
        const second = openDesktopFile(first, '/work/b.ts');
        const reopened = openDesktopFile(second, '/work/a.ts');

        expect(first).toEqual({ paths: ['/work/a.ts'], activePath: '/work/a.ts' });
        expect(second).toEqual({ paths: ['/work/a.ts', '/work/b.ts'], activePath: '/work/b.ts' });
        expect(reopened).toEqual({ paths: ['/work/a.ts', '/work/b.ts'], activePath: '/work/a.ts' });
    });

    it('selects only paths already in the workspace', () => {
        const state = { paths: ['/work/a.ts', '/work/b.ts'], activePath: '/work/a.ts' };

        expect(selectDesktopFile(state, '/work/b.ts')).toEqual({
            paths: state.paths,
            activePath: '/work/b.ts',
        });
        expect(selectDesktopFile(state, '/work/missing.ts')).toBe(state);
    });

    it('preserves the active path when a background tab closes', () => {
        expect(closeDesktopFile({
            paths: ['/work/a.ts', '/work/b.ts', '/work/c.ts'],
            activePath: '/work/c.ts',
        }, '/work/a.ts')).toEqual({
            paths: ['/work/b.ts', '/work/c.ts'],
            activePath: '/work/c.ts',
        });
    });

    it('selects the previous tab, then the next tab, when the active tab closes', () => {
        expect(closeDesktopFile({
            paths: ['/work/a.ts', '/work/b.ts', '/work/c.ts'],
            activePath: '/work/b.ts',
        }, '/work/b.ts')).toEqual({
            paths: ['/work/a.ts', '/work/c.ts'],
            activePath: '/work/a.ts',
        });
        expect(closeDesktopFile({
            paths: ['/work/a.ts', '/work/b.ts'],
            activePath: '/work/a.ts',
        }, '/work/a.ts')).toEqual({
            paths: ['/work/b.ts'],
            activePath: '/work/b.ts',
        });
    });

    it('returns to an empty workspace after the last tab closes', () => {
        expect(closeDesktopFile({ paths: ['/work/a.ts'], activePath: '/work/a.ts' }, '/work/a.ts'))
            .toEqual(EMPTY_DESKTOP_FILE_WORKSPACE);
    });

    it('ignores close requests for paths that are not open', () => {
        const state = { paths: ['/work/a.ts'], activePath: '/work/a.ts' };
        expect(closeDesktopFile(state, '/work/missing.ts')).toBe(state);
    });
});

describe('desktop file workspace width', () => {
    it('clamps to its fixed minimum and maximum', () => {
        expect(resolveDesktopFileWorkspaceWidth(100, 1600)).toBe(360);
        expect(resolveDesktopFileWorkspaceWidth(1200, 1600)).toBe(860);
    });

    it('preserves the minimum chat width inside a smaller session frame', () => {
        expect(resolveDesktopFileWorkspaceWidth(800, 1000)).toBe(612);
        expect(resolveDesktopFileWorkspaceWidth(500, 700)).toBe(360);
    });

    it('defaults to 45 percent before applying the same bounds', () => {
        expect(defaultDesktopFileWorkspaceWidth(1000)).toBe(450);
        expect(defaultDesktopFileWorkspaceWidth(2000)).toBe(860);
        expect(defaultDesktopFileWorkspaceWidth(700)).toBe(360);
    });
});
