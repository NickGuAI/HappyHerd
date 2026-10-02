import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
    width: 1440,
    platform: 'web',
    tablet: true,
    push: vi.fn(),
    feed: [] as any[],
    machines: {} as Record<string, { metadata: { displayName: string; host: string } }>,
    markAll: vi.fn(),
    markItem: vi.fn(),
    alert: vi.fn(),
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, typeof props.children === 'function' ? props.children({ pressed: false }) : props.children);
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Platform: { get OS() { return testState.platform; }, select: (options: Record<string, unknown>) => options[testState.platform] ?? options.default },
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        Text: host('Text'),
        View: host('View'),
        useWindowDimensions: () => ({ width: testState.width, height: 900 }),
    };
});
vi.mock('react-native-unistyles', async () => {
    const { lightTheme } = await import('@/theme');
    return {
        StyleSheet: { hairlineWidth: 1, create: (factory: (value: typeof lightTheme) => unknown) => factory(lightTheme) },
        useUnistyles: () => ({ theme: lightTheme }),
    };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});
vi.mock('expo-image', async () => {
    const ReactModule = await import('react');
    return { Image: (props: any) => ReactModule.createElement('ExpoImage', props) };
});
vi.mock('expo-router', () => ({ useRouter: () => ({ push: testState.push }) }));
vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});
vi.mock('@/components/herd/pages/HerdList', async () => {
    const ReactModule = await import('react');
    return {
        HerdItemGroup: (props: any) => ReactModule.createElement('ItemGroup', props, props.children),
        HerdItem: (props: any) => ReactModule.createElement('Item', props),
    };
});
vi.mock('./navigation/Header', async () => {
    const ReactModule = await import('react');
    return { Header: (props: any) => ReactModule.createElement('Header', props, props.title, props.headerRight?.()) };
});
vi.mock('@/components/UserCard', () => ({ UserCard: () => null }));
vi.mock('./UpdateBanner', () => ({ UpdateBanner: () => null }));
vi.mock('./VoiceAssistantStatusBar', () => ({ VoiceAssistantStatusBar: () => null }));
vi.mock('./Avatar', () => ({ Avatar: () => null }));
vi.mock('@/components/layout', () => ({ layout: { maxWidth: 800 } }));
vi.mock('@/utils/responsive', () => ({ useIsTablet: () => testState.tablet }));
vi.mock('@/track', () => ({ trackFriendsSearch: () => {}, trackFriendsProfileView: () => {} }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}), mono: () => ({}) } }));
vi.mock('@/sync/storage', () => ({
    useAcceptedFriends: () => [],
    useFriendRequests: () => [],
    useRequestedFriends: () => [],
    useFeedItems: () => testState.feed,
    useFeedLoaded: () => true,
    useFriendsLoaded: () => true,
    useRealtimeStatus: () => 'disconnected',
    useUser: (id?: string) => id ? { id, firstName: 'Ada', username: 'ada' } : undefined,
    useMachine: (machineId: string) => testState.machines[machineId] ?? null,
}));
vi.mock('@/sync/feedRead', () => ({ markAllFeedRead: testState.markAll, markFeedItemRead: testState.markItem }));
vi.mock('@/modal', () => ({ Modal: { alert: testState.alert } }));
vi.mock('@/text', async () => {
    const { default: en } = await import('@/text/locales/en.json');
    return {
        t: (key: string, values?: Record<string, unknown>) => {
            const message = key === 'feed.automationBlocked' ? en.feed.automationBlocked
                : key === 'feed.automationBlockedGeneric' ? en.feed.automationBlockedGeneric : undefined;
            if (message) return message.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name]));
            return values?.count !== undefined ? `${key}(${values.count})` : key;
        },
    };
});

import { InboxView } from './InboxView';
import { FeedBodySchema } from '@/sync/feedTypes';
import { FeedItemCard } from './FeedItemCard';

