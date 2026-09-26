import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    state: { sessions: {}, sessionMessages: {}, currentViewingSessionId: null } as any,
    request: vi.fn(),
    gitInvalidate: vi.fn(),
    gitRefreshNow: vi.fn(),
    gitHasStatus: vi.fn(),
    isMutableToolCall: vi.fn(),
}));

// Exercise the real Sync update handling with only the native services,
// network, and store boundary replaced. No Expo runtime or sockets.
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-device', () => ({}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'id' }));
vi.mock('expo-notifications', () => ({}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, AppState: { currentState: 'active', addEventListener: vi.fn() } }));
vi.mock('@/utils/platform', () => ({ isRunningOnMac: () => false }));
vi.mock('@/sync/apiSocket', () => ({ apiSocket: { request: mocks.request }, getCurrentAppState: () => 'active', getHappyHerdClientId: () => 'test' }));
vi.mock('@/sync/webTabTitle', () => ({ notifyUnreadMessage: vi.fn() }));
vi.mock('@/sync/encryption/encryption', () => ({ Encryption: class {} }));
vi.mock('@/sync/encryption/artifactEncryption', () => ({ ArtifactEncryption: class {} }));
vi.mock('@/sync/encryption/encryptionCache', () => ({ EncryptionCache: class {} }));
vi.mock('@/sync/storage', () => ({ storage: { getState: () => ({
    ...mocks.state,
    getActiveSessions: () => [],
    applySessions: (sessions: any[]) => {
        mocks.state.sessions = { ...mocks.state.sessions };
        for (const session of sessions) mocks.state.sessions[session.id] = session;
    },
    applyMessages: () => ({ changed: [], hasReadyEvent: false, enteredPlanMode: false }),
    applyMessagesLoaded: vi.fn(),
    applyOlderMessagesPagination: vi.fn(),
    isMutableToolCall: mocks.isMutableToolCall,
}) } }));
vi.mock('@/sync/ops', () => ({ sessionSetAgentModes: vi.fn() }));
vi.mock('@/sync/persistence', () => ({ loadPendingSettings: () => ({}), savePendingSettings: vi.fn() }));
vi.mock('@/sync/revenueCat', () => ({ RevenueCat: {}, LogLevel: {}, PaywallResult: {} }));
vi.mock('@/sync/serverConfig', () => ({ getServerUrl: () => 'https://example.invalid' }));
vi.mock('@/sync/pushRegistration', () => ({ syncCurrentPushToken: vi.fn() }));
vi.mock('@/sync/apiArtifacts', () => ({ fetchArtifact: vi.fn(), fetchArtifacts: vi.fn(), createArtifact: vi.fn(), updateArtifact: vi.fn() }));
vi.mock('@/sync/apiFriends', () => ({ getFriendsList: vi.fn(), getUserProfile: vi.fn() }));
vi.mock('@/sync/apiFeed', () => ({ fetchFeed: vi.fn() }));
vi.mock('@/sync/apiAttachments', () => ({ requestAttachmentUpload: vi.fn(), uploadEncryptedBlob: vi.fn() }));
vi.mock('@/sync/apiProjects', () => ({ fetchProjects: vi.fn() }));
vi.mock('@/sync/projects', () => ({ decryptProjectRecord: vi.fn(), loadProjectAvatar: vi.fn() }));
vi.mock('@/sync/sessionAvatars', () => ({ loadSessionAvatar: vi.fn(async () => null) }));
vi.mock('@/sync/typesRaw', () => ({ normalizeRawMessage: (_id: string, _localId: string, _time: number, content: unknown) => content }));
vi.mock('@/config', () => ({ config: {} }));
vi.mock('@/log', () => ({ log: { log: vi.fn() } }));
vi.mock('@/track', () => ({ tracking: null }));
vi.mock('@/modal', () => ({ Modal: {} }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/encryption/blob', () => ({}));
vi.mock('@/utils/readFileBytes', () => ({}));
vi.mock('@/sync/gitStatusSync', () => ({ gitStatusSync: {
    getSync: () => ({ invalidate: mocks.gitRefreshNow }),
    invalidate: mocks.gitInvalidate,
    hasStatus: mocks.gitHasStatus,
} }));
vi.mock('@/realtime/hooks/voiceHooks', () => ({ voiceHooks: {
    onSessionFocus: vi.fn(), onMessages: vi.fn(), onReady: vi.fn(), onPermissionRequested: vi.fn(),
} }));

import { sync } from './sync';

let engine: any;
let seq = 0;
const contents = new Map<string, unknown>();

function newMessage(sid: string, content: unknown) {
    seq += 1;
    const id = `message-${seq}`;
    contents.set(id, content);
    return {
        id: `update-${seq}`, seq, createdAt: seq,
        body: { t: 'new-message', sid, message: { id, seq, localId: null, content: { t: 'encrypted', c: 'opaque' }, createdAt: seq, updatedAt: seq } },
    };
}

const text = { role: 'agent', content: [{ type: 'text', text: 'Working on it' }] };
const toolResult = { role: 'agent', content: [{ type: 'tool-result', tool_use_id: 'call-1', content: 'ok' }] };
const turnEnd = { role: 'agent', content: { type: 'session', data: { ev: { t: 'turn-end', status: 'completed' } } } };

// Either entry point runs the four git commands.
const gitRefreshes = () => mocks.gitInvalidate.mock.calls.length + mocks.gitRefreshNow.mock.calls.length;

afterEach(() => { engine?.sessionAvatars.clear(); vi.unstubAllGlobals(); });

beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('__DEV__', false);
    mocks.state = {
        sessions: {
            viewed: { id: 'viewed', active: true, metadata: { machineId: 'm', path: '/repo' } },
            background: { id: 'background', active: true, metadata: { machineId: 'm', path: '/other' } },
        },
        sessionMessages: {},
        currentViewingSessionId: 'viewed',
    };
    mocks.request.mockResolvedValue({ ok: true, json: async () => ({ messages: [], hasMore: false }) });
    mocks.gitHasStatus.mockReturnValue(true);
    mocks.isMutableToolCall.mockReturnValue(true);
    engine = new (sync.constructor as new () => typeof sync)();
    const encryption = {
        decryptMessage: vi.fn(async (message: any) => ({ id: message.id, localId: null, createdAt: message.createdAt, content: contents.get(message.id), seq: message.seq })),
        decryptMessages: vi.fn(async (messages: any[]) => messages),
        decryptAgentState: vi.fn(async () => ({ requests: {} })),
        decryptMetadata: vi.fn(async () => ({ machineId: 'm', path: '/repo' })),
    };
    engine.encryption = { getSessionEncryption: (id: string) => mocks.state.sessions[id] ? encryption : undefined };
    engine.projectsSync = { invalidate: vi.fn() };
});

