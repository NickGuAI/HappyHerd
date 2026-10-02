import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    updateAvailable: false, friendRequests: [] as unknown[], requestedFriends: [] as unknown[],
    feedItems: [] as { readAt?: number | null }[], hasUnread: false,
}));
vi.mock('./useUpdates', () => ({ useUpdates: () => ({ updateAvailable: state.updateAvailable }) }));
vi.mock('./useChangelog', () => ({ useChangelog: () => ({ hasUnread: state.hasUnread }) }));
vi.mock('@/sync/storage', () => ({
    useFriendRequests: () => state.friendRequests,
    useRequestedFriends: () => state.requestedFriends,
    useFeedItems: () => state.feedItems,
}));

import { useInboxHasContent } from './useInboxHasContent';

beforeEach(() => Object.assign(state, {
    updateAvailable: false, friendRequests: [], requestedFriends: [], feedItems: [], hasUnread: false,
}));

describe('Inbox notification sources', () => {
    it('clears the feed notification after its final unread update is read', () => {
        state.feedItems = [{ readAt: 100 }, { readAt: null }];
        expect(useInboxHasContent()).toBe(true);
        state.feedItems[1].readAt = 101;
        expect(useInboxHasContent()).toBe(false);
        state.feedItems.push({});
        expect(useInboxHasContent()).toBe(true);
    });

    it.each(['updateAvailable', 'friendRequests', 'requestedFriends', 'hasUnread'] as const)(
        'preserves the independent %s notification after every feed item is read', (source) => {
            state.feedItems = [{ readAt: 100 }];
            if (source === 'friendRequests' || source === 'requestedFriends') state[source] = [{}];
            else state[source] = true;
            expect(useInboxHasContent()).toBe(true);
        },
    );

    it('has no notification for an empty Inbox without independent updates', () => {
        expect(useInboxHasContent()).toBe(false);
    });
});
