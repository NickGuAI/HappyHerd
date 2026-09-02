import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Image, type ImageLoadEventData } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native-unistyles';
import { unified } from 'unified';
import remarkBreaks from 'remark-breaks';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { common, createLowlight } from 'lowlight';
import * as Clipboard from 'expo-clipboard';

import { HorizontalScrollView } from '../HorizontalScrollView';
import { Text } from '../StyledText';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { useLocalSetting, useSession } from '@/sync/storage';
import { storeTempText } from '@/sync/persistence';
import { useRouter } from 'expo-router';
import { MermaidRenderer } from './MermaidRenderer';
import { t } from '@/text';
import { normalizeExternalMarkdownLink } from './linkUtils';
import { openExternalUrl } from '@/utils/openExternalUrl';
import {
    resolveMarkdownWorkspaceImageReference,
    resolveMarkdownWorkspaceLinkRoute,
    type MarkdownWorkspaceImageReference,
    type WorkspaceLinkRoute,
} from '@/utils/markdownWorkspaceLink';
import { loadMarkdownWorkspaceImage } from '@/utils/markdownWorkspaceImage';
import { useWorkspaceLinkPress } from '@/-session/workspaceLinkNavigation';
import {
    decodeMarkdownOption,
    encodeMarkdownOptions,
    type MarkdownViewProps,
    type Option,
} from './MarkdownView.types';

export type { MarkdownViewProps, Option } from './MarkdownView.types';

type MdNode = {
    type: string;
    value?: string;
    url?: string;
    alt?: string;
    lang?: string | null;
    depth?: number;
    ordered?: boolean;
    start?: number;
    checked?: boolean | null;
    children?: MdNode[];
    align?: Array<'left' | 'right' | 'center' | null>;
};

type LinkTarget =
    | Readonly<{ kind: 'external'; url: string }>
    | Readonly<{ kind: 'workspace'; route: WorkspaceLinkRoute }>;

const markdownProcessor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkBreaks)
    .use(remarkFrontmatter)
    .use(remarkMath);
const nativeLowlight = createLowlight(common);

function parseMarkdown(markdown: string): MdNode {
    const parsed = markdownProcessor.parse(encodeMarkdownOptions(markdown));
    return markdownProcessor.runSync(parsed) as MdNode;
}

function optionItemsFromList(node: MdNode): string[] | null {
    if (node.type !== 'list' || node.ordered || !node.children?.length) return null;
    const items: string[] = [];
    for (const item of node.children) {
        if (item.type !== 'listItem' || item.checked != null || item.children?.length !== 1) return null;
        const paragraph = item.children[0];
        if (paragraph.type !== 'paragraph' || paragraph.children?.length !== 1) return null;
        const link = paragraph.children[0];
        if (link.type !== 'link') return null;
        const option = decodeMarkdownOption(link.url);
        if (option === null) return null;
        items.push(option);
    }
    return items;
}

