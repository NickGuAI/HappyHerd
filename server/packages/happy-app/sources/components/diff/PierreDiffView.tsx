import * as React from 'react';
import { Platform, Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { DiffView } from '@/components/diff/DiffView';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { lineReviewVariables } from '@/components/lineReviewStyles';

export interface PierreDiffViewProps {
    oldFile?: { name: string; contents: string };
    newFile?: { name: string; contents: string };
    /** Render one complete source file through Pierre's syntax-aware file view. */
    file?: { name: string; contents: string };
    /** Unified diff string — alternative to oldFile/newFile. */
    patch?: string;
    diffStyle?: 'unified' | 'split';
    overflow?: 'scroll' | 'wrap';
    disableLineNumbers?: boolean;
    /** Hide Pierre's built-in file-name/stats header — useful when the surrounding UI already shows one. Web-only. */
    disableFileHeader?: boolean;
    /** Forces a theme override; defaults to the current app theme. */
    theme?: 'dark' | 'light';
    /** Replace Pierre's default header with custom React content. Web-only. */
    renderCustomHeader?: (fileDiff: any) => React.ReactNode;
    /** Allow expanding collapsed unchanged lines. Web-only (Pierre feature). */
    expandUnchanged?: boolean;
    /** Web-only gutter review affordance. */
    onGutterUtilityClick?: (line: number) => void;
    /** Web-only whole-line review gesture. */
    onLineClick?: (line: number) => void;
    /** Web-only source lines that already have pinned comments. */
    annotatedLines?: readonly number[];
    /** Web-only in-place content for each annotated source line. */
    renderLineAnnotation?: (line: number) => React.ReactNode;
    /** Reveal an explicitly linked source row once it has actually rendered. */
    requestedLine?: number | null;
}

export const PierreDiffView = React.memo(function PierreDiffView(props: PierreDiffViewProps) {
    if (Platform.OS === 'web') {
        return <PierreDiffViewWeb {...props} />;
    }
    return <PierreDiffViewNative {...props} />;
});

// ────────────────────────────────────────────────────────────────────────────
// Web module loader. Both @pierre/diffs and @pierre/diffs/react are lazy
// chunks; we resolve them once per app run and memoize the promise so every
// diff mount after the first one gets a cache hit with no extra render cycle.
// ────────────────────────────────────────────────────────────────────────────

type PierreMain = typeof import('@pierre/diffs');
type PierreReact = typeof import('@pierre/diffs/react');
type PierreBundle = { main: PierreMain; react: PierreReact };

let pierreBundlePromise: Promise<PierreBundle> | null = null;
const pierreGutterObservers = new WeakMap<HTMLElement, MutationObserver>();

function labelPierreGutterUtility(node: HTMLElement, phase: string): void {
    pierreGutterObservers.get(node)?.disconnect();
    pierreGutterObservers.delete(node);
    if (phase === 'unmount') return;
    const root = node.shadowRoot ?? node;
    const label = () => {
        const button = root.querySelector<HTMLElement>('[data-utility-button]');
        button?.setAttribute('aria-label', t('files.commentOnHoveredLine'));
        button?.setAttribute('title', t('files.commentOnHoveredLine'));
    };
    label();
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(label);
    observer.observe(root, { childList: true, subtree: true });
    pierreGutterObservers.set(node, observer);
}

function loadPierre(): Promise<PierreBundle> {
    if (!pierreBundlePromise) {
        pierreBundlePromise = (async () => {
            // Side-effect import registers the <diffs-container> custom element.
            const main = await import('@pierre/diffs');
            const react = await import('@pierre/diffs/react');
            return { main, react };
        })();
    }
    return pierreBundlePromise;
}

/**
 * Fire-and-forget prefetch — call once when entering a screen that will show
 * diffs so the lazy chunks are already in cache by the time they're rendered.
 */
export function prefetchPierreDiff(): void {
    if (Platform.OS !== 'web') return;
    void loadPierre();
}

function usePierreBundle(): PierreBundle | null {
    const [bundle, setBundle] = React.useState<PierreBundle | null>(null);
    React.useEffect(() => {
        let cancelled = false;
        loadPierre().then((b) => { if (!cancelled) setBundle(b); });
        return () => { cancelled = true; };
    }, []);
    return bundle;
}

// ────────────────────────────────────────────────────────────────────────────
// Web rendering.
// ────────────────────────────────────────────────────────────────────────────

const PierreDiffViewWeb = React.memo(function PierreDiffViewWeb(props: PierreDiffViewProps) {
    const { theme } = useUnistyles();
    const themeName: 'dark' | 'light' = props.theme ?? (theme.dark ? 'dark' : 'light');
    const diffsTheme = themeName === 'dark' ? 'github-dark-default' : 'github-light-default';
    const bundle = usePierreBundle();
    const seamColor = themeName === 'dark' ? '#b4b85c' : '#6f7424';
    const glowColor = themeName === 'dark' ? '#f3c969' : '#b7791f';

    if (!bundle) return <DiffSkeleton />;

    const options = {
        theme: diffsTheme as any,
        diffStyle: props.diffStyle,
        overflow: props.overflow,
        disableLineNumbers: props.disableLineNumbers,
        disableFileHeader: props.disableFileHeader,
        expandUnchanged: props.expandUnchanged,
        enableGutterUtility: Boolean(props.onGutterUtilityClick),
        lineHoverHighlight: props.onGutterUtilityClick ? 'line' : 'disabled',
        onGutterUtilityClick: props.onGutterUtilityClick
            ? (range: { start: number }) => props.onGutterUtilityClick?.(range.start)
            : undefined,
        onLineClick: props.onLineClick
            ? ({ lineNumber }: { lineNumber: number }) => props.onLineClick?.(lineNumber)
            : undefined,
        onPostRender: props.onGutterUtilityClick
            ? (node: HTMLElement, _instance: unknown, phase: string) => labelPierreGutterUtility(node, phase)
            : undefined,
        unsafeCSS: props.renderLineAnnotation
            ? `[data-gutter] [data-gutter-buffer="annotation"] { position: relative; background: color-mix(in srgb, ${seamColor} 18%, transparent); box-shadow: inset -3px 0 ${seamColor}; }
[data-gutter] [data-gutter-buffer="annotation"]::after { content: ""; position: absolute; top: 16px; right: 2px; width: 8px; height: 8px; border-radius: 999px; background: ${glowColor}; box-shadow: 0 0 12px ${glowColor}; }`
            : undefined,
    };

    if (props.file) {
        return (
            <FileViewFromFile
                bundle={bundle}
                file={props.file}
                options={options}
                annotatedLines={props.annotatedLines}
                renderLineAnnotation={props.renderLineAnnotation}
                requestedLine={props.requestedLine}
                reviewVariables={lineReviewVariables(themeName === 'dark', theme.colors.textSecondary)}
            />
        );
    }

    if (props.patch) {
        return <PatchFilesWeb bundle={bundle} patch={props.patch} options={options} renderCustomHeader={props.renderCustomHeader} />;
    }

    if (props.oldFile && props.newFile) {
        return <FileDiffFromFiles bundle={bundle} oldFile={props.oldFile} newFile={props.newFile} options={options} renderCustomHeader={props.renderCustomHeader} />;
    }

    return <View />;
});

function FileViewFromFile({
    bundle,
    file,
    options,
    annotatedLines,
    renderLineAnnotation,
    requestedLine,
    reviewVariables,
}: {
    bundle: PierreBundle;
    file: { name: string; contents: string };
    options: any;
    annotatedLines?: readonly number[];
    renderLineAnnotation?: (line: number) => React.ReactNode;
    requestedLine?: number | null;
    reviewVariables: ReturnType<typeof lineReviewVariables>;
}) {
    const { File } = bundle.react;
    const annotations = React.useMemo(
        () => Array.from(new Set(annotatedLines ?? [])).map((lineNumber) => ({ lineNumber, metadata: { lineNumber } })),
        [annotatedLines],
    );
    const revealed = React.useRef<{ node: HTMLElement; name: string; line: number } | null>(null);
    const onPostRender = (node: HTMLElement, instance: unknown, phase: string) => {
        options.onPostRender?.(node, instance, phase);
        if (phase === 'unmount') {
            revealed.current = null;
            return;
        }
        const root = node.shadowRoot;
        root?.querySelectorAll('[data-review-highlight]').forEach((row) => row.removeAttribute('data-review-highlight'));
        if (requestedLine && requestedLine > 0) {
            root?.querySelector(`[data-line="${requestedLine}"]`)?.setAttribute('data-review-highlight', '');
        }
        if (!requestedLine || requestedLine <= 0) {
            revealed.current = null;
            return;
        }
        if (revealed.current?.node === node && revealed.current.name === file.name && revealed.current.line === requestedLine) return;
        const row = root?.querySelector<HTMLElement>(`[data-line="${requestedLine}"]`);
        if (!row) return;
        row.scrollIntoView({ block: 'center', inline: 'nearest' });
        revealed.current = { node, name: file.name, line: requestedLine };
    };
    return (
        <File
            file={file}
            options={{
                ...options,
                onPostRender,
                unsafeCSS: `${options.unsafeCSS ?? ''}\n${options.enableGutterUtility ? FILE_REVIEW_CSS : ''}`,
            }}
            style={{ ...reviewVariables, '--diffs-font-size': '16px', '--diffs-line-height': '24px' } as React.CSSProperties}
            lineAnnotations={annotations}
            // Explicit null keeps gutter gestures controlled without allowing
            // a navigation or comment anchor to pin Pierre's hover utility.
            selectedLines={null}
            renderAnnotation={(annotation: any) => (
                renderLineAnnotation
                    ? renderLineAnnotation(annotation.lineNumber)
                    : <span aria-label={t('files.pinnedComment')} style={{ display: 'inline-block', padding: '2px 8px', opacity: 0.75 }}>●</span>
            )}
        />
    );
}

const FILE_REVIEW_CSS = `
[data-file] { --diffs-grid-number-column-width: var(--hh-review-gutter-width); }
[data-column-number] { font-size: 13px; }
[data-gutter] [data-column-number] { box-sizing: border-box; border: 0; padding: 0; padding-inline-end: calc(var(--hh-review-gutter-gap) + var(--hh-review-button-size) + var(--hh-review-content-gap)); color: var(--hh-review-number-color); }
[data-line-number-content] { min-width: var(--hh-review-number-width); }
[data-line] { padding-inline-start: 0; }
[data-gutter-utility-slot] { right: var(--hh-review-content-gap); }
[data-utility-button] { width: var(--hh-review-button-size); height: var(--hh-review-button-size); margin: 0; background: var(--hh-review-accent); color: var(--hh-review-accent-text); }
[data-utility-button]:focus-visible { outline: 2px solid var(--hh-review-accent); outline-offset: 2px; }
[data-line][data-hovered], [data-line][data-review-highlight] { background: var(--hh-review-highlight); }
@media (max-width: 700px) { [data-column-number] { font-size: 16px; } }
`;

function PatchFilesWeb({
    bundle,
    patch,
    options,
    renderCustomHeader,
}: {
    bundle: PierreBundle;
    patch: string;
    options: any;
    renderCustomHeader?: (fileDiff: any) => React.ReactNode;
}) {
    const files = React.useMemo(() => {
        try {
            const parsed = bundle.main.processPatch(patch);
            return parsed.files ?? [];
        } catch {
            return [];
        }
    }, [bundle, patch]);

    const { FileDiff } = bundle.react;
    return (
        <View>
            {files.map((fileDiff, i) => (
                <FileDiff key={i} fileDiff={fileDiff} options={options} renderCustomHeader={renderCustomHeader} />
            ))}
        </View>
    );
}

function FileDiffFromFiles({
    bundle,
    oldFile,
    newFile,
    options,
    renderCustomHeader,
}: {
    bundle: PierreBundle;
    oldFile: { name: string; contents: string };
    newFile: { name: string; contents: string };
    options: any;
    renderCustomHeader?: (fileDiff: any) => React.ReactNode;
}) {
    const fileDiff = React.useMemo(
        () => bundle.main.parseDiffFromFile(oldFile, newFile),
        [bundle, oldFile, newFile],
    );
    const { FileDiff } = bundle.react;
    return <FileDiff fileDiff={fileDiff} options={options} renderCustomHeader={renderCustomHeader} />;
}

function DiffSkeleton() {
    const { theme } = useUnistyles();
    return (
        <View
            style={{
                height: 96,
                backgroundColor: theme.colors.surface,
                borderRadius: 6,
                opacity: 0.5,
            }}
        />
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Native: no network dependencies. For oldFile/newFile we route to the classic
// plain-text DiffView; for a raw patch string we colorize lines by prefix.
// Always unified on native — `diffStyle` is intentionally ignored.
// ────────────────────────────────────────────────────────────────────────────

const PierreDiffViewNative = React.memo(function PierreDiffViewNative(props: PierreDiffViewProps) {
    if (props.file) {
        return <PlainPatchView patch={props.file.contents} wrapLines={props.overflow === 'wrap'} />;
    }
    if (props.patch) {
        return <PlainPatchView patch={props.patch} wrapLines={props.overflow === 'wrap'} />;
    }
    if (props.oldFile && props.newFile) {
        return (
            <DiffView
                oldText={props.oldFile.contents}
                newText={props.newFile.contents}
                showLineNumbers={!props.disableLineNumbers}
                wrapLines={props.overflow === 'wrap'}
            />
        );
    }
    return <View />;
});

function PlainPatchView({ patch, wrapLines }: { patch: string; wrapLines: boolean }) {
    const { theme } = useUnistyles();
    const colors = theme.colors.diff;

    const lines = React.useMemo(() => patch.split('\n'), [patch]);

    return (
        <View style={{ backgroundColor: theme.colors.surface, flex: 1, overflow: 'hidden' }}>
            {lines.map((line, i) => {
                const first = line.charAt(0);
                const isFileHeader =
                    line.startsWith('+++') ||
                    line.startsWith('---') ||
                    line.startsWith('diff ') ||
                    line.startsWith('index ') ||
                    line.startsWith('new file') ||
                    line.startsWith('deleted file') ||
                    line.startsWith('rename ') ||
                    line.startsWith('similarity ') ||
                    line.startsWith('Binary files');
                const isHunkHeader = line.startsWith('@@');

                let bg: string = colors.contextBg;
                let fg: string = colors.contextText;

                if (isHunkHeader) {
                    bg = colors.hunkHeaderBg;
                    fg = colors.hunkHeaderText;
                } else if (isFileHeader) {
                    bg = colors.contextBg;
                    fg = colors.hunkHeaderText;
                } else if (first === '+') {
                    bg = colors.addedBg;
                    fg = colors.addedText;
                } else if (first === '-') {
                    bg = colors.removedBg;
                    fg = colors.removedText;
                }

                return (
                    <Text
                        key={i}
                        numberOfLines={wrapLines ? undefined : 1}
                        style={{
                            ...Typography.mono(),
                            fontSize: 13,
                            lineHeight: 20,
                            backgroundColor: bg,
                            color: fg,
                            paddingHorizontal: 8,
                        }}
                    >
                        {line.length === 0 ? ' ' : line}
                    </Text>
                );
            })}
        </View>
    );
}
