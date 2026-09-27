import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    state: { sessions: {}, sessionMessages: {}, currentViewingSessionId: null } as any,
    request: vi.fn(),
    gitInvalidate: vi.fn(),
    gitRefreshNow: vi.fn(),
    gitHasStatus: vi.fn(),
    isMutableToolCall: vi.fn(),
    applySessions: vi.fn(),
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
let seq = 0;
const contents = new Map<string, unknown>();

function newMessage(sid: string, messageSeq: number) {
    seq += 1;
    const id = `message-${seq}`;
    contents.set(id, { role: 'agent', content: [{ type: 'text', text: `reply ${messageSeq}` }] });
    return {
        id: `update-${seq}`, seq: 1000 + seq, createdAt: seq,
        body: { t: 'new-message', sid, message: { id, seq: messageSeq, localId: null, content: { t: 'encrypted', c: 'opaque' }, createdAt: seq, updatedAt: seq } },
    };
}

const messageRequests = () => mocks.request.mock.calls.map(([url]) => url as string).filter((url) => url.includes('/messages'));

afterEach(() => { engine?.sessionAvatars.clear(); vi.unstubAllGlobals(); });

beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('__DEV__', false);
    mocks.state = {
        sessions: {
            viewed: { id: 'viewed', active: true, thinking: false, metadata: { machineId: 'm', path: '/repo' } },
            opened: { id: 'opened', active: true, thinking: false, metadata: { machineId: 'm', path: '/repo' } },
            unopened: { id: 'unopened', active: true, thinking: false, metadata: { machineId: 'm', path: '/other' } },
        },
        sessionMessages: {
            viewed: { isLoaded: true, messages: [], messagesMap: {}, hasMoreOlder: true },
            opened: { isLoaded: true, messages: [], messagesMap: {}, hasMoreOlder: true },
        },
        currentViewingSessionId: 'viewed',
        realtimeStatus: 'disconnected',
    };
    mocks.request.mockResolvedValue({ ok: true, json: async () => ({ messages: [], hasMore: false }) });
    mocks.gitHasStatus.mockReturnValue(true);
    engine = new (sync.constructor as new () => typeof sync)();
    const encryption = {
        decryptMessage: vi.fn(async (message: any) => ({ id: message.id, localId: null, createdAt: message.createdAt, content: contents.get(message.id), seq: message.seq })),
        decryptMessages: vi.fn(async (messages: any[]) => messages),
    };
    engine.encryption = { getSessionEncryption: (id: string) => mocks.state.sessions[id] ? encryption : undefined };
    engine.projectsSync = { invalidate: vi.fn() };
    engine.sessionLastSeq.set('viewed', 5);
    engine.sessionLastSeq.set('opened', 5);
});

async function settle(sessionId: string) {
    await engine.getMessagesSync(sessionId).awaitQueue();
}

describe('socket-delivered messages', () => {
    it('applies a consecutive message from the socket without fetching it', async () => {
        await engine.handleUpdate(newMessage('viewed', 6));
        await engine.handleUpdate(newMessage('opened', 6));
        await settle('viewed');
        await settle('opened');

        expect(messageRequests()).toEqual([]);
        expect(engine.sessionLastSeq.get('viewed')).toBe(6);
        expect(engine.sessionLastSeq.get('opened')).toBe(6);
    });

    it('downloads nothing for a chat this tab has not opened', async () => {
        await engine.handleUpdate(newMessage('unopened', 40));
        await engine.handleUpdate(newMessage('unopened', 41));
        await settle('unopened');

        expect(messageRequests()).toEqual([]);
    });

    it('fills a gap in the viewed chat from the server', async () => {
        await engine.handleUpdate(newMessage('viewed', 9));
        await settle('viewed');

        expect(messageRequests()).toEqual(['/v3/sessions/viewed/messages?after_seq=5&limit=100']);
    });

    it('still loads unopened chats while voice follows sessions', async () => {
        mocks.state.realtimeStatus = 'connected';
        await engine.handleUpdate(newMessage('unopened', 40));
        await settle('unopened');

        expect(messageRequests()).toEqual(['/v3/sessions/unopened/messages?before_seq=2147483647&limit=100']);
    });
});

describe('background work', () => {
    it('does not rebuild the session list for heartbeat-only activity', () => {
        engine.flushActivityUpdates(new Map([
            ['viewed', { type: 'activity', id: 'viewed', active: true, activeAt: 5000, thinking: false }],
            ['opened', { type: 'activity', id: 'opened', active: true, activeAt: 5000 }],
        ]));
        expect(mocks.applySessions).not.toHaveBeenCalled();

        engine.flushActivityUpdates(new Map([
            ['viewed', { type: 'activity', id: 'viewed', active: true, activeAt: 6000, thinking: true }],
            ['opened', { type: 'activity', id: 'opened', active: false, activeAt: 6000 }],
        ]));
        expect(mocks.applySessions).toHaveBeenCalledOnce();
        const applied = mocks.applySessions.mock.calls[0][0];
        expect(applied.map((session: any) => [session.id, session.active, session.thinking])).toEqual([
            ['viewed', true, true],
            ['opened', false, false],
        ]);
    });

    it('pages older history only while the chat is being viewed', async () => {
        const older = vi.spyOn(engine, 'loadOlderMessages').mockImplementation(async () => {
            mocks.state.sessionMessages.viewed = { ...mocks.state.sessionMessages.viewed, hasMoreOlder: false };
        });
        engine.sessionOldestSeq.set('opened', 50);
        engine.sessionOldestSeq.set('viewed', 50);

        await engine.fetchOlderMessagesInBackground('opened');
        expect(older).not.toHaveBeenCalled();

        await engine.fetchOlderMessagesInBackground('viewed');
        expect(older).toHaveBeenCalledWith('viewed');
    });
});
