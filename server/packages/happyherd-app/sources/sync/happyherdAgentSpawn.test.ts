import { describe, expect, it } from 'vitest';

import {
    HappyHerdAgentWorkspaceUnavailableError,
    resolveHappyHerdAgentSpawnTarget,
} from './happyherdAgentSpawn';

const workspaces = [{ id: 'workspace-1', path: '/project/workspace-1' }];

describe('HappyHerd Agent catalog spawn targets', () => {
    it('creates a child through the project catalog', () => {
        expect(resolveHappyHerdAgentSpawnTarget({
            projectId: 'project-1',
            workspaceSelection: '__new__',
            workspaces,
        })).toEqual({ kind: 'newWorkspace', projectId: 'project-1' });
    });

    it('starts inside an existing workspace by durable identity', () => {
        expect(resolveHappyHerdAgentSpawnTarget({
            projectId: 'project-1',
            workspaceSelection: '/project/workspace-1',
            workspaces,
        })).toEqual({ kind: 'workspace', id: 'workspace-1' });
    });

    it('refuses to import a stale workspace path as another project', () => {
        expect(() => resolveHappyHerdAgentSpawnTarget({
            projectId: 'project-1',
            workspaceSelection: '/project/missing',
            workspaces,
        })).toThrow(HappyHerdAgentWorkspaceUnavailableError);
    });
});