export const MarkdownView = React.memo(function MarkdownView(props: MarkdownViewProps) {
    const root = React.useMemo(() => parseMarkdown(props.markdown), [props.markdown]);
    const markdownCopyV2 = useLocalSetting('markdownCopyV2');
    const selectable = !(markdownCopyV2 || props.externalCopyHandler);
    const router = useRouter();
    const session = useSession(props.sessionId ?? '');
    const metadata = props.workspaceProvenance ?? session?.metadata;
    const contextWorkspaceLinkPress = useWorkspaceLinkPress();
    const workspaceLinkPress = props.onWorkspaceLinkPress ?? contextWorkspaceLinkPress;

    const resolveTarget = React.useCallback((url: string, label: string): LinkTarget | null => {
        const external = normalizeExternalMarkdownLink(url);
        if (external) return { kind: 'external', url: external };
        if (!props.enableWorkspaceLinks) return null;
        const route = resolveMarkdownWorkspaceLinkRoute({
            url,
            label,
            originSessionId: props.sessionId,
            metadata,
            ...(props.relativeTo ? { relativeTo: props.relativeTo } : {}),
        });
        return route ? { kind: 'workspace', route } : null;
    }, [metadata, props.enableWorkspaceLinks, props.relativeTo, props.sessionId]);

    const openTarget = React.useCallback((target: LinkTarget) => {
        if (target.kind === 'external') {
            void openExternalUrl(target.url);
        } else if (workspaceLinkPress) {
            workspaceLinkPress(target.route);
        } else {
            router.push(target.route);
        }
    }, [router, workspaceLinkPress]);

    const resolveImage = React.useCallback((url: string, alt: string) => (
        props.enableWorkspaceLinks && props.workspaceImageRoot !== null
            ? resolveMarkdownWorkspaceImageReference({
                url,
                label: alt,
                originSessionId: props.sessionId,
                metadata: metadata ? {
                    ...metadata,
                    path: props.workspaceImageRoot ?? metadata.path,
                } : metadata,
                ...(props.relativeTo ? { relativeTo: props.relativeTo } : {}),
            })
            : null
    ), [metadata, props.enableWorkspaceLinks, props.relativeTo, props.sessionId, props.workspaceImageRoot]);

    const renderInline = React.useCallback((nodes: MdNode[] | undefined, keyPrefix: string): React.ReactNode => (
        nodes?.map((node, index) => {
            const key = `${keyPrefix}:${index}`;
            switch (node.type) {
                case 'text': return node.value ?? '';
                case 'strong': return <Text key={key} style={styles.bold}>{renderInline(node.children, key)}</Text>;
                case 'emphasis': return <Text key={key} style={styles.italic}>{renderInline(node.children, key)}</Text>;
                case 'delete': return <Text key={key} style={styles.strike}>{renderInline(node.children, key)}</Text>;
                case 'inlineCode': return <Text key={key} style={styles.inlineCode}>{node.value}</Text>;
                case 'inlineMath': return <Text key={key} style={styles.inlineCode}>{node.value}</Text>;
                case 'break': return '\n';
                case 'link': {
                    const option = decodeMarkdownOption(node.url);
                    const label = plainText(node);
                    if (option !== null) {
                        return <Text key={key} style={styles.option} onPress={() => props.onOptionPress?.({ title: option })}>{label}</Text>;
                    }
                    const target = node.url ? resolveTarget(node.url, label) : null;
                    return (
                        <Text
                            key={key}
                            accessibilityRole={target ? 'link' : undefined}
                            selectable={selectable}
                            style={target ? styles.link : undefined}
                            onPress={target ? () => openTarget(target) : undefined}
                        >{label}</Text>
                    );
                }
                default: return renderInline(node.children, key);
            }
        })
    ), [openTarget, props.onOptionPress, resolveTarget, selectable]);

    const renderBlock = React.useCallback((node: MdNode, index: number): React.ReactNode => {
        const key = `block:${index}`;
        switch (node.type) {
            case 'paragraph': {
                const renderImage = (image: MdNode, imageKey: string) => {
                    const url = image.url ?? '';
                    const inlineSource = props.inlineImages?.sources.get(url);
                    if (props.inlineImages?.suppressed.has(url)) return null;
                    const external = normalizeExternalMarkdownLink(url);
                    const reference = external || inlineSource ? null : resolveImage(url, image.alt ?? '');
                    if (!external && !inlineSource && !reference) {
                        return <Text key={imageKey} selectable={selectable} style={styles.text}>{`![${image.alt ?? ''}](${url})`}</Text>;
                    }
                    return (
                        <NativeMarkdownImage
                            key={imageKey}
                            url={external ?? inlineSource ?? ''}
                            sourceOverride={inlineSource}
                            alt={image.alt ?? ''}
                            reference={reference}
                            onOpenWorkspace={(route) => openTarget({ kind: 'workspace', route })}
                        />
                    );
                };
                if (node.children?.some((child) => child.type === 'image')) {
                    return (
                        <View key={key} style={styles.mixedParagraph}>
                            {node.children.map((child, childIndex) => child.type === 'image'
                                ? renderImage(child, `${key}:image:${childIndex}`)
                                : <Text key={`${key}:text:${childIndex}`} selectable={selectable} style={styles.text}>{renderInline([child], `${key}:${childIndex}`)}</Text>)}
                        </View>
                    );
                }
                return <Text key={key} selectable={selectable} style={styles.text}>{renderInline(node.children, key)}</Text>;
            }
            case 'heading': {
                const headingStyle = node.depth === 1 ? styles.heading1 : node.depth === 2 ? styles.heading2 : styles.heading;
                return <Text key={key} selectable={selectable} style={headingStyle}>{renderInline(node.children, key)}</Text>;
            }
            case 'thematicBreak': return <View key={key} style={styles.rule} />;
            case 'blockquote': return <View key={key} style={styles.quote}>{node.children?.map(renderBlock)}</View>;
            case 'code': return node.lang === 'mermaid'
                ? <MermaidRenderer key={key} content={node.value ?? ''} />
                : <NativeCodeBlock key={key} code={node.value ?? ''} language={node.lang ?? null} selectable={selectable} />;
            case 'math': return (
                <HorizontalScrollView key={key} style={styles.codeBlock} contentContainerStyle={styles.codeContent}>
                    <Text selectable={selectable} style={styles.codeText}>{node.value ?? ''}</Text>
                </HorizontalScrollView>
            );
            case 'list': {
                const optionItems = optionItemsFromList(node);
                if (optionItems) {
                    return (
                        <NativeOptionsBlock
                            key={key}
                            items={optionItems}
                            selectable={selectable}
                            onOptionPress={props.onOptionPress}
                        />
                    );
                }
                return (
                    <View key={key} style={styles.list}>
                        {node.children?.map((item, itemIndex) => {
                            const marker = item.checked === true
                                ? '☑'
                                : item.checked === false
                                    ? '☐'
                                    : node.ordered
                                        ? `${(node.start ?? 1) + itemIndex}.`
                                        : '•';
                            return (
                                <View key={`${key}:${itemIndex}`} style={styles.listRow} accessibilityRole={item.checked == null ? undefined : 'checkbox'} accessibilityState={item.checked == null ? undefined : { checked: item.checked, disabled: true }}>
                                    <Text style={styles.listMarker}>{marker}</Text>
                                    <View style={styles.listItemBody}>
                                        {item.children?.map((child, childIndex) => child.type === 'paragraph'
                                            ? <Text key={`${key}:${itemIndex}:text:${childIndex}`} selectable={selectable} style={styles.listText}>{renderInline(child.children, `${key}:${itemIndex}:${childIndex}`)}</Text>
                                            : <React.Fragment key={`${key}:${itemIndex}:block:${childIndex}`}>{renderBlock(child, childIndex)}</React.Fragment>)}
                                    </View>
                                </View>
                            );
                        })}
                    </View>
                );
            }
            case 'table': return <NativeTable key={key} node={node} selectable={selectable} renderInline={renderInline} />;
            case 'html': return null;
            default: return node.children?.map(renderBlock) ?? null;
        }
    }, [openTarget, props.inlineImages, renderInline, resolveImage, selectable]);

    const content = <View style={styles.root}>{root.children?.map(renderBlock)}</View>;
    if (props.externalCopyHandler || !markdownCopyV2 || Platform.OS === 'web') return content;

    const longPress = Gesture.LongPress().minDuration(500).onStart(() => {
        try {
            const textId = storeTempText(props.markdown);
            router.push(`/text-selection?textId=${textId}`);
        } catch {
            Modal.alert(t('common.error'), t('uiCopy.failedToOpenTextSelectionPleaseTryAgain'));
        }
    }).runOnJS(true);
    return <GestureDetector gesture={longPress}>{content}</GestureDetector>;
});

