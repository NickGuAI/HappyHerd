import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return { Pressable: host('Pressable'), Text: host('Text'), View: host('View') };
});

vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});

vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        hairlineWidth: 1,
        create: (factory: any) => factory({
            colors: {
                divider: 'divider',
                surface: 'surface',
                surfacePressed: 'pressed',
                text: 'text',
            },
        }),
    },
}));

vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));

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
                icon: 'folder-open-outline',
                label: 'Workspace',
                onPress: vi.fn(),
            }));
        });

        const pressable = renderer!.root.findByType('Pressable' as any);
        const resolvedStyle = Object.assign({}, ...pressable.props.style({ pressed: false }).filter(Boolean));

        expect(resolvedStyle).toMatchObject({
            width: '100%',
            minHeight: 40,
            paddingVertical: 10,
            paddingHorizontal: 14,
        });
        expect(resolvedStyle).not.toHaveProperty('flex');
    });
});
