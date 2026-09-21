import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    return {
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
