import * as React from 'react';
import Module from 'node:module';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Production component evidence with native host stubs, not a device journey.
const state = vi.hoisted(() => ({
    os: 'ios', authenticated: false,
    token: vi.fn(), login: vi.fn(), random: vi.fn(), alert: vi.fn(), created: vi.fn(),
}));
vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Platform: { get OS() { return state.os; } }, Alert: { alert: state.alert },
        View: host('View'), Text: host('Text'), ScrollView: host('ScrollView'),
        Pressable: host('Pressable'), ActivityIndicator: host('ActivityIndicator'),
        useWindowDimensions: () => ({ width: 390, height: 844 }),
    };
});
vi.mock('react-native-unistyles', async () => {
    const { lightTheme } = await import('@/theme');
    return {
        StyleSheet: { create: (factory: any) => factory(lightTheme), absoluteFillObject: {} },
        useUnistyles: () => ({ theme: lightTheme }), withUnistyles: (component: any) => component,
    };
});
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 34 }) }));
vi.mock('expo-crypto', () => ({ getRandomBytesAsync: state.random }));
vi.mock('@/auth/authGetToken', () => ({ authGetToken: state.token }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: state.authenticated, login: state.login }) }));
vi.mock('@/track', () => ({ trackAccountCreated: state.created, trackAccountRestored: vi.fn() }));
vi.mock('@/components/HomeHeader', () => ({ HomeHeaderNotAuth: () => null }));
vi.mock('@/components/herd/pages/HerdLanding', () => ({ HerdLanding: () => null }));
vi.mock('@/components/herd/mobile/PhoneHomeRoute', () => ({ PhoneHomeRoute: () => React.createElement('AuthenticatedPhoneHome') }));
vi.mock('@/components/herd/mobile/useHerdPhone', () => ({ useHerdPhoneLayout: () => true }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/modal', async () => await import('@/modal/ModalManager'));
import Home from '@/app/(app)/index';

let renderer: ReactTestRenderer | undefined;
beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // Metro resolves bundled image requires; Node only needs their opaque source IDs.
    const loader = Module as unknown as { _load: (path: string, ...args: any[]) => any };
    const originalLoad = loader._load;
    vi.spyOn(loader, '_load').mockImplementation((path, ...args) =>
        path.startsWith('@/assets/images/') ? path : originalLoad(path, ...args));
    const originalError = console.error;
    vi.spyOn(console, 'error').mockImplementation((message, ...args) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalError(message, ...args);
    });
});
afterAll(() => vi.restoreAllMocks());
afterEach(() => { if (renderer) act(() => renderer.unmount()); renderer = undefined; });
beforeEach(() => {
    state.authenticated = false;
    for (const mock of [state.token, state.login, state.random, state.alert, state.created]) mock.mockReset();
    state.random.mockResolvedValue(new Uint8Array(32).fill(7));
    state.login.mockImplementation(async () => { state.authenticated = true; });
});
const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};
async function mount() { await act(async () => { renderer = create(React.createElement(Home)); }); }
function createButton() {
    return renderer!.root.findAll((node: any) => node.type === 'Pressable')
        .find((node: any) => node.findAll((child: any) => child.type === 'Text' && child.props.children === 'welcome.createAccount').length)!;
}
function expectIdle() {
    expect(createButton().props.accessibilityRole).toBe('button');
    expect(createButton().props.accessibilityState).toEqual({ disabled: false, busy: false });
    expect(renderer!.root.findAllByType('ActivityIndicator')).toHaveLength(0);
}

