// Run with a separately installed Playwright; no app dependency changes required.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf' };
const server = createServer(async (req, res) => {
    const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try { res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream'); res.end(await readFile(path)); }
    catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}/docs/mocks/commander-first/index.html`;
const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
let browser;
const engineName = process.env.BROWSER === 'webkit' ? 'webkit' : 'chromium';
try {
    browser = await engine.launch({ headless: true });
    for (const [surface, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
        const context = await browser.newContext({ viewport: { width, height }, hasTouch: surface === 'mobile', isMobile: surface === 'mobile' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const click = async (locator) => surface === 'mobile' ? locator.tap() : locator.click();
        const byId = (id) => page.locator(`#${id}`);
        const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('happyherd-issue-300-mock-v1')));
        const count = async (n) => assert.equal((await state()).sessions.length, n);
        const library = async () => { if (surface === 'mobile' && await byId('back').isVisible()) await click(byId('back')); };
        const choose = async (id) => { await library(); await click(page.locator(`[data-select="${id}"]`)); };
        const screenshot = async (name) => {
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal page overflow');
            await page.screenshot({ path: resolve(here, `evidence/${engineName}-${surface}-${name}.png`) });
        };
        const mode = async (enabled) => {
            await click(byId('settings'));
            if (await byId('simplified').isChecked() !== enabled) await click(byId('simplified'));
            await click(page.getByRole('button', { name: 'Close settings' }));
        };
        const scenario = async (value) => {
            if (!await byId('scenario').isVisible()) await click(page.locator('#lab summary'));
            await byId('scenario').selectOption(value);
            await click(page.locator('#lab summary'));
        };
        const send = async () => { await click(byId('send')); await page.waitForFunction(() => !document.getElementById('send').disabled); };
        await page.goto(base);
        assert.equal(await byId('mode-label').textContent(), 'Standard view');
        await mode(true);
        await click(byId('settings'));
        await screenshot('settings');
        await click(page.getByRole('button', { name: 'Close settings' }));
        await page.reload();
        assert.match(await byId('mode-label').textContent(), /Simplified/);
        await byId('search').fill('zzzz');
        assert.match(await byId('bots').textContent(), /No matching/);
        await byId('search').fill('sage');
        assert.equal(await page.locator('#bots button').count(), 1);
        await byId('search').fill('');
        await screenshot('bots');
        await choose('sage');
        await count(1);
        await byId('draft').fill('Keep this draft across modes.');
        await byId('files').setInputFiles([
            { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Prototype-only attachment') },
            { name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') },
        ]);
        await page.waitForFunction(() => document.querySelectorAll('#attachments .attachment').length === 2);
        await mode(false);
        assert.equal(await byId('standard').isVisible(), true);
        await screenshot('standard-draft');
        await page.reload();
        assert.equal(await byId('draft').inputValue(), 'Keep this draft across modes.');
        assert.equal(await page.locator('#attachments .attachment').count(), 2);
        await mode(true);
        assert.equal(await byId('standard').isVisible(), false);
        await count(1);
        await click(page.getByRole('button', { name: 'Remove notes.txt', exact: true }));
        await choose('atlas');
        assert.equal(await byId('draft').inputValue(), '');
        await choose('sage');
        assert.equal(await byId('draft').inputValue(), 'Keep this draft across modes.');
        await scenario('missing');
        await send();
        await count(1);
        assert.match(await byId('error').textContent(), /defaults are missing/);
        await screenshot('failure');
        await page.reload();
        assert.equal(await byId('draft').inputValue(), 'Keep this draft across modes.');
        await send();
        await click(byId('open-defaults'));
        await click(byId('repair'));
        await click(page.getByRole('button', { name: 'Close settings' }));
        await click(byId('retry'));
        await page.waitForFunction(() => !document.getElementById('send').disabled);
        await count(2);
        const first = (await state()).sessions[0];
        assert.equal(first.bot, 'sage');
        assert.deepEqual(first.defaults, { machine: 'studio-mac', provider: 'codex', model: 'gpt-5', path: '/workspace/demo', account: 'saved-default' });
        assert.equal(first.messages[0].files[0].name, 'pixel.png');
        assert.match(await byId('messages').textContent(), /Simulated reply/);
        await screenshot('chat');
        await byId('draft').fill('Continue this exact session.');
        await choose('existing-1');
        assert.match(await byId('messages').textContent(), /release goals/);
        await choose(first.id);
        assert.equal(await byId('draft').inputValue(), 'Continue this exact session.');
        await send();
        await count(2);
        assert.equal((await state()).sessions[0].messages.length, 4);
        await library();
        await click(byId('create'));
        await byId('name').fill('Cancelled bot');
        await click(byId('cancel-create'));
        assert.equal((await state()).bots.length, 2);
        await click(byId('create'));
        await byId('name').fill('Release buddy');
        await byId('purpose').fill('Review the release checklist');
        await screenshot('create');
        await click(page.locator('#create-form button.primary'));
        await count(2);
        assert.equal(await byId('chat-title').textContent(), 'Release buddy');
        const createdBot = (await state()).selected;
        await page.reload();
        assert.equal((await state()).bots.length, 3);
        await byId('draft').fill('One request, one session.');
        await scenario('offline');
        await send();
        await count(2);
        assert.match(await byId('error').textContent(), /studio-mac is unavailable/);
        await scenario('failure');
        await click(byId('retry'));
        await page.waitForFunction(() => !document.getElementById('send').disabled);
        await count(2);
        assert.match(await byId('error').textContent(), /failed temporarily/);
        const request = (await state()).drafts[createdBot].request;
        await scenario('lost');
        await click(byId('retry'));
        await page.waitForFunction(() => !document.getElementById('send').disabled);
        await count(3);
        assert.match(await byId('error').textContent(), /response was lost/);
        await screenshot('lost-response');
        await page.reload();
        assert.equal(await byId('draft').inputValue(), 'One request, one session.');
        // Real Send gesture followed by rapid repeated submit events during pending.
        await click(byId('send'));
        await page.locator('#composer').evaluate((form) => { form.requestSubmit(); form.requestSubmit(); });
        await page.waitForFunction(() => !document.getElementById('send').disabled);
        await count(3);
        const retried = (await state()).sessions[0];
        assert.equal(retried.request, request);
        assert.equal(retried.bot, createdBot);
        assert.equal(retried.messages.length, 2);
        assert.equal((await state()).receipt.requestId, request);
        await byId('draft').fill('Unsent final draft');
        await mode(false);
        await mode(true);
        await page.reload();
        assert.equal((await state()).selected, retried.id);
        assert.equal(await byId('draft').inputValue(), 'Unsent final draft');
        if (surface === 'mobile') {
            assert.equal(await byId('draft').evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 16), true);
            await page.setViewportSize({ width: 390, height: 560 });
            await byId('draft').focus();
            const box = await byId('send').boundingBox();
            assert.ok(box.y + box.height <= 560, 'send remains reachable with reduced viewport');
        }
        assert.deepEqual(errors, []);
        console.log(`PASS ${engineName} ${surface} ${width}x${height}: mode/reload, search, creation/cancel, draft/attachment retention, first-send defaults, recents, missing/offline/transient/lost-response retry, duplicate-submit, layout; zero page errors`);
        await context.close();
    }
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
