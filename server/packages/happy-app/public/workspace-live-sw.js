/* HappyHerd Workspace live-page bridge. This worker is root-scoped so a live
 * iframe can retain the target page's pathname. Every client without an exact,
 * registered live-view mapping is passed through unchanged. */

const MESSAGE_TYPE = 'happyherd-workspace-live';
const VIEW_QUERY = '__happyherd_workspace_live_view';
const TARGET_QUERY = '__happyherd_workspace_live_target';
const DATABASE_NAME = 'happyherd-workspace-live-v1';
const DATABASE_VERSION = 1;
const REQUEST_TIMEOUT_MS = 55_000;
// Keep this aligned with MAX_WORKSPACE_LIVE_BODY_BYTES in happy-wire. The
// encrypted/base64 envelope must remain below Socket.IO's 20 MiB frame limit.
const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;
const RAW_LOOPBACK_URL = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:[/?#]|$)/i;
const registrations = new Map();
const clientViews = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains('registrations')) {
                database.createObjectStore('registrations', { keyPath: 'viewId' });
            }
            if (!database.objectStoreNames.contains('clients')) {
                const store = database.createObjectStore('clients', { keyPath: 'clientId' });
                store.createIndex('viewId', 'viewId', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Could not open live-view storage'));
    });
}

async function storeRecord(storeName, value) {
    const database = await openDatabase();
    await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).put(value);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
    database.close();
}

async function readRecord(storeName, key) {
    const database = await openDatabase();
    const result = await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    database.close();
    return result;
}

async function deleteRegistration(viewId) {
    const database = await openDatabase();
    await new Promise((resolve, reject) => {
        const transaction = database.transaction(['registrations', 'clients'], 'readwrite');
        transaction.objectStore('registrations').delete(viewId);
        const index = transaction.objectStore('clients').index('viewId');
        const cursorRequest = index.openCursor(IDBKeyRange.only(viewId));
        cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            clientViews.delete(cursor.value.clientId);
            cursor.delete();
            cursor.continue();
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
    database.close();
}

async function getRegistration(viewId) {
    const cached = registrations.get(viewId);
    if (cached) return cached;
    const stored = await readRecord('registrations', viewId);
    if (stored) registrations.set(viewId, stored);
    return stored;
}

async function getClientView(clientId) {
    if (!clientId) return undefined;
    const cached = clientViews.get(clientId);
    if (cached) return cached;
    const stored = await readRecord('clients', clientId);
    if (stored) clientViews.set(clientId, stored.viewId);
    return stored?.viewId;
}

async function bindClient(clientId, viewId) {
    if (!clientId) return;
    clientViews.set(clientId, viewId);
    await storeRecord('clients', { clientId, viewId });
}

self.addEventListener('message', (event) => {
    const message = event.data;
    if (message?.type !== MESSAGE_TYPE) return;
    const responsePort = event.ports[0];
    event.waitUntil((async () => {
        try {
            if (message.action === 'register') {
                if (!event.source?.id
                    || typeof message.viewId !== 'string'
                    || typeof message.bridgeToken !== 'string'
                    || !isLoopbackUrl(message.targetUrl)) {
                    throw new Error('Invalid Workspace live registration');
                }
                const record = {
                    viewId: message.viewId,
                    bridgeToken: message.bridgeToken,
                    targetUrl: new URL(message.targetUrl).toString(),
                    bridgeClientId: event.source.id,
                };
                registrations.set(record.viewId, record);
                await storeRecord('registrations', record);
            } else if (message.action === 'unregister') {
                const registration = await getRegistration(message.viewId);
                if (!registration || registration.bridgeToken !== message.bridgeToken) {
                    throw new Error('Workspace live registration does not match');
                }
                registrations.delete(message.viewId);
                await deleteRegistration(message.viewId);
            } else {
                return;
            }
            responsePort?.postMessage({ success: true });
        } catch (error) {
            responsePort?.postMessage({
                success: false,
                error: error instanceof Error ? error.message : 'Workspace live registration failed',
            });
        }
    })());
});

self.addEventListener('fetch', (event) => {
    event.respondWith(routeRequest(event));
});

async function routeRequest(event) {
    const virtualUrl = new URL(event.request.url);
    const requestedViewId = virtualUrl.searchParams.get(VIEW_QUERY);
    let viewId = requestedViewId ?? await getClientView(event.clientId);
    if (!viewId) return fetch(event.request);

    const registration = await getRegistration(viewId);
    if (!registration) return fetch(event.request);

    if (requestedViewId) {
        await bindClient(event.resultingClientId || event.clientId, viewId);
    } else if (event.resultingClientId) {
        await bindClient(event.resultingClientId, viewId);
    }

    const explicitTarget = virtualUrl.searchParams.get(TARGET_QUERY);
    virtualUrl.searchParams.delete(VIEW_QUERY);
    virtualUrl.searchParams.delete(TARGET_QUERY);
    if (explicitTarget && !isLoopbackUrl(explicitTarget)) {
        return errorResponse('Blocked a non-loopback live request', 400);
    }
    const targetUrl = explicitTarget
        ? new URL(explicitTarget)
        : requestedViewId
            ? new URL(registration.targetUrl)
            : new URL(`${virtualUrl.pathname}${virtualUrl.search}`, new URL(registration.targetUrl).origin);
    if (!isLoopbackUrl(targetUrl.toString())) return errorResponse('Blocked a non-loopback live request', 400);

    try {
        const rpcRequest = await serializeRequest(event.request, targetUrl.toString());
        const rpcResponse = await requestFromApp(registration, rpcRequest);
        if (!rpcResponse?.success) return errorResponse(rpcResponse?.error ?? 'Selected machine request failed', 502);
        return deserializeResponse(event.request.method, rpcResponse, viewId, virtualUrl.origin);
    } catch (error) {
        return errorResponse(error instanceof Error ? error.message : 'Selected machine request failed', 502);
    }
}

function isLoopbackUrl(value) {
    if (typeof value !== 'string' || !RAW_LOOPBACK_URL.test(value)) return false;
    try {
        const url = new URL(value);
        const hostname = url.hostname.toLowerCase();
        return (url.protocol === 'http:' || url.protocol === 'https:')
            && !url.username
            && !url.password
            && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]');
    } catch {
        return false;
    }
}

async function serializeRequest(request, targetUrl) {
    const headers = {};
    request.headers.forEach((value, key) => { headers[key] = value; });
    let body;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        const bytes = new Uint8Array(await request.clone().arrayBuffer());
        if (bytes.byteLength > MAX_REQUEST_BODY_BYTES) throw new Error('Workspace live request body is too large');
        body = bytesToBase64(bytes);
    }
    return { url: targetUrl, method: request.method, headers, ...(body === undefined ? {} : { body }) };
}

