import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
    width: 1440,
    tablet: true,
    push: vi.fn(),
    feed: [] as any[],
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, typeof props.children === 'function' ? props.children({ pressed: false }) : props.children);
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Platform: { OS: 'web', select: (options: Record<string, unknown>) => options.web ?? options.default },
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
    return { Header: (props: any) => ReactModule.createElement('Header', props) };
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
    useUser: () => undefined,
}));
vi.mock('@/text', () => ({
    t: (key: string, values?: Record<string, unknown>) => (values?.count !== undefined ? `${key}(${values.count})` : key),
}));

import { InboxView } from './InboxView';

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
    testState.tablet = true;
    testState.push.mockReset();
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
    it('draws the large Inbox title with Find Friends on its row on wide web, instead of the header row', () => {
        const renderer = render();
        const head = renderer.root.findAll((node: any) => node.type === 'View' && node.props?.testID === 'inbox-page-header');
        expect(head).toHaveLength(1);
        expect(texts(head[0])).toEqual(expect.arrayContaining(['tabs.inbox', 'friends.findFriends']));
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
        const cards = renderer.root.findAll((node: any) => node.type === 'View' && /^feed-card-/.test(node.props?.testID ?? ''));
        expect(cards.map((card: any) => card.props.testID)).toEqual(['feed-card-feed-1', 'feed-card-feed-2']);
        expect(texts(cards[0])).toEqual(['Nightly audit finished', 'time.minutesAgo(2)']);
        expect(renderer.root.findAllByType('Item' as any)).toHaveLength(0);
    });
});
