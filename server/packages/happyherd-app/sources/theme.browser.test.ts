import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const faces = ['SpaceGrotesk-Regular', 'SpaceGrotesk-Medium', 'SpaceGrotesk-SemiBold', 'JetBrainsMono-Regular', 'JetBrainsMono-SemiBold'];

describe('KILV runtime foundations in the browser', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            stdin: {
                contents: `
                    import { StyleSheet, UnistylesRuntime, UnistylesShadowRegistry } from 'react-native-unistyles';
                    import { lightTheme, darkTheme } from './theme';
                    StyleSheet.configure({ themes: { light: lightTheme, dark: darkTheme }, settings: { adaptiveThemes: true, CSSVars: true } });
                    const styles = StyleSheet.create((theme) => ({ pane: { backgroundColor: theme.colors.surface } }));
                    const pane = UnistylesShadowRegistry.addStyles([styles.pane]);
                    document.querySelector('main').classList.add(pane.hash);
                    document.querySelectorAll('[data-theme-choice]').forEach((button) => {
                        button.addEventListener('click', () => {
                            UnistylesRuntime.setAdaptiveThemes(false);
                            UnistylesRuntime.setTheme(button.dataset.themeChoice);
                        });
                    });
                `,
                resolveDir: here,
            },
            bundle: true,
            write: false,
            platform: 'browser',
            format: 'iife',
            alias: {
                'react-native': 'react-native-web',
                'react-native-unistyles': resolve(here, '../../../node_modules/react-native-unistyles/src/web/index.ts'),
            },
        });
        const fonts = faces.map((face) => `@font-face {font-family:'${face}';src:url('/${face}.ttf') format('truetype');}`).join('\n');
        const css = readFileSync(resolve(here, 'theme.css'), 'utf8');
        server = createServer((request, response) => {
            const font = faces.find((face) => request.url === `/${face}.ttf`);
            if (font) {
                response.setHeader('content-type', 'font/ttf');
                response.end(readFileSync(resolve(here, 'assets/fonts', `${font}.ttf`)));
                return;
            }
            response.setHeader('content-type', 'text/html');
            response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${fonts}\n${css}</style></head><body>
                <main>Pane</main><button data-theme-choice="light">Light</button><button data-theme-choice="dark">Dark</button>
                <input style="font-size:13px" placeholder="Type"><textarea style="font-size:13px" placeholder="Write"></textarea>
                <select style="font-size:13px"><option>Choice</option></select>
                <div contenteditable="true" style="font-size:13px">Editable</div>
                <script>${bundle.outputFiles[0].text}</script></body></html>`);
        });
        await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Foundation test server failed to bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({ ...(executablePath ? { executablePath } : { channel: 'chrome' }), headless: true });
    }, 30_000);

    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>((closed) => server.close(() => closed()));
    });

    it.each(['light', 'dark'] as const)('loads local fonts and respects explicit overrides over a %s system', async (colorScheme) => {
        const page = await browser.newPage({ colorScheme, viewport: { width: 390, height: 844 } });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(origin);
        expect(errors).toEqual([]);
        const background = () => page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor);
        await page.getByRole('button', { name: /^dark$/i }).click();
        const darkBackground = await background();
        await page.getByRole('button', { name: /^light$/i }).click();
        const lightBackground = await background();
        expect(darkBackground).not.toBe(lightBackground);
        await page.getByRole('button', { name: new RegExp(`^${colorScheme}$`, 'i') }).click();
        expect(await background()).toBe(colorScheme === 'dark' ? darkBackground : lightBackground);
        const loaded = await page.evaluate(async (families) => {
            return Promise.all(families.map(async (family) => {
                const fonts = await document.fonts.load(`16px "${family}"`, family.startsWith('JetBrains') ? 'λ = 2' : 'HappyHerd');
                return fonts.length > 0 && fonts.every((font) => font.status === 'loaded');
            }));
        }, faces);
        expect(loaded).toEqual(faces.map(() => true));
        await page.close();
    });

    it.each([360, 390])('floors every text entry before its first focus at %d CSS pixels', async (width) => {
        const page = await browser.newPage({ viewport: { width, height: 844 } });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(origin);
        expect(errors).toEqual([]);
        for (const selector of ['input', 'textarea', 'select', '[contenteditable]']) {
            const control = page.locator(selector);
            expect(await control.evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px');
            await control.focus();
            expect(await control.evaluate((element) => document.activeElement === element)).toBe(true);
        }
        expect(await page.locator('textarea').evaluate((element) => getComputedStyle(element, '::placeholder').fontSize)).toBe('16px');
        expect(await page.locator('meta[name="viewport"]').getAttribute('content')).not.toMatch(/user-scalable|maximum-scale/);
        await page.setViewportSize({ width: 1440, height: 900 });
        expect(await page.locator('input').evaluate((element) => getComputedStyle(element).fontSize)).toBe('13px');
        await page.close();
    });
});
