// Real Web acceptance against the isolated production server. Import and await
// runAcceptance(); never print its return value because it contains credentials.
// No response interception, injected application state, traces, or storage files.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runnerDirectory = dirname(fileURLToPath(import.meta.url));
const requireApp = createRequire(resolve(runnerDirectory, '../../../server/packages/happyherd-app/package.json'));
const DEFAULT_SHA = '62eaa1555621d35a4ab1042d111c2afed850bf1d';
const digest = value => createHash('sha256').update(value).digest('hex');
const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));
// Match sources/auth/secretKeyBackup.ts: RFC 4648 uppercase base32,
// without padding, grouped by five. Keep the input and result memory-only.
export function formatBackup(seed) {
    const bytes = Buffer.from(seed, 'base64url');
    assert(bytes.length === 32, 'A 32-byte acceptance seed is required');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let encoded = '';
    let buffer = 0;
    let bits = 0;
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            encoded += alphabet[(buffer >> bits) & 31];
        }
    }
    if (bits > 0) encoded += alphabet[(buffer << (5 - bits)) & 31];
    return encoded.match(/.{1,5}/g).join('-');
}
class AcceptanceTimeoutError extends Error {
    constructor(condition) {
        super('An acceptance condition timed out');
        this.name = 'AcceptanceTimeoutError';
        this.condition = condition;
    }
}