describe.each(['ios', 'android'])('shared welcome native components (%s)', (os) => {
    beforeEach(() => { state.os = os; });
    it('rejects safely, prevents simultaneous presses, and retries through the native alert into the authenticated branch', async () => {
        const first = deferred<string>();
        const retry = deferred<string>();
        state.token.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
        await mount();
        expectIdle();
        const press = createButton().props.onPress;
        await act(async () => { press(); press(); press(); });
        expect(state.random).toHaveBeenCalledExactlyOnceWith(32);
        expect(state.token).toHaveBeenCalledTimes(1);
        expect(createButton().props.disabled).toBe(true);
        expect(createButton().props.accessibilityState).toEqual({ disabled: true, busy: true });
        expect(renderer!.root.findAllByType('ActivityIndicator')).toHaveLength(1);
        await act(async () => { first.reject(new Error('HTTP 503 private-server-diagnostic')); });
        expectIdle();
        expect(state.login).not.toHaveBeenCalled();
        expect(state.created).not.toHaveBeenCalled();
        expect(state.alert).toHaveBeenCalledTimes(1);
        const [title, message, buttons] = state.alert.mock.calls[0];
        expect(title).toBe('common.error');
        expect(message).toBe('welcome.accountCreationFailed');
        expect(JSON.stringify([title, message, buttons])).not.toContain('private-server-diagnostic');
        expect(buttons).toEqual([
            expect.objectContaining({ text: 'common.cancel', style: 'cancel' }),
            expect.objectContaining({ text: 'common.retry', onPress: expect.any(Function) }),
        ]);
        await act(async () => { buttons[1].onPress(); buttons[1].onPress(); press(); });
        expect(state.token).toHaveBeenCalledTimes(2);
        expect(createButton().props.accessibilityState).toEqual({ disabled: true, busy: true });
        await act(async () => { retry.resolve('fixture-token'); });
        expect(state.login).toHaveBeenCalledExactlyOnceWith('fixture-token', Buffer.from(new Uint8Array(32).fill(7)).toString('base64url'), 'new-account');
        expect(state.created).toHaveBeenCalledTimes(1);
        expect(state.alert).toHaveBeenCalledTimes(1);
        await act(async () => { renderer!.update(React.createElement(Home)); });
        expect(renderer!.root.findAllByType('AuthenticatedPhoneHome')).toHaveLength(1);
        expect(renderer!.root.findAllByType('Pressable')).toHaveLength(0);
    });
    it.each(['missing-token', 'entropy-rejection'])('makes %s visible and leaves retry usable', async (failure) => {
        if (failure === 'entropy-rejection') {
            state.random.mockRejectedValueOnce(new Error('private entropy diagnostic'));
            state.token.mockResolvedValue('fixture-token');
        } else {
            state.token.mockResolvedValueOnce(undefined).mockResolvedValueOnce('fixture-token');
        }
        await mount();
        await act(async () => { createButton().props.onPress(); });
        expectIdle();
        expect(state.alert).toHaveBeenCalledTimes(1);
        expect(state.alert.mock.calls[0].slice(0, 2)).toEqual(['common.error', 'welcome.accountCreationFailed']);
        expect(state.login).not.toHaveBeenCalled();
        expect(state.created).not.toHaveBeenCalled();
        expect(state.token).toHaveBeenCalledTimes(failure === 'entropy-rejection' ? 0 : 1);
        const retry = state.alert.mock.calls[0][2].find((button: any) => button.text === 'common.retry');
        await act(async () => { retry.onPress(); });
        expect(state.login).toHaveBeenCalledExactlyOnceWith(
            'fixture-token', Buffer.from(new Uint8Array(32).fill(7)).toString('base64url'), 'new-account',
        );
        expect(state.created).toHaveBeenCalledTimes(1);
        expect(state.alert).toHaveBeenCalledTimes(1);
    });

    it('resets after a dismissed failure and after a login failure so Create account remains usable', async () => {
        state.token.mockRejectedValueOnce(new TypeError('Network request failed')).mockResolvedValue('fixture-token');
        state.login.mockRejectedValueOnce(new Error('local login failure')).mockImplementationOnce(async () => { state.authenticated = true; });
        await mount();
        await act(async () => { createButton().props.onPress(); });
        expectIdle();
        const cancel = state.alert.mock.calls[0][2].find((button: any) => button.style === 'cancel');
        await act(async () => { cancel.onPress?.(); });
        expect(state.token).toHaveBeenCalledTimes(1);
        await act(async () => { createButton().props.onPress(); });
        expectIdle();
        expect(state.alert).toHaveBeenCalledTimes(2);
        expect(state.created).not.toHaveBeenCalled();
        await act(async () => { createButton().props.onPress(); });
        expect(state.login).toHaveBeenCalledTimes(2);
        expect(state.created).toHaveBeenCalledTimes(1);
    });
});
