import * as React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useUnistyles } from 'react-native-unistyles';

import { useWorkspaceLinkPress } from '@/-session/workspaceLinkNavigation';
import { MermaidRenderer } from './MermaidRenderer';
import { normalizeExternalMarkdownLink } from './linkUtils';
import {
    decodeMarkdownOption,
    encodeMarkdownOptions,
    type MarkdownLineCommentAnchor,
    type MarkdownViewProps,
    type Option,
} from './MarkdownView.types';
import { useSession } from '@/sync/storage';
import {
    resolveMarkdownWorkspaceImageReference,
    resolveMarkdownWorkspaceLinkRoute,
    type MarkdownWorkspaceImageReference,
    type WorkspaceLinkRoute,
} from '@/utils/markdownWorkspaceLink';
import { loadMarkdownWorkspaceImage } from '@/utils/markdownWorkspaceImage';
import { openExternalUrl } from '@/utils/openExternalUrl';
import { t } from '@/text';
import { Modal } from '@/modal';
import { lineReviewVariables } from '@/components/lineReviewStyles';

export type { MarkdownViewProps, Option } from './MarkdownView.types';

type LinkTarget =
    | Readonly<{ kind: 'external'; url: string }>
    | Readonly<{ kind: 'workspace'; route: WorkspaceLinkRoute }>;

type HastNode = {
    type: string;
    tagName?: string;
    value?: string;
    properties?: { className?: string[]; href?: unknown };
    children?: HastNode[];
};

const sanitizeSchema = {
    ...defaultSchema,
    attributes: {
        ...defaultSchema.attributes,
        code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-/]],
        span: [...(defaultSchema.attributes?.span ?? []), ['className', /^hljs-/]],
    },
};

function sourceLine(node: any): number | undefined {
    const line = node?.position?.start?.line;
    return Number.isInteger(line) && line > 0 ? line : undefined;
}

function meaningfulChildren(node: HastNode): HastNode[] {
    return (node.children ?? []).filter((child) => child.type !== 'text' || child.value?.trim());
}

function optionItemsFromList(node: HastNode | undefined): string[] | null {
    if (!node || node.tagName !== 'ul') return null;
    const listItems = meaningfulChildren(node);
    if (!listItems.length || listItems.some((item) => item.tagName !== 'li')) return null;
    const options: string[] = [];
    for (const item of listItems) {
        let content = meaningfulChildren(item);
        if (content.length === 1 && content[0].tagName === 'p') content = meaningfulChildren(content[0]);
        if (content.length !== 1 || content[0].tagName !== 'a') return null;
        const href = content[0].properties?.href;
        const option = decodeMarkdownOption(typeof href === 'string' ? href : undefined);
        if (option === null) return null;
        options.push(option);
    }
    return options;
}

function WebOptionsBlock(props: {
    items: string[];
    onOptionPress?: (option: Option) => void;
}) {
    return (
        <div className="hh-markdown-options">
            {props.items.map((item, index) => props.onOptionPress ? (
                <button
                    key={index}
                    type="button"
                    className="hh-markdown-option"
                    onClick={() => props.onOptionPress?.({ title: item })}
                >{item}</button>
            ) : (
                <div key={index} className="hh-markdown-option-item">{item}</div>
            ))}
        </div>
    );
}

function ReviewGutter(props: { line?: number; onLineComment?: (anchor: MarkdownLineCommentAnchor) => void }) {
    if (!props.line || !props.onLineComment) return null;
    const line = props.line;
    return (
        <span className="hh-markdown-review-gutter">
            <span className="hh-markdown-source-line" aria-hidden="true">{line}</span>
            <button
                type="button"
                className="hh-markdown-comment-gutter"
                aria-label={t('files.commentOnLine', { line: String(line) })}
                title={t('files.commentOnLine', { line: String(line) })}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    props.onLineComment?.({ line });
                }}
            >+</button>
        </span>
    );
}

function LineCommentThread(props: {
    line?: number;
    renderLineComment?: (anchor: MarkdownLineCommentAnchor) => React.ReactNode;
}) {
    if (!props.line || !props.renderLineComment) return null;
    const thread = props.renderLineComment({ line: props.line });
    if (thread == null) return null;
    return (
        <div className="hh-markdown-inline-comment" data-comment-source-line={props.line}>
            {thread}
        </div>
    );
}

