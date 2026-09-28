import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    machines: [] as any[],
    settings: {
        favoriteMachinePaths: [] as Array<{ machineId: string; path: string }>,
        recentMachinePaths: [] as Array<{ machineId: string; path: string }>,
    },
}));

vi.mock('@/sync/storage', () => ({
    useAllMachines: () => mocks.machines,
    useSetting: (key: keyof typeof mocks.settings) => mocks.settings[key],
}));

import { buildStreamlineLocations, useStreamlineLocations, type StreamlineLocationInput } from './useStreamlineLocations';
import type { Machine } from '@/sync/storageTypes';

function machine(id: string, overrides: Partial<Machine> = {}): Machine {
    return {
        id,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: {
            homeDir: '/home/user',
            happyHomeDir: '/home/user/.happyherd',
            host: `${id}-host`,
            platform: 'linux',
            happyCliVersion: '1.0.0',
        },
        metadataVersion: 1,
        daemonState: null,
        daemonStateVersion: 1,
        ...overrides,
    };
}

const input = (machineId: string, path: string): StreamlineLocationInput => ({ machineId, path });

describe('buildStreamlineLocations', () => {
    it('orders favorites, newest-first recents, then Commander workspaces and deduplicates canonical identities', () => {
        const result = buildStreamlineLocations({
            machines: [machine('machine-1')],
            favorites: [input('machine-1', '~/Projects/alpha/')],
            recents: [input('machine-1', '/home/user/Projects/alpha'), input('machine-1', '/home/user/Projects/beta')],
            commanderWorkspaces: [input('machine-1', '/home/user/Projects/gamma'), input('machine-1', '/home/user/Projects/beta')],
        });

        expect(result.map(({ path }) => path)).toEqual([
            '~/Projects/alpha/', '/home/user/Projects/beta', '/home/user/Projects/gamma',
        ]);
    });

    it('keeps same-basename paths and the same path on different machines separate', () => {
        const result = buildStreamlineLocations({
            machines: [machine('machine-1'), machine('machine-2')],
            favorites: [input('machine-1', '/one/project'), input('machine-1', '/two/project')],
            recents: [input('machine-2', '/one/project')],
        });

        expect(result.map(({ machineId, name }) => [machineId, name])).toEqual([
            ['machine-1', 'project'], ['machine-1', 'project'], ['machine-2', 'project'],
        ]);
    });

    it('retains offline and unknown machines as offline entries', () => {
        const result = buildStreamlineLocations({
            machines: [machine('offline', { active: false, metadata: null })],
            favorites: [input('offline', '/workspace'), input('missing-machine', '/workspace')],
            recents: [],
        });

        expect(result).toEqual([
            { machineId: 'offline', path: '/workspace', name: 'workspace', machineName: 'unknown', online: false },
            { machineId: 'missing-machine', path: '/workspace', name: 'workspace', machineName: 'missing-machine', online: false },
        ]);
    });

    it('keeps a filesystem root and skips blank paths', () => {
        const result = buildStreamlineLocations({
            machines: [machine('machine-1')],
            favorites: [input('machine-1', '   '), input('machine-1', '/')],
            recents: [],
        });

        expect(result).toEqual([
            { machineId: 'machine-1', path: '/', name: '/', machineName: 'machine-1-host', online: true },
        ]);
    });

    it('prefers the machine display name over its host name', () => {
        const result = buildStreamlineLocations({
            machines: [machine('machine-1', { metadata: {
                homeDir: '/home/user',
                happyHomeDir: '/home/user/.happyherd',
                host: 'host-name',
                platform: 'linux',
                happyCliVersion: '1.0.0',
                displayName: 'Work machine',
            } })],
            favorites: [input('machine-1', '/workspace')],
            recents: [],
        });

        expect(result[0].machineName).toBe('Work machine');
    });

    it('resolves tilde and trailing separators for identity while preserving the original path', () => {
        const result = buildStreamlineLocations({
            machines: [machine('machine-1')],
            favorites: [input('machine-1', '~/folder///')],
            recents: [input('machine-1', '/home/user/folder\\')],
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ path: '~/folder///', name: 'folder' });
    });

    it('caps the result at eight entries', () => {
        const favorites = Array.from({ length: 9 }, (_, index) => input('machine-1', `/folder-${index}`));
        const result = buildStreamlineLocations({ machines: [machine('machine-1')], favorites, recents: [] });
        expect(result).toHaveLength(8);
        expect(result[7].path).toBe('/folder-7');
    });
});

let current: ReturnType<typeof useStreamlineLocations>;
function Harness() {
    current = useStreamlineLocations([input('machine-1', '/commander')]);
    return null;
}

let renderer: ReturnType<typeof create> | undefined;

beforeEach(() => {
    mocks.machines = [machine('machine-1')];
    mocks.settings.favoriteMachinePaths = [];
    mocks.settings.recentMachinePaths = [input('machine-1', '/recent')];
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
    renderer = undefined;
});

it('rebuilds locations from changed settings and machine presence', async () => {
    await act(async () => { renderer = create(React.createElement(Harness)); });
    expect(current.map(({ path }) => path)).toEqual(['/recent', '/commander']);

    mocks.settings.favoriteMachinePaths = [input('machine-1', '/favorite')];
    mocks.machines = [machine('machine-1', { active: false })];
    await act(async () => { renderer.update(React.createElement(Harness)); });

    expect(current.map(({ path, online }) => [path, online])).toEqual([
        ['/favorite', false], ['/recent', false], ['/commander', false],
    ]);
});
