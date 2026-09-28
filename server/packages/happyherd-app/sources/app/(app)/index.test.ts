import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ authenticated: true, phoneLayout: false }));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return { Text: host('Text'), View: host('View'), ScrollView: host('ScrollView'), useWindowDimensions: () => ({ width: 1440, height: 900 }) };
});
vi.mock('react-native-unistyles', () => ({
    StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
    useUnistyles: () => ({ theme: { dark: true, colors: {} } }),
    withUnistyles: (component: unknown) => component,
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn(), navigate: vi.fn() }) }));
vi.mock('expo-crypto', () => ({ getRandomBytesAsync: vi.fn() }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: state.authenticated }) }));
vi.mock('@/auth/authGetToken', () => ({ authGetToken: vi.fn() }));
vi.mock('@/auth/accountKeyLifecycle', () => ({ accountAccessRoutes: {} }));
vi.mock('@/encryption/base64', () => ({ encodeBase64: vi.fn() }));
vi.mock('@/track', () => ({ trackAccountCreated: vi.fn(), trackAccountRestored: vi.fn() }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/components/RoundButton', () => ({ RoundButton: () => null }));
vi.mock('@/components/HomeHeader', () => ({ HomeHeaderNotAuth: () => null }));
vi.mock('@/components/herd/pages/HerdLanding', async () => {
    const ReactModule = await import('react');
    return { HerdLanding: () => ReactModule.createElement('HerdLanding') };
});
// The empty main view this route used to show beside the left panel.
vi.mock('@/components/MainView', async () => {
    const ReactModule = await import('react');
    return { MainView: () => ReactModule.createElement('MainView') };
});
vi.mock('@/components/herd/mobile/PhoneHome', async () => {
    const ReactModule = await import('react');
    return { PhoneHome: () => ReactModule.createElement('PhoneHome') };
});
vi.mock('@/components/herd/mobile/useHerdPhone', () => ({ useHerdPhoneLayout: () => state.phoneLayout }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import Home from './index';

const renderers: ReactTestRenderer[] = [];
beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
    act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()));
    Object.assign(state, { authenticated: true, phoneLayout: false });
});

function render() {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(React.createElement(Home));
    });
    renderers.push(renderer);
    return renderer;
}

describe('The signed-in index route', () => {
    it('shows the landing beside the left panel on wider layouts', () => {
        const renderer = render();
        expect(renderer.root.findAllByType('HerdLanding' as any)).toHaveLength(1);
        expect(renderer.root.findAllByType('PhoneHome' as any)).toHaveLength(0);
    });

    it('shows the session list page in the phone layout', () => {
        state.phoneLayout = true;
        const renderer = render();
        expect(renderer.root.findAllByType('PhoneHome' as any)).toHaveLength(1);
        expect(renderer.root.findAllByType('HerdLanding' as any)).toHaveLength(0);
    });
});