const ParentReviewLineContext = React.createContext<number | null>(null);
const ListDepthContext = React.createContext(0);

function MarkdownList({ ordered, children, ...rest }: any) {
    const listDepth = React.useContext(ListDepthContext) + 1;
    const Tag = ordered ? 'ol' : 'ul';
    return (
        <ListDepthContext.Provider value={listDepth}>
            <Tag {...rest}>{children}</Tag>
        </ListDepthContext.Provider>
    );
}

const IMAGE_RETRY_DELAYS_MS = [500, 1500] as const;

function MarkdownImage(props: {
    url: string;
    alt: string;
    reference: MarkdownWorkspaceImageReference | null;
    inlineSource?: string;
    suppressed: boolean;
    onOpenWorkspace: (route: WorkspaceLinkRoute) => void;
}) {
    const [retryToken, setRetryToken] = React.useState(0);
    const [state, setState] = React.useState<{ status: 'loading' | 'ready' | 'failed'; url?: string }>(() => (
        props.inlineSource
            ? { status: 'ready', url: props.inlineSource }
            : props.reference ? { status: 'loading' } : { status: 'failed' }
    ));

    React.useEffect(() => {
        if (props.inlineSource) {
            setState({ status: 'ready', url: props.inlineSource });
            return;
        }
        if (!props.reference) {
            setState({ status: 'failed' });
            return;
        }
        let cancelled = false;
        setState({ status: 'loading' });
        void (async () => {
            for (let attempt = 0; attempt <= IMAGE_RETRY_DELAYS_MS.length; attempt += 1) {
                const url = await loadMarkdownWorkspaceImage(props.reference!);
                if (cancelled) return;
                if (url) {
                    setState({ status: 'ready', url });
                    return;
                }
                if (attempt < IMAGE_RETRY_DELAYS_MS.length) {
                    await new Promise((resolve) => setTimeout(resolve, IMAGE_RETRY_DELAYS_MS[attempt]));
                }
            }
            if (!cancelled) setState({ status: 'failed' });
        })();
        return () => { cancelled = true; };
    }, [props.inlineSource, props.reference, retryToken]);

    if (props.suppressed) return null;
    if (state.status === 'loading') return <span className="hh-markdown-image-status">{t('common.loading')}</span>;
    if (state.status === 'failed' || !state.url) {
        if (!props.inlineSource && !props.reference) return <span>{`![${props.alt}](${props.url})`}</span>;
        return (
            <span role="alert" className="hh-markdown-image-failure">
                {t('markdown.imageLoadFailed')}
                <button type="button" onClick={() => setRetryToken((value) => value + 1)}>{t('common.retry')}</button>
            </span>
        );
    }
    const image = <img key={retryToken} src={state.url} alt={props.alt} loading="lazy" onError={() => setState({ status: 'failed' })} />;
    return (
        <button
            type="button"
            className="hh-markdown-image-button"
            aria-label={`${t('markdown.openImageFullSize')}: ${props.alt || t('uiCopy.markdownImage')}`}
            onClick={() => {
                if (props.reference) props.onOpenWorkspace(props.reference.workspaceRoute);
                else Modal.show({ component: MarkdownWebImagePreviewModal, props: { url: state.url!, alt: props.alt } });
            }}
        >{image}</button>
    );
}

function MarkdownWebImagePreviewModal(props: { url: string; alt: string; onClose: () => void }) {
    return (
        <div className="hh-markdown-image-modal">
            <button type="button" aria-label={t('markdown.closeImagePreview')} onClick={props.onClose}>×</button>
            <img src={props.url} alt={props.alt} />
        </div>
    );
}

