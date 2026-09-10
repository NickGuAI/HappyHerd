import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native-mmkv', () => ({
    MMKV: class { getString() { return undefined; } set() {} delete() {} },
}));
vi.mock('./sync', () => ({ sync: {} }));
vi.mock('@/realtime/RealtimeSession', () => ({}));
vi.mock('@/components/tools/knownTools', () => ({ isMutableTool: () => false }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { storage } from './storage';
import type { Session } from './storageTypes';
import type { Project } from './projectTypes';
import { buildFlatSessionRows } from '@/utils/flatSessionList';
import { rigMetadataFixture } from './__testdata__/rigMetadata';

const personalProject: Project = {
    id: 'personal-project', externalId: 'personal-external', name: 'Launch', kind: 'personal',
    metadataVersion: 1, avatar: null, createdAt: 1, updatedAt: 1,
};
const nativeProject: Project = {
    ...personalProject, id: 'native-project', externalId: 'native-external',
    name: 'Native repository', kind: 'repository',
};

function rigSession(id: string, native = true): Session {
    return {
        id, projectId: native ? nativeProject.id : null, seq: 1,
        createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
        metadata: {
            ...rigMetadataFixture, machineId: 'rig-machine', path: '/work/native-repository',
            ...(native ? {
                project: { id: nativeProject.id, name: nativeProject.name, kind: 'regular' },
                workspace: { id: 'native-worktree', name: 'Feature worktree', kind: 'git_worktree' },
            } : {}),
        },
        metadataVersion: 1, agentState: null, agentStateVersion: 1,
        thinking: false, thinkingAt: 0, presence: 'online',
    };
}

beforeEach(() => {
    storage.setState({ sessions: {}, projects: {}, machines: {}, sessionListViewData: null });
    storage.getState().applyProjects([personalProject, nativeProject]);
});

describe('personal project assignment in the production session projection', () => {
    it.each([true, false])('moves a Rig session from native=%s grouping into its assigned personal project', (native) => {
        const session = rigSession('assigned-rig', native);
        storage.getState().applySessions([session]);
        expect(storage.getState().sessionListViewData).toContainEqual(expect.objectContaining({ type: 'project', source: 'rig' }));

        storage.getState().applySessions([{ ...storage.getState().sessions[session.id], projectId: personalProject.id }]);
        const items = storage.getState().sessionListViewData!;
        const groups = items.filter((item) => item.type === 'project');
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({ source: 'personal', project: { id: personalProject.id, name: 'Launch', sessionCount: 1 } });
        expect(buildFlatSessionRows(items)).toMatchObject([{ session: { id: session.id, projectId: personalProject.id }, projectName: 'Launch' }]);
    });

    it('retains native project/worktree grouping for an unchanged native top-level project ID', () => {
        storage.getState().applySessions([rigSession('native-rig')]);
        const items = storage.getState().sessionListViewData!;
        const groups = items.filter((item) => item.type === 'project');
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({ source: 'rig', project: {
            id: nativeProject.id, name: nativeProject.name,
            workspaces: [{ id: 'native-worktree', name: 'Feature worktree' }],
        } });
        expect(buildFlatSessionRows(items)).toMatchObject([{
            session: { id: 'native-rig' }, projectName: nativeProject.name, workspaceName: 'Feature worktree',
        }]);
    });
});
