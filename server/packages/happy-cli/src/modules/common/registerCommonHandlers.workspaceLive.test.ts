import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { MAX_WORKSPACE_LIVE_BODY_BASE64_LENGTH, MAX_WORKSPACE_LIVE_BODY_BYTES } from '@slopus/happy-wire';
import { registerCommonHandlers } from './registerCommonHandlers';

type Handler = (params: unknown) => Promise<any>;

function registeredHandlers(workingDirectory: string | null): Map<string, Handler> {
    const handlers = new Map<string, Handler>();
    registerCommonHandlers({
        registerHandler: (name: string, handler: Handler) => handlers.set(name, handler),
    } as any, workingDirectory);
    return handlers;
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

describe('workspace live selected-machine fetch boundary', () => {
    const closeServers: Array<() => Promise<void>> = [];

    afterEach(async () => {
        await Promise.all(closeServers.splice(0).map((close) => close()));
    });

    async function startServer(
        listener: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
    ): Promise<string> {
        const server = createServer((request, response) => void listener(request, response));
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        closeServers.push(() => new Promise<void>((resolve, reject) => {
            server.closeAllConnections();
            server.close((error) => error ? reject(error) : resolve());
        }));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
        return `http://127.0.0.1:${address.port}`;
    }

    it('registers the fetch boundary only on the machine-scoped daemon', () => {
        expect(registeredHandlers(null).has('workspace-live-fetch')).toBe(true);
        expect(registeredHandlers('/workspace').has('workspace-live-fetch')).toBe(false);
    });

    it('preserves the method, headers, body, status, response headers, and bytes', async () => {
        const serverUrl = await startServer(async (request, response) => {
            const body = await readRequestBody(request);
            response.writeHead(201, 'Created for workspace', {
                'content-type': 'application/octet-stream',
                'x-workspace-response': 'preserved',
            });
            response.end(Buffer.concat([
                Buffer.from(`${request.method}|${request.headers['x-workspace-request']}|`),
                body,
            ]));
        });

        const response = await registeredHandlers(null).get('workspace-live-fetch')?.({
            url: `${serverUrl}/submit`,
            method: 'POST',
            headers: {
                'content-type': 'application/octet-stream',
                'x-workspace-request': 'preserved',
            },
            body: Buffer.from([0, 1, 2, 255]).toString('base64'),
        });

        expect(response).toMatchObject({
            success: true,
            status: 201,
            statusText: 'Created for workspace',
            finalUrl: `${serverUrl}/submit`,
            headers: {
                'content-type': 'application/octet-stream',
                'x-workspace-response': 'preserved',
            },
        });
        expect(Buffer.from(response.body, 'base64')).toEqual(
            Buffer.concat([Buffer.from('POST|preserved|'), Buffer.from([0, 1, 2, 255])]),
        );
    });

    it.each([
        'http://127.1:3000/',
        'http://2130706433:3000/',
        'http://0x7f000001:3000/',
        'http://localhost.:3000/',
        'http://localhost@evil.example:3000/',
        'https://example.com/',
    ])('rejects non-exact target %s before network access', async (url) => {
        await expect(registeredHandlers(null).get('workspace-live-fetch')?.({
            url,
            method: 'GET',
            headers: {},
        })).resolves.toEqual({
            success: false,
            code: 'invalid-url',
            error: 'Workspace live URL must use an exact loopback authority',
        });
    });

    it('follows a relative redirect while preserving request fields', async () => {
        const seen: Array<{ path: string; method?: string; marker?: string; body: string }> = [];
        const serverUrl = await startServer(async (request, response) => {
            const body = (await readRequestBody(request)).toString('utf8');
            seen.push({
                path: request.url ?? '',
                method: request.method,
                marker: request.headers['x-workspace-request'] as string | undefined,
                body,
            });
            if (request.url === '/start') {
                response.writeHead(307, { location: '/finish' });
                response.end();
                return;
            }
            response.end('redirected');
        });

        const response = await registeredHandlers(null).get('workspace-live-fetch')?.({
            url: `${serverUrl}/start`,
            method: 'POST',
            headers: { 'x-workspace-request': 'preserved' },
            body: Buffer.from('request-body').toString('base64'),
        });

        expect(response).toMatchObject({ success: true, finalUrl: `${serverUrl}/finish` });
        expect(seen).toEqual([
            { path: '/start', method: 'POST', marker: 'preserved', body: 'request-body' },
            { path: '/finish', method: 'POST', marker: 'preserved', body: 'request-body' },
        ]);
    });

    it('applies browser redirect method semantics before issuing the next loopback request', async () => {
        const seen: Array<{ path: string; method?: string; body: string; contentType?: string }> = [];
        const serverUrl = await startServer(async (request, response) => {
            seen.push({
                path: request.url ?? '',
                method: request.method,
                body: (await readRequestBody(request)).toString('utf8'),
                contentType: request.headers['content-type'],
            });
            if (request.url === '/start') {
                response.writeHead(303, { location: '/finish' });
                response.end();
                return;
            }
            response.end('redirected');
        });

        await registeredHandlers(null).get('workspace-live-fetch')?.({
            url: `${serverUrl}/start`,
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: Buffer.from('{}').toString('base64'),
        });

        expect(seen).toEqual([
            { path: '/start', method: 'POST', body: '{}', contentType: 'application/json' },
            { path: '/finish', method: 'GET', body: '', contentType: undefined },
        ]);
    });

    it.each([
        'https://example.com/outside',
        'http://127.1/outside',
        '//2130706433/outside',
    ])('rejects redirect target %s before following it', async (location) => {
        const serverUrl = await startServer((_request, response) => {
            response.writeHead(302, { location });
            response.end();
        });

        await expect(registeredHandlers(null).get('workspace-live-fetch')?.({
            url: `${serverUrl}/start`,
            method: 'GET',
            headers: {},
        })).resolves.toEqual({
            success: false,
            code: 'invalid-url',
            error: 'Workspace live redirect left the loopback boundary',
        });
    });

    it('returns explicit errors for invalid requests and oversized request or response bodies', async () => {
        const serverUrl = await startServer((_request, response) => {
            response.writeHead(200, { 'content-length': String(MAX_WORKSPACE_LIVE_BODY_BYTES + 1) });
            response.end();
        });
        const handler = registeredHandlers(null).get('workspace-live-fetch')!;

        await expect(handler({ url: `${serverUrl}/`, method: 'get', headers: {} })).resolves.toMatchObject({
            success: false,
            code: 'invalid-request',
        });
        await expect(handler({
            url: `${serverUrl}/`,
            method: 'POST',
            headers: {},
            body: 'A'.repeat(MAX_WORKSPACE_LIVE_BODY_BASE64_LENGTH),
        })).resolves.toMatchObject({ success: false, code: 'too-large' });
        await expect(handler({ url: `${serverUrl}/`, method: 'GET', headers: {} })).resolves.toMatchObject({
            success: false,
            code: 'too-large',
        });
    });
});
