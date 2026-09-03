import {
    WorkspaceLiveHttpResponseSchema,
    isWorkspaceLiveLoopbackUrl,
    type WorkspaceLiveHttpRequest,
    type WorkspaceLiveHttpResponse,
} from '@slopus/happy-wire';
import { apiSocket } from './apiSocket';
import type { AttachmentPreview } from './attachmentTypes';

const WORKSPACE_LIVE_SERVICE_WORKER_PATH = '/workspace-live-sw.js';
const WORKSPACE_LIVE_VIEW_QUERY = '__happyherd_workspace_live_view';
const WORKSPACE_LIVE_MESSAGE = 'happyherd-workspace-live';

const registrations = new Map<string, WorkspaceLiveRegistration>();
let bridgeInstalled = false;

type WorkspaceLiveRegistration = {
    machineId: string;
    targetUrl: string;
    bridgeToken: string;
};

type WorkspaceLiveWorkerFetchMessage = {
    type: typeof WORKSPACE_LIVE_MESSAGE;
    action: 'fetch';
    viewId: string;
    bridgeToken: string;
    request: WorkspaceLiveHttpRequest;
};

export type WorkspaceLiveElementBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type WorkspaceLiveElementPick = {
    pickId: string;
    selector: string;
    outerHTML: string;
    computedCss: string;
    bounds: WorkspaceLiveElementBounds;
    screenshot: AttachmentPreview;
};

export type WorkspaceLiveBridgeRegistration = {
    viewId: string;
    iframeUrl: string;
    dispose: () => void;
};

