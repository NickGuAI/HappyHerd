import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Defs, Line, Marker, Path, Text as SvgText } from 'react-native-svg';
import { useUnistyles } from 'react-native-unistyles';
import { useRouter } from 'expo-router';
import type { MarkdownWorkspaceProvenance } from './markdown/MarkdownView.types';
import type { InlineCommentAnchor } from './InlineCommentReview';
import { MarkdownView } from './markdown/MarkdownView';
import { Text } from './StyledText';
import { parseJsonCanvas, type JsonCanvasNode } from '@/utils/jsonCanvas';
import { useWorkspaceLinkPress } from '@/-session/workspaceLinkNavigation';
import { resolveMarkdownWorkspaceLinkRoute } from '@/utils/markdownWorkspaceLink';
import { normalizeExternalMarkdownLink } from './markdown/linkUtils';
import { openExternalUrl } from '@/utils/openExternalUrl';
import { useSession } from '@/sync/storage';
import { t } from '@/text';

export type CanvasFileViewerProps = {
    content: string;
    sessionId: string;
    active?: boolean;
    workspaceProvenance?: MarkdownWorkspaceProvenance;
    relativeTo: string;
    workspaceImageRoot?: string | null;
    commentedNodeIds?: readonly string[];
    onNodeComment: (anchor: InlineCommentAnchor) => void;
};

export function nativeCanvasBounds(nodes: readonly JsonCanvasNode[]) {
    const left = (nodes.length ? Math.min(...nodes.map((node) => node.x)) : 0) - 24;
    const top = (nodes.length ? Math.min(...nodes.map((node) => node.y)) : 0) - 24;
    return {
        left, top,
        width: (nodes.length ? Math.max(...nodes.map((node) => node.x + node.width)) : 1) - left + 24,
        height: (nodes.length ? Math.max(...nodes.map((node) => node.y + node.height)) : 1) - top + 24,
    };
}

function endpoint(node: JsonCanvasNode, side: string | undefined) {
    return {
        x: node.x + (side === 'left' ? 0 : side === 'right' ? node.width : node.width / 2),
        y: node.y + (side === 'top' ? 0 : side === 'bottom' ? node.height : node.height / 2),
    };
}

function canvasColor(color: string | undefined, fallback: string): string {
    return ({ '1': '#fb464c', '2': '#e9973f', '3': '#e0de71', '4': '#44cf6e', '5': '#53dfdd', '6': '#a882ff' } as Record<string, string>)[color ?? '']
        ?? (color?.startsWith('#') ? color : fallback);
}

