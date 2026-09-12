import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { t } from '@/text';
import { loadPdfJs, pdfAssetRoot } from '@/utils/pdfjs.web';
import { clampPdfPan, fitPdfPage, type PdfPan } from '@/utils/pdfPageLayout';

type Props = { uri?: string; title: string; fileName?: string };
type Point = { x: number; y: number };
const origin = { x: 0, y: 0 };

export function MobilePdfPreview({ uri, title, fileName }: Props) {
    const { theme } = useUnistyles();
    const [attempt, setAttempt] = React.useState(0);
    const [pdf, setPdf] = React.useState<PDFDocumentProxy | null>(null);
    const [page, setPage] = React.useState<PDFPageProxy | null>(null);
    const [pageNumber, setPageNumber] = React.useState(1);
    const [failed, setFailed] = React.useState(false);
    const [painted, setPainted] = React.useState(false);
    const [area, setArea] = React.useState({ width: 0, height: 0 });
    const [zoom, setZoom] = React.useState(1);
    const [pan, setPan] = React.useState<PdfPan>(origin);
    const viewportRef = React.useRef<HTMLDivElement>(null);
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const pointers = React.useRef(new Map<number, Point>());
    const transform = React.useRef({ zoom, pan });
    transform.current = { zoom, pan };

    React.useEffect(() => {
        const viewport = viewportRef.current!;
        const observer = new ResizeObserver(() => setArea({ width: viewport.clientWidth, height: viewport.clientHeight }));
        observer.observe(viewport);
        return () => observer.disconnect();
    }, []);

    React.useEffect(() => {
        let disposed = false;
        let loadingTask: ReturnType<Awaited<ReturnType<typeof loadPdfJs>>['getDocument']> | undefined;
        setPdf(null);
        setPage(null);
        setPainted(false);
        setFailed(false);
        setPageNumber(1);
        setZoom(1);
        setPan(origin);
        void loadPdfJs(attempt > 0).then(async (api) => {
            if (disposed) return;
            if (!uri) throw new Error('Missing PDF');
            const source = uri.startsWith('data:')
                ? { data: Uint8Array.from(atob(uri.slice(uri.indexOf(',') + 1)), (char) => char.charCodeAt(0)) }
                : { url: uri };
            loadingTask = api.getDocument({
                ...source,
                cMapUrl: `${pdfAssetRoot}cmaps/`,
                cMapPacked: true,
                standardFontDataUrl: `${pdfAssetRoot}standard_fonts/`,
                wasmUrl: `${pdfAssetRoot}wasm/`,
                isEvalSupported: false,
            });
            const document = await loadingTask.promise;
            if (!disposed) setPdf(document);
        }).catch(() => { if (!disposed) setFailed(true); });
        return () => {
            disposed = true;
            void loadingTask?.destroy();
        };
    }, [uri, attempt]);

    React.useEffect(() => {
        if (!pdf) return;
        let disposed = false;
        setPage(null);
        setPainted(false);
        setZoom(1);
        setPan(origin);
        void pdf.getPage(pageNumber).then((next) => {
            if (!disposed) setPage(next);
        }).catch(() => { if (!disposed) setFailed(true); });
        return () => { disposed = true; };
    }, [pdf, pageNumber]);

    const pageSize = page?.getViewport({ scale: 1 }) ?? { width: 0, height: 0 };
    const fitScale = fitPdfPage(pageSize, area);
    const scale = fitScale * zoom;
    const width = pageSize.width * scale;
    const height = pageSize.height * scale;
    const visiblePan = clampPdfPan(pan, { width, height }, area);

    React.useEffect(() => {
        if (!page || scale <= 0) return;
        let disposed = false;
        let task: RenderTask | undefined;
        // Keep the last completed canvas visible while a pinch changes its CSS size.
        const timer = window.setTimeout(() => {
            const viewport = page.getViewport({ scale });
            const outputScale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (viewport.width * viewport.height)));
            const buffer = document.createElement('canvas');
            buffer.width = Math.max(1, Math.floor(viewport.width * outputScale));
            buffer.height = Math.max(1, Math.floor(viewport.height * outputScale));
            const context = buffer.getContext('2d')!;
            task = page.render({ canvas: buffer, canvasContext: context, viewport, transform: [outputScale, 0, 0, outputScale, 0, 0] });
            void task.promise.then(() => {
                if (disposed || !canvasRef.current) return;
                const canvas = canvasRef.current;
                canvas.width = buffer.width;
                canvas.height = buffer.height;
                canvas.getContext('2d')!.drawImage(buffer, 0, 0);
                setPainted(true);
            }).catch((error) => {
                if (!disposed && error?.name !== 'RenderingCancelledException') setFailed(true);
            });
        }, 60);
        return () => {
            disposed = true;
            window.clearTimeout(timer);
            task?.cancel();
        };
    }, [page, scale]);

    function updateTransform(nextZoom: number, nextPan: PdfPan) {
        const boundedZoom = Math.max(1, Math.min(8, nextZoom));
        const boundedPan = clampPdfPan(nextPan, { width: pageSize.width * fitScale * boundedZoom, height: pageSize.height * fitScale * boundedZoom }, area);
        transform.current = { zoom: boundedZoom, pan: boundedPan };
        setZoom(boundedZoom);
        setPan(boundedPan);
    }

    function movePointer(event: React.PointerEvent<HTMLDivElement>) {
        const previous = pointers.current.get(event.pointerId);
        if (!previous || !page) return;
        event.preventDefault();
        const before = [...pointers.current.values()];
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const after = [...pointers.current.values()];
        const current = transform.current;
        const currentPan = clampPdfPan(current.pan, { width, height }, area);
        if (after.length === 1) {
            updateTransform(current.zoom, { x: currentPan.x + event.clientX - previous.x, y: currentPan.y + event.clientY - previous.y });
        } else if (after.length === 2) {
            const distance = (points: Point[]) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            const previousDistance = distance(before);
            if (!previousDistance) return;
            const nextZoom = Math.max(1, Math.min(8, current.zoom * distance(after) / previousDistance));
            const ratio = nextZoom / current.zoom;
            const bounds = event.currentTarget.getBoundingClientRect();
            const oldX = (before[0].x + before[1].x) / 2 - bounds.left - area.width / 2;
            const oldY = (before[0].y + before[1].y) / 2 - bounds.top - area.height / 2;
            const newX = (after[0].x + after[1].x) / 2 - bounds.left - area.width / 2;
            const newY = (after[0].y + after[1].y) / 2 - bounds.top - area.height / 2;
            updateTransform(nextZoom, { x: newX - (oldX - currentPan.x) * ratio, y: newY - (oldY - currentPan.y) * ratio });
        }
    }

    const buttonStyle: React.CSSProperties = {
        width: 44, height: 44, padding: 0, flexShrink: 0, border: 0, borderRadius: 6,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, color: theme.colors.text, background: theme.colors.surface, cursor: 'pointer',
    };
    function control(label: string, icon: React.ComponentProps<typeof Ionicons>['name'], onClick: () => void, disabled = false) {
        return <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} style={{ ...buttonStyle, opacity: disabled ? 0.4 : 1 }}>
            <Ionicons name={icon} size={20} color={theme.colors.text} />
        </button>;
    }

    return (
        <div data-testid="mobile-pdf-preview" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0, minWidth: 0, color: theme.colors.text, background: theme.colors.surface }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 4, padding: 4, flexShrink: 0, borderBottom: `1px solid ${theme.colors.divider}` }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    {control(t('files.pdf.previousPage'), 'chevron-back', () => setPageNumber((number) => number - 1), !pdf || pageNumber <= 1 || failed)}
                    <span aria-live="polite" style={{ fontSize: 16, whiteSpace: 'nowrap', textAlign: 'center', minWidth: 56 }}>{t('files.pdf.pageIndicator', { current: String(pageNumber), total: pdf?.numPages ?? 0 })}</span>
                    {control(t('files.pdf.nextPage'), 'chevron-forward', () => setPageNumber((number) => number + 1), !pdf || pageNumber >= pdf.numPages || failed)}
                </div>
                <div style={{ display: 'flex' }}>
                    {control(t('files.pdf.zoomOut'), 'remove', () => updateTransform(zoom / 1.5, pan), !page || zoom <= 1 || failed)}
                    {control(t('files.pdf.fitPage'), 'scan-outline', () => updateTransform(1, origin), !page || failed)}
                    {control(t('files.pdf.zoomIn'), 'add', () => updateTransform(zoom * 1.5, pan), !page || zoom >= 8 || failed)}
                </div>
                <a href={uri} download={fileName} title={t('files.pdf.download')} aria-label={t('files.pdf.download')} style={buttonStyle}>
                    <Ionicons name="download-outline" size={20} color={theme.colors.text} />
                </a>
            </div>
            <div
                ref={viewportRef}
                data-testid="pdf-reading-area"
                onPointerDown={(event) => {
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
                }}
                onPointerMove={movePointer}
                onPointerUp={(event) => pointers.current.delete(event.pointerId)}
                onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
                onLostPointerCapture={(event) => pointers.current.delete(event.pointerId)}
                style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative', touchAction: 'none', background: theme.colors.groupped.background }}
            >
                <canvas ref={canvasRef} role="img" aria-label={title} data-zoom={zoom} style={{ display: painted && !failed ? 'block' : 'none', position: 'absolute', width, height, left: (area.width - width) / 2 + visiblePan.x, top: (area.height - height) / 2 + visiblePan.y, background: 'white' }} />
                {(!painted || failed) && <div role={failed ? 'alert' : 'status'} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, fontSize: 16 }}>
                    <span>{failed ? t('files.pdf.loadFailed') : t('common.loading')}</span>
                    {failed && <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setAttempt((value) => value + 1)} style={{ ...buttonStyle, width: 'auto', padding: '0 16px' }}>{t('common.retry')}</button>}
                </div>}
            </div>
        </div>
    );
}
