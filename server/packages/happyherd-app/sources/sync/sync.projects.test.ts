import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from './storageTypes';

type AssignmentStore = {
    sessions: Record<string, Session>;
    projects: Record<string, { id: string; kind: string }>;
    getActiveSessions: () => Session[];
    applySessions: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
    state: undefined as unknown as AssignmentStore,
    assignSessionProject: vi.fn(),
}));

// Keep the production assignment method and its asynchronous storage merge;
// isolate the native runtime and unrelated singleton services at imports.
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }));
vi.mock('expo-notifications', () => ({}));
vi.mock('react-native', () => ({
    Platform: { OS: 'web' },
    AppState: { currentState: 'active', addEventListener: vi.fn() },
}));
vi.mock('@/sync/apiSocket', () => ({}));
vi.mock('@/sync/webTabTitle', () => ({}));
vi.mock('@/sync/encryption/encryption', () => ({}));
vi.mock('@/encryption/base64', () => ({}));
vi.mock('./storage', () => ({ storage: { getState: () => mocks.state } }));
vi.mock('./ops', () => ({}));
vi.mock('./attachmentSupport', () => ({}));
vi.mock('./attachmentDiagnostics', () => ({}));
vi.mock('./apiTypes', () => ({}));
vi.mock('@/utils/sync', () => ({
    InvalidateSync: class {},
}));
vi.mock('@/utils/time', () => ({ delay: async () => undefined }));
vi.mock('./pushRegistration', () => ({}));
vi.mock('@/utils/platform', () => ({}));
vi.mock('./typesRaw', () => ({}));
vi.mock('./settings', () => ({ applySettings: vi.fn() }));
vi.mock('./profile', () => ({}));
vi.mock('./persistence', () => ({ loadPendingSettings: () => ({}) }));
vi.mock('@/track', () => ({}));
vi.mock('@/utils/parseToken', () => ({}));
vi.mock('./revenueCat', () => ({}));
vi.mock('./serverConfig', () => ({}));
vi.mock('@/config', () => ({}));
vi.mock('@/log', () => ({}));
vi.mock('./gitStatusSync', () => ({}));
vi.mock('@/utils/lock', () => ({}));
vi.mock('@/realtime/hooks/voiceHooks', () => ({}));
vi.mock('./encryption/encryptionCache', () => ({ EncryptionCache: class {} }));
vi.mock('./prompt/systemPrompt', () => ({}));
vi.mock('./prompt/userSafeguard', () => ({}));
vi.mock('./apiArtifacts', () => ({}));
vi.mock('./encryption/artifactEncryption', () => ({}));
vi.mock('./apiFriends', () => ({}));
vi.mock('./apiFeed', () => ({ fetchFeed: vi.fn() }));
vi.mock('./controlHandoff', () => ({}));
vi.mock('./messageMeta', () => ({}));
vi.mock('./agentDefaults', () => ({}));
vi.mock('@/components/modelModeOptions', () => ({}));
vi.mock('./apiAttachments', () => ({}));
vi.mock('@/encryption/blob', () => ({}));
vi.mock('@/utils/readFileBytes', () => ({}));
vi.mock('@/modal', () => ({}));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('./rig', () => ({}));
vi.mock('./visibleSessionReconciliation', () => ({}));
vi.mock('./queueState', () => ({}));
vi.mock('./apiProjects', () => ({ assignSessionProject: mocks.assignSessionProject }));
vi.mock('./projects', () => ({}));

import { sync } from './sync';

beforeEach(() => {
    mocks.assignSessionProject.mockReset();
    mocks.state = {
        sessions: {},
        projects: { launch: { id: 'launch', kind: 'personal' } },
        getActiveSessions: () => [],
        applySessions: vi.fn((sessions: Session[]) => {
            for (const session of sessions) mocks.state.sessions[session.id] = session;
        }),
    };
});

function session(): Session {
    return {
        id: 'session-one', projectId: null, seq: 1,
        createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
        metadata: { path: '/work/project', host: 'machine-one', name: 'Original title' },
        metadataVersion: 1, agentState: null, agentStateVersion: 1,
        thinking: false, thinkingAt: 0, presence: 'online',
    };
}

function deferAssignment() {
    let resolve!: (value: { id: string; projectId: string }) => void;
    mocks.assignSessionProject.mockReturnValue(new Promise((done) => { resolve = done; }));
    return () => resolve({ id: 'session-one', projectId: 'launch' });
}

describe('session project assignment', () => {
    it('merges the response into current metadata, activity, agent state and draft', async () => {
        const original = session();
        mocks.state.sessions[original.id] = original;
        const finish = deferAssignment();
        const assignment = sync.assignSessionProject(original.id, 'launch');
        expect(mocks.assignSessionProject).toHaveBeenCalledOnce();

        const updated: Session = {
            ...original,
            seq: 12, updatedAt: 30, active: false, activeAt: 29,
            metadata: { ...original.metadata!, name: 'Updated while assigning' },
            metadataVersion: 4,
            agentState: { controlledByUser: true }, agentStateVersion: 5,
            thinking: true, thinkingAt: 28,
            draft: 'Keep this draft',
        };
        mocks.state.sessions[original.id] = updated;
        finish();
        await assignment;

        expect(mocks.state.sessions[original.id]).toEqual({ ...updated, projectId: 'launch' });
    });

    it('does not resurrect a session removed while assignment was pending', async () => {
        mocks.state.sessions['session-one'] = session();
        const finish = deferAssignment();
        const assignment = sync.assignSessionProject('session-one', 'launch');
        delete mocks.state.sessions['session-one'];
        finish();
        await assignment;

        expect(mocks.state.sessions).toEqual({});
        expect(mocks.state.applySessions).not.toHaveBeenCalled();
    });
});
