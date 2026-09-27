import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Session } from '@/sync/storageTypes';
import type { Message, ToolCall } from '@/sync/typesMessage';

const state = vi.hoisted(() => ({
    platform: 'ios',
    tablet: false,
    mac: false,
    // 0 takes a phone's or a desktop window's size from `tablet`.
    width: 0,
    session: null as Session | null,
    message: null as Message | null,
    messagesLoaded: false,
    params: { id: 'session-id' } as Record<string, string>,
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    sessionVisible: vi.fn(),
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Platform: {
            get OS() { return state.platform; },
            select: (values: any) => values[state.platform] ?? values.default,
        },
        StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1 },
        useWindowDimensions: () => ({ width: state.width || (state.tablet ? 1440 : 390), height: state.tablet ? 900 : 844 }),
        View: host('View'), Text: host('Text'), TextInput: host('TextInput'), Pressable: host('Pressable'),
        ActivityIndicator: host('ActivityIndicator'), TouchableOpacity: host('TouchableOpacity'), Image: host('Image'),
        Animated: {
            Value: class { constructor(public value: number) {} },
            timing: () => ({ start: (callback?: (result: { finished: boolean }) => void) => callback?.({ finished: true }) }),
            View: host('AnimatedView'),
        },
    };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
vi.mock('react-native-reanimated', () => ({}));
vi.mock('@/utils/platform', () => ({ isRunningOnMac: () => state.mac }));
vi.mock('@/utils/responsive', () => ({ useHeaderHeight: () => 52, useIsTablet: () => state.tablet }));
vi.mock('@/components/layout', () => ({ layout: { maxWidth: 800, headerMaxWidth: 800 } }));
vi.mock('react-native-unistyles', async () => {
    const { lightTheme } = await import('@/theme');
    const theme = {
        ...lightTheme,
        dark: false,
        colors: {
            ...lightTheme.colors,
            text: 'text', textSecondary: 'secondary', surface: 'surface', divider: 'divider',
            gitAddedText: 'green', gitRemovedText: 'red',
            header: { tint: 'tint', background: 'background' },
            glass: { border: 'border', backgroundStrong: 'glass', shadow: 'shadow' },
            groupped: { background: 'background', chevron: 'chevron' },
            shadow: { color: 'shadow', opacity: 1, offset: { width: 0, height: 1 }, radius: 2 },
        },
    };
    return {
        useUnistyles: () => ({ theme }),
        StyleSheet: { create: (factory: any) => typeof factory === 'function' ? factory(theme, { insets: { top: 0 } }) : factory, hairlineWidth: 1 },
    };
});
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    const Icon = (props: any) => ReactModule.createElement('Icon', props);
    return { Ionicons: Icon, Octicons: Icon };
});
vi.mock('@/components/MobileGlass', async () => {
    const ReactModule = await import('react');
    return {
        MobileGlassSurface: (props: any) => ReactModule.createElement('Glass', props, props.children),
        MobileGlassBackdrop: () => null,
    };
});
vi.mock('@/components/BubblePressable', async () => {
    const ReactModule = await import('react');
    return { BubblePressable: (props: any) => ReactModule.createElement('BubblePressable', props, props.children) };
});
vi.mock('@/components/navigation/MobileHeaderScrim', () => ({
    MobileHeaderScrim: () => null,
    MOBILE_HOME_SCRIM_OVERLAY_OPACITY: 1,
    MOBILE_STRONG_HEADER_SCRIM_RESTING_OPACITY: 0,
    MOBILE_STRONG_HEADER_SCRIM_UNDERLAP_OPACITY: 1,
}));
vi.mock('expo-router', async () => {
    const ReactModule = await import('react');
    return {
        Stack: Object.assign((props: any) => ReactModule.createElement('Stack', props, props.children), {
            Screen: (props: any) => ReactModule.createElement('StackScreen', props),
        }),
        useRouter: () => ({ push: state.push, replace: state.replace, back: state.back }),
        useLocalSearchParams: () => state.params,
    };
});
vi.mock('@/sync/storage', () => ({
    useSession: () => state.session,
    useProjects: () => [],
    storage: { getState: () => ({ sessions: {} }) },
    useMessage: () => state.message,
    useSessionMessages: () => ({ isLoaded: state.messagesLoaded }),
    useIsDataReady: () => true,
    useLocalSetting: () => false,
    useSessionGitStatus: () => null,
    useSessionGitStatusFiles: () => null,
}));
vi.mock('@/sync/sync', () => ({ sync: { onSessionVisible: state.sessionVisible } }));
vi.mock('@/components/Deferred', async () => {
    const ReactModule = await import('react');
    return { Deferred: (props: any) => ReactModule.createElement('Deferred', props, props.children) };
});
vi.mock('@/components/tools/ToolFullView', async () => {
    const ReactModule = await import('react');
    return { ToolFullView: (props: any) => ReactModule.createElement('ToolFullView', props) };
});
vi.mock('@/utils/sessionUtils', () => ({
    getSessionName: () => 'A long session title that needs the available header width',
    useSessionStatus: () => ({ isConnected: true, isPulsing: true, statusText: 'Working' }),
    formatOSPlatform: () => '', formatPathRelativeToHome: (path: string) => path,
    getResumeCommand: () => null,
}));
vi.mock('@/text', () => ({ t: (key: string, params?: { count: number }) => params ? `${params.count} changed files` : key }));
vi.mock('@/components/Item', async () => {
    const ReactModule = await import('react');
    return { Item: (props: any) => ReactModule.createElement('Item', props, props.rightElement) };
});
vi.mock('@/components/ItemGroup', async () => {
    const ReactModule = await import('react');
    return { ItemGroup: (props: any) => ReactModule.createElement('ItemGroup', props, props.children) };
});
vi.mock('@/components/ItemList', async () => {
    const ReactModule = await import('react');
    return { ItemList: (props: any) => ReactModule.createElement('ItemList', props, props.children) };
});
vi.mock('@/components/CodeView', () => ({ CodeView: () => null }));
vi.mock('@react-navigation/native', () => ({
    useNavigation: () => ({ getState: () => ({ routes: [] }), dispatch: vi.fn() }),
    CommonActions: { navigate: vi.fn() }, StackActions: { pop: vi.fn() },
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'fixture-uuid' }));
vi.mock('@/components/ProviderIcon', () => ({ ProviderIcon: () => null }));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('@/modal', () => ({ Modal: { alert: vi.fn() } }));
vi.mock('@/sync/ops', () => ({ sessionArchive: vi.fn(), sessionKill: vi.fn(), sessionDelete: vi.fn() }));
vi.mock('@/hooks/useWorktreeCleanup', () => ({ maybeCleanupWorktree: vi.fn() }));
vi.mock('@/hooks/useHappyHerdAction', () => ({ useHappyHerdAction: (action: unknown) => [false, action] }));
vi.mock('@/hooks/useSessionQuickActions', () => ({ useSessionQuickActions: () => ({}) }));
vi.mock('@/utils/copySessionMetadataToClipboard', () => ({
    copySessionMetadataToClipboard: vi.fn(), copySessionMetadataAndLogsToClipboard: vi.fn(),
}));
vi.mock('@/utils/versionUtils', () => ({ isVersionSupported: () => true, MINIMUM_CLI_VERSION: '1' }));

