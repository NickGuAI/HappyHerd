import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
    width: 1440,
    os: 'web',
    experiments: false,
    pathname: '/settings',
    navigate: vi.fn(),
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Platform: {
            get OS() {
                return testState.os;
            },
        },
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        View: host('View'),
        useWindowDimensions: () => ({ width: testState.width, height: 900 }),
    };
});

vi.mock('react-native-unistyles', async () => {
    const { lightTheme } = await import('@/theme');
    return {
        StyleSheet: { create: (factory: (value: typeof lightTheme) => unknown) => factory(lightTheme) },
        useUnistyles: () => ({ theme: lightTheme }),
    };
});

vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});

vi.mock('expo-router', () => ({
    useRouter: () => ({ navigate: testState.navigate }),
    usePathname: () => testState.pathname,
}));

vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});

vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}), mono: () => ({}) } }));
vi.mock('@/sync/storage', () => ({ useSetting: (key: string) => (key === 'experiments' ? testState.experiments : undefined) }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { SETTINGS_SECTIONS, SettingsFrame, withSettingsFrame } from './SettingsFrame';

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
    testState.os = 'web';
    testState.experiments = false;
    testState.pathname = '/settings';
    testState.navigate.mockReset();
});

function render(section: React.ComponentProps<typeof SettingsFrame>['section']): ReactTestRenderer {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(React.createElement(SettingsFrame, {
            section,
            children: React.createElement('Page', { testID: 'settings-page' }),
        }));
    });
    return renderer;
}

function navItems(renderer: ReactTestRenderer) {
    return renderer.root.findAll((node: any) => (
        node.type === 'Pressable' && typeof node.props.testID === 'string' && node.props.testID.startsWith('settings-nav-')
    ));
}

describe('SettingsFrame', () => {
    it('lists every settings section and the About links beside the page on desktop', () => {
        const renderer = render('appearance');

        expect(renderer.root.findAllByType('Page' as any)).toHaveLength(1);
        expect(navItems(renderer).map((node: any) => node.props.accessibilityLabel)).toEqual([
            'settings.title',
            'settings.account',
            'newSession.streamline.modeStreamline',
            'settings.appearance',
            'uiCopy.agentDefaults',
            'settingsCredentials.title',
            'devicePairing.title',
            'settings.featuresTitle',
            'settings.voiceAssistant',
            'settingsLanguage.title',
            'happyHerd.commander.category',
            'settings.whatsNew',
        ]);
        expect(navItems(renderer).filter((node: any) => node.props.accessibilityState.selected)
            .map((node: any) => node.props.testID)).toEqual(['settings-nav-appearance']);
        expect(renderer.root.findAll((node: any) => node.type === 'ScrollView' && node.props.testID === 'settings-nav')[0]
            .props.accessibilityLabel).toBe('settings.sectionsLabel');
    });

    it('shows Usage only when experiments are on, like the Settings list', () => {
        testState.experiments = true;
        expect(navItems(render('general')).map((node: any) => node.props.testID)).toContain('settings-nav-usage');
    });

    it('switches sections through their existing routes and ignores the active one', () => {
        testState.pathname = '/settings/account';
        const renderer = render('account');
        const item = (id: string) => navItems(renderer).find((node: any) => node.props.testID === `settings-nav-${id}`)!;

        act(() => item('account').props.onPress());
        act(() => item('language').props.onPress());
        act(() => item('commanders').props.onPress());
        act(() => item('general').props.onPress());

        expect(testState.navigate.mock.calls.map(([route]) => route)).toEqual([
            '/settings/language',
            '/commanders',
            '/settings',
        ]);
        expect(SETTINGS_SECTIONS.map((entry) => entry.route)).toEqual([
            '/settings',
            '/settings/account',
            '/settings/streamline',
            '/settings/appearance',
            '/settings/agents',
            '/settings/credentials',
            '/settings/connections',
            '/settings/features',
            '/settings/usage',
            '/settings/voice',
            '/settings/language',
        ]);
    });

    it('returns from a nested page to its highlighted section', () => {
        testState.pathname = '/settings/voice/language';
        const renderer = render('voice');
        const voice = navItems(renderer).find((node: any) => node.props.testID === 'settings-nav-voice')!;
        expect(voice.props.accessibilityState.selected).toBe(true);

        act(() => voice.props.onPress());

        expect(testState.navigate).toHaveBeenCalledWith('/settings/voice');
    });

    it('keeps the page mounted, with its unsaved state, when the window crosses the frame width', () => {
        const mounts = vi.fn();
        function DraftPage() {
            React.useEffect(() => mounts(), []);
            return React.createElement('Page', { testID: 'settings-page' });
        }
        const tree = () => React.createElement(SettingsFrame, { section: 'credentials', children: React.createElement(DraftPage) });
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(tree());
        });
        expect(navItems(renderer).length).toBeGreaterThan(0);

        testState.width = 900;
        act(() => renderer.update(tree()));
        expect(navItems(renderer)).toHaveLength(0);

        testState.width = 1440;
        act(() => renderer.update(tree()));
        expect(navItems(renderer).length).toBeGreaterThan(0);
        expect(mounts).toHaveBeenCalledTimes(1);
    });

    it('keeps the stacked phone and narrow-window navigation unchanged', () => {
        testState.width = 390;
        let renderer = render('appearance');
        expect(navItems(renderer)).toHaveLength(0);
        expect(renderer.root.findAllByType('Page' as any)).toHaveLength(1);

        testState.width = 1440;
        testState.os = 'ios';
        renderer = render('appearance');
        expect(navItems(renderer)).toHaveLength(0);
    });

    it('wraps a route screen and forwards its props', () => {
        const Screen = (props: { label: string }) => React.createElement('Page', props);
        const Framed = withSettingsFrame('voice', Screen);
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(Framed, { label: 'voice page' }));
        });

        expect(renderer.root.findByType('Page' as any).props.label).toBe('voice page');
        expect(navItems(renderer).find((node: any) => node.props.accessibilityState.selected)?.props.testID)
            .toBe('settings-nav-voice');
    });
});
