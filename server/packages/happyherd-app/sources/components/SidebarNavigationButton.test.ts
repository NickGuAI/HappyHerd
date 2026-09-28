import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const pressableState = vi.hoisted(() => ({ hovered: false }));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Platform: { OS: 'web' },
        // Renders function children the way React Native's Pressable does.
        Pressable: (props: any) => ReactModule.createElement('Pressable', props,
            typeof props.children === 'function' ? props.children({ pressed: false, hovered: pressableState.hovered }) : props.children),
        Text: host('Text'),
        View: host('View'),
        useWindowDimensions: () => ({ width: 1440, height: 900 }),
    };
});

vi.mock('@/utils/responsive', () => ({ useIsTablet: () => true }));

vi.mock('@/components/herd/shell/HerdShellIcon', async () => {
    const ReactModule = await import('react');
    return { HerdShellIcon: (props: any) => ReactModule.createElement('HerdShellIcon', props) };
});

vi.mock('./herd/shell/HerdTooltip', async () => {
    const ReactModule = await import('react');
    return { HerdTooltip: (props: any) => ReactModule.createElement('HerdTooltip', props) };
});

vi.mock('react-native-unistyles', () => {
    const theme = {
        colors: {
            kilv: { rimLine: 'rim', accent: 'accent' },
            selection: { border: 'selection-border', background: 'selection-background' },
            surfaceSelected: 'selected',
            surfacePressedOverlay: 'pressed-overlay',
            divider: 'divider',
            surface: 'surface',
            surfacePressed: 'pressed',
            text: 'text',
            textSecondary: 'dim',
            textLink: 'link',
        },
        kilv: { radius: 8, glowMoltenSoft: 'glow' },
    };
    return {
        StyleSheet: {
            hairlineWidth: 1,
            create: (factory: any) => factory(theme),
        },
        useUnistyles: () => ({ theme }),
    };
});

vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}), logo: () => ({}) } }));

import { SidebarNavigationButton } from './SidebarNavigationButton';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());

describe('SidebarNavigationButton', () => {
    it('keeps every sidebar destination on the compact shared navigation geometry', () => {
        let renderer: ReturnType<typeof create>;
        act(() => {
            renderer = create(React.createElement(SidebarNavigationButton, {
                icon: 'split',
                label: 'Workspace',
                onPress: vi.fn(),
            }));
        });

        const pressable = renderer!.root.findByType('Pressable' as any);
        const resolvedStyle = Object.assign({}, ...pressable.props.style({ pressed: false }).filter(Boolean));

        expect(resolvedStyle).toMatchObject({
            width: '100%',
            minHeight: 42,
            borderRadius: 8,
            paddingVertical: 10,
            paddingHorizontal: 14,
        });
        expect(resolvedStyle).not.toHaveProperty('flex');
        expect(pressable.props.accessibilityLabel).toBe('Workspace');
        expect(pressable.props.accessibilityRole).toBe('button');
        expect(pressable.props['aria-selected']).toBeUndefined();
    });

    it('marks the destination that owns the current route with the shared selection language', () => {
        let renderer: ReturnType<typeof create>;
        act(() => {
            renderer = create(React.createElement(SidebarNavigationButton, {
                icon: 'folders',
                label: 'Projects',
                iconOnly: true,
                active: true,
                onPress: vi.fn(),
            }));
        });

        const pressable = renderer!.root.findByType('Pressable' as any);
        const resolvedStyle = Object.assign({}, ...pressable.props.style({ pressed: false, hovered: false }).filter(Boolean));
        expect(resolvedStyle).toMatchObject({
            borderColor: 'selection-border',
            backgroundColor: 'selection-background',
        });
        expect(pressable.props['aria-selected']).toBe(true);
        expect(renderer!.root.findByType('HerdShellIcon' as any).props).toMatchObject({ name: 'folders', color: 'link' });
    });

    it('draws the mock icons in dim ink, full ink for New session, and names icon-only controls on hover', () => {
        const render = (props: Record<string, unknown>) => {
            let renderer: ReturnType<typeof create>;
            act(() => {
                renderer = create(React.createElement(SidebarNavigationButton, { label: 'Label', onPress: vi.fn(), ...props } as any));
            });
            return renderer!;
        };
        expect(render({ icon: 'bolt', iconOnly: true }).root.findByType('HerdShellIcon' as any).props).toMatchObject({ name: 'bolt', size: 19, color: 'dim' });
        expect(render({ icon: 'pen', emphasis: true }).root.findByType('HerdShellIcon' as any).props).toMatchObject({ name: 'pen', size: 17, color: 'text' });
        expect(render({ icon: 'gear', quiet: true }).root.findByType('HerdShellIcon' as any).props).toMatchObject({ name: 'gear', size: 18, color: 'dim' });
        // The mock's anchored tooltip replaces the browser's title tooltip.
        expect(render({ icon: 'bolt', iconOnly: true }).root.findAllByType('HerdTooltip' as any)).toHaveLength(0);
        pressableState.hovered = true;
        try {
            const hovered = render({ icon: 'bolt', iconOnly: true, label: 'Automations' });
            expect(hovered.root.findByType('HerdTooltip' as any).props.label).toBe('Automations');
            expect(render({ icon: 'pen', emphasis: true }).root.findAllByType('HerdTooltip' as any)).toHaveLength(0);
        } finally {
            pressableState.hovered = false;
        }
    });

    it('exposes a toggle state as aria-pressed and lights its icon', () => {
        let renderer: ReturnType<typeof create>;
        act(() => {
            renderer = create(React.createElement(SidebarNavigationButton, {
                icon: 'archive', label: 'Archive', pressed: true, onPress: vi.fn(),
            }));
        });
        expect(renderer!.root.findByType('Pressable' as any).props['aria-pressed']).toBe(true);
        expect(renderer!.root.findByType('HerdShellIcon' as any).props.color).toBe('link');
    });
});
