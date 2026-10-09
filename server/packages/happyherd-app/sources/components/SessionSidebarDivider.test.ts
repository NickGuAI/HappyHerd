import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ platform: 'web', pan: null as any }));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    return {
        Platform: { get OS() { return native.platform; } },
        PanResponder: { create: (config: any) => { native.pan = config; return { panHandlers: { onResponderMove: config.onPanResponderMove } }; } },
        View: (props: any) => ReactModule.createElement('View', props, props.children),
    };
});

vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        create: (styles: unknown) => styles,
    },
    useUnistyles: () => ({
        theme: {
            colors: {
                divider: '#ddd',
                textLink: '#06c',
                textSecondary: '#666',
            },
        },
    }),
}));

vi.mock('@/text', () => ({ t: (key: string) => key }));

import { SessionSidebarDivider } from './SessionSidebarDivider';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());

describe('SessionSidebarDivider', () => {
    it('captures a pointer and translates a left drag into a wider right panel', () => {
        const onWidthChange = vi.fn();
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(SessionSidebarDivider, { width: 360, onWidthChange }));
        });
        const divider = renderer.root.findByProps({ testID: 'session-sidebar-divider' });
        const currentTarget = { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() };

        act(() => divider.props.onPointerDown({
            nativeEvent: { pointerId: 4, clientX: 900, button: 0 },
            currentTarget,
            preventDefault: vi.fn(),
        }));
        act(() => divider.props.onPointerMove({
            nativeEvent: { pointerId: 4, clientX: 700 },
            currentTarget,
            preventDefault: vi.fn(),
        }));
        act(() => divider.props.onPointerUp({
            nativeEvent: { pointerId: 4, clientX: 700 },
            currentTarget,
        }));

        expect(onWidthChange).toHaveBeenCalledWith(560);
        expect(currentTarget.setPointerCapture).toHaveBeenCalledWith(4);
        expect(currentTarget.releasePointerCapture).toHaveBeenCalledWith(4);
        expect(divider.props.accessibilityLabel).toBe('sideChat.resizePanel');
    });

    it('supports accessible 40-pixel increments and decrements', () => {
        const onWidthChange = vi.fn();
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(SessionSidebarDivider, { width: 360, onWidthChange }));
        });
        const divider = renderer.root.findByProps({ testID: 'session-sidebar-divider' });

        act(() => divider.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
        act(() => divider.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }));

        expect(onWidthChange.mock.calls).toEqual([[400], [320]]);
    });
});


describe('native panel divider', () => {
    it('uses a native drag and preserves the gesture start width', () => {
        native.platform = 'ios';
        const onWidthChange = vi.fn();
        let renderer!: ReactTestRenderer;
        act(() => { renderer = create(React.createElement(SessionSidebarDivider, { width: 360, onWidthChange })); });
        act(() => native.pan.onPanResponderGrant());
        act(() => native.pan.onPanResponderMove({}, { dx: -120 }));
        act(() => native.pan.onPanResponderMove({}, { dx: 40 }));
        expect(onWidthChange.mock.calls).toEqual([[480], [320]]);
        act(() => native.pan.onPanResponderRelease());
        act(() => renderer.unmount());
        native.platform = 'web';
    });
});
