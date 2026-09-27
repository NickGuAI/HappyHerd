import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const layout = vi.hoisted(() => ({ wide: true, tablet: true, insets: { top: 0, right: 0, bottom: 0, left: 0 } }));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Modal: host('Modal'),
        Platform: { OS: 'web' },
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        View: host('View'),
        useWindowDimensions: () => ({ width: layout.wide ? 1440 : 390, height: layout.wide ? 900 : 844 }),
    };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => layout.insets }));
vi.mock('@/utils/responsive', () => ({ useIsTablet: () => layout.tablet }));
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
vi.mock('./HerdPage', () => ({ useHerdWideLayout: () => layout.wide }));

import { lightTheme } from '@/theme';
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
afterEach(() => {
    act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()));
    Object.assign(layout, { wide: true, tablet: true, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
});

const flat = (style: any): Record<string, any> => Array.isArray(style)
    ? Object.assign({}, ...style.flat(Infinity).filter(Boolean))
    : (style ?? {});

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

    it('rests on a phone\'s bottom edge as a card 8 px from its sides and bottom, below the top bar', () => {
        Object.assign(layout, { wide: false, tablet: false, insets: { top: 47, right: 0, bottom: 34, left: 0 } });
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(sheet(true, vi.fn()));
        });
        renderers.push(renderer);
        const dialog = renderer.root.findAll((node: any) => node.props.role === 'dialog' && typeof node.type === 'string')[0];
        const root = dialog.parent.parent;
        expect(flat(root.props.style)).toMatchObject({ justifyContent: 'flex-end', paddingHorizontal: 8, paddingBottom: 42 });
        const frame = flat(dialog.props.style);
        // Rounded on every corner, as wide as the margins allow, and clear of the 52 px top bar.
        expect(frame).toMatchObject({ width: '100%', maxWidth: '100%', borderRadius: lightTheme.kilv.radiusSheet, maxHeight: 844 - 47 - 52 - 34 - 8 - 20 });
        expect(frame.borderTopLeftRadius).toBeUndefined();
        // No drag handle: the card closes from its close button, the scrim and Escape.
        expect(dialog.children.filter((child: any) => typeof child !== 'string' && flat(child.props.style).height === 4)).toEqual([]);
        // Content sits on the card's 16 px gutter.
        const header = dialog.children[0];
        expect(flat(header.props.style)).toMatchObject({ paddingHorizontal: 16, paddingTop: 20 });
    });

    it('keeps the bottom sheet with its handle on a narrow tablet layout', () => {
        Object.assign(layout, { wide: false, tablet: true });
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(sheet(true, vi.fn()));
        });
        renderers.push(renderer);
        const dialog = renderer.root.findAll((node: any) => node.props.role === 'dialog' && typeof node.type === 'string')[0];
        expect(flat(dialog.props.style).borderTopLeftRadius).toBe(lightTheme.kilv.radiusBottomSheet);
        expect(flat(dialog.children[0].props.style)).toMatchObject({ width: 38, height: 4 });
    });
});
