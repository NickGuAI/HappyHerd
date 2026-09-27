import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default },
        Pressable: host('Pressable'),
        View: host('View'),
    };
});
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Octicons: (props: any) => ReactModule.createElement('Octicons', props) };
});
vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}), mono: () => ({}) } }));
vi.mock('react-native-unistyles', async () => {
    const { lightTheme } = await import('@/theme');
    return {
        StyleSheet: { create: (factory: any) => typeof factory === 'function' ? factory(lightTheme) : factory, hairlineWidth: 1 },
        useUnistyles: () => ({ theme: lightTheme }),
    };
});

import { HerdPanelTab } from './PanelTab';
import { resolveHerdSheetWidth } from './PanelOverlay';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());

function flat(style: unknown): Record<string, unknown> {
    const entries = Array.isArray(style) ? style.flat(Infinity) : [style];
    return Object.assign({}, ...entries.filter(Boolean));
}

function render(element: React.ReactElement): ReactTestRenderer {
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(element); });
    return renderer;
}

describe('HerdPanelTab', () => {
    it('reports selection for web and reveals its close button only while hovered or active', () => {
        const onPress = vi.fn();
        const onClose = vi.fn();
        const tab = (active: boolean) => React.createElement(HerdPanelTab, {
            label: 'Changes', active, onPress, onClose, closeLabel: 'Close panel',
        });
        const renderer = render(tab(false));
        const [outer, close] = renderer.root.findAllByType('Pressable' as any);
        expect(outer.props.accessibilityRole).toBe('tab');
        expect(outer.props['aria-selected']).toBe(false);
        expect(outer.props.accessibilityLabel).toBeUndefined();
        expect(close.props.accessibilityLabel).toBe('Close panel');
        expect(flat(close.props.style({ hovered: false }))).toMatchObject({ opacity: 0 });

        act(() => outer.props.onPointerEnter());
        expect(flat(renderer.root.findAllByType('Pressable' as any)[1].props.style({ hovered: false })).opacity).not.toBe(0);
        act(() => outer.props.onPointerLeave());

        act(() => renderer.update(tab(true)));
        const [activeOuter, activeClose] = renderer.root.findAllByType('Pressable' as any);
        expect(activeOuter.props['aria-selected']).toBe(true);
        expect(flat(activeClose.props.style({ hovered: false })).opacity).not.toBe(0);

        const stopPropagation = vi.fn();
        act(() => activeClose.props.onPress({ stopPropagation }));
        expect(stopPropagation).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
        expect(onPress).not.toHaveBeenCalled();
    });

    it('keeps plain buttons out of the tab role', () => {
        const renderer = render(React.createElement(HerdPanelTab, {
            label: 'New side chat', active: false, onPress: vi.fn(), accessibilityRole: 'button', accessibilityLabel: 'New side chat',
        }));
        const [button] = renderer.root.findAllByType('Pressable' as any);
        expect(button.props.accessibilityRole).toBe('button');
        expect(button.props['aria-selected']).toBeUndefined();
    });
});

describe('resolveHerdSheetWidth', () => {
    it('prefers the requested width but always leaves a strip of scrim', () => {
        expect(resolveHerdSheetWidth(717, 440)).toBe(440);
        expect(resolveHerdSheetWidth(717, 760)).toBe(661);
        expect(resolveHerdSheetWidth(40, 440)).toBe(0);
    });
});
