import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';

// Production Web UI and auth context; isolated contract-shaped backend.
// This does not exercise the deployed server, database, WebSocket sync, or native host.
const evidenceDir = process.env.HAPPYHERD_EVIDENCE_DIR;
if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
const accountId = 'welcome-recovery-test';
const token = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub: accountId })).toString('base64')}.isolated-test`;
let authMode = 'server';
let authRequests = 0;
let authenticatedRequests = 0;
let releaseAuth;
let pendingAuth;
let backendError;
const sentinel = 'PRIVATE_SERVER_DETAIL_DO_NOT_DISPLAY';
const json = (response, status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
};

const distDir = resolve(process.argv[2] ?? 'dist-ci');
const indexPath = resolve(distDir, 'index.html');
await access(indexPath);

const contentTypes = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.html', 'text/html; charset=utf-8'],
    ['.ico', 'image/x-icon'],
    ['.js', 'application/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.wasm', 'application/wasm'],
    ['.woff2', 'font/woff2'],
]);

let origin = '';
const server = createServer(async (request, response) => {
    try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname === '/v1/auth') {
            authRequests++;
            try {
                let body = '';
                for await (const chunk of request) body += chunk;
                const proof = JSON.parse(body);
                assert.deepEqual(Object.keys(proof).sort(), ['challenge', 'publicKey', 'signature']);
                const key = createPublicKey({
                    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(proof.publicKey, 'base64')]),
                    format: 'der', type: 'spki',
                });
                assert.ok(verify(null, Buffer.from(proof.challenge, 'base64'), key, Buffer.from(proof.signature, 'base64')));
                if (pendingAuth) await pendingAuth;
                if (authMode === 'server') { json(response, 503, { error: sentinel }); return; }
                if (authMode === 'signature') { json(response, 401, { error: `Invalid signature: ${sentinel}` }); return; }
                json(response, 200, { success: true, token });
            } catch (error) {
                backendError = error;
                json(response, 400, { error: 'invalid test proof' });
            }
            return;
        }
        const authenticatedResponses = {
            '/v1/account/settings': { settings: null, settingsVersion: 0 },
            '/v1/account/profile': { id: accountId, timestamp: 0, firstName: null, lastName: null, avatar: null, github: null },
            '/v1/sessions': { sessions: [] },
            '/v1/machines': { machines: [] },
            '/v1/projects': { projects: [] },
            '/v1/artifacts': [],
            '/v1/friends': { friends: [] },
            '/v1/friends/requests': { requests: [] },
            '/v1/feed': { items: [], hasMore: false },
        };
        if (url.pathname in authenticatedResponses) {
            if (request.headers.authorization !== `Bearer ${token}`) { json(response, 401, { error: 'unauthorized' }); return; }
            authenticatedRequests++;
            json(response, 200, authenticatedResponses[url.pathname]);
            return;
        }
        if (url.pathname.startsWith('/v1') || url.pathname.startsWith('/v3') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket')) {
            response.writeHead(404, { 'content-type': 'application/json' });
            response.end('{"error":"not found"}');
            return;
        }

        const relativePath = url.pathname === '/' || !extname(url.pathname)
            ? 'index.html'
            : decodeURIComponent(url.pathname).replace(/^\/+/, '');
        const filePath = resolve(distDir, relativePath);
        if (filePath !== distDir && !filePath.startsWith(`${distDir}${sep}`)) {
            response.writeHead(403);
            response.end();
            return;
        }

        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) throw new Error('not a file');
        const contentType = contentTypes.get(extname(filePath)) ?? 'application/octet-stream';
        response.setHeader('content-type', contentType);

        if (filePath === indexPath) {
            const html = await readFile(indexPath, 'utf8');
            const config = `<script>window.__HAPPYHERD_CONFIG__ = ${JSON.stringify({ serverUrl: origin, disableAnalytics: true })};</script>`;
            response.end(html.replace(/<head[^>]*>/i, (head) => `${head}\n${config}`));
            return;
        }

        createReadStream(filePath).pipe(response);
    } catch {
        response.writeHead(404);
        response.end();
    }
});

await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Production Web smoke server did not bind');
origin = `http://127.0.0.1:${address.port}`;

const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
let browser;