const originalConsoleError = console.error;
beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => {
    testState.width = 1440;
    testState.platform = 'web';
    testState.tablet = true;
    testState.push.mockReset();
    testState.machines = {};
    testState.markAll.mockReset().mockResolvedValue(undefined);
    testState.markItem.mockReset().mockResolvedValue(undefined);
    testState.alert.mockReset();
    testState.feed = [
        { id: 'feed-1', repeatKey: null, cursor: 'c1', counter: 1, createdAt: Date.now() - 2 * 60_000, body: { kind: 'text', text: 'Nightly audit finished' } },
        { id: 'feed-2', repeatKey: null, cursor: 'c2', counter: 2, createdAt: Date.now() - 3 * 3_600_000, body: { kind: 'text', text: 'HappyHerd 1.4.2 is available' } },
    ];
});

function render(): ReactTestRenderer {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(React.createElement(InboxView));
    });
    return renderer;
}

const texts = (node: any): unknown[] => node.findAllByType('Text' as any).map((entry: any) => entry.props.children).flat(Infinity);

describe('Inbox page (UI overhaul, mock fidelity)', () => {
    it.each([
        { width: 1440, machineKnown: true },
        { width: 390, machineKnown: true },
        { width: 1440, machineKnown: false },
        { width: 390, machineKnown: false },
    ])('opens Automations from a blocked-run Inbox update at width $width (machine known: $machineKnown)', ({ width, machineKnown }) => {
        testState.width = width;
        testState.tablet = width > 768;
        if (machineKnown) {
            testState.machines['machine-1'] = { metadata: { displayName: 'Work laptop', host: 'work-host' } };
        }
        testState.feed = [{
            id: 'blocked', repeatKey: 'automation-blocked', cursor: 'c3', counter: 3,
            createdAt: Date.now(),
            body: { kind: 'automation_blocked', machineId: 'machine-1', automationId: 'automation-1', runId: 'run-1' },
        }];
        expect(FeedBodySchema.parse(testState.feed[0].body)).toEqual(testState.feed[0].body);
        const renderer = render();
        const card = renderer.root.findAll((node: any) => node.type === 'Pressable' && node.props.testID === 'feed-card-blocked');
        expect(card).toHaveLength(1);
        const title = machineKnown
            ? 'An automation on Work laptop is blocked by run run-1. Open Automations to stop or abandon it.'
            : 'An automation is blocked by run run-1. Open Automations to stop or abandon it.';
        expect(texts(card[0])).toContain(title);
        expect(card[0].props.accessibilityLabel).toBe(title);
        expect(renderer.root.findAll((node: any) => node.type === 'View' && node.props.testID === 'feed-unread-blocked')).toHaveLength(1);
        act(() => card[0].props.onPress());
        expect(testState.markItem).toHaveBeenCalledWith('blocked');
        expect(testState.push).toHaveBeenCalledWith({ pathname: '/automations', params: { machineId: 'machine-1', automationId: 'automation-1' } });
    });

    it.each(['row', 'card'] as const)('keeps automation %s navigation immediate, deduplicates pending reads and removes an acknowledged dot', async (variant) => {
        const item = {
            ...testState.feed[0],
            body: { kind: 'automation_blocked' as const, machineId: 'machine-1', automationId: 'automation-1', runId: 'run-1' },
            readAt: null,
        };
        let rejectRead!: (error: Error) => void;
        testState.markItem.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectRead = reject; }));
        let renderer!: ReactTestRenderer;
        act(() => { renderer = create(React.createElement(FeedItemCard, { item, variant })); });
        const target = () => renderer.root.findByType(variant === 'row' ? 'Item' as any : 'Pressable' as any);
        act(() => { target().props.onPress(); target().props.onPress(); });
        expect(testState.push).toHaveBeenCalledTimes(2);
        expect(testState.push).toHaveBeenLastCalledWith({ pathname: '/automations', params: { machineId: 'machine-1', automationId: 'automation-1' } });
        expect(testState.markItem).toHaveBeenCalledExactlyOnceWith(item.id);
        const dot = () => variant === 'row'
            ? target().props.icon.props.children[1]
            : renderer.root.findAll((node: any) => node.type === 'View' && node.props.testID === 'feed-unread-feed-1')[0];
        expect(dot()).toBeTruthy();
        await act(async () => rejectRead(new Error('offline')));
        expect(testState.alert).toHaveBeenCalledWith('common.error', 'inbox.markReadFailed');
        expect(dot()).toBeTruthy();
        await act(async () => target().props.onPress());
        expect(testState.markItem).toHaveBeenCalledTimes(2);
        act(() => renderer.update(React.createElement(FeedItemCard, { item: { ...item, readAt: 123 }, variant })));
        expect(dot()).toBeFalsy();
        act(() => target().props.onPress());
        expect(testState.markItem).toHaveBeenCalledTimes(2);
        expect(testState.push).toHaveBeenCalledTimes(4);
        act(() => renderer.unmount());
    });

    it.each(['web', 'macos'])('draws the large Inbox title with Find Friends on its row on wide %s', (platform) => {
        testState.platform = platform;
        const renderer = render();
        const head = renderer.root.findAll((node: any) => node.type === 'View' && node.props?.testID === 'inbox-page-header');
        expect(head).toHaveLength(1);
        expect(texts(head[0])).toEqual(expect.arrayContaining(['tabs.inbox', 'friends.findFriends', 'common.done']));
        expect(renderer.root.findAllByType('Header' as any)).toHaveLength(0);
        const find = head[0].findAll((node: any) => node.type === 'Pressable' && node.props.accessibilityLabel === 'friends.findFriends');
        act(() => find[0].props.onPress());
        expect(testState.push).toHaveBeenCalledWith('/friends/search');
    });

    it('keeps the header row on a narrower tablet window', () => {
        testState.width = 800;
        const renderer = render();
        expect(renderer.root.findAll((node: any) => node.props?.testID === 'inbox-page-header')).toHaveLength(0);
        expect(renderer.root.findAllByType('Header' as any)).toHaveLength(1);
    });

    it('shows each update as its own card with the time at the right, in a borderless list', () => {
        const renderer = render();
        const group = renderer.root.findByType('ItemGroup' as any);
        expect(group.props.containerStyle).toMatchObject({ borderWidth: 0, backgroundColor: 'transparent', gap: 8 });
        const cards = renderer.root.findAll((node: any) => node.type === 'Pressable' && /^feed-card-/.test(node.props?.testID ?? ''));
        expect(cards.map((card: any) => card.props.testID)).toEqual(['feed-card-feed-1', 'feed-card-feed-2']);
        expect(texts(cards[0])).toEqual(['Nightly audit finished', 'time.minutesAgo(2)']);
        expect(renderer.root.findAllByType('Item' as any)).toHaveLength(0);
    });

    it.each(['web', 'ios', 'android', 'macos', 'windows'])('exposes Done and Find Friends on the compact %s title row without a shell', async (platform) => {
        testState.platform = platform;
        testState.width = 390;
        testState.tablet = false;
        const renderer = render();
        expect(renderer.root.findAllByType('Header' as any)).toHaveLength(1);
        const done = renderer.root.findAll((node: any) => node.type === 'Pressable' && node.props.testID === 'inbox-mark-all-read')[0];
        await act(async () => done.props.onPress());
        expect(testState.markAll).toHaveBeenCalledOnce();
        const find = renderer.root.findAll((node: any) => node.type === 'Pressable' && node.props.accessibilityLabel === 'friends.findFriends')[0];
        act(() => find.props.onPress());
        expect(testState.push).toHaveBeenCalledWith('/friends/search');
    });

    it('keeps Done available for an already-read loaded page to cover older updates', async () => {
        testState.feed = testState.feed.map((item) => ({ ...item, readAt: 123 }));
        const renderer = render();
        const done = renderer.root.findAll((node: any) => node.type === 'Pressable' && node.props.testID === 'inbox-mark-all-read')[0];
        expect(done.props.disabled).toBe(false);
        expect(renderer.root.findAll((node: any) => node.type === 'View' && /^feed-unread-/.test(node.props.testID ?? ''))).toHaveLength(0);
        await act(async () => done.props.onPress());
        expect(testState.markAll).toHaveBeenCalledOnce();
    });

    it('retains dots on mark-all failure, shows the localized error and permits retry', async () => {
        testState.markAll.mockRejectedValueOnce(new Error('offline'));
        const renderer = render();
        const done = () => renderer.root.findAll((node: any) => node.type === 'Pressable' && node.props.testID === 'inbox-mark-all-read')[0];
        await act(async () => done().props.onPress());
        expect(testState.alert).toHaveBeenCalledWith('common.error', 'inbox.markReadFailed');
        expect(renderer.root.findAll((node: any) => node.type === 'View' && /^feed-unread-/.test(node.props.testID ?? ''))).toHaveLength(2);
        expect(done().props.disabled).toBe(false);
        await act(async () => done().props.onPress());
        expect(testState.markAll).toHaveBeenCalledTimes(2);
    });

    it.each(['row', 'card'] as const)('marks each supported %s kind read and preserves friend navigation', async (variant) => {
        for (const kind of ['text', 'friend_request', 'friend_accepted']) {
            const item = { ...testState.feed[0], body: kind === 'text' ? { kind, text: 'Update' } : { kind, uid: 'friend-1' } };
            let renderer!: ReactTestRenderer;
            act(() => { renderer = create(React.createElement(FeedItemCard, { item, variant })); });
            const target = renderer.root.findByType(variant === 'row' ? 'Item' as any : 'Pressable' as any);
            await act(async () => target.props.onPress());
            expect(testState.markItem).toHaveBeenLastCalledWith(item.id);
            if (kind !== 'text') expect(testState.push).toHaveBeenLastCalledWith('/user/friend-1');
            act(() => renderer.unmount());
        }
    });

    it('leaves a failed single update unread while preserving friend navigation and retry', async () => {
        testState.feed = [{ ...testState.feed[0], body: { kind: 'friend_request', uid: 'friend-1' } }];
        testState.markItem.mockRejectedValueOnce(new Error('offline'));
        const renderer = render();
        const card = renderer.root.findAll((node: any) => node.type === 'Pressable' && node.props.testID === 'feed-card-feed-1')[0];
        await act(async () => card.props.onPress());
        expect(testState.push).toHaveBeenCalledWith('/user/friend-1');
        expect(testState.alert).toHaveBeenCalledWith('common.error', 'inbox.markReadFailed');
        await act(async () => card.props.onPress());
        expect(testState.push).toHaveBeenCalledWith('/user/friend-1');
    });

    it('opens the existing friend destination immediately while the read request is pending', async () => {
        testState.feed = [{ ...testState.feed[0], body: { kind: 'friend_request', uid: 'friend-1' } }];
        let resolveRead!: () => void;
        testState.markItem.mockImplementation(() => new Promise<void>((resolve) => { resolveRead = resolve; }));
        const renderer = render();
        const card = renderer.root.findAll((node: any) => node.type === 'Pressable' && node.props.testID === 'feed-card-feed-1')[0];
        act(() => card.props.onPress());
        expect(testState.push).toHaveBeenCalledWith('/user/friend-1');
        act(() => card.props.onPress());
        expect(testState.push).toHaveBeenCalledTimes(2);
        expect(testState.markItem).toHaveBeenCalledOnce();
        expect(renderer.root.findAll((node: any) => node.type === 'View' && node.props.testID === 'feed-unread-feed-1')).toHaveLength(1);
        await act(async () => resolveRead());
    });
});