function plainText(node: MdNode): string {
    if (typeof node.value === 'string') return node.value;
    return node.children?.map(plainText).join('') ?? '';
}

function NativeOptionsBlock(props: {
    items: string[];
    selectable: boolean;
    onOptionPress?: (option: Option) => void;
}) {
    return (
        <View style={styles.optionsContainer}>
            {props.items.map((item, index) => props.onOptionPress ? (
                <Pressable
                    key={index}
                    style={({ pressed }) => [
                        styles.optionPressable,
                        styles.optionButton,
                        pressed && styles.optionButtonPressed,
                    ]}
                    onPress={() => props.onOptionPress?.({ title: item })}
                >
                    <Text selectable={props.selectable} style={styles.optionButtonText}>{item}</Text>
                </Pressable>
            ) : (
                <View key={index} style={styles.optionItem}>
                    <Text selectable={props.selectable} style={styles.optionText}>{item}</Text>
                </View>
            ))}
        </View>
    );
}

type HastNode = { type: string; value?: string; properties?: { className?: string[] }; children?: HastNode[] };

function NativeHighlightedCode(props: { code: string; language: string | null; selectable: boolean }) {
    const tree = React.useMemo<HastNode>(() => {
        try {
            return (props.language
                ? nativeLowlight.highlight(props.language, props.code)
                : nativeLowlight.highlightAuto(props.code)) as HastNode;
        } catch {
            return { type: 'root', children: [{ type: 'text', value: props.code }] };
        }
    }, [props.code, props.language]);
    return <Text selectable={props.selectable} style={styles.codeText}>{renderHighlightedNodes(tree.children ?? [])}</Text>;
}