async function requestFromApp(registration, request) {
    const bridgeClient = await self.clients.get(registration.bridgeClientId);
    if (!bridgeClient) throw new Error('Workspace live app bridge is unavailable');
    return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => {
            channel.port1.close();
            reject(new Error('Selected machine did not respond'));
        }, REQUEST_TIMEOUT_MS);
        channel.port1.onmessage = (event) => {
            clearTimeout(timeout);
            channel.port1.close();
            resolve(event.data);
        };
        bridgeClient.postMessage({
            type: MESSAGE_TYPE,
            action: 'fetch',
            viewId: registration.viewId,
            bridgeToken: registration.bridgeToken,
            request,
        }, [channel.port2]);
    });
}

function deserializeResponse(method, response, viewId, virtualOrigin) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.delete('transfer-encoding');
    headers.delete('x-frame-options');
    headers.delete('content-security-policy');
    headers.delete('content-security-policy-report-only');

    const hasNoBody = method === 'HEAD' || response.status === 204 || response.status === 205 || response.status === 304;
    if (hasNoBody) return new Response(null, { status: response.status, statusText: response.statusText, headers });

    let bytes = base64ToBytes(response.body);
    const contentType = headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('text/html')) {
        let html = new TextDecoder().decode(bytes);
        html = rewriteAbsoluteAttributes(html, virtualOrigin);
        html = injectPageBridge(html, viewId, response.finalUrl, virtualOrigin);
        bytes = new TextEncoder().encode(html);
        headers.set('content-type', 'text/html; charset=utf-8');
    }
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers });
}