function WebCodeBlock(props: {
    line?: number;
    onLineComment?: (anchor: MarkdownLineCommentAnchor) => void;
    children: React.ReactNode;
    content: string;
    className?: string;
    renderLineComment?: (anchor: MarkdownLineCommentAnchor) => React.ReactNode;
}) {
    const copy = React.useCallback(async () => {
        try {
            await Clipboard.setStringAsync(props.content);
            Modal.alert(t('common.success'), t('markdown.codeCopied'), [{ text: t('common.ok'), style: 'cancel' }]);
        } catch {
            Modal.alert(t('common.error'), t('markdown.copyFailed'), [{ text: t('common.ok'), style: 'cancel' }]);
        }
    }, [props.content]);
    return (
        <>
            <div className="hh-markdown-review-line" data-source-line={props.line}>
                <ReviewGutter line={props.line} onLineComment={props.onLineComment} />
                <pre className={props.className}>
                    <button type="button" className="hh-markdown-code-copy" aria-label={t('common.copy')} onClick={() => { void copy(); }}>{t('common.copy')}</button>
                    {props.children}
                </pre>
            </div>
            <LineCommentThread line={props.line} renderLineComment={props.renderLineComment} />
        </>
    );
}

function extractText(node: any): string {
    if (!node) return '';
    if (typeof node.value === 'string') return node.value;
    return Array.isArray(node.children) ? node.children.map(extractText).join('') : '';
}

type MarkdownRendererContextValue = {
    props: MarkdownViewProps;
    metadata: MarkdownViewProps['workspaceProvenance'] | null;
    openWorkspace: (route: WorkspaceLinkRoute) => void;
    resolveTarget: (url: string, label: string) => LinkTarget | null;
};

const MarkdownRendererContext = React.createContext<MarkdownRendererContextValue>(null!);