/** Native graph uses the same parsed Canvas document and review state as Web. */
export function CanvasFileViewer(props: CanvasFileViewerProps) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const workspaceLinkPress = useWorkspaceLinkPress();
    const session = useSession(props.sessionId);
    const provenance = props.workspaceProvenance ?? session?.metadata ?? undefined;
    const document = React.useMemo(() => parseJsonCanvas(props.content), [props.content]);
    const bounds = React.useMemo(() => nativeCanvasBounds(document?.nodes ?? []), [document]);
    const [viewport, setViewport] = React.useState({ width: 1, height: 1 });
    const [zoom, setZoom] = React.useState(1);
    const [toolbarHeight, setToolbarHeight] = React.useState(44);
    const verticalScroll = React.useRef<ScrollView>(null);
    const horizontalScroll = React.useRef<ScrollView>(null);
    const fit = Math.min(1, viewport.width / bounds.width, Math.max(1, viewport.height - toolbarHeight) / bounds.height);
    const scale = Math.max(0.05, Math.min(4, fit * zoom));
    if (!document) return <Text accessibilityRole="alert">{t('files.invalidCanvas')}</Text>;
    const byId = new Map(document.nodes.map((node) => [node.id, node]));
    return <View style={{ flex: 1 }} onLayout={(event) => setViewport(event.nativeEvent.layout)} testID="native-canvas-viewer">
        <View style={{ flexDirection: 'row', gap: 12 }} onLayout={(event) => setToolbarHeight(event.nativeEvent.layout.height)}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('files.canvas.zoomOut')} onPress={() => setZoom((value) => Math.max(0.1, value / 1.25))} style={{ padding: 12 }}><Text>−</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t('files.canvas.zoomIn')} onPress={() => setZoom((value) => Math.min(80, value * 1.25))} style={{ padding: 12 }}><Text>+</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t('files.canvas.fit')} onPress={() => {
                setZoom(1);
                verticalScroll.current?.scrollResponderZoomTo({ x: 0, y: 0, width: viewport.width, height: Math.max(1, viewport.height - toolbarHeight), animated: false });
                verticalScroll.current?.scrollTo({ x: 0, y: 0, animated: false });
                horizontalScroll.current?.scrollTo({ x: 0, y: 0, animated: false });
            }} style={{ padding: 12 }}><Text>{t('files.canvas.fit')}</Text></Pressable>
        </View>
        <ScrollView ref={verticalScroll} style={{ flex: 1 }} minimumZoomScale={0.1} maximumZoomScale={4} bouncesZoom>
            <ScrollView ref={horizontalScroll} horizontal contentContainerStyle={{ minWidth: viewport.width }}>
                <View style={{ width: bounds.width * scale, height: bounds.height * scale }}>
                    <View style={{ width: bounds.width, height: bounds.height, transformOrigin: 'top left', transform: [{ scale }] }}>
                        <Svg width={bounds.width} height={bounds.height} style={{ position: 'absolute' }}>
                            <Defs><Marker id="arrow" markerWidth={10} markerHeight={10} refX={9} refY={5} orient="auto-start-reverse"><Path d="M0 0 L10 5 L0 10 Z" fill={theme.colors.textSecondary} /></Marker></Defs>
                            {document.edges.map((edge) => {
                                const from = endpoint(byId.get(edge.fromNode)!, edge.fromSide);
                                const to = endpoint(byId.get(edge.toNode)!, edge.toSide);
                                return <React.Fragment key={edge.id}>
                                    <Line x1={from.x - bounds.left} y1={from.y - bounds.top} x2={to.x - bounds.left} y2={to.y - bounds.top}
                                        stroke={canvasColor(edge.color, theme.colors.textSecondary)} strokeWidth={2}
                                        markerStart={edge.fromEnd === 'arrow' ? 'url(#arrow)' : undefined} markerEnd={edge.toEnd === 'arrow' ? 'url(#arrow)' : undefined} />
                                    {edge.label ? <SvgText x={(from.x + to.x) / 2 - bounds.left} y={(from.y + to.y) / 2 - bounds.top} fill={theme.colors.text}>{edge.label}</SvgText> : null}
                                </React.Fragment>;
                            })}
                        </Svg>
                        {[...document.nodes].sort((a, b) => Number(a.type !== 'group') - Number(b.type !== 'group')).map((node) => {
                            const route = node.type === 'file' && node.file ? resolveMarkdownWorkspaceLinkRoute({ url: node.file, label: node.label ?? node.file, originSessionId: props.sessionId, metadata: provenance, relativeTo: props.relativeTo }) : null;
                            const url = node.type === 'link' && node.url ? normalizeExternalMarkdownLink(node.url) : null;
                            return <View key={node.id} accessibilityLabel={t('files.canvasNode', { node: node.id })} style={{ position: 'absolute', left: node.x - bounds.left, top: node.y - bounds.top, width: node.width, height: node.height, padding: 8, borderWidth: 1, borderRadius: 8, borderColor: canvasColor(node.color, theme.colors.divider), backgroundColor: node.type === 'group' ? 'transparent' : theme.colors.surface }}>
                                <Pressable accessibilityRole="button" accessibilityLabel={t('files.commentOnNode', { node: node.id })} onPress={() => props.onNodeComment({ nodeId: node.id, position: { x: node.x, y: node.y } })} style={{ minHeight: 44, alignSelf: 'flex-end', paddingHorizontal: 12 }}><Text>{props.commentedNodeIds?.includes(node.id) ? '●' : '+'}</Text></Pressable>
                                <ScrollView style={{ flex: 1 }}>
                                    {node.type === 'text' ? <MarkdownView markdown={node.text ?? ''} sessionId={props.sessionId} enableWorkspaceLinks workspaceProvenance={provenance} relativeTo={props.relativeTo} workspaceImageRoot={props.workspaceImageRoot} />
                                        : <Pressable accessibilityRole={route || url ? 'link' : undefined} disabled={!route && !url} onPress={() => { if (route) { if (workspaceLinkPress) workspaceLinkPress(route); else router.push(route); } else if (url) void openExternalUrl(url); }}><Text>{node.label ?? node.file ?? node.url ?? node.id}</Text></Pressable>}
                                </ScrollView>
                            </View>;
                        })}
                    </View>
                </View>
            </ScrollView>
        </ScrollView>
    </View>;
}
