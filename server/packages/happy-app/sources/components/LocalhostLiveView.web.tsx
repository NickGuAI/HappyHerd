import * as React from 'react';
import {
    registerWorkspaceLiveView,
    workspaceLiveProtocol,
    workspaceLiveScreenshotAttachment,
    type WorkspaceLiveElementPick,
} from '@/sync/workspaceLive';

const MAX_PICK_TEXT_LENGTH = 20_000;
const MAX_SCREENSHOT_EDGE = 2_400;
const MAX_SCREENSHOT_DATA_URL_LENGTH = 8 * 1024 * 1024;

type PickerMessage = {
    type: string;
    action: 'pick';
    viewId: string;
    pickId: string;
    selector: string;
    outerHTML: string;
    computedCss: string;
    bounds: { x: number; y: number; width: number; height: number };
    screenshot: { dataUrl: string; width: number; height: number };
};

export type LocalhostLiveViewProps = {
    machineId: string;
    url: string;
    pickerEnabled: boolean;
    onPick: (pick: WorkspaceLiveElementPick) => void;
    onError?: (error: Error) => void;
    onCaptureError?: (error: Error) => void;
};

function finiteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function workspaceLivePickFromMessage(value: unknown): WorkspaceLiveElementPick | null {
    const message = value as Partial<PickerMessage> | null;
    const bounds = message?.bounds;
    const screenshot = message?.screenshot;
    if (!message
        || message.type !== workspaceLiveProtocol.messageType
        || message.action !== 'pick'
        || typeof message.pickId !== 'string'
        || !message.pickId
        || typeof message.selector !== 'string'
        || typeof message.outerHTML !== 'string'
        || typeof message.computedCss !== 'string'
        || !bounds
        || !finiteNumber(bounds.x)
        || !finiteNumber(bounds.y)
        || !finiteNumber(bounds.width)
        || !finiteNumber(bounds.height)
        || bounds.width <= 0
        || bounds.height <= 0
        || !screenshot
        || typeof screenshot.dataUrl !== 'string'
        || !screenshot.dataUrl.startsWith('data:image/png;base64,')
        || screenshot.dataUrl.length > MAX_SCREENSHOT_DATA_URL_LENGTH
        || !finiteNumber(screenshot.width)
        || !finiteNumber(screenshot.height)
        || screenshot.width <= 0
        || screenshot.height <= 0
        || screenshot.width > MAX_SCREENSHOT_EDGE
        || screenshot.height > MAX_SCREENSHOT_EDGE) {
        return null;
    }
    return {
        pickId: message.pickId,
        selector: message.selector.slice(0, MAX_PICK_TEXT_LENGTH),
        outerHTML: message.outerHTML.slice(0, MAX_PICK_TEXT_LENGTH),
        computedCss: message.computedCss.slice(0, MAX_PICK_TEXT_LENGTH),
        bounds: {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
        },
        screenshot: workspaceLiveScreenshotAttachment({
            pickId: message.pickId,
            dataUrl: screenshot.dataUrl,
            width: screenshot.width,
            height: screenshot.height,
        }),
    };
}

export const LocalhostLiveView = React.memo(function LocalhostLiveView({
    machineId,
    url,
    pickerEnabled,
    onPick,
    onError,
    onCaptureError,
}: LocalhostLiveViewProps) {
    const iframeRef = React.useRef<HTMLIFrameElement>(null);
    const viewIdRef = React.useRef(`view-${globalThis.crypto?.randomUUID?.()
        ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`);
    const deliveredPicksRef = React.useRef(new Set<string>());
    const [iframeUrl, setIframeUrl] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        let dispose: (() => void) | undefined;
        setIframeUrl(null);
        deliveredPicksRef.current.clear();
        void registerWorkspaceLiveView({ machineId, targetUrl: url, viewId: viewIdRef.current })
            .then((registration) => {
                dispose = registration.dispose;
                if (cancelled) {
                    registration.dispose();
                    return;
                }
                setIframeUrl(registration.iframeUrl);
            })
            .catch((error) => {
                if (!cancelled) onError?.(error instanceof Error ? error : new Error('Workspace live view failed'));
            });
        return () => {
            cancelled = true;
            dispose?.();
        };
    }, [machineId, onError, url]);

    const postPickerState = React.useCallback(() => {
        iframeRef.current?.contentWindow?.postMessage({
            type: workspaceLiveProtocol.messageType,
            action: 'picker',
            viewId: viewIdRef.current,
            enabled: pickerEnabled,
        }, window.location.origin);
    }, [pickerEnabled]);

    React.useEffect(() => {
        postPickerState();
    }, [postPickerState]);

    React.useEffect(() => {
        const receiveMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin
                || event.source !== iframeRef.current?.contentWindow
                || event.data?.viewId !== viewIdRef.current) {
                return;
            }
            if (event.data?.type === workspaceLiveProtocol.messageType && event.data.action === 'error') {
                onCaptureError?.(new Error(typeof event.data.error === 'string' ? event.data.error : 'Element picker failed'));
                return;
            }
            const pick = workspaceLivePickFromMessage(event.data);
            if (!pick || deliveredPicksRef.current.has(pick.pickId)) return;
            deliveredPicksRef.current.add(pick.pickId);
            onPick(pick);
        };
        window.addEventListener('message', receiveMessage);
        return () => window.removeEventListener('message', receiveMessage);
    }, [onCaptureError, onPick]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0 }}>
            <div
                title={url}
                style={{
                    flex: '0 0 auto',
                    overflow: 'hidden',
                    padding: '7px 10px',
                    borderBottom: '1px solid rgba(127,127,127,.24)',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 12,
                    lineHeight: '18px',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {url}
            </div>
            {iframeUrl ? (
                <iframe
                    ref={iframeRef}
                    key={iframeUrl}
                    title={url}
                    src={iframeUrl}
                    sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
                    onLoad={postPickerState}
                    style={{ flex: 1, width: '100%', minHeight: 0, border: 0, background: 'white' }}
                />
            ) : null}
        </div>
    );
});