import { ChatHeaderView } from './ChatHeaderView';
import { Header, createHeader, createPlainHeader } from './navigation/Header';
import { HerdWindowInsetsContext } from './herd/shell/windowInsets';
import { GitLineChanges } from './GitLineChanges';
import { RigGitLineChanges } from './RigGitLineChanges';
import SessionInfo from '@/app/(app)/session/[id]/info';
import MessageDetails from '@/app/(app)/session/[id]/message/[messageId]';
import RootLayout from '@/app/(app)/_layout';

const renderers: ReturnType<typeof create>[] = [];
const originalConsoleError = console.error;
beforeAll(() => {
    vi.stubGlobal('__DEV__', false);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});
afterEach(() => {
    act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()));
    state.platform = 'ios';
    state.tablet = false;
    state.mac = false;
    state.width = 0;
    state.message = null;
    state.messagesLoaded = false;
    state.params = { id: 'session-id' };
    state.push.mockClear();
    state.replace.mockClear();
    state.back.mockClear();
    state.sessionVisible.mockClear();
});
afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function render(element: React.ReactElement) {
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(element); });
    renderers.push(renderer!);
    return renderer!;
}
function texts(renderer: ReturnType<typeof create>): string[] {
    return renderer.root.findAllByType('Text').map((node: any) => node.children.join(''));
}