describe('git status refresh triggers', () => {
    it('does not refresh git for a message that cannot change files', async () => {
        await engine.handleUpdate(newMessage('viewed', text));
        await engine.handleUpdate(newMessage('background', text));
        expect(gitRefreshes()).toBe(0);
    });

    it('refreshes git after a mutating tool result in the viewed session', async () => {
        await engine.handleUpdate(newMessage('viewed', toolResult));
        expect(mocks.isMutableToolCall).toHaveBeenCalledWith('viewed', 'call-1');
        expect(gitRefreshes()).toBe(1);
        expect(mocks.gitInvalidate).toHaveBeenCalledWith('viewed');
    });

    it('does not refresh git for a read-only tool result', async () => {
        mocks.isMutableToolCall.mockReturnValue(false);
        await engine.handleUpdate(newMessage('viewed', toolResult));
        expect(gitRefreshes()).toBe(0);
    });

    it('waits for the end of the turn in a background session', async () => {
        await engine.handleUpdate(newMessage('background', toolResult));
        expect(gitRefreshes()).toBe(0);

        await engine.handleUpdate(newMessage('background', turnEnd));
        expect(gitRefreshes()).toBe(1);
        expect(mocks.gitInvalidate).toHaveBeenCalledWith('background');
    });

    it('fetches a project that has no status yet on its first message', async () => {
        mocks.gitHasStatus.mockReturnValue(false);
        await engine.handleUpdate(newMessage('background', text));
        expect(mocks.gitInvalidate).toHaveBeenCalledWith('background');
    });

    it('does not refresh git for agent state bookkeeping', async () => {
        await engine.handleUpdate({
            id: 'state-1', seq: 999, createdAt: 999,
            body: { t: 'update-session', id: 'viewed', agentState: { version: 2, value: 'opaque' } },
        });
        expect(mocks.state.sessions.viewed.agentStateVersion).toBe(2);
        expect(gitRefreshes()).toBe(0);
    });
});
