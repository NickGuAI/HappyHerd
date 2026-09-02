import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));

function recordPageErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });
    return errors;
}

describe('MobileTypographyFloor browser behavior', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            entryPoints: [resolve(here, '__testdata__/MobileTypographyFloor.browser.fixture.tsx')],
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
            jsx: 'automatic',
        });
        const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? bundle.outputFiles[0].text;
        server = createServer((_request, response) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<main id="root"></main><script>${script}</script>`);
        });
        await new Promise<void>((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Typography fixture did not bind');
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
        ['portrait phone', { width: 390, height: 844 }],
        ['landscape phone', { width: 844, height: 390 }],
    ])('preserves hierarchy and floors initial and streamed text on %s', async (_label, viewport) => {
        const page = await browser.newPage({ viewport });
        const errors = recordPageErrors(page);
        await page.goto(`${origin}/?phone=1`);

        await expect(page.locator('[data-testid="small"]').evaluate((element) => getComputedStyle(element).fontSize)).resolves.toBe('16px');
        await expect(page.locator('[data-testid="heading"]').evaluate((element) => getComputedStyle(element).fontSize)).resolves.toBe('24px');
        await expect(page.locator('[data-testid="orientation-responsive"]').evaluate((element) => getComputedStyle(element).fontSize)).resolves.toBe(
            viewport.width < viewport.height ? '18px' : '16px',
        );
        await expect(page.locator('[data-testid="icon"]').evaluate((element) => getComputedStyle(element).fontSize)).resolves.toBe('12px');
        for (const testId of ['input', 'textarea', 'select', 'editable']) {
            const control = page.locator(`[data-testid="${testId}"]`);
            await expect(control.evaluate((element) => getComputedStyle(element).fontSize)).resolves.toBe('16px');
            await control.focus();
            await expect(control.evaluate((element) => document.activeElement === element)).resolves.toBe(true);
        }
        await expect(page.locator('[data-testid="textarea"]').evaluate((element) => getComputedStyle(element, '::placeholder').fontSize)).resolves.toBe('16px');
        await expect(page.locator('[data-testid="portal-text"]').evaluate((element) => getComputedStyle(element).fontSize)).resolves.toBe('16px');

        await page.locator('[data-testid="add-dynamic"]').click();
        await expect.poll(() => page.locator('[data-testid="dynamic"]').evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px');
        await page.locator('[data-testid="reveal"]').click();
        await expect.poll(() => page.locator('[data-testid="revealed-text"]').evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px');
        await page.locator('[data-testid="replace-class"]').click();
        await expect.poll(() => page.locator('[data-testid="small"]').evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px');
        await expect(page.locator('[data-testid="small"]').evaluate((element) => ({
            className: element.className,
            marker: element.getAttribute('data-hh-mobile-typography-floor'),
        }))).resolves.toEqual({
            className: 'react-replaced hh-mobile-typography-floor',
            marker: 'true',
        });
        const undersizedEntries = await page.locator('input,textarea,select,[contenteditable]').evaluateAll((elements) => (
            elements.filter((element) => Number.parseFloat(getComputedStyle(element).fontSize) < 16).length
        ));
        expect(undersizedEntries).toBe(0);

        await page.locator('[data-testid="make-large"]').click();
        await expect.poll(() => page.locator('[data-testid="small"]').evaluate((element) => getComputedStyle(element).fontSize)).toBe('20px');
        await page.setViewportSize({ width: viewport.height, height: viewport.width });
        await expect.poll(() => page.locator('[data-testid="orientation-responsive"]').evaluate((element) => getComputedStyle(element).fontSize)).toBe(
            viewport.width < viewport.height ? '16px' : '18px',
        );
        expect(errors).toEqual([]);
        await page.close();
    }, 20_000);

    it('leaves desktop text unchanged and clears the floor when deactivated', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(`${origin}/?phone=0`);
        await expect(page.locator('[data-testid="small"]').evaluate((element) => getComputedStyle(element).fontSize)).resolves.toBe('12px');
        await page.locator('[data-testid="toggle-active"]').click();
        await expect(page.locator('[data-testid="small"]').evaluate((element) => getComputedStyle(element).fontSize)).resolves.toBe('16px');
        await page.locator('[data-testid="toggle-active"]').click();
        await expect(page.locator('[data-testid="small"]').evaluate((element) => getComputedStyle(element).fontSize)).resolves.toBe('12px');
        await page.close();
    }, 20_000);
});
