import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Modal: host('Modal'),
        Platform: { OS: 'web' },
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        View: host('View'),
    };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
vi.mock('react-native-unistyles', async () => {
    const { lightTheme } = await import('@/theme');
    return {
        StyleSheet: { create: (factory: (value: typeof lightTheme) => unknown) => factory(lightTheme) },
        useUnistyles: () => ({ theme: lightTheme }),
    };
});
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}), mono: () => ({}) } }));
vi.mock('./HerdPage', () => ({ useHerdWideLayout: () => true }));

import { HerdSheet } from './HerdSheet';

const originalConsoleError = console.error;

// Browsers accept a boolean capture flag in removeEventListener; Node's
// EventTarget only matches the options object, so normalize it here.
class BrowserWindowTarget extends EventTarget {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
        super.addEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options);
    }
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
        super.removeEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options);
    }
}
const windowTarget = new BrowserWindowTarget();

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('window', windowTarget);
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const renderers: ReactTestRenderer[] = [];
afterEach(() => act(() => renderers.splice(0).forEach((renderer) => renderer.unmount())));

/** Dispatches a keydown like the browser does and reports whether a listener handled it. */
function pressKey(key: string): boolean {
    const event = new Event('keydown', { cancelable: true });
    Object.defineProperty(event, 'key', { value: key });
    windowTarget.dispatchEvent(event);
    return event.defaultPrevented;
}

function sheet(visible: boolean, onClose: () => void) {
    return React.createElement(HerdSheet, {
        visible,
        title: 'Create automation',
        closeLabel: 'Close',
        onClose,
        children: React.createElement('Form'),
    });
}

describe('HerdSheet', () => {
    it('marks Escape handled while open, so closing it never also navigates Back', () => {
        const onClose = vi.fn();
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(sheet(true, onClose));
        });
        renderers.push(renderer);

        // The Modal host still closes the sheet (React Native Web: Escape keyup).
        expect(renderer.root.findByType('Modal' as any).props.onRequestClose).toBe(onClose);
        expect(pressKey('Escape')).toBe(true);
        expect(pressKey('Enter')).toBe(false);

        act(() => renderer.update(sheet(false, onClose)));
        expect(pressKey('Escape')).toBe(false);
        expect(onClose).not.toHaveBeenCalled();
    });
});
