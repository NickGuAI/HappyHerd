import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ platform: 'web', width: 390, tablet: false, customServer: true, push: vi.fn() }));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Platform: { get OS() { return state.platform; } },
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        View: host('View'),
        useWindowDimensions: () => ({ width: state.width, height: 768 }),
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
vi.mock('expo-router', async () => {
    const ReactModule = await import('react');
    return {
        Redirect: (props: any) => ReactModule.createElement('Redirect', props),
        Stack: { Screen: (props: any) => ReactModule.createElement('StackScreen', props) },
        useRouter: () => ({ push: state.push }),
        usePathname: () => '/settings',
    };
});
vi.mock('@/components/SettingsView', async () => {
    const ReactModule = await import('react');
    return { SettingsView: () => ReactModule.createElement('SettingsView') };
});
vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});
vi.mock('@/components/layout', () => ({ layout: { maxWidth: 800 } }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}), mono: () => ({}) } }));
vi.mock('@/sync/storage', () => ({ useSetting: () => false }));
vi.mock('@/sync/serverConfig', () => ({ isUsingCustomServer: () => state.customServer }));
vi.mock('@/utils/responsive', () => ({ useIsTablet: () => state.tablet }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/track', () => ({ trackWhatsNewClicked: () => {} }));

import SettingsPage from './index';

const renderers: ReactTestRenderer[] = [];
beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
    act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()));
    Object.assign(state, { platform: 'web', width: 390, tablet: false, customServer: true });
    state.push.mockClear();
});

function render(): ReactTestRenderer {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(React.createElement(SettingsPage));
    });
    renderers.push(renderer);
    return renderer;
}

function headerRight() {
    return render().root.findByType('StackScreen' as any).props.options.headerRight as (() => React.ReactElement) | undefined;
}

describe('Settings without a home page', () => {
    // The desktop section list sits beside the page from 1,000 px on the web.
    it.each([
        ['a desktop window', { width: 1440 }],
        ['a 1024 × 768 browser window', { width: 1024 }],
        ['the frame width exactly', { width: 1000 }],
        ['the macOS build', { platform: 'macos', width: 1280 }],
        ['a wide native tablet', { platform: 'ios', width: 1366, tablet: true }],
    ])('opens Account in place of this route in %s', (_label, layout) => {
        Object.assign(state, layout);
        const renderer = render();
        const redirects = renderer.root.findAllByType('Redirect' as any);
        expect(redirects.map((node: any) => node.props.href)).toEqual(['/settings/account']);
        expect(renderer.root.findAllByType('SettingsView' as any)).toHaveLength(0);
    });

    it.each([
        ['a 390 px phone browser', { width: 390 }],
        ['an 800 px window', { width: 800 }],
        ['1 px below the frame width', { width: 999 }],
        ['a native phone', { platform: 'ios', width: 390 }],
        ['a narrow native tablet', { platform: 'ios', width: 900, tablet: true }],
        ['Android', { platform: 'android', width: 412 }],
    ])('is the section list on %s', (_label, layout) => {
        Object.assign(state, layout);
        const renderer = render();
        expect(renderer.root.findAllByType('Redirect' as any)).toHaveLength(0);
        expect(renderer.root.findAllByType('SettingsView' as any)).toHaveLength(1);
    });
});

describe('Settings server configuration on the section list', () => {
    it('opens a custom server\'s configuration from the title row', () => {
        const right = headerRight();
        expect(right).toEqual(expect.any(Function));
        let button!: ReactTestRenderer;
        act(() => {
            button = create(right!());
        });
        renderers.push(button);
        const pressable = button.root.findByType('Pressable' as any);
        expect(pressable.props.testID).toBe('settings-server-configuration');
        expect(pressable.props).toMatchObject({ accessibilityRole: 'button', accessibilityLabel: 'server.serverConfiguration' });
        act(() => pressable.props.onPress());
        expect(state.push).toHaveBeenCalledWith('/server');
    });

    it('shows nothing there on the default server', () => {
        for (const layout of [{ width: 390, tablet: false }, { width: 800, tablet: true }, { platform: 'ios', width: 844, tablet: false }]) {
            Object.assign(state, { customServer: false, platform: 'web', ...layout });
            expect(headerRight()).toBeUndefined();
        }
    });

    // It is the only signed-in way to /server, so the width rule must not take it away.
    it.each([
        ['a 390 px phone browser', { width: 390, tablet: false }],
        ['699 px on the web', { width: 699, tablet: true }],
        ['700 px on the web', { width: 700, tablet: false }],
        ['999 px on the web', { width: 999, tablet: false }],
        ['a native phone in landscape', { platform: 'ios', width: 844, tablet: false }],
        ['a narrow native tablet', { platform: 'ios', width: 900, tablet: true }],
    ])('keeps it on %s with a custom server', (_label, layout) => {
        Object.assign(state, { platform: 'web', customServer: true, ...layout });
        expect(headerRight()).toEqual(expect.any(Function));
    });
});