// ReactMarkdown treats these adapters as component types. Keep their identities
// stable so routine host updates do not remount stateful inline review editors.
const markdownComponents: Components = (() => {
    const reviewable = (tag: keyof React.JSX.IntrinsicElements) => function Reviewable({ node, children, ...rest }: any) {
        const { props } = React.useContext(MarkdownRendererContext);
        const Tag = tag as any;
        const line = sourceLine(node);
        const parentReviewLine = React.useContext(ParentReviewLineContext);
        const listDepth = React.useContext(ListDepthContext);
        const ownsReviewLine = line !== undefined && line !== parentReviewLine;
        const reviewStyle = tag === 'li'
            ? { ...rest.style, '--hh-markdown-list-indent': `${listDepth * 40}px` }
            : rest.style;
        const reviewUnit = (
            <Tag {...rest} style={reviewStyle} className={`${rest.className ?? ''} ${ownsReviewLine && props.onLineComment ? 'hh-markdown-review-line' : ''}`.trim()} data-source-line={line}>
                {ownsReviewLine ? <ReviewGutter line={line} onLineComment={props.onLineComment} /> : null}
                <ParentReviewLineContext.Provider value={ownsReviewLine ? line : parentReviewLine}>
                    {children}
                </ParentReviewLineContext.Provider>
                {tag === 'li' && ownsReviewLine ? <LineCommentThread line={line} renderLineComment={props.renderLineComment} /> : null}
            </Tag>
        );
        if (tag === 'li' || !ownsReviewLine) return reviewUnit;
        return (
            <>
                {reviewUnit}
                <LineCommentThread line={line} renderLineComment={props.renderLineComment} />
            </>
        );
    };

    return {
        ul: ({ node, children, ...rest }: any) => {
            const { props } = React.useContext(MarkdownRendererContext);
            const optionItems = optionItemsFromList(node);
            if (optionItems) return <WebOptionsBlock items={optionItems} onOptionPress={props.onOptionPress} />;
            return <MarkdownList {...rest}>{children}</MarkdownList>;
        },
        ol: ({ node: _node, children, ...rest }: any) => <MarkdownList {...rest} ordered>{children}</MarkdownList>,
        p: reviewable('p'),
        h1: reviewable('h1'),
        h2: reviewable('h2'),
        h3: reviewable('h3'),
        h4: reviewable('h4'),
        h5: reviewable('h5'),
        h6: reviewable('h6'),
        blockquote: reviewable('blockquote'),
        table: ({ node, children, ...rest }: any) => {
            const { props } = React.useContext(MarkdownRendererContext);
            const line = sourceLine(node);
            return (
                <div className="hh-markdown-review-line hh-markdown-table-review" data-source-line={line}>
                    <ReviewGutter line={line} onLineComment={props.onLineComment} />
                    <div className="hh-markdown-table-wrap">
                        <table {...rest}>{children}</table>
                    </div>
                    <LineCommentThread line={line} renderLineComment={props.renderLineComment} />
                </div>
            );
        },
        li: reviewable('li'),
        // Give each table row a source-line range so a deep link to a line
        // inside a table can reveal that exact row instead of the table
        // start. Cells inherit the row identity and stay commentable at the
        // row block level.
        tr: ({ node, children, ...rest }: any) => {
            const start = sourceLine(node);
            const end = node?.position?.end?.line;
            const lineStart = Number.isInteger(start) ? start : undefined;
            const lineEnd = Number.isInteger(end) ? end : lineStart;
            return (
                <tr
                    {...rest}
                    data-source-line-start={lineStart}
                    data-source-line-end={lineEnd}
                    className={`${rest.className ?? ''} hh-markdown-table-row`.trim()}
                >{children}</tr>
            );
        },
        hr: ({ node, ...rest }: any) => {
            const { props } = React.useContext(MarkdownRendererContext);
            const line = sourceLine(node);
            return (
                <div className="hh-markdown-review-line" data-source-line={line}>
                    <ReviewGutter line={line} onLineComment={props.onLineComment} />
                    <hr {...rest} />
                    <LineCommentThread line={line} renderLineComment={props.renderLineComment} />
                </div>
            );
        },
        pre: ({ node, children, ...rest }: any) => {
            const { props } = React.useContext(MarkdownRendererContext);
            const first = node?.children?.[0];
            const classes = first?.properties?.className ?? [];
            if (classes.includes('language-mermaid')) {
                return <MermaidRenderer content={extractText(first)} />;
            }
            const line = sourceLine(node);
            return <WebCodeBlock line={line} onLineComment={props.onLineComment} renderLineComment={props.renderLineComment} content={extractText(first)} className={rest.className}>{children}</WebCodeBlock>;
        },
        a: ({ href, children, node: _node, ...rest }: any) => {
            const { props, resolveTarget, openWorkspace } = React.useContext(MarkdownRendererContext);
            const option = decodeMarkdownOption(href);
            if (option !== null) {
                return (
                    <button type="button" className="hh-markdown-option" onClick={() => props.onOptionPress?.({ title: option })}>
                        {children}
                    </button>
                );
            }
            const label = typeof children === 'string' ? children : extractText(_node);
            const target = href ? resolveTarget(href, label) : null;
            if (!target) return <span>{children}</span>;
            return (
                <a
                    {...rest}
                    href={target.kind === 'external' ? target.url : '#'}
                    onClick={(event) => {
                        event.preventDefault();
                        if (target.kind === 'external') void openExternalUrl(target.url);
                        else openWorkspace(target.route);
                    }}
                >{children}</a>
            );
        },
        img: ({ src, alt }: any) => {
            const { props, metadata, openWorkspace } = React.useContext(MarkdownRendererContext);
            const url = src ?? '';
            const inlineSource = props.inlineImages?.sources.get(url);
            const suppressed = props.inlineImages?.suppressed.has(url) ?? false;
            const external = normalizeExternalMarkdownLink(url);
            if (external) return (
                <MarkdownImage
                    url={url}
                    alt={alt ?? ''}
                    reference={null}
                    inlineSource={external}
                    suppressed={suppressed}
                    onOpenWorkspace={openWorkspace}
                />
            );
            const reference = props.enableWorkspaceLinks
                && !inlineSource
                && props.workspaceImageRoot !== null
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
                : null;
            return (
                <MarkdownImage
                    url={url}
                    alt={alt ?? ''}
                    reference={reference}
                    inlineSource={inlineSource}
                    suppressed={suppressed}
                    onOpenWorkspace={openWorkspace}
                />
            );
        },
    };
})();

