import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    openWorkspace: vi.fn(),
    resolveWorkspace: vi.fn(),
    push: vi.fn(),
}));

vi.mock('@xyflow/react', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Background: host('Background'), Controls: host('Controls'), Handle: host('Handle'), MiniMap: host('MiniMap'), ReactFlow: host('ReactFlow'),
        MarkerType: { ArrowClosed: 'arrowclosed' }, Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
        useNodesState: (initialNodes: any[]) => {
            const [nodes, setNodes] = ReactModule.useState(initialNodes);
            return [nodes, setNodes, vi.fn()];
        },
    };
});
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/-session/workspaceLinkNavigation', () => ({ useWorkspaceLinkPress: () => mocks.openWorkspace }));
vi.mock('@/utils/markdownWorkspaceLink', () => ({ resolveMarkdownWorkspaceLinkRoute: mocks.resolveWorkspace }));
vi.mock('./markdown/MarkdownView', async () => {
    const ReactModule = await import('react');
    return { MarkdownView: (props: any) => ReactModule.createElement('MarkdownView', props) };
});
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/sync/storage', () => ({ useSession: () => ({ metadata: { machineId: 'machine-one', path: '/repo' } }) }));

import { CanvasFileViewer } from './CanvasFileViewer.web';

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
        if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveWorkspace.mockReturnValue({ pathname: '/workspace', params: { mode: 'link', absolutePath: '/repo/notes/My (draft) [v2].md' } });
});

describe('CanvasFileViewer web', () => {
    it('renders connected edges and routes raw file-node paths without Markdown interpolation', () => {
        const onNodeComment = vi.fn();
        const content = JSON.stringify({
            nodes: [
                { id: 'a', type: 'text', text: 'Start', x: 0, y: 0, width: 180, height: 100 },
                { id: 'b', type: 'file', file: 'notes/My (draft) [v2].md', x: 260, y: 0, width: 220, height: 100 },
            ],
            edges: [{ id: 'e', fromNode: 'a', toNode: 'b', color: '1' }],
        });
        let renderer: any;
        act(() => {
            renderer = create(React.createElement(CanvasFileViewer, {
                content,
                sessionId: 'session-one',
                relativeTo: '/repo/maps',
                onNodeComment,
            }));
        });

        const flow = renderer.root.findByType('ReactFlow' as any);
        expect(flow.props.edges[0]).toMatchObject({
            sourceHandle: 'source-right',
            targetHandle: 'target-left',
            style: { stroke: '#fb464c' },
            markerEnd: { type: 'arrowclosed', color: '#fb464c' },
        });

        let fileNode: any;
        act(() => {
            fileNode = create(React.createElement(flow.props.nodeTypes.canvas, { data: flow.props.nodes[1].data, selected: false }));
        });
        expect(fileNode.root.findAllByType('Handle' as any)).toHaveLength(8);
        const link = fileNode.root.findByProps({ className: 'hh-canvas-file-link' });
        expect(link.props.children).toBe('notes/My (draft) [v2].md');
        act(() => link.props.onClick());
        expect(mocks.resolveWorkspace).toHaveBeenCalledWith({
            url: 'notes/My (draft) [v2].md',
            label: 'notes/My (draft) [v2].md',
            originSessionId: 'session-one',
            metadata: { machineId: 'machine-one', path: '/repo' },
            relativeTo: '/repo/maps',
        });
        expect(mocks.openWorkspace).toHaveBeenCalledOnce();
        act(() => fileNode.unmount());
        act(() => renderer.unmount());
    });
});