function NativeCodeBlock(props: { code: string; language: string | null; selectable: boolean }) {
    const copy = React.useCallback(async () => {
        try {
            await Clipboard.setStringAsync(props.code);
            Modal.alert(t('common.success'), t('markdown.codeCopied'), [{ text: t('common.ok'), style: 'cancel' }]);
        } catch {
            Modal.alert(t('common.error'), t('markdown.copyFailed'), [{ text: t('common.ok'), style: 'cancel' }]);
        }
    }, [props.code]);
    return (
        <View style={styles.codeBlock}>
            {props.language ? <Text selectable={props.selectable} style={styles.codeLanguage}>{props.language}</Text> : null}
            <HorizontalScrollView contentContainerStyle={styles.codeContent}>
                <NativeHighlightedCode {...props} />
            </HorizontalScrollView>
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.copy')} onPress={() => { void copy(); }} style={styles.codeCopyButton}>
                <Text style={styles.codeCopyText}>{t('common.copy')}</Text>
            </Pressable>
        </View>
    );
}

function renderHighlightedNodes(nodes: HastNode[]): React.ReactNode {
    return nodes.map((node, index) => {
        if (node.type === 'text') return node.value ?? '';
        const classes = node.properties?.className ?? [];
        const tokenStyle = classes.some((name) => /keyword|literal|selector-tag/u.test(name))
            ? styles.tokenKeyword
            : classes.some((name) => /string|doctag|attr/u.test(name))
                ? styles.tokenString
                : classes.some((name) => /comment|quote/u.test(name))
                    ? styles.tokenComment
                    : classes.some((name) => /title|function|section/u.test(name))
                        ? styles.tokenFunction
                        : undefined;
        return <Text key={index} style={tokenStyle}>{renderHighlightedNodes(node.children ?? [])}</Text>;
    });
}

function NativeTable(props: {
    node: MdNode;
    selectable: boolean;
    renderInline: (nodes: MdNode[] | undefined, keyPrefix: string) => React.ReactNode;
}) {
    return (
        <HorizontalScrollView style={styles.table}>
            <View>
                {props.node.children?.map((row, rowIndex) => (
                    <View key={rowIndex} style={styles.tableRow}>
                        {row.children?.map((cell, cellIndex) => (
                            <Text key={cellIndex} selectable={props.selectable} style={[styles.tableCell, rowIndex === 0 && styles.tableHeader]}>
                                {props.renderInline(cell.children, `table:${rowIndex}:${cellIndex}`)}
                            </Text>
                        ))}
                    </View>
                ))}
            </View>
        </HorizontalScrollView>
    );
}

const RETRY_DELAYS_MS = [500, 1500] as const;