export const MarkdownView = React.memo(function MarkdownView(props: MarkdownViewProps) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const session = useSession(props.sessionId ?? '');
    const contextWorkspaceLinkPress = useWorkspaceLinkPress();
    const workspaceLinkPress = props.onWorkspaceLinkPress ?? contextWorkspaceLinkPress;
    const metadata = props.workspaceProvenance ?? session?.metadata;
    const rootRef = React.useRef<HTMLDivElement | null>(null);

    const openWorkspace = React.useCallback((route: WorkspaceLinkRoute) => {
        if (workspaceLinkPress) workspaceLinkPress(route);
        else router.push(route);
    }, [router, workspaceLinkPress]);

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



    const themeVariables = {
        ...lineReviewVariables(theme.dark, theme.colors.textSecondary),
        '--hh-markdown-text': theme.colors.text,
        '--hh-markdown-text-secondary': theme.colors.textSecondary,
        '--hh-markdown-divider': theme.colors.divider,
        '--hh-markdown-surface': theme.colors.surface,
        '--hh-markdown-surface-high': theme.colors.surfaceHigh,
        '--hh-markdown-surface-highest': theme.colors.surfaceHighest,
        '--hh-markdown-syntax-keyword': theme.colors.syntaxKeyword,
        '--hh-markdown-syntax-string': theme.colors.syntaxString,
        '--hh-markdown-syntax-comment': theme.colors.syntaxComment,
        '--hh-markdown-syntax-number': theme.colors.syntaxNumber,
        '--hh-markdown-syntax-function': theme.colors.syntaxFunction,
        '--hh-markdown-syntax-default': theme.colors.syntaxDefault,
    } as React.CSSProperties;

    // Reveal the rendered unit that corresponds to a requested source line. The
    // unit may be an exact `data-source-line` block or a `data-source-line-start`
    // table row whose range contains the line. The match prefers an exact
    // block, then a containing row, then the nearest exact rendered unit.
    React.useEffect(() => {
        const line = props.requestedLine;
        if (!line || line <= 0 || !rootRef.current) return undefined;
        const root = rootRef.current;
        const candidates = Array.from(root.querySelectorAll<HTMLElement>(
            '[data-source-line], [data-source-line-start]',
        ));
        let best: HTMLElement | null = null;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const element of candidates) {
            const exact = Number(element.getAttribute('data-source-line'));
            const start = Number(element.getAttribute('data-source-line-start')) || exact || 0;
            const end = Number(element.getAttribute('data-source-line-end')) || start;
            let score: number;
            if (exact === line) score = 0;
            else if (exact > 0) score = 1000 + Math.abs(exact - line);
            else if (line >= start && line <= end) score = 1;
            else score = 2000 + Math.min(Math.abs(line - start), Math.abs(line - end));
            if (score < bestScore) {
                bestScore = score;
                best = element;
            }
        }
        if (!best) return undefined;
        root.querySelectorAll('.hh-markdown-review-reveal').forEach((element) => {
            element.classList.remove('hh-markdown-review-reveal');
        });
        best.classList.add('hh-markdown-review-reveal');
        best.scrollIntoView({ block: 'center', inline: 'nearest' });
        return undefined;
    }, [props.markdown, props.requestedLine]);

    return (
        <div
            ref={rootRef}
            className={`hh-markdown-root${theme.dark ? ' hh-markdown-dark' : ''}${props.onLineComment ? ' hh-markdown-review-root' : ''}`}
            style={{ ...themeVariables, textAlign: props.textAlign }}
        >
            <style>{MARKDOWN_CSS}</style>
            <MarkdownRendererContext.Provider value={{ props, metadata, openWorkspace, resolveTarget }}>
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkBreaks, remarkFrontmatter, remarkMath]}
                    rehypePlugins={[rehypeRaw, rehypeHighlight, [rehypeSanitize, sanitizeSchema]]}
                    components={markdownComponents}
                >{encodeMarkdownOptions(props.markdown)}</ReactMarkdown>
            </MarkdownRendererContext.Provider>
        </div>
    );
});