describe('chat header', () => {
    // HappyHerd keeps the folder/title/path header; the approved integration
    // does not relocate composer branch/count controls into this surface.
    // Phones (UI overhaul) stack the folder above the title on every platform.
    it.each([
        ['an iPhone', 'ios', false, ['nice', 'Session title']],
        ['an Android phone', 'android', false, ['nice', 'Session title']],
        ['Web Mobile', 'web', false, ['nice', 'Session title']],
        ['an iPad', 'ios', true, ['Session title', 'nice']],
        ['desktop Web', 'web', true, ['nice', '/', 'Session title']],
    ])('retains the folder and title hierarchy on %s', (_name, platform, tablet, expected) => {
        state.platform = platform as string;
        state.tablet = tablet as boolean;
        const renderer = render(React.createElement(ChatHeaderView, {
            title: 'Session title', folderName: 'nice',
        }));
        expect(texts(renderer)).toEqual(expected);
    });

    // Owner decision, 2026-09-27: native tablets, the iOS app on a Mac included, keep the
    // session header's own Back; web tablets and desktop leave history to the browser.
    it.each([
        ['an iPad', 'ios', true],
        ['an Android tablet', 'android', true],
        ['a web tablet or desktop', 'web', false],
    ])('shows the session header\'s own Back on %s: %s', (_name, platform, shown) => {
        state.platform = platform as string;
        state.tablet = true;
        const onBackPress = vi.fn();
        const renderer = render(React.createElement(ChatHeaderView, { title: 'Session title', folderName: 'nice', onBackPress }));
        const back = renderer.root.findAll((node: any) => node.type === 'Pressable' && node.props.accessibilityLabel === 'common.back');
        expect(back).toHaveLength(shown ? 1 : 0);
        if (shown) {
            act(() => back[0].props.onPress());
            expect(onBackPress).toHaveBeenCalledOnce();
        }
    });

    it('keeps the desktop header, with no Back, in a 1024 × 768 browser window the device rule calls a phone', () => {
        // An 8-inch diagonal: useIsTablet() is false, but the web lays out by width.
        state.platform = 'web';
        state.tablet = false;
        state.width = 1024;
        const renderer = render(React.createElement(ChatHeaderView, { title: 'Session title', folderName: 'nice', onBackPress: vi.fn() }));
        expect(texts(renderer)).toEqual(['nice', '/', 'Session title']);
        expect(renderer.root.findAll((node: any) => node.type === 'Pressable' && node.props.accessibilityLabel === 'common.back')).toHaveLength(0);
    });

    it('does not duplicate the folder when it equals the title', () => {
        expect(texts(render(React.createElement(ChatHeaderView, { title: 'nice', folderName: 'nice' })))).toEqual(['nice']);
    });

    it('keeps file-overlay paths visible without inventing git information', () => {
        expect(texts(render(React.createElement(ChatHeaderView, { title: 'Session' })))).toEqual(['Session']);
        // A phone puts the folder and title above the file's path.
        expect(texts(render(React.createElement(ChatHeaderView, {
            title: 'Session', folderName: 'nice', extraPathSegment: 'src/app.ts',
        })))).toEqual(['nice / Session', 'src/app.ts']);
        state.tablet = true;
        expect(texts(render(React.createElement(ChatHeaderView, {
            title: 'Session', folderName: 'nice', extraPathSegment: 'src/app.ts',
        })))).toEqual(['Session', 'nice', '•', 'src/app.ts']);
    });

    it('removes stale folder and overlay context when navigating back to chat', () => {
        const renderer = render(React.createElement(ChatHeaderView, {
            title: 'Session', folderName: 'nice', extraPathSegment: 'src/app.ts',
        }));
        expect(texts(renderer)).toEqual(['nice / Session', 'src/app.ts']);
        act(() => renderer.update(React.createElement(ChatHeaderView, { title: 'Session' })));
        expect(texts(renderer)).toEqual(['Session']);
    });
});

