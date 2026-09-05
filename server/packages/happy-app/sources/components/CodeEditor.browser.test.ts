import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));

describe('CodeEditor Web typography', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            entryPoints: [resolve(here, '__testdata__/CodeEditor.browser.fixture.tsx')],
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
            jsx: 'automatic',
        });
        const script = bundle.outputFiles[0].text;
        server = createServer((_request, response) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}</style></head><body><div id="root"></div><script>${script}</script></body></html>`);
        });
        await new Promise<void>((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('CodeEditor fixture did not bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({
            ...(executablePath ? { executablePath } : { channel: 'chrome' }),
            headless: true,
            args: process.platform === 'linux' ? ['--no-sandbox'] : [],
        });
    }, 30_000);

    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
    }, 30_000);

    it.each([
        ['desktop', 'light', { width: 1440, height: 900 }],
        ['desktop', 'dark', { width: 1440, height: 900 }],
        ['mobile', 'light', { width: 390, height: 844 }],
        ['mobile', 'dark', { width: 390, height: 844 }],
    ] as const)('keeps 16px input and highlighting aligned while typing on %s in %s', async (surface, theme, viewport) => {
        const page = await browser.newPage({ viewport, hasTouch: surface === 'mobile', isMobile: surface === 'mobile' });
        page.setDefaultTimeout(3_000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
        try {
            await page.goto(`${origin}?theme=${theme}`, { timeout: 15_000 });
            const input = page.locator('textarea.code-editor-textarea');
            const overlay = page.locator('pre[aria-hidden="true"]');
            await input.evaluate((element) => {
                element.dataset.editorIdentity = 'original';
                element.addEventListener('focus', () => {
                    element.dataset.fontAtFocus = getComputedStyle(element).fontSize;
                }, { once: true });
            });
            if (surface === 'mobile') await input.tap();
            else await input.click();
            await expect(input.getAttribute('data-font-at-focus')).resolves.toBe('16px');
            await input.press('ControlOrMeta+A');
            await input.pressSequentially('const count: number = 2;');
            await input.press('Enter');
            await input.pressSequentially('console.log(count);');
            const expected = 'const count: number = 2;\nconsole.log(count);';
            await expect(input.inputValue()).resolves.toBe(expected);
            await expect(page.getByTestId('edited-value').textContent()).resolves.toBe(expected);
            await expect(overlay.textContent()).resolves.toBe(expected);
            await expect(overlay.locator('.token.keyword').count()).resolves.toBeGreaterThan(0);
            await expect(input.getAttribute('data-editor-identity')).resolves.toBe('original');
            await expect(input.evaluate((element) => document.activeElement === element)).resolves.toBe(true);

            const metrics = await input.evaluate((element) => {
                const highlight = element.parentElement!.querySelector('pre')!;
                const measure = (node: Element) => {
                    const style = getComputedStyle(node);
                    const box = node.getBoundingClientRect();
                    return {
                        fontSize: style.fontSize, lineHeight: style.lineHeight, fontFamily: style.fontFamily,
                        letterSpacing: style.letterSpacing, whiteSpace: style.whiteSpace,
                        paddingTop: style.paddingTop, paddingLeft: style.paddingLeft,
                        x: box.x, y: box.y, width: box.width,
                    };
                };
                return { input: measure(element), highlight: measure(highlight) };
            });
            expect(metrics.input).toEqual(metrics.highlight);
            expect(metrics.input).toMatchObject({ fontSize: '16px', lineHeight: '24px' });
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    }, 20_000);
});
