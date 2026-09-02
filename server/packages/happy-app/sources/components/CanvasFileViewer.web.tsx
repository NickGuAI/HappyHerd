import * as React from 'react';
import {
    Background,
    Controls,
    Handle,
    MarkerType,
    MiniMap,
    ReactFlow,
    Position,
    useNodesState,
    type Edge,
    type Node,
    type NodeProps,
    type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useRouter } from 'expo-router';

import { MarkdownView } from './markdown/MarkdownView';
import { normalizeExternalMarkdownLink } from './markdown/linkUtils';
import { useWorkspaceLinkPress } from '@/-session/workspaceLinkNavigation';
import { parseJsonCanvas, type JsonCanvasNode } from '@/utils/jsonCanvas';
import { resolveMarkdownWorkspaceLinkRoute, type WorkspaceLinkRoute } from '@/utils/markdownWorkspaceLink';
import { t } from '@/text';
import { useSession } from '@/sync/storage';
import type { CanvasFileViewerProps } from './CanvasFileViewer';

type CanvasFlowData = {
    canvasNode: JsonCanvasNode;
    sessionId: string;
    workspaceProvenance: CanvasFileViewerProps['workspaceProvenance'];
    relativeTo: string;
    workspaceImageRoot: CanvasFileViewerProps['workspaceImageRoot'];
    commented: boolean;
    onComment: CanvasFileViewerProps['onNodeComment'];
    onOpenWorkspace: (route: WorkspaceLinkRoute) => void;
};

function CanvasNodeCard({ data, selected }: NodeProps<Node<CanvasFlowData>>) {
    const node = data.canvasNode;
    const comment = (event: React.MouseEvent) => {
        event.stopPropagation();
        data.onComment({ nodeId: node.id, position: { x: node.x, y: node.y } });
    };
    const fileRoute = node.type === 'file' && node.file ? resolveMarkdownWorkspaceLinkRoute({
        url: node.file,
        label: node.label ?? node.file,
        originSessionId: data.sessionId,
        metadata: data.workspaceProvenance,
        relativeTo: data.relativeTo,
    }) : null;
    const externalUrl = node.type === 'link' && node.url ? normalizeExternalMarkdownLink(node.url) : null;
    const body = node.type === 'text' ? (
        <MarkdownView
            markdown={node.text ?? ''}
            sessionId={data.sessionId}
            enableWorkspaceLinks
            workspaceProvenance={data.workspaceProvenance}
            relativeTo={data.relativeTo}
            workspaceImageRoot={data.workspaceImageRoot}
        />
    ) : node.type === 'file' ? (
        <button
            type="button"
            className="hh-canvas-file-link"
            disabled={!fileRoute}
            onClick={() => fileRoute && data.onOpenWorkspace(fileRoute)}
        >
            {node.label ?? node.file ?? node.id}
        </button>
    ) : node.type === 'link' ? (
        externalUrl
            ? <a href={externalUrl} target="_blank" rel="noreferrer">{node.label ?? node.url ?? node.id}</a>
            : <span>{node.label ?? node.url ?? node.id}</span>
    ) : (
        <strong>{node.label ?? node.id}</strong>
    );
    return (
        <div className={`hh-canvas-node hh-canvas-${node.type}${selected ? ' selected' : ''}`} style={{ borderColor: canvasColor(node.color) }}>
            {([['top', Position.Top], ['right', Position.Right], ['bottom', Position.Bottom], ['left', Position.Left]] as const).flatMap(([side, position]) => [
                <Handle key={`source-${side}`} id={`source-${side}`} type="source" position={position} className="hh-canvas-handle" />,
                <Handle key={`target-${side}`} id={`target-${side}`} type="target" position={position} className="hh-canvas-handle" />,
            ])}
            <button type="button" className="hh-canvas-comment" aria-label={t('files.commentOnNode', { node: node.id })} onClick={comment}>+</button>
            {data.commented ? <span className="hh-canvas-pin" aria-label={t('files.pinnedComment')}>●</span> : null}
            {body}
        </div>
    );
}

const nodeTypes = { canvas: CanvasNodeCard };