function NativeMarkdownImage(props: {
    url: string;
    sourceOverride?: string;
    alt: string;
    reference: MarkdownWorkspaceImageReference | null;
    onOpenWorkspace: (route: WorkspaceLinkRoute) => void;
}) {
    const [retryToken, setRetryToken] = React.useState(0);
    const [state, setState] = React.useState<{ status: 'loading' | 'ready' | 'failed'; url?: string }>(() => (
        props.sourceOverride || props.url ? { status: 'ready', url: props.sourceOverride ?? props.url } : { status: 'loading' }
    ));

    React.useEffect(() => {
        if (props.sourceOverride || props.url) {
            setState({ status: 'ready', url: props.sourceOverride ?? props.url });
            return;
        }
        if (!props.reference) {
            setState({ status: 'failed' });
            return;
        }
        let cancelled = false;
        setState({ status: 'loading' });
        void (async () => {
            for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
                const url = await loadMarkdownWorkspaceImage(props.reference!);
                if (cancelled) return;
                if (url) {
                    setState({ status: 'ready', url });
                    return;
                }
                if (attempt < RETRY_DELAYS_MS.length) {
                    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
                }
            }
            if (!cancelled) setState({ status: 'failed' });
        })();
        return () => { cancelled = true; };
    }, [props.reference, props.sourceOverride, props.url, retryToken]);

    if (state.status === 'loading') return <View style={styles.imageFailure}><ActivityIndicator /></View>;
    if (state.status === 'failed' || !state.url) {
        return (
            <View accessibilityRole="alert" style={styles.imageFailure}>
                <Ionicons name="image-outline" size={24} />
                <Text>{t('markdown.imageLoadFailed')}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t('common.retry')} onPress={() => setRetryToken((value) => value + 1)}>
                    <Text style={styles.link}>{t('common.retry')}</Text>
                </Pressable>
            </View>
        );
    }
    return <LoadedNativeImage {...props} url={state.url} />;
}

function LoadedNativeImage(props: {
    url: string;
    alt: string;
    reference: MarkdownWorkspaceImageReference | null;
    onOpenWorkspace: (route: WorkspaceLinkRoute) => void;
}) {
    const [aspectRatio, setAspectRatio] = React.useState(16 / 9);
    const open = React.useCallback(() => {
        if (props.reference) {
            props.onOpenWorkspace(props.reference.workspaceRoute);
            return;
        }
        Modal.show({ component: MarkdownImagePreviewModal, props: { url: props.url, alt: props.alt } });
    }, [props]);
    const onLoad = React.useCallback((event: ImageLoadEventData) => {
        if (event.source.width > 0 && event.source.height > 0) setAspectRatio(event.source.width / event.source.height);
    }, []);
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={`${t('markdown.openImageFullSize')}: ${props.alt || t('uiCopy.markdownImage')}`} onPress={open} style={styles.imageFrame}>
            <Image source={{ uri: props.url }} style={{ width: '100%', aspectRatio }} contentFit="contain" accessibilityLabel={props.alt} onLoad={onLoad} />
        </Pressable>
    );
}

