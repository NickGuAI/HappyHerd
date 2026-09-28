import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ platform: 'web', width: 1440, customServer: true, push: vi.fn(), frameAction: vi.fn() }));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Platform: { get OS() { return state.platform; } },
        Pressable: host('Pressable'),
        View: host('View'),
        useWindowDimensions: () => ({ width: state.width, height: 900 }),
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
vi.mock('@/components/ConnectionsSettingsView', () => ({ ConnectionsSettingsView: () => null }));
vi.mock('@/components/herd/pages/SettingsFrame', () => ({
    withSettingsFrame: (_section: string, Screen: React.ComponentType) => Screen,
    useSettingsFrameAction: (action: unknown) => state.frameAction(action),
}));
vi.mock('@/sync/serverConfig', () => ({ isUsingCustomServer: () => state.customServer }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import ConnectionsPage from './connections';
import { SettingsServerButton } from '@/components/herd/pages/SettingsServerButton';

const renderers: ReactTestRenderer[] = [];
beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
    act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()));
    Object.assign(state, { platform: 'web', width: 1440, customServer: true });
    state.push.mockClear();
    state.frameAction.mockClear();
});

function render() {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(React.createElement(ConnectionsPage));
    });
    renderers.push(renderer);
    return renderer;
}

describe('Connections server configuration', () => {
    // Settings has no home page, so Connections carries the server action at every width:
    // in the header row, and beside the page title where the desktop frame draws it.
    it.each([
        ['a desktop window', { width: 1440 }],
        ['a 1024 × 768 window', { width: 1024 }],
        ['an 800 px window', { width: 800 }],
        ['a phone browser', { width: 390 }],
        ['a native phone', { platform: 'ios', width: 390 }],
    ])('keeps a custom server\'s configuration on the title row in %s', (_label, layout) => {
        Object.assign(state, layout);
        const renderer = render();
        const right = renderer.root.findByType('StackScreen' as any).props.options.headerRight as () => React.ReactElement;
        expect(state.frameAction).toHaveBeenLastCalledWith(SettingsServerButton);
        let button!: ReactTestRenderer;
        act(() => {
            button = create(right());
        });
        renderers.push(button);
        const pressable = button.root.findByType('Pressable' as any);
        expect(pressable.props.testID).toBe('settings-server-configuration');
        act(() => pressable.props.onPress());
        expect(state.push).toHaveBeenCalledWith('/server');
    });

    it('shows nothing there on the default server', () => {
        state.customServer = false;
        const renderer = render();
        expect(renderer.root.findByType('StackScreen' as any).props.options.headerRight).toBeUndefined();
        expect(state.frameAction).toHaveBeenLastCalledWith(null);
    });
});
