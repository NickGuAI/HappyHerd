import { describe, expect, it } from 'vitest';

import type { Machine } from '@/sync/storageTypes';
import {
    buildWorkspaceAttachmentParams,
    classifyWorkspaceDirectoryError,
    DESKTOP_WORKSPACE_BROWSER_WIDTH,
    desktopWorkspaceBrowserLayout,
    pickWorkspaceDirectory,
    pickWorkspaceMachine,
    rememberWorkspacePath,
    toggleWorkspaceFavorite,
} from './machineWorkspace';

function machine(id: string, active: boolean, homeDir = `/home/${id}`): Machine {
    return {
        id,
        active,
        activeAt: 0,
        createdAt: 0,
        updatedAt: 0,
        seq: 0,
        metadataVersion: 0,
        daemonState: null,
        daemonStateVersion: 0,
        metadata: {
            host: id,
            platform: 'linux',
            happyCliVersion: 'test',
            happyHomeDir: `${homeDir}/.happy`,
            homeDir,
        },
    };
}

describe('Machine Workspace state', () => {
    it('keeps the desktop browser pane at a non-collapsible fixed width', () => {
        expect(desktopWorkspaceBrowserLayout).toMatchObject({
            width: DESKTOP_WORKSPACE_BROWSER_WIDTH,
            minWidth: DESKTOP_WORKSPACE_BROWSER_WIDTH,
            maxWidth: DESKTOP_WORKSPACE_BROWSER_WIDTH,
            flexBasis: DESKTOP_WORKSPACE_BROWSER_WIDTH,
            flexGrow: 0,
            flexShrink: 0,
        });
        expect(desktopWorkspaceBrowserLayout).not.toHaveProperty('flex');
    });

    it('binds attachment mode to the current session machine and path', () => {
        expect(buildWorkspaceAttachmentParams('session-1', {
            machineId: 'machine-1',
            path: '/srv/project',
            homeDir: '/home/nick',
        })).toEqual({
            mode: 'attach',
            sessionId: 'session-1',
            machineId: 'machine-1',
            path: '/srv/project',
        });
        expect(buildWorkspaceAttachmentParams('session-1', {
            path: '/srv/project',
            homeDir: '/home/nick',
        })).toBeNull();
    });

    it('prefers a requested machine, then recent, then an online machine', () => {
        const machines = [machine('offline', false), machine('online', true)];
        expect(pickWorkspaceMachine(machines, 'offline', [])?.id).toBe('offline');
        expect(pickWorkspaceMachine(machines, undefined, [{ machineId: 'offline', path: '/tmp' }])?.id).toBe('offline');
        expect(pickWorkspaceMachine(machines, undefined, [])?.id).toBe('online');
    });

    it('resolves each machine directory independently so switches cannot reuse another machine path', () => {
        const first = machine('first', true);
        const second = machine('second', true);
        const recent = [{ machineId: 'first', path: '/srv/first' }];
        expect(pickWorkspaceDirectory(first, undefined, recent)).toBe('/srv/first');
        expect(pickWorkspaceDirectory(second, undefined, recent)).toBe('/home/second');
    });

    it('keeps the ten newest unique machine paths and toggles favorites', () => {
        const paths = Array.from({ length: 10 }, (_, index) => ({ machineId: 'm', path: `/p${index}` }));
        expect(rememberWorkspacePath(paths, 'm', '/new')).toHaveLength(10);
        expect(rememberWorkspacePath(paths, 'm', '/new')[0]).toEqual({ machineId: 'm', path: '/new' });
        expect(toggleWorkspaceFavorite([], 'm', '/home')).toEqual([{ machineId: 'm', path: '/home' }]);
        expect(toggleWorkspaceFavorite([{ machineId: 'm', path: '/home' }], 'm', '/home')).toEqual([]);
    });

    it('maps offline, permission, and missing-path failures to explicit states', () => {
        expect(classifyWorkspaceDirectoryError(undefined, false)).toBe('offline');
        expect(classifyWorkspaceDirectoryError('EACCES: permission denied', true)).toBe('permission');
        expect(classifyWorkspaceDirectoryError('ENOENT: no such file', true)).toBe('missing');
        expect(classifyWorkspaceDirectoryError('socket timeout', true)).toBe('unknown');
    });
});
