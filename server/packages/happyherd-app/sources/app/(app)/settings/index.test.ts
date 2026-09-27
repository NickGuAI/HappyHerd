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
        Stack: { Screen: (props: any) => ReactModule.createElement('StackScreen', props) },
        useRouter: () => ({ push: state.push }),
    };
});
vi.mock('@/components/SettingsView', () => ({ SettingsView: () => null }));
vi.mock('@/components/herd/pages/SettingsFrame', () => ({ withSettingsFrame: (_section: string, Screen: React.ComponentType) => Screen }));
vi.mock('@/sync/serverConfig', () => ({ isUsingCustomServer: () => state.customServer }));
vi.mock('@/utils/responsive', () => ({ useIsTablet: () => state.tablet }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

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

function headerRight() {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(React.createElement(SettingsPage));
    });
    renderers.push(renderer);
    return renderer.root.findByType('StackScreen' as any).props.options.headerRight as (() => React.ReactElement) | undefined;
}

describe('Settings on a phone', () => {
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

    it('shows nothing there on the default server or on a tablet', () => {
        state.customServer = false;
        expect(headerRight()).toBeUndefined();
        Object.assign(state, { customServer: true, tablet: true, width: 1024 });
        expect(headerRight()).toBeUndefined();
    });

    it('shows nothing there in a 1024 × 768 browser window, though the device rule calls it a phone', () => {
        // An 8-inch diagonal: useIsTablet() is false, but the web lays out by width.
        Object.assign(state, { tablet: false, width: 1024 });
        expect(headerRight()).toBeUndefined();
    });

    it('keeps it at 699 px on the web and drops it at 700 px', () => {
        Object.assign(state, { tablet: true, width: 699 });
        expect(headerRight()).toEqual(expect.any(Function));
        Object.assign(state, { tablet: false, width: 700 });
        expect(headerRight()).toBeUndefined();
    });

    it('keeps it on a native phone in landscape, where the device decides', () => {
        Object.assign(state, { platform: 'ios', tablet: false, width: 844 });
        expect(headerRight()).toEqual(expect.any(Function));
    });
});