function MarkdownImagePreviewModal(props: { url: string; alt: string; onClose: () => void }) {
    const viewport = useWindowDimensions();
    const width = Math.min(Math.max(viewport.width - 32, 280), 1120);
    const height = Math.min(Math.max(viewport.height - 80, 320), 900);
    return (
        <View style={[styles.modal, { width, height }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('markdown.closeImagePreview')} onPress={props.onClose} style={styles.modalClose}>
                <Ionicons name="close" size={24} />
            </Pressable>
            <ScrollView contentContainerStyle={styles.modalContent} maximumZoomScale={4} minimumZoomScale={1}>
                <Image source={{ uri: props.url }} style={{ width: width - 32, height: height - 32 }} contentFit="contain" accessibilityLabel={props.alt} />
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    root: { width: '100%' },
    text: { ...Typography.default(), color: theme.colors.text, fontSize: 16, lineHeight: 25, marginVertical: 7 },
    mixedParagraph: { width: '100%' },
    bold: { ...Typography.default('semiBold'), fontWeight: '700' },
    italic: { fontStyle: 'italic' },
    strike: { textDecorationLine: 'line-through' },
    inlineCode: { ...Typography.mono(), backgroundColor: theme.colors.surfaceHigh },
    link: { color: theme.colors.textLink, textDecorationLine: 'underline' },
    option: { color: theme.colors.text, backgroundColor: theme.colors.surfaceHigh },
    heading: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 17, lineHeight: 25, marginTop: 12, marginBottom: 5 },
    heading1: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 24, lineHeight: 30, marginTop: 14, marginBottom: 7 },
    heading2: { ...Typography.default('semiBold'), color: theme.colors.text, fontSize: 20, lineHeight: 27, marginTop: 13, marginBottom: 6 },
    quote: { borderLeftWidth: 3, borderLeftColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh, paddingHorizontal: 12, marginVertical: 8 },
    rule: { height: 1, backgroundColor: theme.colors.divider, marginVertical: 8 },
    codeBlock: { backgroundColor: theme.colors.surfaceHighest, borderRadius: 8, marginVertical: 8, position: 'relative' },
    codeContent: { padding: 16 },
    codeLanguage: { ...Typography.mono(), color: theme.colors.textSecondary, fontSize: 12, paddingHorizontal: 16, paddingTop: 8 },
    codeCopyButton: { position: 'absolute', top: 8, right: 8, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, backgroundColor: theme.colors.surface },
    codeCopyText: { ...Typography.default(), color: theme.colors.text, fontSize: 12 },
    codeText: { ...Typography.mono(), color: theme.colors.text, fontSize: 14, lineHeight: 20 },
    tokenKeyword: { color: theme.colors.textDestructive },
    tokenString: { color: theme.colors.success },
    tokenComment: { color: theme.colors.textSecondary, fontStyle: 'italic' },
    tokenFunction: { color: theme.colors.textLink },
    list: { gap: 5, marginVertical: 7 },
    listRow: { flexDirection: 'row', alignItems: 'flex-start' },
    listItemBody: { flex: 1 },
    listMarker: { ...Typography.default(), color: theme.colors.textSecondary, width: 28, lineHeight: 24 },
    listText: { ...Typography.default(), color: theme.colors.text, flex: 1, lineHeight: 24 },
    table: { borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 8, marginVertical: 8 },
    tableRow: { flexDirection: 'row' },
    tableCell: { ...Typography.default(), color: theme.colors.text, minWidth: 120, padding: 8, borderRightWidth: 1, borderBottomWidth: 1, borderColor: theme.colors.divider },
    tableHeader: { ...Typography.default('semiBold'), backgroundColor: theme.colors.surfaceHigh },
    imageFrame: { width: '100%', maxWidth: 520, borderRadius: 12, overflow: 'hidden', marginVertical: 8 },
    imageFailure: { minHeight: 120, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20 },
    modal: { backgroundColor: theme.colors.surface, borderRadius: 14, overflow: 'hidden' },
    modalClose: { position: 'absolute', top: 12, right: 12, zIndex: 2, width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceHighest },
    modalContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
    optionsContainer: { flexDirection: 'column', gap: 8, marginVertical: 8 },
    optionPressable: { borderRadius: Platform.select({ web: 8, default: 18 }) },
    optionItem: {
        backgroundColor: Platform.select({ web: theme.colors.surfaceHighest, default: theme.colors.surface }),
        borderRadius: Platform.select({ web: 8, default: 18 }),
        paddingHorizontal: 16,
        paddingVertical: Platform.select({ web: 12, default: 14 }),
        borderWidth: Platform.select({ web: 1, default: StyleSheet.hairlineWidth }),
        borderColor: theme.colors.divider,
        overflow: 'hidden',
    },
    optionText: { ...Typography.default(), fontSize: 16, lineHeight: 24, color: theme.colors.text },
    optionButton: {
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        overflow: 'hidden',
    },
    optionButtonPressed: { opacity: 0.7 },
    optionButtonText: { ...Typography.default(), fontSize: 16, lineHeight: 24, color: theme.colors.text },
}));
