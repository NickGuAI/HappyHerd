import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        Text: host('Text'),
        View: host('View'),
    };
});

vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});

vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        hairlineWidth: 1,
        create: (factory: () => unknown) => factory(),
    },
    useUnistyles: () => ({
        theme: {
            colors: {
                divider: '#dddddd',
                text: '#111111',
                textLink: '#0066cc',
                textSecondary: '#666666',
            },
        },
    }),
}));

vi.mock('@/constants/Typography', () => ({ Typography: { mono: () => ({}) } }));
vi.mock('@/text', () => ({ t: (key: string, values: Record<string, string>) => `${key}:${values.value1}` }));

import { WorkspaceContextStrip } from './WorkspaceContextStrip';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());

describe('WorkspaceContextStrip', () => {
    it('keeps file and directory context visibly distinct in active Chat', () => {
        const onRemove = vi.fn();
        let renderer!: ReturnType<typeof create>;
        act(() => {
            renderer = create(React.createElement(WorkspaceContextStrip, {
                entries: [
                    {
                        path: '/srv/project/docs',
                        kind: 'directory',
                        source: { kind: 'machine', machineId: 'machine-one' },
                    },
                    {
                        path: '/srv/project/README.md',
                        kind: 'file',
                        source: { kind: 'session' },
                    },
                ],
                onRemove,
            }));
        });

        const contextIcons = renderer.root.findAllByType('Ionicons' as any)
            .map((node: any) => node.props.name)
            .filter((name: string) => name !== 'close-circle');
        expect(contextIcons).toEqual(['folder-outline', 'document-attach-outline']);

        const removeDirectory = renderer.root.findByProps({
            accessibilityLabel: 'uiCopy.removeValueFromMessageContext:/srv/project/docs',
        });
        act(() => removeDirectory.props.onPress());
        expect(onRemove).toHaveBeenCalledWith({
            path: '/srv/project/docs',
            kind: 'directory',
            source: { kind: 'machine', machineId: 'machine-one' },
        });
    });
});
