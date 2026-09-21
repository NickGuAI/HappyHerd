import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Two neutral pages with different orientations and colored corner markers.
function neutralPdf() {
    const stream = '1 1 1 rg 0 0 600 1200 re f\n1 0 0 rg 0 1150 50 50 re f\n0 1 0 rg 550 1150 50 50 re f\n0 0 1 rg 0 0 50 50 re f\n1 0 1 rg 550 0 50 50 re f\n';
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 1200] /Resources << >> /Contents 5 0 R >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 1200] /Rotate 90 /Resources << >> /Contents 5 0 R >>',
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    ];
    let result = '%PDF-1.7\n';
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(Buffer.byteLength(result));
        result += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(result);
    result += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(result);
}

let browser: Browser;
let server: Server;
let origin: string;

beforeAll(async () => {
    const virtual: Record<string, string> = {
        'react-native-unistyles': `export const useUnistyles = () => ({ theme: { colors: { text:'#111', surface:'#fff', divider:'#ddd', groupped:{ background:'#eee' } } } });`,
        '@expo/vector-icons': `import React from 'react';
            import glyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json';
            import font from '@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf';
            export const Ionicons = ({name,size,color}) => React.createElement(React.Fragment, null,
                React.createElement('style', null, '@font-face{font-family:PdfTestIonicons;src:url(' + font + ') format("truetype")}'),
                React.createElement('span', {'data-icon':name, style:{display:'inline-block',fontFamily:'PdfTestIonicons',fontSize:size,lineHeight:1,color}}, String.fromCodePoint(glyphs[name])));`,
        '@/utils/platform': `export const isRunningOnMac = () => false;`,
        '@/text': `import en from './sources/text/locales/en.json'; export const t = (key, params={}) => Object.entries(params).reduce((text,[name,value]) => text.replaceAll('{'+name+'}', String(value)), key.split('.').reduce((value, part) => value[part], en));`,
    };
    const bundle = await build({
        stdin: {
            contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {FileDocumentPreview} from './sources/components/FileDocumentPreview.web';
                const root = createRoot(document.getElementById('preview'));
                window.showPdf = (uri) => root.render(<FileDocumentPreview kind="pdf" uri={uri} title="Neutral PDF" fileName="neutral.pdf" />);
                window.showHtml = () => root.render(<FileDocumentPreview kind="html" html="<p>Neutral HTML</p>" title="Neutral HTML" />);
                window.showPdf('data:application/pdf;base64,${neutralPdf().toString('base64')}');`,
            resolveDir: appRoot, loader: 'tsx',
        },
        bundle: true, write: false, platform: 'browser', format: 'iife',
        loader: { '.ttf': 'dataurl' },
        alias: { '@': resolve(appRoot, 'sources'), 'react-native': 'react-native-web' },
        plugins: [{ name: 'runtime-boundaries', setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => virtual[args.path] ? { path: args.path, namespace: 'boundary' } : undefined);
            build.onLoad({ filter: /.*/, namespace: 'boundary' }, (args) => ({ contents: virtual[args.path], loader: 'js', resolveDir: appRoot }));
        } }],
    });
    server = createServer((request, response) => {
        if (request.url?.startsWith('/pdfjs/')) {
            try {
                const pathname = new URL(request.url, 'http://localhost').pathname;
                const asset = readFileSync(resolve(appRoot, 'public', `.${pathname}`));
                response.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
                response.end(asset);
            } catch { response.statusCode = 404; response.end(); }
        } else if (request.url === '/app.js') {
            response.setHeader('Content-Type', 'text/javascript');
            response.end(bundle.outputFiles[0].contents);
        } else {
            response.setHeader('Content-Type', 'text/html');
            response.end('<meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;font:16px sans-serif}body{display:flex;flex-direction:column}header{height:56px;flex:none}footer{height:70px;flex:none}#preview{flex:1;min-height:0;display:flex}</style><header>PDF</header><main id="preview"></main><footer>Feedback controls</footer><script src="/app.js"></script>');
        }
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test address');
    origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
}, 30_000);

afterAll(async () => {
    await browser?.close();
    await new Promise<void>((done) => server?.close(() => done()));
});

async function bounds(page: Page) {
    return page.locator('canvas').evaluate((canvas) => {
        const area = document.querySelector('[data-testid="pdf-reading-area"]')!.getBoundingClientRect();
        const page = canvas.getBoundingClientRect();
        return { area: { x: area.x, y: area.y, width: area.width, height: area.height }, page: { x: page.x, y: page.y, width: page.width, height: page.height } };
    });
}

async function assertFit(page: Page, ratio = 0.5) {
    await page.locator('canvas').waitFor({ state: 'visible' });
    await expect.poll(async () => {
        const result = await bounds(page);
        return Math.abs(result.page.width / result.page.height - ratio) < 0.001
            && result.page.width <= result.area.width + 1 && result.page.height <= result.area.height + 1;
    }).toBe(true);
    const result = await bounds(page);
    expect(result.page.width).toBeLessThanOrEqual(result.area.width + 1);
    expect(result.page.height).toBeLessThanOrEqual(result.area.height + 1);
    expect(result.page.x).toBeGreaterThanOrEqual(result.area.x - 1);
    expect(result.page.y).toBeGreaterThanOrEqual(result.area.y - 1);
    expect(result.page.x + result.page.width).toBeLessThanOrEqual(result.area.x + result.area.width + 1);
    expect(result.page.y + result.page.height).toBeLessThanOrEqual(result.area.y + result.area.height + 1);
}

describe('mobile PDF production renderer', () => {
    it.each([{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }])('fits a complete first page at $width × $height after controls', async (viewport) => {
        const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
        const page = await context.newPage();
        await page.goto(origin);
        await assertFit(page);
        expect(await page.locator('[aria-live="polite"]').textContent()).toBe('Page 1 of 2');
        if (process.env.HAPPYHERD_PDF_EVIDENCE_DIR) {
            await page.screenshot({ path: resolve(process.env.HAPPYHERD_PDF_EVIDENCE_DIR, `pdf-${viewport.width}x${viewport.height}.png`) });
        }
        const pixels = await page.locator('canvas').evaluate((element) => {
            const canvas = element as HTMLCanvasElement;
            const context = canvas.getContext('2d')!;
            return [[5, 5], [canvas.width - 5, 5], [5, canvas.height - 5], [canvas.width - 5, canvas.height - 5]].map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data));
        });
        expect(pixels).toEqual([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 0, 255, 255]]);
        expect(page.workers().some((worker) => worker.url().endsWith('/pdf.worker.min.js'))).toBe(true);
        const download = page.waitForEvent('download');
        await page.getByRole('link', { name: 'Download', exact: true }).click();
        expect((await download).suggestedFilename()).toBe('neutral.pdf');
        await page.getByRole('button', { name: 'Next page', exact: true }).click();
        await assertFit(page, 2);
        await page.getByRole('button', { name: 'Previous page', exact: true }).click();
        await assertFit(page);
        await context.close();
    }, 20_000);

    it('supports touch pinch/pan, zoom controls, fit reset and orientation changes', async () => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const page = await context.newPage();
        await page.goto(origin);
        await assertFit(page);
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 170, y: 360, id: 1 }, { x: 220, y: 410, id: 2 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y: 290, id: 1 }, { x: 290, y: 480, id: 2 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(() => page.locator('canvas').getAttribute('data-zoom')).not.toBe('1');
        const beforePan = await bounds(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 400, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150, y: 300, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(async () => (await bounds(page)).page.y).toBeLessThan(beforePan.page.y - 50);
        await page.getByRole('button', { name: 'Fit to page', exact: true }).click();
        await assertFit(page);
        await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
        expect(await page.locator('canvas').getAttribute('data-zoom')).toBe('1.5');
        await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
        await assertFit(page);
        await page.setViewportSize({ width: 844, height: 390 });
        await assertFit(page);
        await context.close();
    }, 20_000);

    it('shows an honest PDF error and keeps download/retry available', async () => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const page = await context.newPage();
        await page.goto(origin);
        await page.evaluate(() => (window as any).showPdf('data:application/pdf;base64,AAAA'));
        await page.getByRole('alert').waitFor({ timeout: 2000 });
        expect(await page.getByRole('alert').textContent()).toContain('Failed to load PDF');
        await page.getByRole('button', { name: 'Retry', exact: true }).tap();
        await page.getByRole('alert').waitFor();
        expect(await page.getByRole('link', { name: 'Download', exact: true }).count()).toBe(1);
        await page.evaluate(() => (window as any).showHtml());
        expect(await page.locator('iframe').getAttribute('sandbox')).toBe('');
        await context.close();
    });

    it('recovers on touch Retry after the PDF module fails to download', async () => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const page = await context.newPage();
        let requests = 0;
        await page.route('**/pdfjs/*/pdf.min.js*', async (route) => {
            requests += 1;
            if (requests === 1) await route.fulfill({ status: 503, body: '' });
            else await route.continue();
        });
        await page.goto(origin);
        await page.getByRole('alert').waitFor();
        expect(requests).toBe(1);
        await page.getByRole('button', { name: 'Retry', exact: true }).tap();
        await assertFit(page);
        expect(requests).toBe(2);
        await context.close();
    });

    it('recovers on touch Retry after the PDF worker is temporarily unavailable', async () => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const page = await context.newPage();
        let unavailable = true;
        await context.route('**/pdfjs/*/pdf.worker.min.js*', async (route) => {
            if (unavailable) await route.fulfill({ status: 503, body: '' });
            else await route.continue();
        });
        await page.goto(origin);
        await page.getByRole('alert').waitFor();
        unavailable = false;
        await page.getByRole('button', { name: 'Retry', exact: true }).tap();
        await page.locator('canvas').waitFor({ state: 'visible', timeout: 2000 });
        await assertFit(page);
        await context.close();
    });

    it('retains the native desktop PDF browser viewer', async () => {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await context.newPage();
        await page.goto(origin);
        await page.locator('iframe').waitFor();
        expect(await page.locator('iframe').getAttribute('src')).toContain('data:application/pdf;base64,');
        expect(await page.locator('iframe').getAttribute('sandbox')).toBe(null);
        expect(await page.locator('[data-testid="mobile-pdf-preview"]').count()).toBe(0);
        await context.close();
    });
});
