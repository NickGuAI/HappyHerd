import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});
vi.mock('./BubblePressable', async () => {
    const ReactModule = await import('react');
    return { BubblePressable: (props: any) => ReactModule.createElement('BubblePressable', props, props.children) };
});
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { CompactWorkspaceContextButton } from './CompactWorkspaceContextButton';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());

describe('CompactWorkspaceContextButton', () => {
    it('renders a reachable context action only when browsing is available', () => {
        let unavailable!: ReturnType<typeof create>;
        act(() => {
            unavailable = create(React.createElement(CompactWorkspaceContextButton, {
                active: false,
                color: '#111111',
                activeColor: '#0066cc',
            }));
        });
        expect(unavailable.toJSON()).toBeNull();

        const onPress = vi.fn();
        let available!: ReturnType<typeof create>;
        act(() => {
            available = create(React.createElement(CompactWorkspaceContextButton, {
                onPress,
                active: true,
                color: '#111111',
                activeColor: '#0066cc',
            }));
        });
        const button = available.root.findByType('BubblePressable' as any);
        expect(button.props.accessibilityLabel).toBe('workspace.browseContext');
        expect(available.root.findByType('Ionicons' as any).props).toMatchObject({
            name: 'folder-open-outline',
            color: '#0066cc',
        });
        act(() => button.props.onPress());
        expect(onPress).toHaveBeenCalledOnce();
    });
});