describe('session details', () => {
    it('puts single-Workspace Changes first without duplicating cached header statistics', () => {
        state.platform = 'web';
        state.session = {
            id: 'session-id', createdAt: 1, updatedAt: 1, seq: 1,
            metadata: {
                path: '/repo', host: 'machine',
                client: { id: 'rig', name: 'HappyHerd Agent', version: '1' },
                git: { changedFiles: 5, insertions: 120, deletions: 34, countsExact: true },
            },
        } as Session;
        const renderer = render(React.createElement(SessionInfo));
        const groups = renderer.root.findAllByType('ItemGroup');
        expect(groups[0].props.title).toBe('sessionInfo.quickActions');
        const items = renderer.root.findAllByType('Item');
        expect(items[0].props.title).toBe('files.changes');
        expect(items[0].props.subtitle).toBeUndefined();
        expect(items[0].props.rightElement).toBeUndefined();
        expect(texts(renderer)).toEqual([]);
        expect(items.some((item: any) => item.props.title === 'sessionInfo.connectionStatus')).toBe(true);
        expect(renderer.root.findAllByType('Glass')).toHaveLength(0);
        expect(renderer.root.findByType('StackScreen').props.options.headerTitle).toBe('A long session title that needs the available header width');
        act(() => items[0].props.onPress());
        expect(state.replace).toHaveBeenCalledWith({ pathname: '/session/[id]', params: { id: 'session-id', openChangesRequestId: 'fixture-uuid' } });
        expect(state.push).not.toHaveBeenCalled();
    });

    it.each([
        ['an iPad', 'ios', 1],
        ['an Android tablet', 'android', 1],
        ['a web tablet or desktop', 'web', 0],
    ])('gives a page header its own Back on %s', (_name, platform, backs) => {
        state.platform = platform as string;
        state.tablet = true;
        const goBack = vi.fn();
        const renderer = render(createPlainHeader({
            options: { headerTitle: 'Appearance' },
            route: { name: 'settings/appearance' }, back: { title: 'Settings' },
            navigation: { goBack },
        } as any)!);
        const presses = renderer.root.findAllByType('Pressable');
        expect(presses).toHaveLength(backs);
        if (backs) {
            act(() => presses[0].props.onPress());
            expect(goBack).toHaveBeenCalledOnce();
        }
    });

    it('honors left alignment so the title uses space after the back button', () => {
        const renderer = render(createPlainHeader({
            options: { headerTitle: 'Long session title', headerTitleAlign: 'left' },
            route: { name: 'session/[id]/info' }, back: { title: 'Chat' },
            navigation: { goBack: vi.fn() },
        } as any)!);
        const header = renderer.root.findByType((Header as any).type);
        expect(header.props.mobileTitleAlignment).toBe('start');
        expect(header.props.headerRight).toBeUndefined();
        expect(texts(renderer)).toEqual(['Long session title']);
    });

    it.each(['ios', 'android', 'web', 'ipad'])('centers the detail title between symmetric insets on %s', (platform) => {
        state.platform = platform === 'ipad' ? 'ios' : platform;
        state.tablet = platform === 'ipad';
        const renderer = render(createPlainHeader({
            options: { headerTitle: 'Long session title', headerTitleAlign: 'center' },
            route: { name: 'session/[id]/info' }, back: { title: 'Chat' },
            navigation: { goBack: vi.fn() },
        } as any)!);
        const header = renderer.root.findByType((Header as any).type);
        expect(header.props.mobileTitleAlignment).toBe('center');
        expect(header.props.titleAlignment).toBe('center');
        const centered = renderer.root.findAllByType('View').map((node: any) => flattenStyle(node.props.style))
            .find((style: any) => style.position === 'absolute' && style.alignItems === 'center');
        expect(centered.left).toBe(centered.right);
        const title = renderer.root.findByType('Text');
        expect(flattenStyle(title.props.style).textAlign).toBe('center');
        expect(title.props.numberOfLines).toBe(1);
    });

    it('keeps Web Workspace Changes available for a legacy session without cached statistics', () => {
        state.platform = 'web';
        state.session = {
            id: 'session-id', createdAt: 1, updatedAt: 1, seq: 1,
            metadata: { path: '/repo', host: 'machine' },
        } as Session;
        const renderer = render(React.createElement(SessionInfo));
        const firstItem = renderer.root.findAllByType('Item')[0];
        expect(firstItem.props.title).toBe('files.changes');
        expect(firstItem.props.rightElement).toBeUndefined();
        expect(firstItem.props.disabled).not.toBe(true);
        act(() => firstItem.props.onPress());
        expect(state.replace).toHaveBeenCalledWith({ pathname: '/session/[id]', params: { id: 'session-id', openChangesRequestId: 'fixture-uuid' } });
        expect(state.push).not.toHaveBeenCalled();
    });
});

function flattenStyle(style: any): Record<string, unknown> {
    return Array.isArray(style) ? Object.assign({}, ...style.map(flattenStyle)) : style || {};
}

function expectCountTypography(renderer: ReturnType<typeof create>) {
    const counts = renderer.root.findAllByType('Text').filter((node: any) => /^[+\-]\d/.test(node.children.join('')));
    expect(counts.length).toBeGreaterThan(0);
    for (const count of counts) {
        expect(flattenStyle(count.props.style)).toMatchObject({
            fontFamily: 'SpaceGrotesk-Regular', fontSize: 11, fontWeight: '600',
        });
    }
}