function rewriteAbsoluteAttributes(html, virtualOrigin) {
    return html.replace(/\b(src|href|action|poster)\s*=\s*(["'])(https?:\/\/[^"']+)\2/gi, (match, attribute, quote, value) => {
        if (!isLoopbackUrl(value)) return match;
        const target = new URL(value);
        const virtual = new URL(`${target.pathname}${target.search}`, virtualOrigin);
        virtual.searchParams.set(TARGET_QUERY, target.toString());
        virtual.hash = target.hash;
        return `${attribute}=${quote}${virtual.toString()}${quote}`;
    });
}

function injectPageBridge(html, viewId, finalUrl, virtualOrigin) {
    const finalTarget = new URL(finalUrl);
    const virtualBase = new URL(`${finalTarget.pathname}${finalTarget.search}`, virtualOrigin);
    const base = `<base href=${JSON.stringify(virtualBase.toString())}>`;
    const script = `<script>(${workspaceLivePageBridge.toString()})(${JSON.stringify(viewId)},${JSON.stringify(MESSAGE_TYPE)},${JSON.stringify(TARGET_QUERY)});<\/script>`;
    const head = /<head(?:\s[^>]*)?>/i.exec(html);
    if (head) return `${html.slice(0, head.index + head[0].length)}${base}${script}${html.slice(head.index + head[0].length)}`;
    return `${base}${script}${html}`;
}

function workspaceLivePageBridge(viewId, messageType, targetQuery) {
    const MAX_HTML = 20_000;
    const MAX_CSS = 12_000;
    const MAX_CLONE_NODES = 500;
    const MAX_SCREENSHOT_EDGE = 1_200;
    let pickerEnabled = false;
    let highlighted = null;

    const rawLoopbackUrl = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:[/?#]|$)/i;
    const isLoopback = (value) => {
        try {
            const raw = String(value);
            if (!rawLoopbackUrl.test(raw)) return false;
            const url = new URL(raw);
            const hostname = url.hostname.toLowerCase();
            return (url.protocol === 'http:' || url.protocol === 'https:')
                && !url.username
                && !url.password
                && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]');
        } catch {
            return false;
        }
    };
    const virtualize = (value) => {
        if (!isLoopback(value)) return value;
        const target = new URL(String(value));
        const virtual = new URL(`${target.pathname}${target.search}`, location.origin);
        virtual.searchParams.set(targetQuery, target.toString());
        virtual.hash = target.hash;
        return virtual.toString();
    };

    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
        if (typeof input === 'string' || input instanceof URL) return nativeFetch(virtualize(input), init);
        if (input instanceof Request && isLoopback(input.url)) return nativeFetch(new Request(virtualize(input.url), input), init);
        return nativeFetch(input, init);
    };
    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        return nativeOpen.call(this, method, virtualize(url), ...rest);
    };
    const nativeSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
        const lower = String(name).toLowerCase();
        return nativeSetAttribute.call(this, name,
            ['src', 'href', 'action', 'poster'].includes(lower) ? virtualize(value) : value);
    };

    const overlay = document.createElement('div');
    nativeSetAttribute.call(overlay, 'data-happyherd-picker-overlay', '');
    Object.assign(overlay.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: '2147483647', display: 'none',
        border: '2px solid #5b8cff', background: 'rgba(91,140,255,.12)', boxSizing: 'border-box',
    });
    const mountOverlay = () => { if (!overlay.isConnected) document.documentElement.appendChild(overlay); };
    if (document.documentElement) mountOverlay();
    else document.addEventListener('DOMContentLoaded', mountOverlay, { once: true });

    const updateOverlay = (element) => {
        highlighted = element;
        const rect = element.getBoundingClientRect();
        Object.assign(overlay.style, {
            display: 'block', left: `${rect.left}px`, top: `${rect.top}px`,
            width: `${rect.width}px`, height: `${rect.height}px`,
        });
    };
    const clearOverlay = () => { highlighted = null; overlay.style.display = 'none'; };

    const cssEscape = (value) => window.CSS?.escape
        ? window.CSS.escape(value)
        : String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
    const selectorFor = (element) => {
        if (element.id) return `#${cssEscape(element.id)}`;
        const parts = [];
        let current = element;
        while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
            let part = current.tagName.toLowerCase();
            const siblings = current.parentElement
                ? Array.from(current.parentElement.children).filter((candidate) => candidate.tagName === current.tagName)
                : [];
            if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
            parts.unshift(part);
            current = current.parentElement;
        }
        return parts.join(' > ');
    };
    const cssFor = (element) => {
        const style = getComputedStyle(element);
        let output = '';
        for (let index = 0; index < style.length && output.length < MAX_CSS; index += 1) {
            const property = style[index];
            output += `${property}: ${style.getPropertyValue(property)}${style.getPropertyPriority(property) ? ' !important' : ''};\n`;
        }
        return output.slice(0, MAX_CSS);
    };
    const copyStyles = (source, clone, budget) => {
        if (!(source instanceof Element) || !(clone instanceof Element) || budget.count >= MAX_CLONE_NODES) return;
        budget.count += 1;
        const computed = getComputedStyle(source);
        let cssText = '';
        for (let index = 0; index < computed.length && cssText.length < 40_000; index += 1) {
            const property = computed[index];
            cssText += `${property}:${computed.getPropertyValue(property)}${computed.getPropertyPriority(property) ? ' !important' : ''};`;
        }
        nativeSetAttribute.call(clone, 'style', cssText);
        const sourceChildren = source.children;
        const cloneChildren = clone.children;
        for (let index = 0; index < sourceChildren.length && budget.count < MAX_CLONE_NODES; index += 1) {
            copyStyles(sourceChildren[index], cloneChildren[index], budget);
        }
    };
    const capture = async (element, bounds) => {
        const width = Math.max(1, Math.ceil(bounds.width));
        const height = Math.max(1, Math.ceil(bounds.height));
        const scale = Math.min(2, MAX_SCREENSHOT_EDGE / width, MAX_SCREENSHOT_EDGE / height);
        const outputWidth = Math.max(1, Math.round(width * scale));
        const outputHeight = Math.max(1, Math.round(height * scale));
        const clone = element.cloneNode(true);
        copyStyles(element, clone, { count: 0 });
        const wrapper = document.createElement('div');
        nativeSetAttribute.call(wrapper, 'xmlns', 'http://www.w3.org/1999/xhtml');
        Object.assign(wrapper.style, { width: `${width}px`, height: `${height}px`, overflow: 'hidden' });
        wrapper.appendChild(clone);
        const markup = new XMLSerializer().serializeToString(wrapper);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
        const image = await new Promise((resolve, reject) => {
            const candidate = new Image();
            candidate.onload = () => resolve(candidate);
            candidate.onerror = () => reject(new Error('Element screenshot could not be rendered'));
            // A same-document data URL keeps the SVG foreignObject origin-clean
            // when Chrome draws it to a canvas. Blob URLs taint this exact path.
            candidate.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        });
        const canvas = document.createElement('canvas');
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Element screenshot canvas is unavailable');
        context.drawImage(image, 0, 0, outputWidth, outputHeight);
        return { dataUrl: canvas.toDataURL('image/png'), width: outputWidth, height: outputHeight };
    };

    window.addEventListener('message', (event) => {
        const message = event.data;
        if (event.source !== parent || event.origin !== location.origin
            || message?.type !== messageType || message.viewId !== viewId) return;
        if (message.action === 'picker') {
            pickerEnabled = message.enabled === true;
            if (!pickerEnabled) clearOverlay();
        }
    });
    document.addEventListener('pointermove', (event) => {
        if (!pickerEnabled) return;
        const element = event.target instanceof Element ? event.target : null;
        if (element && element !== overlay && element !== highlighted) updateOverlay(element);
    }, true);
    document.addEventListener('click', (event) => {
        if (!pickerEnabled) return;
        const element = event.target instanceof Element ? event.target : null;
        if (!element || element === overlay) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        pickerEnabled = false;
        clearOverlay();
        const rect = element.getBoundingClientRect();
        const bounds = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        void capture(element, bounds).then((screenshot) => {
            parent.postMessage({
                type: messageType,
                action: 'pick',
                viewId,
                pickId: crypto.randomUUID?.() ?? `pick-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                selector: selectorFor(element),
                outerHTML: element.outerHTML.slice(0, MAX_HTML),
                computedCss: cssFor(element),
                bounds,
                screenshot,
            }, location.origin);
        }).catch((error) => parent.postMessage({
            type: messageType,
            action: 'error',
            viewId,
            error: error instanceof Error ? error.message : 'Element screenshot failed',
        }, location.origin));
    }, true);
}

function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}

function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

function errorResponse(message, status) {
    return new Response(message, {
        status,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
}