export function CanvasFileViewer(props: CanvasFileViewerProps) {
    const router = useRouter();
    const flowRef = React.useRef<ReactFlowInstance<Node<CanvasFlowData>, Edge> | null>(null);
    const session = useSession(props.sessionId);
    const workspaceProvenance = props.workspaceProvenance ?? session?.metadata ?? undefined;
    const workspaceLinkPress = useWorkspaceLinkPress();
    const routerRef = React.useRef(router);
    const workspaceLinkPressRef = React.useRef(workspaceLinkPress);
    routerRef.current = router;
    workspaceLinkPressRef.current = workspaceLinkPress;
    const openWorkspace = React.useCallback((route: WorkspaceLinkRoute) => {
        if (workspaceLinkPressRef.current) workspaceLinkPressRef.current(route);
        else routerRef.current.push(route);
    }, []);
    const document = React.useMemo(() => parseJsonCanvas(props.content), [props.content]);
    const commented = React.useMemo(() => new Set(props.commentedNodeIds ?? []), [props.commentedNodeIds]);
    const nodeDefinitions = React.useMemo<Node<CanvasFlowData>[]>(() => document?.nodes.map((node) => ({
        id: node.id,
        type: 'canvas',
        position: { x: node.x, y: node.y },
        width: node.width,
        height: node.height,
        style: { width: node.width, height: node.height, zIndex: node.type === 'group' ? -1 : 1 },
        selectable: true,
        draggable: false,
        data: {
            canvasNode: node,
            sessionId: props.sessionId,
            workspaceProvenance,
            relativeTo: props.relativeTo,
            workspaceImageRoot: props.workspaceImageRoot,
            commented: commented.has(node.id),
            onComment: props.onNodeComment,
            onOpenWorkspace: openWorkspace,
        },
    })) ?? [], [commented, document?.nodes, openWorkspace, props.onNodeComment, props.relativeTo, props.sessionId, props.workspaceImageRoot, workspaceProvenance]);
    const [nodes, setNodes, onNodesChange] = useNodesState(nodeDefinitions);
    const edges = React.useMemo<Edge[]>(() => document?.edges.map((edge) => ({
        id: edge.id,
        source: edge.fromNode,
        target: edge.toNode,
        sourceHandle: `source-${edge.fromSide ?? 'right'}`,
        targetHandle: `target-${edge.toSide ?? 'left'}`,
        label: edge.label,
        style: edge.color ? { stroke: canvasColor(edge.color) } : undefined,
        markerStart: edge.fromEnd === 'arrow' ? { type: MarkerType.ArrowClosed, color: canvasColor(edge.color) } : undefined,
        markerEnd: edge.toEnd === 'arrow' ? { type: MarkerType.ArrowClosed, color: canvasColor(edge.color) } : undefined,
        selectable: true,
    })) ?? [], [document?.edges]);

    React.useEffect(() => {
        setNodes(nodeDefinitions);
    }, [nodeDefinitions, setNodes]);

    React.useEffect(() => {
        if (props.active === false || !document) return;
        if (typeof requestAnimationFrame === 'undefined') {
            void flowRef.current?.fitView();
            return;
        }
        let secondFrame = 0;
        const firstFrame = requestAnimationFrame(() => {
            secondFrame = requestAnimationFrame(() => {
                void flowRef.current?.fitView();
            });
        });
        return () => {
            cancelAnimationFrame(firstFrame);
            cancelAnimationFrame(secondFrame);
        };
    }, [document, props.active]);

    if (!document) return <div role="alert" className="hh-canvas-error">{t('files.invalidCanvas')}</div>;
    return (
        <div className="hh-canvas-root">
            <style>{CANVAS_CSS}</style>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                fitView
                panOnDrag
                panOnScroll
                zoomOnScroll
                zoomOnPinch
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                minZoom={0.15}
                maxZoom={3}
                onInit={(instance) => { flowRef.current = instance; }}
            >
                <Background />
                <MiniMap pannable zoomable />
                <Controls showInteractive={false} />
            </ReactFlow>
        </div>
    );
}

const PRESET_COLORS: Record<string, string> = {
    '1': '#fb464c',
    '2': '#e9973f',
    '3': '#e0de71',
    '4': '#44cf6e',
    '5': '#53dfdd',
    '6': '#a882ff',
};

function canvasColor(color: string | undefined): string | undefined {
    return color === undefined ? undefined : (PRESET_COLORS[color] ?? color);
}

const CANVAS_CSS = `
.hh-canvas-root { width: 100%; height: 100%; min-height: 360px; }
.hh-canvas-node { position: relative; width: 100%; height: 100%; overflow: auto; border: 1px solid rgba(127,127,127,.45); border-radius: 10px; background: Canvas; color: CanvasText; padding: 12px; box-shadow: 0 3px 12px rgba(0,0,0,.09); }
.hh-canvas-node.selected { outline: 2px solid Highlight; }
.hh-canvas-group { background: color-mix(in srgb, Canvas 88%, Highlight 12%); box-shadow: none; }
.hh-canvas-comment { position: absolute; top: 5px; right: 5px; width: 23px; height: 23px; border-radius: 50%; border: 1px solid rgba(127,127,127,.45); opacity: 0; cursor: pointer; z-index: 2; }
.hh-canvas-node:hover .hh-canvas-comment,.hh-canvas-comment:focus-visible { opacity: 1; }
@media (hover: none), (pointer: coarse) { .hh-canvas-comment { opacity: 1; } }
.hh-canvas-pin { position: absolute; top: 7px; right: 34px; color: Highlight; }
.hh-canvas-handle { opacity: 0; pointer-events: none; }
.hh-canvas-file-link { appearance: none; border: 0; padding: 0; background: transparent; color: LinkText; font: inherit; text-align: left; text-decoration: underline; cursor: pointer; }
.hh-canvas-file-link:disabled { color: GrayText; text-decoration: none; cursor: default; }
.hh-canvas-error { padding: 20px; }
`;
