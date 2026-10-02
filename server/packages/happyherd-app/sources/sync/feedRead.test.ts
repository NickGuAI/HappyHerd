import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
    credentials: { token: 'account-a-token', secret: 'test' } as { token: string; secret: string } | null,
    endpoint: 'https://server-a.example.test',
}));
vi.mock('react-native-mmkv', () => ({
    MMKV: class { getString() { return undefined; } set() {} delete() {} },
}));
vi.mock('./sync', () => ({ sync: { getCredentials: () => boundary.credentials } }));
vi.mock('./serverConfig', () => ({ getServerUrl: () => boundary.endpoint }));
vi.mock('./apiSocket', () => ({ getHappyHerdClientId: () => 'test-app' }));
vi.mock('@/realtime/RealtimeSession', () => ({}));
vi.mock('@/components/tools/knownTools', () => ({ isMutableTool: () => false }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { storage } from './storage';
import { markAllFeedRead, markFeedItemRead } from './feedRead';
import type { FeedItem } from './feedTypes';

const request = vi.fn<typeof fetch>();
function item(counter: number, readAt: number | null = null): FeedItem {
    return { id: `item-${counter}`, counter, cursor: `0-${counter}`, repeatKey: null,
        createdAt: counter, readAt, body: { kind: 'text', text: `Update ${counter}` } };
}
function holdRequest() {
    let finish!: (response: Response) => void;
    request.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }));
    return (receipt: unknown) => finish(Response.json(receipt));
}

beforeEach(() => {
    request.mockReset();
    vi.stubGlobal('fetch', request);
    boundary.credentials = { token: 'account-a-token', secret: 'test' };
    boundary.endpoint = 'https://server-a.example.test';
    storage.getState().clearFeed();
    storage.getState().setFeedAccount('server-a/account-a');
    storage.getState().applyFeedItems([item(1), item(2)]);
});
afterEach(() => vi.unstubAllGlobals());

describe('Inbox read requests', () => {
    it('captures the Done cutoff and authentication before a newer update arrives', async () => {
        const finish = holdRequest();
        const reading = markAllFeedRead();
        expect(request).toHaveBeenCalledExactlyOnceWith('https://server-a.example.test/v1/feed/read', {
            method: 'POST', headers: { Authorization: 'Bearer account-a-token', 'X-Happy-Client': 'test-app', 'Content-Type': 'application/json' },
            body: JSON.stringify({ through: '0-2' }),
        });
        storage.getState().applyFeedItems([item(3)]);
        finish({ through: '0-2', readAt: 100 });
        await reading;
        expect(storage.getState().feedItems.map(({ readAt }) => readAt)).toEqual([null, 100, 100]);
    });

    it('still acknowledges the whole server snapshot when all loaded items are already read', async () => {
        storage.getState().applyFeedItems([item(1, 100), item(2, 100)]);
        request.mockImplementation(async () => Response.json({ through: '0-2', readAt: 200 }));
        await markAllFeedRead();
        await markAllFeedRead();
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls.map(([, init]) => init?.body)).toEqual([
            JSON.stringify({ through: '0-2' }), JSON.stringify({ through: '0-2' }),
        ]);
        expect(storage.getState().feedItems.map(({ readAt }) => readAt)).toEqual([100, 100]);
    });

    it('does nothing for an empty feed and skips missing or already-read individual items', async () => {
        storage.getState().applyFeedRead({ id: 'item-1', readAt: 100 });
        await markFeedItemRead('item-1');
        await markFeedItemRead('missing');
        storage.getState().clearFeed();
        await markAllFeedRead();
        expect(request).not.toHaveBeenCalled();
    });

    it('reads an individual update without changing its unread neighbor', async () => {
        request.mockResolvedValueOnce(Response.json({ id: 'item-1', readAt: 100 }));
        await markFeedItemRead('item-1');
        expect(request.mock.calls[0][1]?.body).toBe(JSON.stringify({ id: 'item-1' }));
        expect(storage.getState().feedItems.map(({ readAt }) => readAt)).toEqual([null, 100]);
        await markFeedItemRead('item-1');
        expect(request).toHaveBeenCalledOnce();
    });

    it.each(['account', 'server'])('ignores a reply after the active %s changes', async (changed) => {
        const finish = holdRequest();
        const reading = markAllFeedRead();
        if (changed === 'account') {
            boundary.credentials = { token: 'account-b-token', secret: 'other' };
            storage.getState().setFeedAccount('server-a/account-b');
            storage.getState().applyFeedItems([item(1)]);
        } else {
            boundary.endpoint = 'https://server-b.example.test';
        }
        finish({ through: '0-2', readAt: 100 });
        await reading;
        expect(storage.getState().feedItems.every(({ readAt }) => readAt === null)).toBe(true);
        expect(storage.getState().feedReadThrough).toBeNull();
    });

    it.each(['http', 'network', 'invalid receipt'])('leaves updates unread on %s failure and allows retry', async (failure) => {
        if (failure === 'http') request.mockResolvedValueOnce(new Response(null, { status: 500 }));
        else if (failure === 'network') request.mockRejectedValueOnce(new Error('offline'));
        else request.mockResolvedValueOnce(Response.json({ through: 'invalid', readAt: 100 }));
        await expect(markAllFeedRead()).rejects.toThrow();
        expect(storage.getState().feedItems.every(({ readAt }) => readAt === null)).toBe(true);
        request.mockResolvedValueOnce(Response.json({ through: '0-2', readAt: 100 }));
        await markAllFeedRead();
        expect(storage.getState().feedItems.every(({ readAt }) => readAt === 100)).toBe(true);
    });

    it.each(['credentials', 'account'])('requires an authenticated %s before a read request', async (missing) => {
        if (missing === 'credentials') boundary.credentials = null;
        else storage.setState({ feedAccount: null });
        await expect(markAllFeedRead()).rejects.toThrow('Feed is not authenticated');
        expect(request).not.toHaveBeenCalled();
    });
});