describe('shared git-count typography', () => {
    const changes = { approximate: false, insertions: 120, deletions: 34 };

    it('uses the grouped project font in the shared counts and flat-list adapter', () => {
        expectCountTypography(render(React.createElement(GitLineChanges, { changes })));
        expectCountTypography(render(React.createElement(RigGitLineChanges, {
            changedFiles: 2, countsExact: true, insertions: 120, deletions: 34,
        })));
    });

    it('keeps git counts separate from the retained folder/title header', () => {
        const renderer = render(React.createElement(ChatHeaderView, {
            title: 'Session', folderName: 'main',
        }));
        expect(texts(renderer)).toEqual(['main', 'Session']);
        expect(renderer.root.findAllByType(GitLineChanges)).toHaveLength(0);
        expectCountTypography(render(React.createElement(GitLineChanges, { changes })));
    });
});

describe('tool-detail navigation', () => {
    // The storage mock is not a subscription. Exercise the memo's render
    // function so updates model the real hooks notifying their consumer.
    const MessageDetailContent = (MessageDetails as any).type;
    function message(tool: Partial<ToolCall> = {}): Message {
        return {
            id: 'tool-message', kind: 'tool-call', createdAt: 1, localId: null, children: [],
            tool: { name: 'apply_patch', input: {}, description: null, createdAt: 1, state: 'running', ...tool },
        } as Message;
    }

    function rootOptions() {
        const root = render(React.createElement(RootLayout));
        return root.root.findAllByType('StackScreen')
            .find((node: any) => node.props.name === 'session/[id]/message/[messageId]').props.options;
    }

    function navElement(options: any) {
        return options.header({
            options, route: { name: 'session/[id]/message/[messageId]' },
            back: { title: 'Session' }, navigation: { goBack: state.back },
        });
    }

    it('chooses a plain, non-interactive title in the root route before hydration', () => {
        expect(rootOptions()).toMatchObject({ header: createPlainHeader, headerTitleAlign: 'center', headerShown: true });
    });

    it('keeps the same header geometry through loading, tool updates and text messages', () => {
        state.session = null;
        state.params = { id: 'session-id', messageId: 'tool-message' };
        const defaults = rootOptions();
        const screen = render(React.createElement(MessageDetailContent));
        const currentOptions = () => ({ ...defaults, ...screen.root.findByType('StackScreen').props.options });
        const nav = render(navElement(currentOptions()));
        const originalHeader = nav.root.findByType((Header as any).type);
        const geometry = () => nav.root.findAllByType('View').map((node: any) => flattenStyle(node.props.style))
            .filter((style: any) => style.height === 52 || style.position === 'absolute');
        const originalGeometry = geometry();

        expect(screen.root.findAllByType('ActivityIndicator')).toHaveLength(1);
        expect(nav.root.findAllByType('Glass')).toHaveLength(2); // Back plus the retained status slot, never the title.
        expect(originalHeader.props.mobileTitleSurface).toBe('plain');
        expect(nav.root.findAllByType('Pressable')).toHaveLength(1);
        expect(texts(nav)).toEqual(['common.message']);
        expect(state.sessionVisible).toHaveBeenCalledWith('session-id');

        for (const toolState of ['running', 'completed', 'error'] as const) {
            state.session = { id: 'session-id', metadata: { path: '/repo', host: 'machine' } } as Session;
            state.messagesLoaded = true;
            state.message = message({ state: toolState, title: 'A very long tool title '.repeat(20) });
            act(() => screen.update(React.createElement(MessageDetailContent)));
            act(() => nav.update(navElement(currentOptions())));

            expect(nav.root.findByType((Header as any).type)).toBe(originalHeader);
            expect(geometry()).toEqual(originalGeometry);
            expect(nav.root.findAllByType('Glass')).toHaveLength(2);
            expect(nav.root.findAllByType('Pressable')).toHaveLength(1);
            expect(currentOptions().headerRight).toEqual(expect.any(Function));
            expect(texts(nav)).toHaveLength(1);
            expect(nav.root.findByType('Text').props).toMatchObject({ numberOfLines: 1, ellipsizeMode: 'middle' });
            expect(nav.root.findByType('Text').props.onPress).toBeUndefined();
            expect(screen.root.findByType('ToolFullView').props.metadata).toBe(state.session.metadata);
        }

        state.message = { id: 'text', kind: 'agent-text', text: 'Response', createdAt: 1, localId: null } as Message;
        act(() => screen.update(React.createElement(MessageDetailContent)));
        act(() => nav.update(navElement(currentOptions())));
        expect(texts(nav)).toEqual(['common.message']);
        expect(geometry()).toEqual(originalGeometry);
        expect(currentOptions().headerRight).toEqual(expect.any(Function));
        act(() => nav.root.findByType('Pressable').props.onPress());
        expect(state.back).toHaveBeenCalledTimes(1);
    });

    it('keeps navigation available while a missing loaded message returns to the session', () => {
        state.messagesLoaded = true;
        state.message = null;
        const screen = render(React.createElement(MessageDetails));
        expect(screen.root.findAllByType('StackScreen')).toHaveLength(1);
        expect(screen.root.findAllByType('ActivityIndicator')).toHaveLength(1);
        expect(state.back).toHaveBeenCalledTimes(1);
    });
});

