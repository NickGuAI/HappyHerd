import { createReadStream } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

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
    ['.webp', 'image/webp'],
    ['.ttf', 'font/ttf'],
    ['.woff2', 'font/woff2'],
]);

let origin = '';
const server = createServer(async (request, response) => {
    try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
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
            const config = `<script>window.__HAPPY_CONFIG__ = ${JSON.stringify({ serverUrl: origin, disableAnalytics: true })};</script>`;
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
    const evidence = process.argv[3];
    if (!evidence) throw new Error('Pass an evidence directory as the second argument');
    await mkdir(evidence, { recursive: true });
    const records = [];
    for (const locale of ['en-US', 'zh-CN', 'de-DE']) {
        for (const colorScheme of ['light', 'dark']) {
            for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 800 }]) {
                const context = await browser.newContext({ viewport, locale, colorScheme, hasTouch: viewport.width < 500, isMobile: viewport.width < 500 });
                const page = await context.newPage();
                const errors = [];
                page.on('pageerror', (e) => errors.push(e.message));
                await page.goto(origin, { waitUntil: 'networkidle', timeout: 30000 });
                await page.waitForSelector('#root > *');
                await page.evaluate(() => document.fonts.ready);
                const name = `${locale}-${colorScheme}-${viewport.width}`;
                const art = page.getByTestId('kilv-landing-art');
                await art.waitFor({ state: 'visible' });
                await art.locator('img').evaluateAll(async images => {
                    await Promise.all(images.map(img => img.decode()));
                });
                const artwork = await art.evaluate(element => {
                    const rect = element.getBoundingClientRect();
                    const images = [...element.querySelectorAll('img')];
                    return { width: rect.width, height: rect.height, loaded: images.some(img => img.complete && img.naturalWidth > 0) };
                });
                if (!artwork.loaded || artwork.width < 100 || artwork.height < 100) throw new Error(`Invisible or unloaded artwork ${name}: ${JSON.stringify(artwork)}`);
                await page.screenshot({ path: resolve(evidence, `${name}-landing.png`), fullPage: true });
                const snapshot = await page.locator('body').innerText();
                const geometry = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, inputs: [...document.querySelectorAll('input,textarea,select,[contenteditable="true"]')].map(e => ({fontSize:getComputedStyle(e).fontSize})), fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family) }));
                const localeCode = locale === 'zh-CN' ? 'cn' : locale.slice(0,2);
                const catalog = JSON.parse(await readFile(fileURLToPath(new URL(`../sources/text/locales/${localeCode}.json`, import.meta.url)), 'utf8'));
                await page.getByText(catalog.navigation.restoreWithSecretKey, {exact:true}).click();
                const input = page.locator('textarea,input').first();
                await input.waitFor();
                await input.fill('visual-test-draft');
                await input.focus();
                const fieldSize = await input.evaluate(e => parseFloat(getComputedStyle(e).fontSize));
                if (viewport.width < 500 && fieldSize < 16) throw new Error(`small mobile input ${name}: ${fieldSize}`);
                await page.setViewportSize({ width: viewport.width < 500 ? 390 : 1200, height: viewport.height });
                if (await input.inputValue() !== 'visual-test-draft') throw new Error('Restore draft lost on resize');
                await page.setViewportSize(viewport);
                await page.screenshot({ path: resolve(evidence, `${name}-restore.png`), fullPage: true });
                records.push({ name, errors, snapshot, geometry, artwork, restore: { visibleEntry:true, focused:true, fieldSize, draftRetained:true } });
                console.log(name, JSON.stringify({ errors, geometry }));
                await context.close();
            }
        }
    }
    await writeFile(resolve(evidence, 'results.json'), JSON.stringify(records, null, 2));
    if (records.some(r => r.errors.length || r.geometry.scroll > r.geometry.viewport)) throw new Error('Production UI errors or horizontal overflow; inspect results.json');

} finally {
    await browser?.close();
    await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
}
