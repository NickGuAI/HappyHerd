// Acceptance-only transport delay. Normal HTTP and WebSocket traffic still
// reaches the real isolated server; no response or authentication is fabricated.
import http from 'node:http';
import net from 'node:net';

const DEADLINE_MS = 15000;
const MAX_BODY_BYTES = 4096;

export async function startNativeTransportRelay({ port = 43545, targetPort = 43546 } = {}) {
    const receipt = {
        failed: false, nativeClientVerified: false, armCount: 0, heldCount: 0, releaseCount: 0,
        forwardedRequests: 0, upgrades: 0, transportErrors: 0, events: [], connections: [],
    };
    const sockets = new Set();
    let state = 'idle', expectedThrough, pending, deadline, heldPromise, resolveHeld, rejectHeld, closing;
    const event = (type, fields = {}) => receipt.events.push({ type, ...fields });
    function track(socket) {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
        return socket;
    }
    function fail(type) {
        if (!receipt.failed) {
            receipt.failed = true;
            receipt.failure = type;
            event(type);
        }
        clearTimeout(deadline);
        state = 'failed';
        rejectHeld?.(new Error('Native transport hold failed'));
        forwardPending();
    }
    function forward(request, response, chunks = [], selected = false) {
        receipt.forwardedRequests += 1;
        const upstream = http.request({
            hostname: '127.0.0.1', port: targetPort, method: request.method,
            path: request.url, headers: request.rawHeaders, setHost: false, agent: false,
        }, incoming => {
            response.writeHead(incoming.statusCode, incoming.statusMessage, incoming.rawHeaders);
            incoming.on('end', () => {
                if (incoming.rawTrailers.length) response.addTrailers(incoming.rawTrailers);
            });
            incoming.on('error', () => response.destroy());
            incoming.pipe(response);
        });
        upstream.on('socket', track);
        upstream.on('error', () => {
            receipt.transportErrors += 1;
            if (selected) fail('held-transport-error');
            response.destroy();
        });
        request.on('error', () => upstream.destroy());
        request.on('aborted', () => upstream.destroy());
        response.on('close', () => {
            if (!response.writableFinished) upstream.destroy();
        });
        // Preserve header values, body bytes and trailers, including a failed
        // hold's original body. Never retain them in the public receipt.
        for (const chunk of chunks) upstream.write(chunk);
        if (request.readableEnded) {
            if (request.rawTrailers.length) upstream.addTrailers(request.rawTrailers);
            upstream.end();
        } else {
            request.on('end', () => {
                if (request.rawTrailers.length) upstream.addTrailers(request.rawTrailers);
            });
            request.pipe(upstream);
        }
    }
    function forwardPending(extraChunk) {
        if (!pending) return;
        const selected = pending;
        pending = undefined;
        selected.request.removeListener('data', selected.onData);
        selected.request.removeListener('end', selected.onEnd);
        selected.request.removeListener('aborted', selected.onAborted);
        selected.request.removeListener('error', selected.onError);
        if (extraChunk) selected.chunks.push(extraChunk);
        forward(selected.request, selected.response, selected.chunks, true);
        selected.chunks.length = 0;
    }
    function hold(request, response) {
        // Product feedRead sends the platform/version header. Retain only its
        // iOS attribution result, never the private header or version string.
        const nativeClient = request.headers['x-happy-client'];
        if (typeof nativeClient !== 'string' || !/^ios\//.test(nativeClient)) {
            fail('held-client-mismatch');
            forward(request, response, [], true);
            return;
        }
        receipt.nativeClientVerified = true;
        state = 'buffering';
        const selected = { request, response, chunks: [], bytes: 0 };
        pending = selected;
        selected.onAborted = () => fail('held-request-aborted');
        selected.onError = () => fail('held-request-error');
        selected.onData = chunk => {
            if (selected.bytes + chunk.length > MAX_BODY_BYTES) {
                // Forward this chunk immediately; never accumulate an oversized
                // body or replace the actual request with an acceptance response.
                forwardPending(chunk);
                fail('held-body-too-large');
                return;
            }
            selected.bytes += chunk.length;
            selected.chunks.push(chunk);
        };
        selected.onEnd = () => {
            let through;
            try { through = JSON.parse(Buffer.concat(selected.chunks).toString('utf8'))?.through; }
            catch { fail('held-body-invalid'); return; }
            if (through !== expectedThrough) { fail('held-through-mismatch'); return; }
            clearTimeout(deadline);
            state = 'held';
            receipt.heldCount += 1;
            event('held', { through: expectedThrough });
            deadline = setTimeout(() => fail('held-timeout'), DEADLINE_MS);
            resolveHeld({ through: expectedThrough });
        };
        request.on('data', selected.onData);
        request.once('end', selected.onEnd);
        request.once('aborted', selected.onAborted);
        request.once('error', selected.onError);
    }
    const server = http.createServer((request, response) => {
        if (state === 'armed' && request.method === 'POST' && request.url === '/v1/feed/read') hold(request, response);
        else forward(request, response);
    });
    server.on('connection', track);
    // Node's default clientError handler writes a synthetic 400; this relay
    // instead drops malformed connections without inventing a server response.
    server.on('clientError', (_error, socket) => socket.destroy());
    server.on('upgrade', (request, socket, head) => {
        receipt.upgrades += 1;
        const connection = { id: receipt.upgrades, connected: false, closed: false };
        receipt.connections.push(connection);
        socket.pause();
        const upstream = track(net.connect({ host: '127.0.0.1', port: targetPort }));
        upstream.once('connect', () => {
            connection.connected = true;
            const headers = [];
            for (let index = 0; index < request.rawHeaders.length; index += 2) {
                headers.push(`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}\r\n`);
            }
            upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.join('')}\r\n`);
            if (head.length) upstream.write(head);
            upstream.pipe(socket);
            socket.pipe(upstream);
            socket.resume();
        });
        upstream.on('error', () => { receipt.transportErrors += 1; socket.destroy(); });
        socket.on('error', () => upstream.destroy());
        socket.once('close', () => upstream.destroy());
        upstream.once('close', () => { connection.closed = true; socket.destroy(); });
    });
    await new Promise((resolve, reject) => {
        const failed = () => reject(new Error('Native transport relay listen failed'));
        server.once('error', failed);
        server.listen(port, '127.0.0.1', () => { server.removeListener('error', failed); resolve(); });
    });
    server.on('error', () => fail('relay-listener-error'));
    return {
        arm(through) {
            if (state !== 'idle' || typeof through !== 'string' || !/^0-(0|[1-9]\d*)$/.test(through)) {
                fail('arm-invalid');
                throw new Error('Native transport arm failed');
            }
            state = 'armed';
            expectedThrough = through;
            receipt.armCount += 1;
            event('armed', { through });
            heldPromise = new Promise((resolve, reject) => { resolveHeld = resolve; rejectHeld = reject; });
            // The timer can expire before the controller begins waiting.
            heldPromise.catch(() => {});
            deadline = setTimeout(() => fail('armed-timeout'), DEADLINE_MS);
        },
        waitForHeld() {
            if (!heldPromise || receipt.failed) return Promise.reject(new Error('Native transport hold failed'));
            return heldPromise;
        },
        release() {
            if (state !== 'held') {
                fail('release-invalid');
                throw new Error('Native transport release failed');
            }
            clearTimeout(deadline);
            state = 'released';
            receipt.releaseCount += 1;
            event('released', { through: expectedThrough });
            forwardPending();
        },
        receipt,
        connectionSnapshot() {
            return {
                active: receipt.connections.filter(connection => connection.connected && !connection.closed).map(connection => connection.id),
                connections: receipt.connections.map(connection => ({ ...connection })),
            };
        },
        close() {
            if (closing) return closing;
            if (['armed', 'buffering', 'held'].includes(state)) fail('closed-before-release');
            clearTimeout(deadline);
            state = 'closed';
            closing = new Promise(resolve => {
                const timer = setTimeout(() => {
                    for (const socket of sockets) socket.destroy();
                }, 2000);
                server.close(() => {
                    clearTimeout(timer);
                    for (const socket of sockets) socket.destroy();
                    resolve();
                });
                server.closeIdleConnections();
            });
            return closing;
        },
    };
}
