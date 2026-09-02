import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    addListener: vi.fn(() => vi.fn()),
    dispatch: vi.fn(),
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    return { View: (props: any) => ReactModule.createElement('View', props, props.children) };
});
vi.mock('expo-router', () => ({
    useLocalSearchParams: () => ({
        id: 'session-one',
        path: btoa('docs/note.md'),
        line: '42',
        column: '7',
    }),
}));
vi.mock('@react-navigation/native', () => ({
    useNavigation: () => ({ addListener: mocks.addListener, dispatch: mocks.dispatch }),
}));
vi.mock('@/components/FileViewPanel', async () => {
    const ReactModule = await import('react');
    return { FileViewPanel: (props: any) => ReactModule.createElement('FileViewPanel', props) };
});
vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});
vi.mock('@/constants/Typography', () => ({ Typography: { mono: () => ({}) } }));
vi.mock('@/modal', () => ({ Modal: { confirm: vi.fn() } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/sync/storage', () => ({
    storage: { getState: () => ({ sessions: { 'session-one': { metadata: { path: '/repo' } } } }) },
}));
vi.mock('@/utils/sessionFileLinks', () => ({
    resolveSessionFilePath: () => ({ absolutePath: '/repo/docs/note.md' }),
}));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1 },
    useUnistyles: () => ({ theme: { colors: { surface: '#fff', surfaceHigh: '#eee', divider: '#ddd', textSecondary: '#666' } } }),
}));

import FileScreen from './file';

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
        if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
});

afterAll(() => vi.restoreAllMocks());

describe('session file compatibility route', () => {
    it('delegates path and deep-link position to the shared viewer', () => {
        let renderer: any;
        act(() => { renderer = create(React.createElement(FileScreen)); });

        expect(renderer.root.findByType('FileViewPanel' as any).props).toMatchObject({
            sessionId: 'session-one',
            filePath: '/repo/docs/note.md',
            requestedLine: 42,
            requestedColumn: 7,
        });
        expect(renderer.root.findByType('Text' as any).props.children).toBe('/repo/docs/note.md:42:7');
        act(() => renderer.unmount());
    });
});