export async function runAcceptance({
    browser,
    origin = 'http://127.0.0.1:43545',
    artifactDir = resolve(runnerDirectory, `web-acceptance-${Date.now()}`),
    sha = DEFAULT_SHA,
    runnerPid = 87656,
} = {}) {
    const { chromium } = requireApp('playwright-core');
    const sodium = requireApp('libsodium-wrappers');
    await sodium.ready;
    assert(browser && browser.browserType().name() === chromium.name(), 'A Chromium browser is required for real latency control');
    assert.match(sha, /^[a-f0-9]{40}$/, 'An exact source revision is required');
    origin = new URL(origin).origin;
    artifactDir = resolve(artifactDir);
    await mkdir(artifactDir, { recursive: true });

    const checks = [];
    const receipt = {
        sourceRevision: sha,
        origin,
        inputFormat: 'Canonical backup: uppercase RFC 4648 base32 without padding, grouped by five',
        startedAt: new Date().toISOString(),
        status: 'RUNNING',
        browser: { engine: browser.browserType().name(), version: browser.version(), playwright: requireApp('playwright-core/package.json').version },
        surfaces: [
            { name: 'Web Desktop', width: 1440, height: 900, touch: false },
            { name: 'Web Mobile', width: 390, height: 844, touch: true },
        ],
        boundaries: {
            server: 'Isolated production server and persistent database on loopback',
            accountCreation: 'Normal Restore with Secret Key UI and real authentication',
            transport: 'Real HTTP and socket transport; no response or state mocks',
            machine: 'Offline protocol machine created through the authenticated API; no daemon or provider journey claimed',
            native: 'Not covered by this Web runner',
        },
        checks,
        endpointStatuses: [],
        socketConnections: [],
        socketUpdates: [],
        feedSnapshots: [],
        captures: [],
    };
    const receiptPath = resolve(artifactDir, 'web-acceptance.json');
    let activeStage = 'initialization';
    let contextA, contextM, contextB, pageA, pageM, pageB;
    let seedA, credsA, publishA;
    const socketStates = new WeakMap();
    const save = () => writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    async function stage(name, action) {
        activeStage = name;
        const value = await action();
        checks.push({ name, status: 'PASS', completedAt: new Date().toISOString() });
        await save();
        return value;
    }
    async function until(predicate, label, timeout = 20_000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            if (await predicate()) return;
            await pause(100);
        }
        throw new AcceptanceTimeoutError(label);
    }
    function recordEndpoint(source, method, path, status) {
        receipt.endpointStatuses.push({ source, method, path, status, at: new Date().toISOString() });
    }
    const recordedBrowserPaths = new Set(['/v1/auth', '/v1/account/profile', '/v1/feed', '/v1/feed/read', '/v1/machines', '/v1/feed/automation-blocked']);
    function observeContext(context, label) {
        const socketState = { open: new Set(), closes: 0, pages: new WeakMap(), nextConnection: 0 };
        socketStates.set(context, socketState);
        context.on('page', page => {
            const pageState = { current: null, documentNavigationPending: false };
            socketState.pages.set(page, pageState);
            const recordConnection = (event, connection) => receipt.socketConnections.push({
                source: label, event, connection, at: new Date().toISOString(),
            });
            function forgetCurrent(event) {
                if (!pageState.current) return;
                socketState.open.delete(pageState.current.socket);
                pageState.current.ready = false;
                recordConnection(event, pageState.current.id);
                pageState.current = null;
            }
            // Document reloads may omit the old WebSocket close event. Only
            // document navigations reset ownership; SPA routes keep their socket.
            page.on('request', request => {
                if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
                    pageState.documentNavigationPending = true;
                }
            });
            page.on('framenavigated', frame => {
                if (frame === page.mainFrame() && pageState.documentNavigationPending) {
                    forgetCurrent('document-navigation-reset');
                    pageState.documentNavigationPending = false;
                }
            });
            page.on('close', () => forgetCurrent('page-close-reset'));
            page.on('websocket', socket => {
            const url = new URL(socket.url());
            const socketOrigin = `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`;
            if (socketOrigin !== origin || url.pathname.replace(/\/$/, '') !== '/v1/updates') return;
            forgetCurrent('socket-superseded');
            const connection = { id: ++socketState.nextConnection, socket, ready: false, closed: false };
            pageState.current = connection;
            recordConnection('socket-created', connection.id);
            socket.on('close', () => {
                socketState.open.delete(socket);
                socketState.closes += 1;
                connection.ready = false;
                connection.closed = true;
                recordConnection('socket-close', connection.id);
            });
            socket.on('framereceived', ({ payload }) => {
                // Never retain the frame, connection URL, auth packet, metadata,
                // or nested feed body. Whitelist only read-related update fields.
                const text = typeof payload === 'string' ? payload : payload.toString('utf8');
                // Engine.IO message (4) plus Socket.IO namespace connect (0)
                // acknowledges authenticated readiness. Never retain its payload.
                if (/^40(?:\/[^,]+,)?(?:\{.*\})?$/s.test(text)) {
                    if (pageState.current === connection && !connection.closed) {
                        connection.ready = true;
                        socketState.open.add(socket);
                        recordConnection('socket-authenticated-ready', connection.id);
                    }
                    return;
                }
                if (/^41(?:\/[^,]+,)?$/.test(text)) {
                    connection.ready = false;
                    socketState.open.delete(socket);
                    recordConnection('socket-namespace-disconnect', connection.id);
                    return;
                }
                const event = /^42(?:\/[^,]+,)?(?:\d+)?(\[.*)$/s.exec(text);
                if (!event) return;
                try {
                    const packet = JSON.parse(event[1]);
                    const body = packet[1]?.body;
                    if (packet[0] !== 'update' || !['feed-read', 'new-feed-post'].includes(body?.t)) return;
                    const captured = { source: label, event: 'update', type: body.t, connection: connection.id, at: new Date().toISOString() };
                    if (typeof packet[1].id === 'string') captured.eventId = packet[1].id;
                    if (typeof body.id === 'string') captured.id = body.id;
                    if (typeof body.through === 'string') captured.through = body.through;
                    if (typeof body.readAt === 'number' || body.readAt === null) captured.readAt = body.readAt;
                    receipt.socketUpdates.push(captured);
                } catch { /* Non-JSON or unrelated socket packets are not evidence. */ }
            });
            });
        });
        context.on('response', response => {
            const url = new URL(response.url());
            if (url.origin === origin && recordedBrowserPaths.has(url.pathname)) {
                recordEndpoint(label, response.request().method(), url.pathname, response.status());
            }
        });
    }
    async function api(credentials, path, { method = 'GET', body, expectedStatus = 200 } = {}) {
        assert(credentials && typeof credentials.token === 'string', 'Authenticated API credentials are required');
        const url = new URL(path, origin);
        assert.equal(url.origin, origin, 'Acceptance API requests stay on the selected server');
        const response = await fetch(url, {
            method,
            headers: { Authorization: `Bearer ${credentials.token}`, 'X-Happy-Client': 'happyherd-issue-345-acceptance', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(15_000),
        });
        recordEndpoint('authenticated-api', method, url.pathname, response.status);
        assert.equal(response.status, expectedStatus, `Unexpected status for ${method} ${url.pathname}`);
        return response.json();
    }
    async function feed(credentials) {
        const data = await api(credentials, '/v1/feed?limit=200');
        assert(Array.isArray(data.items) && data.hasMore === false, 'The test account feed must fit in one authoritative page');
        return data.items;
    }
    const feedIdentity = items => items.map(({ id, cursor, readAt }) => ({ id, cursor, readAt })).sort((a, b) => a.id.localeCompare(b.id));
    function snapshot(label, account, items) {
        receipt.feedSnapshots.push({ label, account, items: feedIdentity(items) });
    }
    async function activate(locator, mobile) {
        if (mobile) await locator.tap();
        else await locator.click();
    }
    function readResponse(page) {
        return page.waitForResponse(response => new URL(response.url()).origin === origin
            && new URL(response.url()).pathname === '/v1/feed/read'
            && response.request().method() === 'POST', { timeout: 30_000 });
    }
    async function restore(context, seed, label, mobile = false) {
        observeContext(context, label);
        const page = await context.newPage();
        page.setDefaultTimeout(20_000);
        await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
        const configuredServer = await page.evaluate(() => window.__HAPPYHERD_CONFIG__?.serverUrl);
        assert.equal(configuredServer, origin, 'The served app must use the selected server');
        await activate(page.getByText('Restore with Secret Key', { exact: true }), mobile);
        // The seed is only passed to the production input and stays in memory.
        await page.locator('textarea').fill(formatBackup(seed));
        await activate(page.getByText('Restore Account', { exact: true }), mobile);
        await page.getByTestId('herd-inbox-bell').waitFor({ state: 'visible', timeout: 45_000 });
        const credentials = await page.evaluate(() => {
            const raw = localStorage.getItem('auth_credentials');
            return raw ? JSON.parse(raw) : null;
        });
        assert(credentials && typeof credentials.token === 'string' && typeof credentials.secret === 'string', 'Normal UI authentication must produce credentials');
        const profile = await api(credentials, '/v1/account/profile');
        assert(typeof profile.id === 'string', 'The authenticated profile must identify an account');
        return { page, credentials, accountId: profile.id };
    }
    async function openInbox(page, mobile = false) {
        await activate(page.getByTestId('herd-inbox-bell'), mobile);
        await page.getByTestId('herd-inbox-popover').waitFor({ state: 'visible' });
        await activate(page.getByTestId('herd-inbox-open-page'), mobile);
        await page.waitForURL(url => url.pathname === '/inbox');
        await page.getByTestId('inbox-mark-all-read').waitFor({ state: 'visible' });
    }
    async function backToInbox(page) {
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await page.waitForURL(url => url.pathname === '/inbox');
        await page.getByTestId('inbox-mark-all-read').waitFor({ state: 'visible' });
    }
    async function expectUnread(page, expectedIds, timeout = 20_000) {
        const expected = [...expectedIds].sort();
        await until(async () => {
            const actual = await page.locator('[data-testid^="feed-card-"] [data-testid^="feed-unread-"]').evaluateAll(nodes =>
                nodes.map(node => node.getAttribute('data-testid').slice('feed-unread-'.length)).sort());
            return JSON.stringify(actual) === JSON.stringify(expected);
        }, 'card unread identities', timeout);
        await until(async () => await page.getByTestId('herd-inbox-dot').count() === (expected.length ? 1 : 0), 'feed bell unread indicator', timeout);
        assert.equal(await page.getByTestId('herd-inbox-count').count(), 0, 'Fresh acceptance accounts have no independent friend badge');
    }
    async function expectCards(page, items) {
        for (const item of items) await page.getByTestId(`feed-card-${item.id}`).waitFor({ state: 'visible' });
    }
    async function done(page, mobile = false) {
        const button = page.getByTestId('inbox-mark-all-read');
        await until(async () => await button.getAttribute('aria-disabled') !== 'true', 'Done enabled');
        const response = readResponse(page);
        await activate(button, mobile);
        assert.equal((await response).status(), 200, 'The real Done request must succeed');
        await until(async () => await button.getAttribute('aria-disabled') !== 'true', 'Done acknowledgement complete');
    }
    async function capture(page, name) {
        assert.equal(new URL(page.url()).pathname, '/inbox', 'Capture only the authenticated Inbox');
        assert.equal(await page.locator('textarea').count(), 0, 'Never capture an account restore form');
        await page.screenshot({ path: resolve(artifactDir, `${name}.png`), fullPage: true, animations: 'disabled' });
        receipt.captures.push(`${name}.png`);
    }
    async function makePublisher(credentials, seed, label) {
        const machineId = `issue-345-${label}-${randomBytes(8).toString('hex')}`;
        const nonce = randomBytes(24);
        const metadata = { host: `acceptance-${label}`, displayName: `Inbox acceptance ${label}`, platform: 'darwin',
            happyCliVersion: 'acceptance', happyHomeDir: '/isolated/acceptance', homeDir: '/isolated' };
        const ciphertext = sodium.crypto_secretbox_easy(Buffer.from(JSON.stringify(metadata)), nonce, Buffer.from(seed, 'base64url'));
        const created = await api(credentials, '/v1/machines', { method: 'POST', body: {
            id: machineId, metadata: Buffer.concat([nonce, Buffer.from(ciphertext)]).toString('base64'),
        } });
        assert(created.machine?.id === machineId && created.machine.active === false, 'The publisher machine must be newly registered and offline');
        return async function publish(runId = `run-${randomBytes(8).toString('hex')}`) {
            const posted = await api(credentials, '/v1/feed/automation-blocked', { method: 'POST', body: {
                machineId, automationId: 'inbox-acceptance', runId,
            } });
            assert.equal(posted.ok, true, 'The real feed publication must succeed');
            const matches = (await feed(credentials)).filter(item => item.body.kind === 'automation_blocked'
                && item.body.machineId === machineId && item.body.automationId === 'inbox-acceptance' && item.body.runId === runId);
            assert.equal(matches.length, 1, 'Each automation episode must have exactly one persisted update');
            return { ...matches[0], runId };
        };
    }

    try {
        await stage('exact-production-artifact', async () => {
            const indexResponse = await fetch(`${origin}/`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
            recordEndpoint('artifact', 'GET', '/', indexResponse.status);
            assert.equal(indexResponse.status, 200, 'The production index must be served');
            const index = await indexResponse.text();
            receipt.indexSha256 = digest(index);
            const scripts = [...index.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(match => new URL(match[1], origin));
            assert(scripts.length > 0, 'The served production index must reference JavaScript');
            let verified = false;
            for (const url of scripts) {
                if (url.origin !== origin || !/\.js$/.test(url.pathname)) continue;
                const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
                recordEndpoint('artifact', 'GET', url.pathname, response.status);
                assert.equal(response.status, 200, 'The production entry bundle must be available');
                const source = await response.text();
                const decoded = source.replace(/\\u([0-9a-f]{4})/gi, (_, value) => String.fromCharCode(parseInt(value, 16)))
                    .replace(/\\x([0-9a-f]{2})/gi, (_, value) => String.fromCharCode(parseInt(value, 16)));
                if (decoded.includes(sha)) {
                    receipt.bundle = { path: url.pathname, sha256: digest(source), embeddedSourceRevision: sha };
                    verified = true;
                    break;
                }
            }
            assert(verified, 'The HTTP-served entry bundle must embed the requested source SHA');
        });

        let accountAId;
        await stage('desktop-normal-auth-and-empty-inbox', async () => {
            seedA = randomBytes(32).toString('base64url');
            contextA = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', colorScheme: 'light' });
            const restored = await restore(contextA, seedA, 'desktop-A');
            pageA = restored.page; credsA = restored.credentials; accountAId = restored.accountId;
            assert.equal((await feed(credsA)).length, 0, 'A new account must have an empty feed');
            await openInbox(pageA);
            assert.equal(await pageA.getByTestId('inbox-mark-all-read').getAttribute('aria-disabled'), 'true', 'Empty Inbox Done must be disabled');
            await expectUnread(pageA, []);
            await capture(pageA, 'desktop-empty-inbox');
        });

        let first, second, third, fourth;
        await stage('desktop-real-feed-publication', async () => {
            publishA = await makePublisher(credsA, seedA, 'A');
            first = await publishA(); second = await publishA();
            await expectCards(pageA, [first, second]);
            await expectUnread(pageA, [first.id, second.id]);
            const items = await feed(credsA);
            assert(items.length === 2 && items.every(item => item.readAt === null), 'Both published updates must persist unread');
            snapshot('initial-unread', 'A', items);
            await capture(pageA, 'desktop-two-unread');
        });

        await stage('mobile-normal-restore-same-account', async () => {
            contextM = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'en-US', colorScheme: 'light' });
            const restored = await restore(contextM, seedA, 'mobile-A', true);
            pageM = restored.page;
            assert(restored.accountId === accountAId, 'Normal mobile restore must authenticate the same account');
            await openInbox(pageM, true);
            await expectCards(pageM, [first, second]);
            await expectUnread(pageM, [first.id, second.id]);
            await capture(pageM, 'mobile-two-unread');
        });

        await stage('desktop-single-read-and-mobile-socket-update', async () => {
            const response = readResponse(pageA);
            await pageA.getByTestId(`feed-card-${first.id}`).click();
            await pageA.waitForURL(url => url.pathname === '/automations');
            assert.equal(new URL(pageA.url()).searchParams.get('machineId'), first.body.machineId, 'Single read must retain the exact machine destination');
            assert.equal(new URL(pageA.url()).searchParams.get('automationId'), first.body.automationId, 'Single read must retain the exact automation destination');
            assert.equal((await response).status(), 200, 'Single update acknowledgement must succeed');
            await expectUnread(pageM, [second.id]);
            assert(receipt.socketUpdates.some(update => update.source === 'mobile-A' && update.type === 'feed-read' && update.id === first.id), 'Mobile must receive the real single-item socket acknowledgement');
            const items = await feed(credsA);
            assert(items.find(item => item.id === first.id)?.readAt != null, 'Selected update must persist read');
            assert(items.find(item => item.id === second.id)?.readAt === null, 'Other update must remain unread');
            assert.equal(items.filter(item => item.readAt !== null).length, 1, 'Exactly one update must be read');
            await backToInbox(pageA);
            await expectUnread(pageA, [second.id]);
            snapshot('desktop-single-read', 'A', items);
        });

        await stage('desktop-done-clears-both-clients', async () => {
            await done(pageA);
            await Promise.all([expectUnread(pageA, []), expectUnread(pageM, [])]);
            const items = await feed(credsA);
            assert(items.every(item => item.readAt !== null), 'Done must persist every observed update as read');
            snapshot('desktop-done', 'A', items);
            await capture(pageA, 'desktop-done-cleared');
            await capture(pageM, 'mobile-socket-cleared');
        });

        await stage('mobile-single-tap-and-done-tap-update-desktop', async () => {
            third = await publishA(); fourth = await publishA();
            await Promise.all([expectUnread(pageA, [third.id, fourth.id]), expectUnread(pageM, [third.id, fourth.id])]);
            const response = readResponse(pageM);
            await pageM.getByTestId(`feed-card-${third.id}`).tap();
            await pageM.waitForURL(url => url.pathname === '/automations');
            assert.equal(new URL(pageM.url()).searchParams.get('machineId'), third.body.machineId, 'Mobile read must retain the exact machine destination');
            assert.equal(new URL(pageM.url()).searchParams.get('automationId'), third.body.automationId, 'Mobile read must retain the exact automation destination');
            assert.equal((await response).status(), 200, 'The mobile single-item request must succeed');
            await expectUnread(pageA, [fourth.id]);
            await backToInbox(pageM);
            await expectUnread(pageM, [fourth.id]);
            await done(pageM, true);
            await Promise.all([expectUnread(pageA, []), expectUnread(pageM, [])]);
            const items = await feed(credsA);
            assert(items.every(item => item.readAt !== null), 'Mobile Done must persist read timestamps');
            snapshot('mobile-done', 'A', items);
            await capture(pageM, 'mobile-done-cleared');
        });

        let allReadSnapshot;
        await stage('already-read-done-and-repeat-delivery-are-idempotent', async () => {
            const before = feedIdentity(await feed(credsA));
            await done(pageA);
            const repeated = await publishA(fourth.runId);
            assert.equal(repeated.id, fourth.id, 'Repeat delivery must preserve the update ID');
            assert.equal(repeated.cursor, fourth.cursor, 'Repeat delivery must preserve its cursor');
            const after = feedIdentity(await feed(credsA));
            assert.deepEqual(after, before, 'Repeated Done and delivery must preserve IDs, cursors, and original read timestamps');
            await Promise.all([expectUnread(pageA, []), expectUnread(pageM, [])]);
            allReadSnapshot = after;
            snapshot('idempotent-read-state', 'A', after);
        });

        await stage('desktop-and-mobile-reload-retain-read-state', async () => {
            await Promise.all([pageA.reload({ waitUntil: 'domcontentloaded' }), pageM.reload({ waitUntil: 'domcontentloaded' })]);
            await Promise.all([expectCards(pageA, [first, second, third, fourth]), expectCards(pageM, [first, second, third, fourth])]);
            await Promise.all([expectUnread(pageA, []), expectUnread(pageM, [])]);
            assert.deepEqual(feedIdentity(await feed(credsA)), allReadSnapshot, 'Reload must preserve server read timestamps');
        });

        await stage('offline-client-misses-receipt-and-reconciles-on-reconnect', async () => {
            const offlineItem = await publishA();
            await Promise.all([expectUnread(pageA, [offlineItem.id]), expectUnread(pageM, [offlineItem.id])]);
            const mobileSockets = socketStates.get(contextM);
            const mobilePageSockets = mobileSockets.pages.get(pageM);
            await until(() => mobilePageSockets.current?.ready, 'mobile authenticated socket before offline');
            const offlineConnection = mobilePageSockets.current;
            let reconnectResponses;
            await contextM.setOffline(true);
            try {
                await until(() => offlineConnection.closed && mobileSockets.open.size === 0, 'current mobile socket actually closed before Desktop Done');
                receipt.socketConnections.push({ source: 'mobile-A', event: 'offline-disconnect-proved-before-done', connection: offlineConnection.id, at: new Date().toISOString() });
                await done(pageA);
                await expectUnread(pageA, []);
                await expectUnread(pageM, [offlineItem.id]);
                assert((await feed(credsA)).find(item => item.id === offlineItem.id)?.readAt != null, 'Server must persist the read while mobile is offline');
                await capture(pageM, 'mobile-offline-unread');
            } finally {
                reconnectResponses = receipt.endpointStatuses.length;
                await contextM.setOffline(false);
            }
            await until(() => mobilePageSockets.current !== offlineConnection && mobilePageSockets.current?.ready,
                'new mobile socket authenticated after reconnect');
            await until(() => receipt.endpointStatuses.slice(reconnectResponses).some(response =>
                response.source === 'mobile-A' && response.method === 'GET' && response.path === '/v1/feed' && response.status === 200),
            'real feed reconciliation response after mobile reconnect', 20_000);
            await expectUnread(pageM, [], 20_000);
            snapshot('after-mobile-reconnect', 'A', await feed(credsA));
            await capture(pageM, 'mobile-reconnected-cleared');
        });

        let during;
        await stage('real-latency-done-snapshot-preserves-incoming-update', async () => {
            const before = await publishA();
            await Promise.all([expectUnread(pageA, [before.id]), expectUnread(pageM, [before.id])]);
            const cdp = await contextA.newCDPSession(pageA);
            await cdp.send('Network.enable');
            try {
                await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
                const request = pageA.waitForRequest(request => new URL(request.url()).origin === origin
                    && new URL(request.url()).pathname === '/v1/feed/read' && request.method() === 'POST');
                const response = readResponse(pageA);
                const clicking = pageA.getByTestId('inbox-mark-all-read').click();
                const sent = await request;
                const criteria = sent.postDataJSON();
                assert(criteria && typeof criteria.through === 'string', 'Done must send its observed cursor');
                assert.equal(criteria.through, before.cursor, 'Done must capture the pre-arrival snapshot');
                assert.equal(await pageA.getByTestId('inbox-mark-all-read').getAttribute('aria-disabled'), 'true', 'Done must stay disabled while the request is pending');
                during = await publishA();
                await clicking;
                assert.equal((await response).status(), 200, 'The delayed real acknowledgement must succeed');
                await until(async () => await pageA.getByTestId('inbox-mark-all-read').getAttribute('aria-disabled') !== 'true', 'Delayed Done complete', 30_000);
                const items = await feed(credsA);
                assert(items.find(item => item.id === before.id)?.readAt != null, 'The pre-click update must become read');
                assert(items.find(item => item.id === during.id)?.readAt === null, 'The during-request update must stay unread');
                assert(Number(during.cursor.slice(2)) > Number(criteria.through.slice(2)), 'The incoming update must be beyond the observed cursor');
                snapshot('during-done-arrival', 'A', items);
            } finally {
                await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
                await cdp.detach();
            }
            await Promise.all([expectUnread(pageA, [during.id]), expectUnread(pageM, [during.id])]);
            await capture(pageA, 'desktop-new-arrival-unread');
            await capture(pageM, 'mobile-new-arrival-unread');
        });

        let credsB, protectedItem;
        await stage('separate-account-isolation-through-real-ui-and-api', async () => {
            const seedB = randomBytes(32).toString('base64url');
            contextB = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', colorScheme: 'light' });
            const restored = await restore(contextB, seedB, 'desktop-B');
            pageB = restored.page; credsB = restored.credentials;
            assert(restored.accountId !== accountAId, 'Account B must be independent');
            assert.equal((await feed(credsB)).length, 0, 'Account B must not receive account A updates');
            await openInbox(pageB);
            const publishB = await makePublisher(credsB, seedB, 'B');
            const own = await publishB();
            await expectUnread(pageB, [own.id]);
            await done(pageA);
            await Promise.all([expectUnread(pageA, []), expectUnread(pageM, []), expectUnread(pageB, [own.id])]);
            assert((await feed(credsB)).find(item => item.id === own.id)?.readAt === null, 'Account A Done must not change account B');

            protectedItem = await publishA();
            await Promise.all([expectUnread(pageA, [protectedItem.id]), expectUnread(pageM, [protectedItem.id])]);
            const beforeB = feedIdentity(await feed(credsB));
            await api(credsB, '/v1/feed/read', { method: 'POST', body: { id: protectedItem.id } });
            assert.deepEqual(feedIdentity(await feed(credsB)), beforeB, 'A foreign-item request must not alter account B');
            assert((await feed(credsA)).find(item => item.id === protectedItem.id)?.readAt === null, 'Account B cannot read an account A update by ID');
            await done(pageB);
            await Promise.all([expectUnread(pageB, []), expectUnread(pageA, [protectedItem.id]), expectUnread(pageM, [protectedItem.id])]);
            assert((await feed(credsA)).find(item => item.id === protectedItem.id)?.readAt === null, 'Account B Done must not read account A updates');
            snapshot('account-isolation', 'A', await feed(credsA));
            snapshot('account-isolation', 'B', await feed(credsB));
            await capture(pageB, 'account-b-done-cleared');
        });

        await stage('isolated-server-restart-retains-auth-and-disk-state', async () => {
            const beforeA = feedIdentity(await feed(credsA));
            const beforeB = feedIdentity(await feed(credsB));
            const readPid = async name => Number((await readFile(resolve(runnerDirectory, name), 'utf8')).trim());
            assert.equal(await readPid('server-runner.pid'), runnerPid, 'Only the designated isolated runner may be restarted');
            const oldServerPid = await readPid('server.pid');
            assert(Number.isInteger(oldServerPid) && oldServerPid > 1, 'The isolated server PID must exist');
            process.kill(runnerPid, 'SIGUSR2');
            await until(async () => {
                const current = await readPid('server.pid');
                return Number.isInteger(current) && current > 1 && current !== oldServerPid;
            }, 'isolated child server restarted', 30_000);
            await until(async () => {
                try {
                    const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2000) });
                    recordEndpoint('restart-health', 'GET', '/health', health.status);
                    return health.status === 200;
                } catch { return false; }
            }, 'restarted server healthy', 30_000);
            assert.deepEqual(feedIdentity(await feed(credsA)), beforeA, 'Existing account A token and all stored read timestamps must survive restart');
            assert.deepEqual(feedIdentity(await feed(credsB)), beforeB, 'Existing account B token and read timestamps must survive restart');
            await Promise.all([pageA.reload({ waitUntil: 'domcontentloaded' }), pageM.reload({ waitUntil: 'domcontentloaded' })]);
            await Promise.all([expectCards(pageA, [protectedItem]), expectCards(pageM, [protectedItem])]);
            await Promise.all([expectUnread(pageA, [protectedItem.id]), expectUnread(pageM, [protectedItem.id])]);
            snapshot('after-server-restart', 'A', await feed(credsA));
            snapshot('after-server-restart', 'B', await feed(credsB));
            await capture(pageA, 'desktop-after-server-restart');
            await capture(pageM, 'mobile-after-server-restart');
        });

        receipt.status = 'PASS';
        receipt.completedAt = new Date().toISOString();
        await save();
        // Caller retains these live contexts and secret values for native proof.
        // Never JSON.stringify, inspect, log, or write this entire return value.
        return { pageA, pageM, pageB, contextA, contextM, contextB, seedA, credsA, publishA, api, checks, receipt };
    } catch (error) {
        receipt.status = 'FAIL';
        receipt.completedAt = new Date().toISOString();
        receipt.failure = { stage: activeStage, type: error instanceof Error ? error.name : 'UnknownError' };
        if (error instanceof AcceptanceTimeoutError) receipt.failure.condition = error.condition;
        checks.push({ name: activeStage, status: 'FAIL', completedAt: receipt.completedAt });
        await save();
        // Playwright's input failure logs can contain filled secrets. Do not
        // propagate its message, cause, trace, input values or response bodies.
        throw new Error(`Inbox acceptance failed at ${activeStage}; sanitized receipt: ${receiptPath}`);
    }
}
