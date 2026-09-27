import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidateSync } from '@/utils/sync';

const mocks = vi.hoisted(() => ({
    state: { sessions: {}, sessionMessages: {}, currentViewingSessionId: null } as any,
    request: vi.fn(),
    gitInvalidate: vi.fn(),
    gitRefreshNow: vi.fn(),
    gitHasStatus: vi.fn(),
    isMutableToolCall: vi.fn(),
    applySessions: vi.fn(),
    addAppStateListener: vi.fn(),
    onReconnected: vi.fn(),
}));

// Exercise the real Sync update handling with only the native services,
// network, and store boundary replaced. No Expo runtime or sockets.
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-device', () => ({}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'id' }));
vi.mock('expo-notifications', () => ({}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, AppState: { currentState: 'active', addEventListener: mocks.addAppStateListener } }));
vi.mock('@/utils/platform', () => ({ isRunningOnMac: () => false }));
vi.mock('@/sync/apiSocket', () => ({
    apiSocket: { request: mocks.request, sendAppState: vi.fn(), onMessage: vi.fn(), onReconnected: mocks.onReconnected },
    getCurrentAppState: () => 'active',
    getHappyHerdClientId: () => 'test',
}));
vi.mock('@/sync/webTabTitle', () => ({ notifyUnreadMessage: vi.fn() }));
vi.mock('@/sync/encryption/encryption', () => ({ Encryption: class {} }));
vi.mock('@/sync/encryption/artifactEncryption', () => ({ ArtifactEncryption: class {} }));
vi.mock('@/sync/encryption/encryptionCache', () => ({ EncryptionCache: class {} }));
vi.mock('@/sync/storage', () => ({ storage: { getState: () => ({
    ...mocks.state,
    getActiveSessions: () => [],
    applySessions: (sessions: any[]) => {
        mocks.applySessions(sessions);
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
let fetchMock: ReturnType<typeof vi.fn>;
const known = new Set<string>();
const sessionEncryption = {
    decryptMetadata: vi.fn(async () => ({ machineId: 'm', path: '/repo' })),
    decryptAgentState: vi.fn(async () => ({})),
    decryptMessage: vi.fn(async () => null),
};

function record(id: string, updatedAt: number) {
    return {
        id, seq: 1, metadata: 'opaque', metadataVersion: 1, agentState: null, agentStateVersion: 0,
        dataEncryptionKey: 'key', active: true, activeAt: updatedAt, createdAt: 1, updatedAt,
    };
}

function stubSyncs(names: string[]) {
    const stubs: Record<string, { invalidate: ReturnType<typeof vi.fn>; awaitQueue: () => Promise<void> }> = {};
    for (const name of names) {
        stubs[name] = { invalidate: vi.fn(), awaitQueue: async () => {} };
        engine[name] = stubs[name];
    }
    return stubs;
}

const OTHER_SYNCS = [
    'purchasesSync', 'profileSync', 'machinesSync', 'pushTokenSync', 'projectsSync', 'nativeUpdateSync',
    'artifactsSync', 'friendsSync', 'friendRequestsSync', 'feedSync',
];

afterEach(() => { engine?.sessionAvatars.clear(); vi.unstubAllGlobals(); });

beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('__DEV__', false);
    known.clear();
    known.add('existing');
    mocks.state = {
        sessions: { existing: { id: 'existing', active: true, thinking: false, metadata: { machineId: 'm', path: '/repo' } } },
        sessionMessages: {},
        currentViewingSessionId: null,
        realtimeStatus: 'disconnected',
    };
    sessionEncryption.decryptMetadata.mockImplementation(async () => ({ machineId: 'm', path: '/repo' }));
    sessionEncryption.decryptAgentState.mockImplementation(async () => ({}));
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    engine = new (sync.constructor as new () => typeof sync)();
    engine.credentials = { token: 'token', secret: 'secret' };
    engine.encryption = {
        getSessionEncryption: (id: string) => known.has(id) ? sessionEncryption : undefined,
        decryptEncryptionKey: vi.fn(async () => new Uint8Array(32)),
        initializeSessions: vi.fn(async (keys: Map<string, unknown>) => { for (const id of keys.keys()) known.add(id); }),
    };
    engine.projectsSync = { invalidate: vi.fn() };
});

describe('session list refresh', () => {
    it('downloads the full list only when this tab has no list yet', async () => {
        fetchMock.mockResolvedValue(Response.json({ sessions: [record('existing', 50_000)] }));
        await engine.fetchChangedSessions();

        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://example.invalid/v1/sessions']);
        expect(engine.sessionsChangedSince).toBe(50_000);
    });

    it('fetches only sessions changed since the newest applied list, across pages', async () => {
        engine.sessionsChangedSince = 100_000;
        fetchMock
            .mockResolvedValueOnce(Response.json({ sessions: [record('fresh', 130_000)], nextCursor: 'cursor_v1_fresh', hasNext: true }))
            .mockResolvedValueOnce(Response.json({ sessions: [record('existing', 120_000)], nextCursor: null, hasNext: false }));

        await engine.fetchChangedSessions();

        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            'https://example.invalid/v2/sessions?changedSince=40000&limit=200',
            'https://example.invalid/v2/sessions?changedSince=40000&limit=200&cursor=cursor_v1_fresh',
        ]);
        expect(engine.encryption.decryptEncryptionKey).toHaveBeenCalledOnce();
        expect(mocks.applySessions).toHaveBeenCalledOnce();
        expect(mocks.applySessions.mock.calls[0][0].map((session: any) => session.id)).toEqual(['fresh', 'existing']);
        expect(engine.sessionsChangedSince).toBe(130_000);
    });

    it('applies nothing when no session changed', async () => {
        engine.sessionsChangedSince = 100_000;
        fetchMock.mockResolvedValue(Response.json({ sessions: [], nextCursor: null, hasNext: false }));
        await engine.fetchChangedSessions();

        expect(mocks.applySessions).not.toHaveBeenCalled();
        expect(engine.projectsSync.invalidate).not.toHaveBeenCalled();
    });

    it('catches up on tab return without the full list', async () => {
        const [listener] = mocks.addAppStateListener.mock.calls.at(-1)!.slice(1);
        const syncs = stubSyncs(['sessionsSync', 'sessionsDeltaSync', ...OTHER_SYNCS]);
        engine.cancelBackgroundSendTimeoutNotification = vi.fn(async () => {});

        listener('active');

        expect(syncs.sessionsDeltaSync.invalidate).toHaveBeenCalledOnce();
        expect(syncs.sessionsSync.invalidate).not.toHaveBeenCalled();
    });

    it('catches up after a socket reconnect without the full list', () => {
        engine.subscribeToUpdates();
        const [reconnected] = mocks.onReconnected.mock.calls.at(-1)!;
        const syncs = stubSyncs(['sessionsSync', 'sessionsDeltaSync', ...OTHER_SYNCS]);

        reconnected();

        expect(syncs.sessionsDeltaSync.invalidate).toHaveBeenCalledOnce();
        expect(syncs.sessionsSync.invalidate).not.toHaveBeenCalled();
    });

    it('adds a new session without the full list', async () => {
        const syncs = stubSyncs(['sessionsSync', 'sessionsDeltaSync']);
        await engine.handleUpdate({ id: 'u1', seq: 1, createdAt: 1, body: { t: 'new-session', id: 'fresh', createdAt: 1, updatedAt: 1 } });

        expect(syncs.sessionsDeltaSync.invalidate).toHaveBeenCalledOnce();
        expect(syncs.sessionsSync.invalidate).not.toHaveBeenCalled();
    });

    it('lets a new session\'s first message wait for the in-flight catch-up', async () => {
        const fullFetch = vi.spyOn(engine, 'fetchSessions');
        engine.sessionsDeltaSync = new InvalidateSync(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            known.add('fresh');
            mocks.state.sessions = { ...mocks.state.sessions, fresh: { id: 'fresh', active: true, thinking: false, metadata: {} } };
        });
        engine.sessionsDeltaSync.invalidate();

        await engine.handleUpdate({
            id: 'u2', seq: 2, createdAt: 2,
            body: { t: 'new-message', sid: 'fresh', message: { id: 'm1', seq: 1, localId: null, content: { t: 'encrypted', c: 'x' }, createdAt: 2, updatedAt: 2 } },
        });

        expect(fullFetch).not.toHaveBeenCalled();
        expect(mocks.state.sessions.fresh).toBeDefined();
    });
});