function createOpaqueId(prefix: string): string {
    const random = globalThis.crypto?.randomUUID?.()
        ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${random}`;
}

function serviceWorkerSourceMatches(source: MessageEventSource | null): boolean {
    if (!source || typeof source !== 'object' || !('scriptURL' in source)) return false;
    try {
        return new URL(String(source.scriptURL), window.location.origin).pathname
            === WORKSPACE_LIVE_SERVICE_WORKER_PATH;
    } catch {
        return false;
    }
}

export async function fetchWorkspaceLiveOnMachine(
    machineId: string,
    request: WorkspaceLiveHttpRequest,
): Promise<WorkspaceLiveHttpResponse> {
    if (!isWorkspaceLiveLoopbackUrl(request.url)) {
        return { success: false, code: 'invalid-url', error: 'Workspace live requests must use a loopback URL' };
    }
    try {
        const response = await apiSocket.machineRPC<WorkspaceLiveHttpResponse, WorkspaceLiveHttpRequest>(
            machineId,
            'workspace-live-fetch',
            request,
        );
        const parsed = WorkspaceLiveHttpResponseSchema.safeParse(response);
        if (!parsed.success) {
            return { success: false, code: 'unavailable', error: 'Machine returned an unsupported live response' };
        }
        return parsed.data;
    } catch (error) {
        return {
            success: false,
            code: 'unavailable',
            error: error instanceof Error ? error.message : 'Machine live request failed',
        };
    }
}

function installWorkerFetchBridge(): void {
    if (bridgeInstalled || typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    bridgeInstalled = true;
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent<WorkspaceLiveWorkerFetchMessage>) => {
        const message = event.data;
        const responsePort = event.ports[0];
        if (!responsePort
            || !serviceWorkerSourceMatches(event.source)
            || message?.type !== WORKSPACE_LIVE_MESSAGE
            || message.action !== 'fetch') {
            return;
        }
        const registration = registrations.get(message.viewId);
        if (!registration || registration.bridgeToken !== message.bridgeToken) {
            responsePort.postMessage({
                success: false,
                code: 'unavailable',
                error: 'Workspace live view is no longer registered',
            } satisfies WorkspaceLiveHttpResponse);
            return;
        }
        void fetchWorkspaceLiveOnMachine(registration.machineId, message.request)
            .then((response) => responsePort.postMessage(response));
    });
}

function waitForWorkerActivation(worker: ServiceWorker): Promise<ServiceWorker> {
    if (worker.state === 'activated') return Promise.resolve(worker);
    return new Promise((resolve, reject) => {
        const onStateChange = () => {
            if (worker.state === 'activated') {
                worker.removeEventListener('statechange', onStateChange);
                resolve(worker);
            } else if (worker.state === 'redundant') {
                worker.removeEventListener('statechange', onStateChange);
                reject(new Error('Workspace live service worker could not activate'));
            }
        };
        worker.addEventListener('statechange', onStateChange);
    });
}

async function resolveActiveWorker(): Promise<ServiceWorker> {
    const workerRegistration = await navigator.serviceWorker.register(
        WORKSPACE_LIVE_SERVICE_WORKER_PATH,
        { scope: '/' },
    );
    const candidate = workerRegistration.active
        ?? workerRegistration.waiting
        ?? workerRegistration.installing;
    if (!candidate) throw new Error('Workspace live service worker is unavailable');
    return waitForWorkerActivation(candidate);
}

function postWorkerRegistration(
    worker: ServiceWorker,
    action: 'register' | 'unregister',
    payload: Record<string, unknown>,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timeout = window.setTimeout(() => reject(new Error('Workspace live service worker did not respond')), 10_000);
        channel.port1.onmessage = (event: MessageEvent<{ success?: boolean; error?: string }>) => {
            window.clearTimeout(timeout);
            channel.port1.close();
            if (event.data?.success) resolve();
            else reject(new Error(event.data?.error ?? 'Workspace live service worker rejected the view'));
        };
        worker.postMessage({ type: WORKSPACE_LIVE_MESSAGE, action, ...payload }, [channel.port2]);
    });
}

export function buildWorkspaceLiveIframeUrl(targetUrl: string, viewId: string, appOrigin: string): string {
    const target = new URL(targetUrl);
    const virtual = new URL(`${target.pathname}${target.search}`, appOrigin);
    virtual.searchParams.set(WORKSPACE_LIVE_VIEW_QUERY, viewId);
    virtual.hash = target.hash;
    return virtual.toString();
}

export async function registerWorkspaceLiveView(input: {
    machineId: string;
    targetUrl: string;
    viewId?: string;
}): Promise<WorkspaceLiveBridgeRegistration> {
    if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.serviceWorker) {
        throw new Error('Workspace live pages require service worker support');
    }
    if (!isWorkspaceLiveLoopbackUrl(input.targetUrl)) {
        throw new Error('Workspace live pages require a loopback URL');
    }

    installWorkerFetchBridge();
    const targetUrl = new URL(input.targetUrl).toString();
    const viewId = input.viewId ?? createOpaqueId('view');
    const bridgeToken = createOpaqueId('bridge');
    const registration = { machineId: input.machineId, targetUrl, bridgeToken };
    registrations.set(viewId, registration);

    let worker: ServiceWorker;
    try {
        worker = await resolveActiveWorker();
        await postWorkerRegistration(worker, 'register', { viewId, targetUrl, bridgeToken });
    } catch (error) {
        registrations.delete(viewId);
        throw error;
    }

    let disposed = false;
    return {
        viewId,
        iframeUrl: buildWorkspaceLiveIframeUrl(targetUrl, viewId, window.location.origin),
        dispose: () => {
            if (disposed) return;
            disposed = true;
            registrations.delete(viewId);
            void postWorkerRegistration(worker, 'unregister', { viewId, bridgeToken }).catch(() => undefined);
        },
    };
}

export function workspaceLiveScreenshotAttachment(input: {
    pickId: string;
    dataUrl: string;
    width: number;
    height: number;
}): AttachmentPreview {
    const comma = input.dataUrl.indexOf(',');
    const encodedLength = comma >= 0 ? input.dataUrl.length - comma - 1 : 0;
    const padding = input.dataUrl.endsWith('==') ? 2 : input.dataUrl.endsWith('=') ? 1 : 0;
    return {
        id: input.pickId,
        uri: input.dataUrl,
        width: Math.max(1, Math.round(input.width)),
        height: Math.max(1, Math.round(input.height)),
        mimeType: 'image/png',
        size: Math.max(0, Math.floor((encodedLength * 3) / 4) - padding),
        name: `localhost-element-${input.pickId}.png`,
    };
}

export const workspaceLiveProtocol = {
    messageType: WORKSPACE_LIVE_MESSAGE,
    viewQuery: WORKSPACE_LIVE_VIEW_QUERY,
} as const;
