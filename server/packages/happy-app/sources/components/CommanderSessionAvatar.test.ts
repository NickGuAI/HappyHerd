import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useCommanderAvatar', () => ({
    useCommanderAvatar: () => 'data:image/png;base64,avatar',
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    return { View: (props: any) => ReactModule.createElement('View', props, props.children) };
});
vi.mock('expo-image', async () => {
    const ReactModule = await import('react');
    return { Image: (props: any) => ReactModule.createElement('Image', props) };
});
vi.mock('react-native-unistyles', () => ({
    StyleSheet: { create: (factory: any) => factory({}) },
    useUnistyles: () => ({ theme: { colors: { surfaceHighest: '#eee', text: '#111' } } }),
}));
vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));

import { CommanderSessionAvatar } from './CommanderSessionAvatar';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());

describe('CommanderSessionAvatar', () => {
    it('renders the machine-scoped Commander image and falls back to initials', () => {
        let renderer!: ReturnType<typeof create>;
        act(() => {
            renderer = create(React.createElement(CommanderSessionAvatar, {
                machineId: 'machine-one',
                commanderId: 'athena',
                commanderName: 'Athena Prime',
                size: 40,
            }));
        });

        expect(renderer.root.findByType('Image' as any).props).toMatchObject({
            source: { uri: 'data:image/png;base64,avatar' },
            cachePolicy: 'memory',
            accessibilityLabel: 'Athena Prime',
            accessibilityRole: 'image',
        });

        act(() => {
            renderer.root.findByType('Image' as any).props.onError();
        });
        expect(renderer.root.findAllByType('Image' as any)).toHaveLength(0);
        expect(renderer.root.findByType('Text' as any).props.children).toBe('AP');
        expect(renderer.root.findByType('View' as any).props.accessibilityLabel).toBe('Athena Prime');
    });
});