try {
    browser = await chromium.launch({
        ...(executablePath ? { executablePath } : { channel: 'chrome' }),
        headless: true,
    });
    for (const surface of [
        { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
        { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    ]) {
        const { name, ...contextOptions } = surface;
        const context = await browser.newContext({ ...contextOptions, locale: 'en-US' });
        // Never use a shared service, even if runtime configuration regresses.
        await context.route('**/*', (route) => route.request().url().startsWith(`${origin}/`)
            ? route.continue() : route.abort());
        const page = await context.newPage();
        const pageErrors = [];
        let clientAuthRequests = 0;
        page.on('pageerror', (error) => pageErrors.push(error.message));
        page.on('request', (request) => {
            if (request.url() === `${origin}/v1/auth`) clientAuthRequests++;
        });
        authRequests = 0;
        authenticatedRequests = 0;
        authMode = 'server';
        const press = (locator) => surface.hasTouch ? locator.tap() : locator.click();
        const create = page.getByRole('button', { name: 'Create account', exact: true });
        const retry = page.getByRole('button', { name: 'Retry', exact: true });
        const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
        const failure = page.getByText('Account creation did not finish. Check your connection and try again.', { exact: true });
        const expectFailure = async () => {
            await failure.waitFor({ state: 'visible' });
            // Playwright visibility permits opacity zero; wait for the real modal fade.
            await page.waitForFunction((element) => {
                for (let current = element; current; current = current.parentElement) {
                    if (Number(getComputedStyle(current).opacity) !== 1) return false;
                }
                return true;
            }, await failure.elementHandle());
        };
        const screenshot = async (state) => {
            if (evidenceDir) await page.screenshot({ path: resolve(evidenceDir, `${name}-${state}.png`), fullPage: true });
        };
        await page.goto(origin, { waitUntil: 'load', timeout: 30_000 });
        await create.waitFor({ state: 'visible' });
        await screenshot('welcome');
        // Hold the request so repeated real pointer presses overlap pending state.
        pendingAuth = new Promise((resolvePending) => { releaseAuth = resolvePending; });
        await press(create);
        await page.waitForFunction((button) => button.getAttribute('aria-busy') === 'true', await create.elementHandle());
        const box = await create.boundingBox();
        assert.ok(box);
        for (let i = 0; i < 5; i++) {
            if (surface.hasTouch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
            else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }
        assert.equal(await create.getAttribute('aria-disabled'), 'true');
        await page.waitForTimeout(100);
        assert.equal(authRequests, 1, 'rapid presses must send one request');
        assert.equal(clientAuthRequests, 1, 'rapid presses must initiate one request');
        await screenshot('pending');
        releaseAuth();
        pendingAuth = undefined;
        await expectFailure();
        assert.ok(!(await page.locator('body').innerText()).includes(sentinel));
        assert.equal(await page.evaluate(() => localStorage.getItem('auth_credentials')), null);
        await screenshot('server-rejection');
        await press(cancel);
        await failure.waitFor({ state: 'hidden' });
        assert.notEqual(await create.getAttribute('aria-disabled'), 'true');
        assert.notEqual(await create.getAttribute('aria-busy'), 'true');
        await context.setOffline(true);
        await press(create);
        await expectFailure();
        assert.equal(authRequests, 1, 'offline request cannot reach backend');
        assert.equal(clientAuthRequests, 2);
        await screenshot('network-rejection');
        await context.setOffline(false);
        authMode = 'signature';
        await Promise.all([
            page.waitForResponse((response) => response.url() === `${origin}/v1/auth` && response.status() === 401),
            press(retry),
        ]);
        await expectFailure();
        assert.equal(authRequests, 2);
        assert.equal(clientAuthRequests, 3);
        assert.ok(!(await page.locator('body').innerText()).includes(sentinel));
        // Restored backend accepts the application's real generated auth proof.
        authMode = 'success';
        await press(retry);
        await page.getByText('Backup', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
        await create.waitFor({ state: 'hidden' });
        assert.equal(authRequests, 3);
        assert.equal(clientAuthRequests, 4);
        assert.ok(authenticatedRequests >= 3);
        assert.equal(await page.evaluate(() => {
            const value = JSON.parse(localStorage.getItem('auth_credentials') ?? 'null');
            return typeof value?.token === 'string' && typeof value?.secret === 'string'
                && localStorage.getItem('account_key_backup_required') === 'true';
        }), true);
        // The backup gate is the shipped authenticated destination for new accounts.
        // Never capture its visible account key in an artifact.
        await page.reload({ waitUntil: 'load' });
        await page.getByText('Backup', { exact: true }).waitFor({ state: 'visible' });
        assert.equal(authRequests, 3, 'reload must restore saved authentication');
        assert.equal(clientAuthRequests, 4, 'reload must not initiate account creation');
        assert.deepEqual(pageErrors, []);
        if (backendError) throw backendError;
        console.log(`${name}: welcome → held/repeated presses → 503/cancel → offline error → 401/retry → authenticated backup gate → reload PASS; client auth requests=4; backend signed proofs=3`);
        await context.close();
    }
} finally {
    releaseAuth?.();
    await browser?.close();
    await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
}
