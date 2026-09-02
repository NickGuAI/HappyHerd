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

export type { MarkdownViewProps, Option } from './MarkdownView.types';

type LinkTarget =
    | Readonly<{ kind: 'external'; url: string }>
    | Readonly<{ kind: 'workspace'; route: WorkspaceLinkRoute }>;

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

function ReviewButton(props: { line?: number; onLineComment?: (anchor: MarkdownLineCommentAnchor) => void }) {
    if (!props.line || !props.onLineComment) return null;
    const line = props.line;
    return (
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
        <pre className={`hh-markdown-review-line ${props.className ?? ''}`.trim()} data-source-line={props.line}>
            <ReviewButton line={props.line} onLineComment={props.onLineComment} />
            <button type="button" className="hh-markdown-code-copy" aria-label={t('common.copy')} onClick={() => { void copy(); }}>{t('common.copy')}</button>
            {props.children}
        </pre>
    );
}

function extractText(node: any): string {
    if (!node) return '';
    if (typeof node.value === 'string') return node.value;
    return Array.isArray(node.children) ? node.children.map(extractText).join('') : '';
}

export const MarkdownView = React.memo(function MarkdownView(props: MarkdownViewProps) {
    const router = useRouter();
    const session = useSession(props.sessionId ?? '');
    const contextWorkspaceLinkPress = useWorkspaceLinkPress();
    const workspaceLinkPress = props.onWorkspaceLinkPress ?? contextWorkspaceLinkPress;
    const metadata = props.workspaceProvenance ?? session?.metadata;

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

    const components = React.useMemo<Components>(() => {
        const reviewable = (tag: keyof React.JSX.IntrinsicElements) => function Reviewable({ node, children, ...rest }: any) {
            const Tag = tag as any;
            const line = sourceLine(node);
            return (
                <Tag {...rest} className={`${rest.className ?? ''} ${props.onLineComment ? 'hh-markdown-review-line' : ''}`.trim()} data-source-line={line}>
                    <ReviewButton line={line} onLineComment={props.onLineComment} />
                    {children}
                </Tag>
            );
        };

        return {
            p: reviewable('p'),
            h1: reviewable('h1'),
            h2: reviewable('h2'),
            h3: reviewable('h3'),
            h4: reviewable('h4'),
            h5: reviewable('h5'),
            h6: reviewable('h6'),
            blockquote: reviewable('blockquote'),
            table: ({ node, children, ...rest }: any) => {
                const line = sourceLine(node);
                return (
                    <div className="hh-markdown-review-line hh-markdown-table-wrap" data-source-line={line}>
                        <ReviewButton line={line} onLineComment={props.onLineComment} />
                        <table {...rest}>{children}</table>
                    </div>
                );
            },
            li: reviewable('li'),
            hr: ({ node, ...rest }: any) => {
                const line = sourceLine(node);
                return (
                    <div className="hh-markdown-review-line" data-source-line={line}>
                        <ReviewButton line={line} onLineComment={props.onLineComment} />
                        <hr {...rest} />
                    </div>
                );
            },
            pre: ({ node, children, ...rest }: any) => {
                const first = node?.children?.[0];
                const classes = first?.properties?.className ?? [];
                if (classes.includes('language-mermaid')) {
                    return <MermaidRenderer content={extractText(first)} />;
                }
                const line = sourceLine(node);
                return <WebCodeBlock line={line} onLineComment={props.onLineComment} content={extractText(first)} className={rest.className}>{children}</WebCodeBlock>;
            },
            a: ({ href, children, node: _node, ...rest }: any) => {
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
    }, [metadata, openWorkspace, props.enableWorkspaceLinks, props.inlineImages, props.onLineComment, props.onOptionPress, props.relativeTo, props.sessionId, props.workspaceImageRoot, resolveTarget]);

    return (
        <div className="hh-markdown-root">
            <style>{MARKDOWN_CSS}</style>
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks, remarkFrontmatter, remarkMath]}
                rehypePlugins={[rehypeRaw, rehypeHighlight, [rehypeSanitize, sanitizeSchema]]}
                components={components}
            >{encodeMarkdownOptions(props.markdown)}</ReactMarkdown>
        </div>
    );
});

const MARKDOWN_CSS = `
.hh-markdown-root { color: inherit; width: 100%; font-size: 16px; line-height: 1.55; overflow-wrap: anywhere; }
.hh-markdown-root > :first-child { margin-top: 0; }
.hh-markdown-root > :last-child { margin-bottom: 0; }
.hh-markdown-root h1,.hh-markdown-root h2,.hh-markdown-root h3,.hh-markdown-root h4,.hh-markdown-root h5,.hh-markdown-root h6 { line-height: 1.25; margin: 1em 0 .45em; }
.hh-markdown-root p,.hh-markdown-root ul,.hh-markdown-root ol,.hh-markdown-root blockquote,.hh-markdown-root pre,.hh-markdown-root table { margin: .65em 0; }
.hh-markdown-root a { color: inherit; text-decoration: underline; cursor: pointer; }
.hh-markdown-root blockquote { border-left: 3px solid currentColor; opacity: .85; padding: .5em .9em; }
.hh-markdown-root table { border-collapse: collapse; display: block; max-width: 100%; overflow-x: auto; }
.hh-markdown-root th,.hh-markdown-root td { border: 1px solid rgba(127,127,127,.35); padding: .45em .7em; text-align: left; }
.hh-markdown-root pre { background: rgba(127,127,127,.12); border-radius: 8px; overflow-x: auto; padding: 16px; }
.hh-markdown-root code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.hh-markdown-root img { display: block; max-width: min(100%, 720px); height: auto; border-radius: 10px; }
.hh-markdown-image-button { border: 0; padding: 0; background: transparent; cursor: pointer; }
.hh-markdown-image-failure { display: flex; min-height: 120px; max-width: 520px; align-items: center; justify-content: center; gap: 10px; border: 1px solid rgba(127,127,127,.35); border-radius: 10px; }
.hh-markdown-image-modal { position: relative; width: min(1120px, calc(100vw - 32px)); height: min(900px, calc(100vh - 80px)); padding: 16px; }
.hh-markdown-image-modal > button { position: absolute; top: 8px; right: 8px; z-index: 1; }
.hh-markdown-image-modal > img { width: 100%; height: 100%; object-fit: contain; }
.hh-markdown-option { border: 0; border-radius: 10px; padding: 8px 12px; cursor: pointer; }
.hh-markdown-root pre { position: relative; }
.hh-markdown-code-copy { position: absolute; top: 8px; right: 8px; opacity: 0; cursor: pointer; }
.hh-markdown-root pre:hover > .hh-markdown-code-copy,.hh-markdown-code-copy:focus-visible { opacity: 1; }
.hh-markdown-review-line { position: relative; }
.hh-markdown-comment-gutter { position: absolute; left: -24px; top: .15em; width: 20px; height: 20px; border: 1px solid rgba(127,127,127,.45); border-radius: 50%; opacity: 0; cursor: pointer; line-height: 16px; padding: 0; }
.hh-markdown-review-line:hover > .hh-markdown-comment-gutter,.hh-markdown-comment-gutter:focus-visible { opacity: 1; }
@media (hover: none), (pointer: coarse) { .hh-markdown-comment-gutter { opacity: 1; } }
.hljs-comment,.hljs-quote { color: #6a737d; }
.hljs-keyword,.hljs-selector-tag,.hljs-literal { color: #d73a49; }
.hljs-string,.hljs-doctag { color: #032f62; }
.hljs-title,.hljs-section,.hljs-function { color: #6f42c1; }
`;
