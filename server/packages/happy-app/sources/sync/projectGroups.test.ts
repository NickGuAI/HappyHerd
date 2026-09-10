import { describe, expect, it } from 'vitest';
import { buildPersonalProjectGroups } from './projectGroups';
import type { Session } from './storageTypes';

function session(id: string, projectId: string | null, machineId: string, path: string): Session {
    return {
        id,
        projectId,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        seq: 1,
        metadata: { path, host: machineId, machineId },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
    };
}

describe('buildPersonalProjectGroups', () => {
    it('groups one account project across unrelated machines and working directories', () => {
        const groups = buildPersonalProjectGroups(
            [
                session('one', 'project-1', 'machine-a', '/work/one'),
                session('two', 'project-1', 'machine-b', '/other/two'),
                session('unassigned', null, 'machine-a', '/work/one'),
            ],
            {
                'project-1': {
                    id: 'project-1',
                    externalId: 'stable-external-id',
                    name: 'Launch',
                    kind: 'personal',
                    metadataVersion: 1,
                    avatar: null,
                    createdAt: 1,
                    updatedAt: 1,
                },
                'repository-project': {
                    id: 'repository-project',
                    externalId: 'repository-external-id',
                    name: 'Repository',
                    kind: 'repository',
                    metadataVersion: 1,
                    avatar: null,
                    createdAt: 1,
                    updatedAt: 1,
                },
            },
            (value) => ({ id: value.id }) as never,
            (value) => value.active,
        );

        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({
            id: 'project-1',
            name: 'Launch',
            machineId: null,
            sessionCount: 2,
            activeCount: 2,
        });
        expect(groups[0].workspaces[0].sessions.map((value) => value.id)).toEqual(['one', 'two']);
    });

    it('does not turn repository descriptors into personal project groups', () => {
        expect(buildPersonalProjectGroups(
            [session('repository-session', 'repository-project', 'machine-a', '/work/repository')],
            {
                'repository-project': {
                    id: 'repository-project',
                    externalId: 'repository-external-id',
                    name: 'Repository',
                    kind: 'repository',
                    metadataVersion: 1,
                    avatar: null,
                    createdAt: 1,
                    updatedAt: 1,
                },
            },
            (value) => ({ id: value.id }) as never,
            (value) => value.active,
        )).toEqual([]);
    });
});