const MARKDOWN_CSS = `
.hh-markdown-root { color: inherit; width: 100%; font-size: 16px; line-height: 1.55; overflow-wrap: anywhere; }
.hh-markdown-root > :first-child { margin-top: 0; }
.hh-markdown-root > :last-child { margin-bottom: 0; }
.hh-markdown-root h1,.hh-markdown-root h2,.hh-markdown-root h3,.hh-markdown-root h4,.hh-markdown-root h5,.hh-markdown-root h6 { line-height: 1.25; margin: 1em 0 .45em; }
.hh-markdown-root p,.hh-markdown-root ul,.hh-markdown-root ol,.hh-markdown-root blockquote,.hh-markdown-root pre { margin: .65em 0; }
.hh-markdown-root ul,.hh-markdown-root ol { padding-inline-start: 40px; }
.hh-markdown-root a { color: inherit; text-decoration: underline; cursor: pointer; }
.hh-markdown-root blockquote { border-left: 3px solid currentColor; opacity: .85; padding: .5em .9em; }
.hh-markdown-table-review { margin: .65em 0; }
.hh-markdown-table-wrap { max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; -webkit-overflow-scrolling: touch; touch-action: pan-x pan-y; }
.hh-markdown-table-wrap > table { border-collapse: collapse; display: table; width: max-content; min-width: 100%; max-width: none; margin: 0; overflow: visible; table-layout: auto; }
.hh-markdown-root th,.hh-markdown-root td { min-width: 8rem; border: 1px solid rgba(127,127,127,.35); padding: .45em .7em; text-align: left; overflow-wrap: break-word; word-break: normal; }
.hh-markdown-root pre { background: rgba(127,127,127,.12); border-radius: 8px; overflow-x: auto; padding: 16px; }
.hh-markdown-root code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.hh-markdown-root button { font-size: inherit; }
.hh-markdown-root img { display: block; max-width: min(100%, 720px); height: auto; border-radius: 10px; }
.hh-markdown-image-button { border: 0; padding: 0; background: transparent; cursor: pointer; }
.hh-markdown-image-failure { display: flex; min-height: 120px; max-width: 520px; align-items: center; justify-content: center; gap: 10px; border: 1px solid rgba(127,127,127,.35); border-radius: 10px; }
.hh-markdown-image-modal { position: relative; width: min(1120px, calc(100vw - 32px)); height: min(900px, calc(100vh - 80px)); padding: 16px; }
.hh-markdown-image-modal > button { position: absolute; top: 8px; right: 8px; z-index: 1; font-size: 16px; }
.hh-markdown-image-modal > img { width: 100%; height: 100%; object-fit: contain; }
.hh-markdown-options { display: flex; flex-direction: column; gap: 8px; width: 100%; margin: 8px 0; }
.hh-markdown-root > .hh-markdown-options { margin: 8px 0; }
.hh-markdown-option { appearance: none; display: block; box-sizing: border-box; width: 100%; overflow: hidden; border: 0; border-radius: 12px; padding: 8px 12px; background: var(--hh-markdown-surface-highest); color: var(--hh-markdown-text); font-family: IBMPlexSans-Regular; font-size: 16px; font-weight: 400; line-height: 24px; text-align: left; white-space: normal; overflow-wrap: anywhere; cursor: pointer; }
.hh-markdown-option:active { opacity: .7; }
.hh-markdown-option-item { box-sizing: border-box; width: 100%; overflow: hidden; border: 1px solid var(--hh-markdown-divider); border-radius: 8px; padding: 12px 16px; background: var(--hh-markdown-surface-highest); color: var(--hh-markdown-text); font-family: IBMPlexSans-Regular; font-size: 16px; font-weight: 400; line-height: 24px; overflow-wrap: anywhere; }
.hh-markdown-root.hh-markdown-dark { color: var(--hh-markdown-text); }
.hh-markdown-root.hh-markdown-dark h1,.hh-markdown-root.hh-markdown-dark h2,.hh-markdown-root.hh-markdown-dark h3,.hh-markdown-root.hh-markdown-dark h4,.hh-markdown-root.hh-markdown-dark h5,.hh-markdown-root.hh-markdown-dark h6,.hh-markdown-root.hh-markdown-dark p,.hh-markdown-root.hh-markdown-dark ul,.hh-markdown-root.hh-markdown-dark ol,.hh-markdown-root.hh-markdown-dark li { color: var(--hh-markdown-text); }
.hh-markdown-root.hh-markdown-dark a { color: var(--hh-markdown-text); }
.hh-markdown-root.hh-markdown-dark blockquote { border-left-color: var(--hh-markdown-divider); background: var(--hh-markdown-surface-high); color: var(--hh-markdown-text-secondary); opacity: 1; }
.hh-markdown-root.hh-markdown-dark blockquote p { color: var(--hh-markdown-text-secondary); }
.hh-markdown-root.hh-markdown-dark :not(pre) > code { background: var(--hh-markdown-surface-high); color: var(--hh-markdown-text); }
.hh-markdown-root.hh-markdown-dark pre { background: var(--hh-markdown-surface-highest); color: var(--hh-markdown-text); }
.hh-markdown-root.hh-markdown-dark pre code { color: var(--hh-markdown-text); }
.hh-markdown-root.hh-markdown-dark th,.hh-markdown-root.hh-markdown-dark td { border-color: var(--hh-markdown-divider); color: var(--hh-markdown-text); }
.hh-markdown-root.hh-markdown-dark th { background: var(--hh-markdown-surface-high); }
.hh-markdown-root.hh-markdown-dark .hljs-comment,.hh-markdown-root.hh-markdown-dark .hljs-quote { color: var(--hh-markdown-syntax-comment); }
.hh-markdown-root.hh-markdown-dark .hljs-keyword,.hh-markdown-root.hh-markdown-dark .hljs-selector-tag,.hh-markdown-root.hh-markdown-dark .hljs-literal { color: var(--hh-markdown-syntax-keyword); }
.hh-markdown-root.hh-markdown-dark .hljs-string,.hh-markdown-root.hh-markdown-dark .hljs-doctag { color: var(--hh-markdown-syntax-string); }
.hh-markdown-root.hh-markdown-dark .hljs-number { color: var(--hh-markdown-syntax-number); }
.hh-markdown-root.hh-markdown-dark .hljs-title,.hh-markdown-root.hh-markdown-dark .hljs-section,.hh-markdown-root.hh-markdown-dark .hljs-function { color: var(--hh-markdown-syntax-function); }
.hh-markdown-root.hh-markdown-dark .hljs-variable,.hh-markdown-root.hh-markdown-dark .hljs-attr,.hh-markdown-root.hh-markdown-dark .hljs-params,.hh-markdown-root.hh-markdown-dark .hljs-punctuation { color: var(--hh-markdown-syntax-default); }
.hh-markdown-root pre { position: relative; }
.hh-markdown-code-copy { position: absolute; top: 8px; right: 8px; opacity: 0; cursor: pointer; }
.hh-markdown-root pre:hover > .hh-markdown-code-copy,.hh-markdown-code-copy:focus-visible { opacity: 1; }
.hh-markdown-review-root { box-sizing: border-box; padding-inline-start: var(--hh-review-gutter-width); }
.hh-markdown-review-line { position: relative; }
.hh-markdown-inline-comment { box-sizing: border-box; width: 100%; margin: .3em 0 .8em; }
.hh-markdown-review-reveal,.hh-markdown-review-root .hh-markdown-review-line:hover { background: var(--hh-review-highlight); }
.hh-markdown-review-gutter { position: absolute; inset-inline-start: calc(-1 * var(--hh-review-gutter-width) - var(--hh-markdown-list-indent, 0px)); top: .15em; z-index: 4; display: grid; grid-template-columns: var(--hh-review-number-width) var(--hh-review-button-size); gap: var(--hh-review-gutter-gap); align-items: center; height: var(--hh-review-button-size); font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; font-size: 13px; font-variant-numeric: tabular-nums; line-height: 20px; }
.hh-markdown-source-line { overflow: hidden; color: var(--hh-review-number-color); text-align: end; text-overflow: clip; user-select: none; white-space: nowrap; }
.hh-markdown-comment-gutter { appearance: none; display: flex; align-items: center; justify-content: center; width: var(--hh-review-button-size); height: var(--hh-review-button-size); border: 0; border-radius: 4px; padding: 0; background: var(--hh-review-accent); color: var(--hh-review-accent-text); font: inherit; line-height: 20px; opacity: 0; cursor: pointer; touch-action: none; }
.hh-markdown-review-line:hover > .hh-markdown-review-gutter .hh-markdown-comment-gutter,.hh-markdown-comment-gutter:focus-visible { opacity: 1; }
.hh-markdown-comment-gutter:focus-visible { outline: 2px solid var(--hh-review-accent); outline-offset: 2px; }
@media (max-width: 700px) { .hh-markdown-review-gutter { font-size: 16px; } }
@media (hover: none), (pointer: coarse) { .hh-markdown-comment-gutter { opacity: 1; } }
.hljs-comment,.hljs-quote { color: #6a737d; }
.hljs-keyword,.hljs-selector-tag,.hljs-literal { color: #d73a49; }
.hljs-string,.hljs-doctag { color: #032f62; }
.hljs-title,.hljs-section,.hljs-function { color: #6f42c1; }
`;
