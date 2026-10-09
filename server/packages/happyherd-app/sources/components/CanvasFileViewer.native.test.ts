import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ openWorkspace: vi.fn(), external: vi.fn() }));
vi.mock('react-native', async () => {
    const React = await import('react');
    const host = (name: string) => (props: any) => React.createElement(name, props, props.children);
    return { Pressable: host('Pressable'), ScrollView: host('ScrollView'), View: host('View') };
});
vi.mock('react-native-svg', async () => {
    const React = await import('react');
    const host = (name: string) => (props: any) => React.createElement(name, props, props.children);
    return { default: host('Svg'), Defs: host('Defs'), Line: host('Line'), Marker: host('Marker'), Path: host('Path'), Text: host('SvgText') };
});
vi.mock('./StyledText', async () => {
    const React = await import('react');
    return { Text: (props: any) => React.createElement('Text', props, props.children) };
});
vi.mock('./markdown/MarkdownView', async () => {
    const React = await import('react');
    return { MarkdownView: (props: any) => React.createElement('MarkdownView', props) };
});
vi.mock('react-native-unistyles', async () => {
    const { lightTheme } = await import('@/theme');
    return { useUnistyles: () => ({ theme: lightTheme }) };
});
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.openWorkspace }) }));
vi.mock('@/-session/workspaceLinkNavigation', () => ({ useWorkspaceLinkPress: () => mocks.openWorkspace }));
vi.mock('@/sync/storage', () => ({ useSession: () => ({ metadata: { machineId: 'machine-one', path: '/repo' } }) }));
vi.mock('@/utils/openExternalUrl', () => ({ openExternalUrl: mocks.external }));
vi.mock('@/text', () => ({ t: (key: string, args?: Record<string, string>) => `${key}${args?.node ? ':' + args.node : ''}` }));
import { CanvasFileViewer, nativeCanvasBounds } from './CanvasFileViewer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('native Canvas production content', () => {
    const nodes = [
        { id: 'text', type: 'text' as const, x: -200, y: -50, width: 200, height: 150, text: '**Rendered** text' },
        { id: 'file', type: 'file' as const, x: 100, y: 250, width: 200, height: 150, file: 'README.md' },
    ];
    it('fits negative coordinates and retains the complete graph extent', () => {
        expect(nativeCanvasBounds(nodes)).toEqual({ left: -224, top: -74, width: 548, height: 498 });
    });
    it('fits an entirely negative graph without extending its bounds to the origin', () => {
        expect(nativeCanvasBounds([
            { ...nodes[0], x: -10000, y: -8000 },
            { ...nodes[1], x: -9700, y: -7700 },
        ])).toEqual({ left: -10024, top: -8024, width: 548, height: 498 });
        expect(nativeCanvasBounds([])).toEqual({ left: -24, top: -24, width: 49, height: 49 });
    });
    it('renders nodes and edges, opens a machine file, and comments the exact original node coordinates', () => {
        const onNodeComment = vi.fn();
        let renderer: any;
        act(() => { renderer = create(React.createElement(CanvasFileViewer, {
            content: JSON.stringify({ nodes, edges: [{ id: 'edge', fromNode: 'text', toNode: 'file', label: 'connection' }] }),
            sessionId: 'side-chat', relativeTo: '/repo', onNodeComment,
        })); });
        expect(renderer.root.findByType('MarkdownView').props.markdown).toBe('**Rendered** text');
        expect(renderer.root.findAllByType('Line')).toHaveLength(1);
        act(() => renderer.root.findAllByType('Pressable').find((button: any) => button.props.accessibilityLabel === 'files.commentOnNode:text').props.onPress());
        expect(onNodeComment).toHaveBeenCalledWith({ nodeId: 'text', position: { x: -200, y: -50 } });
        act(() => renderer.root.findAllByType('Pressable').find((button: any) => button.props.accessibilityRole === 'link').props.onPress());
        expect(mocks.openWorkspace).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ machineId: 'machine-one', absolutePath: '/repo/README.md' }) }));
        act(() => renderer.unmount());
    });
});
