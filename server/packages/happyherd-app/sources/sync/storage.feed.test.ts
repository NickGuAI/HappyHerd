import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native-mmkv', () => ({
    MMKV: class { getString() { return undefined; } set() {} delete() {} },
}));
vi.mock('./sync', () => ({ sync: {} }));
vi.mock('@/realtime/RealtimeSession', () => ({}));
vi.mock('@/components/tools/knownTools', () => ({ isMutableTool: () => false }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { storage } from './storage';
import type { FeedItem } from './feedTypes';

function item(counter: number, patch: Partial<FeedItem> = {}): FeedItem {
    return { id: `item-${counter}`, counter, cursor: `0-${counter}`, repeatKey: null,
        createdAt: counter, readAt: null, body: { kind: 'text', text: `Update ${counter}` }, ...patch };
}

beforeEach(() => {
    storage.getState().clearFeed();
    storage.getState().setFeedAccount('server/account-a');
});

describe('Inbox read state in the production store', () => {
    it('restores server read state after clearing memory while treating legacy items as unread', () => {
        storage.getState().applyFeedItems([item(1)]);
        storage.getState().applyFeedRead({ id: 'item-1', readAt: 100 });
        storage.getState().clearFeed();
        storage.getState().setFeedAccount('server/account-a');
        storage.getState().applyFeedItems([item(1, { readAt: 100 }), item(2, { readAt: undefined })]);
        expect(storage.getState().feedItems.map(({ id, readAt }) => [id, readAt])).toEqual([
            ['item-2', null], ['item-1', 100],
        ]);
    });

    it('reads only the selected item and does not let a stale fetch undo it', () => {
        storage.getState().applyFeedItems([item(1), item(2)]);
        storage.getState().applyFeedRead({ id: 'item-1', readAt: 100 });
        storage.getState().applyFeedItems([item(1), item(2)]);
        expect(storage.getState().feedItems.map(({ id, readAt }) => [id, readAt])).toEqual([
            ['item-2', null], ['item-1', 100],
        ]);
    });

    it.each([{ id: 'item-2', readAt: 100 }, { through: '0-2', readAt: 100 }])(
        'retains a read event received before its delayed item: %j', (receipt) => {
            storage.getState().applyFeedRead(receipt);
            storage.getState().applyFeedItems([item(2), item(3)]);
            expect(storage.getState().feedItems.map(({ id, readAt }) => [id, readAt])).toEqual([
                ['item-3', null], ['item-2', 100],
            ]);
        },
    );

    it('reads the Done snapshot and older delayed items, leaving later arrivals unread', () => {
        storage.getState().applyFeedItems([item(3), item(2)]);
        const through = storage.getState().feedHead!;
        storage.getState().applyFeedItems([item(4)]);
        storage.getState().applyFeedRead({ through, readAt: 100 });
        storage.getState().applyFeedRead({ through: '0-1', readAt: 90 });
        storage.getState().applyFeedItems([item(1), item(2), item(3)]);
        expect(storage.getState().feedItems.map(({ id, readAt }) => [id, readAt])).toEqual([
            ['item-4', null], ['item-3', 100], ['item-2', 100], ['item-1', 100],
        ]);
        expect(storage.getState().feedReadThrough).toEqual({ counter: 3, readAt: 100 });
    });

    it('retains one same-ID repeat-key item when a duplicate fetch or socket event arrives', () => {
        const notification = item(1, { repeatKey: 'friend-request-a' });
        storage.getState().applyFeedItems([notification]);
        storage.getState().applyFeedRead({ id: notification.id, readAt: 100 });
        storage.getState().applyFeedItems([notification, notification]);
        expect(storage.getState().feedItems).toEqual([{ ...notification, readAt: 100 }]);
    });

    it('keeps a newer repeat-key notification unread and rejects its delayed older version', () => {
        const previous = item(1, { repeatKey: 'friend-request-a' });
        const replacement = item(2, { repeatKey: previous.repeatKey });
        storage.getState().applyFeedItems([previous]);
        storage.getState().applyFeedRead({ through: previous.cursor, readAt: 100 });
        storage.getState().applyFeedItems([replacement]);
        storage.getState().applyFeedItems([previous]);
        expect(storage.getState().feedItems).toEqual([replacement]);
        expect(storage.getState().feedHead).toBe(replacement.cursor);
    });

    it('keeps read receipts for the same account but discards all feed state when switching accounts', () => {
        storage.getState().applyFeedItems([item(1)]);
        storage.getState().applyFeedRead({ through: '0-1', readAt: 100 });
        storage.getState().applyFeedRead({ id: 'item-2', readAt: 101 });
        storage.getState().setFeedAccount('server/account-a');
        expect(storage.getState().feedItems[0].readAt).toBe(100);
        expect(storage.getState().feedReadIds).toEqual({ 'item-2': 101 });

        storage.getState().setFeedAccount('server/account-b');
        expect(storage.getState()).toMatchObject({ feedAccount: 'server/account-b', feedItems: [],
            feedHead: null, feedTail: null, feedReadThrough: null, feedReadIds: {}, feedLoaded: false });
        storage.getState().applyFeedItems([item(1), item(2)]);
        expect(storage.getState().feedItems.every(({ readAt }) => readAt === null)).toBe(true);
    });

    it('resets receipts on clear and handles an empty or already-read snapshot idempotently', () => {
        storage.getState().applyFeedItems([]);
        expect(storage.getState().feedLoaded).toBe(true);
        storage.getState().applyFeedRead({ through: '0-2', readAt: 100 });
        storage.getState().applyFeedItems([item(2)]);
        storage.getState().applyFeedRead({ through: '0-2', readAt: 200 });
        expect(storage.getState().feedItems[0].readAt).toBe(100);
        storage.getState().clearFeed();
        expect(storage.getState()).toMatchObject({ feedAccount: null, feedItems: [], feedHead: null,
            feedTail: null, feedReadThrough: null, feedReadIds: {}, feedLoaded: false });
    });
});