describe('page headers', () => {
    // Phones (UI overhaul), the iPhone included, draw every page's header with
    // navigation/Header, the title row under the top bar. The iPad keeps UIKit's.
    // Signed in, the layout renders under the top bar, which provides the window insets.
    function screenOptions(routeName: string, underTopBar = true) {
        const layout = render(underTopBar
            ? React.createElement(HerdWindowInsetsContext.Provider, { value: { top: 47, bottom: 34, left: 0, right: 0 } }, React.createElement(RootLayout))
            : React.createElement(RootLayout));
        return layout.root.findByType('Stack').props.screenOptions({ route: { name: routeName } });
    }

    it.each([
        ['an iPhone', 'ios', false, createHeader],
        ['an Android phone', 'android', false, createHeader],
        ['Web Mobile', 'web', false, createHeader],
        ['an iPad', 'ios', true, undefined],
        ['an Android tablet', 'android', true, createHeader],
        ['desktop Web', 'web', true, createHeader],
    ])('chooses a page\'s header on %s', (_name, platform, tablet, header) => {
        state.platform = platform as string;
        state.tablet = tablet as boolean;
        expect(screenOptions('settings/appearance').header).toBe(header);
    });

    it('keeps UIKit\'s header on a signed-out iPhone page, with no top bar above it', () => {
        state.platform = 'ios';
        state.tablet = false;
        expect(screenOptions('restore/index', false).header).toBeUndefined();
    });

    it('gives an iPhone page the phone title row and Back, and the drawer\'s destinations no Back', () => {
        const titleRow = (routeName: string, headerTitle: string) => {
            const options = { ...screenOptions(routeName), headerTitle };
            return render(React.createElement(HerdWindowInsetsContext.Provider, { value: { top: 47, bottom: 34, left: 0, right: 0 } }, options.header({
                options, route: { name: routeName }, back: { title: 'Home' }, navigation: { goBack: vi.fn() },
            })));
        };
        expect(screenOptions('automations/index')).toMatchObject({ header: createHeader, headerBackVisible: false });

        const page = titleRow('settings/appearance', 'Appearance');
        expect(page.root.findAllByType('Pressable').map((node: any) => node.props.testID)).toEqual(['header-back']);
        expect(page.root.findByType('Icon').props.name).toBe('arrow-back');
        expect(flattenStyle(page.root.findByType('Text').props.style)).toMatchObject({ fontSize: 22, textAlign: 'left' });

        const destination = titleRow('automations/index', 'Automations');
        expect(destination.root.findAllByType('Pressable')).toHaveLength(0);
        expect(flattenStyle(destination.root.findByType('Text').props.style)).toMatchObject({ fontSize: 24, textAlign: 'left' });
    });

    it('keeps Back on the drawer\'s destinations in the iOS app on a Mac, in a window the device rule calls a phone', () => {
        // Owner decision, 2026-09-27: the iOS app on a Mac keeps the tablet Back at any window size.
        state.platform = 'ios';
        state.tablet = false;
        state.mac = true;
        const options = { ...screenOptions('automations/index'), headerTitle: 'Automations' };
        expect(options.header).toBe(createHeader);
        expect(options).not.toHaveProperty('headerBackVisible');

        const destination = render(React.createElement(HerdWindowInsetsContext.Provider, { value: { top: 47, bottom: 34, left: 0, right: 0 } }, options.header({
            options, route: { name: 'automations/index' }, back: { title: 'Home' }, navigation: { goBack: vi.fn() },
        })));
        expect(destination.root.findAllByType('Pressable').map((node: any) => node.props.testID)).toEqual(['header-back']);
    });
});
