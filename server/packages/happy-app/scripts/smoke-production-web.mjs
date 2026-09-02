import { createReadStream } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';

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
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(origin, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(500);
    if (pageErrors.length > 0) throw new Error(`Production Web page error: ${pageErrors.join(' | ')}`);
    await page.waitForSelector('#root > *', { timeout: 15_000 });
    if (pageErrors.length > 0) throw new Error(`Production Web page error: ${pageErrors.join(' | ')}`);
    console.log(`Production Web smoke passed: React mounted at ${origin}`);
} finally {
    await browser?.close();
    await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
}
