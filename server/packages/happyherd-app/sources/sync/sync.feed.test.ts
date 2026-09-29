import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem } from './feedTypes';

const mocks = vi.hoisted(() => ({
    state: {} as any,
    fetchFeed: vi.fn(),
    applyFeedItems: vi.fn(),
    applyFeedRead: vi.fn(),
}));

// Exercise production Sync pagination and event dispatch. Native integrations,
// transport and store are boundaries; storage.feed.test.ts proves actual merges.
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-device', () => ({}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'id' }));
vi.mock('expo-notifications', () => ({}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, AppState: { currentState: 'active', addEventListener: vi.fn() } }));
vi.mock('@/utils/platform', () => ({ isRunningOnMac: () => false }));
vi.mock('@/sync/apiSocket', () => ({ apiSocket: {}, getCurrentAppState: () => 'active', getHappyHerdClientId: () => 'test' }));
vi.mock('@/sync/webTabTitle', () => ({ notifyUnreadMessage: vi.fn() }));
vi.mock('@/sync/encryption/encryption', () => ({ Encryption: class {} }));
vi.mock('@/sync/encryption/artifactEncryption', () => ({ ArtifactEncryption: class {} }));
vi.mock('@/sync/encryption/encryptionCache', () => ({ EncryptionCache: class {} }));
vi.mock('@/sync/storage', () => ({ storage: { getState: () => ({
    ...mocks.state, getActiveSessions: () => [],
    applyFeedItems: mocks.applyFeedItems, applyFeedRead: mocks.applyFeedRead,
}) } }));
vi.mock('@/sync/ops', () => ({ sessionSetAgentModes: vi.fn() }));
vi.mock('@/sync/persistence', () => ({ loadPendingSettings: () => ({}), savePendingSettings: vi.fn() }));
vi.mock('@/sync/revenueCat', () => ({ RevenueCat: {}, LogLevel: {}, PaywallResult: {} }));
vi.mock('@/sync/serverConfig', () => ({ getServerUrl: () => 'https://example.invalid' }));
vi.mock('@/sync/pushRegistration', () => ({ syncCurrentPushToken: vi.fn() }));
vi.mock('@/sync/apiArtifacts', () => ({ fetchArtifact: vi.fn(), fetchArtifacts: vi.fn(), createArtifact: vi.fn(), updateArtifact: vi.fn() }));
vi.mock('@/sync/apiFriends', () => ({ getFriendsList: vi.fn(), getUserProfile: vi.fn() }));
vi.mock('@/sync/apiFeed', () => ({ fetchFeed: mocks.fetchFeed }));
vi.mock('@/sync/apiAttachments', () => ({ requestAttachmentUpload: vi.fn(), uploadEncryptedBlob: vi.fn() }));
vi.mock('@/sync/apiProjects', () => ({ fetchProjects: vi.fn() }));
vi.mock('@/sync/projects', () => ({ decryptProjectRecord: vi.fn(), loadProjectAvatar: vi.fn() }));
vi.mock('@/sync/sessionAvatars', () => ({ loadSessionAvatar: vi.fn(async () => null) }));
vi.mock('@/config', () => ({ config: {} }));
vi.mock('@/log', () => ({ log: { log: vi.fn() } }));
vi.mock('@/track', () => ({ tracking: null }));
vi.mock('@/modal', () => ({ Modal: {} }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/encryption/blob', () => ({}));
vi.mock('@/utils/readFileBytes', () => ({}));
vi.mock('@/sync/gitStatusSync', () => ({ gitStatusSync: {} }));
vi.mock('@/realtime/hooks/voiceHooks', () => ({ voiceHooks: {} }));

import { sync } from './sync';

let engine: any;
const credentials = { token: 'account-a', secret: 'test' };
function item(counter: number, patch: Partial<FeedItem> = {}): FeedItem {
    return { id: `item-${counter}`, counter, cursor: `0-${counter}`, repeatKey: null,
        createdAt: counter, readAt: null, body: { kind: 'text', text: `Update ${counter}` }, ...patch };
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('__DEV__', false);
    mocks.state = { feedAccount: 'server/account-a', feedHead: '0-2', feedTail: '0-1',
        feedItems: [item(2), item(1)], users: {} };
    engine = new (sync.constructor as new () => typeof sync)();
    engine.credentials = credentials;
    engine.encryption = {};
});
afterEach(() => { engine.sessionAvatars.clear(); vi.unstubAllGlobals(); });

describe('Inbox reconnect reconciliation', () => {
    it('refetches known rows newest-first and retains persisted read markers from another device', async () => {
        mocks.fetchFeed.mockResolvedValueOnce({ items: [item(3), item(2, { readAt: 100 })], hasMore: true });
        mocks.fetchFeed.mockResolvedValueOnce({ items: [item(1, { readAt: 101 })], hasMore: false });
        await engine.fetchFeed();
        expect(mocks.fetchFeed.mock.calls).toEqual([
            [credentials, { limit: 100, before: undefined }],
            [credentials, { limit: 100, before: '0-2' }],
        ]);
        expect(mocks.applyFeedItems).toHaveBeenCalledExactlyOnceWith([item(3), item(2, { readAt: 100 }), item(1, { readAt: 101 })]);
    });

    it('continues past 500 newer rows to reconcile every older item retained before disconnect', async () => {
        mocks.state.feedHead = '0-50';
        mocks.state.feedTail = '0-1';
        mocks.state.feedItems = [item(50), item(1)];
        mocks.fetchFeed.mockImplementation(async (_credentials, { before }) => {
            const highest = before ? Number(before.slice(2)) - 1 : 650;
            const lowest = Math.max(1, highest - 99);
            return { items: Array.from({ length: highest - lowest + 1 }, (_, index) =>
                item(highest - index, { readAt: highest - index <= 50 ? 100 : null })), hasMore: lowest > 1 };
        });
        await engine.fetchFeed();
        expect(mocks.fetchFeed).toHaveBeenCalledTimes(7);
        const applied: FeedItem[] = mocks.applyFeedItems.mock.calls[0][0];
        expect(applied).toHaveLength(650);
        expect(applied.find(({ id }) => id === 'item-1')?.readAt).toBe(100);
        expect(applied.find(({ id }) => id === 'item-50')?.readAt).toBe(100);
        expect(applied.find(({ id }) => id === 'item-650')?.readAt).toBeNull();
    });

    it('keeps the initial-load bound when no older feed items are retained', async () => {
        mocks.state.feedHead = null;
        mocks.state.feedTail = null;
        mocks.state.feedItems = [];
        mocks.fetchFeed.mockImplementation(async (_credentials, { before }) => {
            const highest = before ? Number(before.slice(2)) - 1 : 650;
            return { items: Array.from({ length: 100 }, (_, index) => item(highest - index)), hasMore: true };
        });
        await engine.fetchFeed();
        expect(mocks.fetchFeed).toHaveBeenCalledTimes(5);
        expect(mocks.applyFeedItems.mock.calls[0][0]).toHaveLength(500);
    });

    it('terminates an empty page even if its response claims more pages', async () => {
        mocks.fetchFeed.mockResolvedValueOnce({ items: [], hasMore: true });
        await engine.fetchFeed();
        expect(mocks.fetchFeed).toHaveBeenCalledOnce();
        expect(mocks.applyFeedItems).toHaveBeenCalledExactlyOnceWith([]);
    });

    it.each(['account', 'credentials'])('does not apply an old fetch after %s changes', async (changed) => {
        let finish!: (value: unknown) => void;
        mocks.fetchFeed.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        const fetching = engine.fetchFeed();
        if (changed === 'account') mocks.state.feedAccount = 'server/account-b';
        else engine.credentials = { token: 'account-b', secret: 'other' };
        finish({ items: [item(1, { readAt: 100 })], hasMore: false });
        await fetching;
        expect(mocks.applyFeedItems).not.toHaveBeenCalled();
    });

    it('dispatches socket read receipts and preserves persisted item read state', async () => {
        await engine.handleUpdate({ id: 'read-update', seq: 1, createdAt: 100,
            body: { t: 'feed-read', through: '0-2', readAt: 100 } });
        expect(mocks.applyFeedRead).toHaveBeenCalledWith(expect.objectContaining({ through: '0-2', readAt: 100 }));
        await engine.handleUpdate({ id: 'new-update', seq: 2, createdAt: 101,
            body: { t: 'new-feed-post', ...item(2, { readAt: 100 }) } });
        expect(mocks.applyFeedItems).toHaveBeenCalledWith([item(2, { readAt: 100 })]);
    });
});
