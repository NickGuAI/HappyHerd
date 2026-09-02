import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../..');

const virtualModules: Record<string, string> = {
    'react-native-unistyles': `
        const light = {
            dark: false,
            colors: {
                text: '#000000', textSecondary: '#49454f', divider: '#eaeaea',
                surface: '#ffffff', surfaceHigh: '#f8f8f8', surfaceHighest: '#f0f0f0',
                syntaxKeyword: '#1d4ed8', syntaxString: '#059669', syntaxComment: '#6b7280',
                syntaxNumber: '#0891b2', syntaxFunction: '#9333ea', syntaxDefault: '#374151',
            },
        };
        const dark = {
            dark: true,
            colors: {
                text: '#ffffff', textSecondary: '#cac4d0', divider: '#292929',
                surface: '#212121', surfaceHigh: '#171717', surfaceHighest: '#292929',
                syntaxKeyword: '#569cd6', syntaxString: '#ce9178', syntaxComment: '#6a9955',
                syntaxNumber: '#b5cea8', syntaxFunction: '#dcdcaa', syntaxDefault: '#d4d4d4',
            },
        };
        export const useUnistyles = () => ({
            theme: new URLSearchParams(window.location.search).get('theme') === 'dark' ? dark : light,
        });
    `,
    'expo-router': `export const useRouter = () => ({ push() {} });`,
    'expo-clipboard': `export const setStringAsync = async () => {};`,
    '@/-session/workspaceLinkNavigation': `export const useWorkspaceLinkPress = () => null;`,
    '@/sync/storage': `export const useSession = () => null;`,
    '@/utils/markdownWorkspaceLink': `
        export const resolveMarkdownWorkspaceImageReference = () => null;
        export const resolveMarkdownWorkspaceLinkRoute = () => null;
    `,
    '@/utils/markdownWorkspaceImage': `export const loadMarkdownWorkspaceImage = async () => null;`,
    '@/utils/openExternalUrl': `export const openExternalUrl = async () => {};`,
    '@/text': `export const t = (key) => key;`,
    '@/modal': `export const Modal = { alert() {}, show() {} };`,
    './MermaidRenderer': `
        import React from 'react';
        export const MermaidRenderer = ({ content }) => React.createElement('div', null, content);
    `,
};

const fixturePlugin: Plugin = {
    name: 'markdown-browser-fixture',
    setup(buildContext) {
        buildContext.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in virtualModules) return { path: args.path, namespace: 'fixture-stub' };
            if (args.path.startsWith('@/')) {
                const sourcePath = resolve(appRoot, 'sources', args.path.slice(2));
                const path = [sourcePath, `${sourcePath}.ts`, `${sourcePath}.tsx`].find(existsSync);
                if (!path) throw new Error(`missing fixture source: ${args.path}`);
                return { path };
            }
            return null;
        });
        buildContext.onLoad({ filter: /.*/, namespace: 'fixture-stub' }, (args) => ({
            contents: virtualModules[args.path],
            loader: 'tsx',
            resolveDir: appRoot,
        }));
    },
};

function recordPageErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });
    return errors;
}

describe('MarkdownView browser theme and option parity', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            entryPoints: [resolve(here, '__testdata__/MarkdownView.browser.fixture.tsx')],
            bundle: true,
            write: false,
            outdir: 'out',
            format: 'iife',
            platform: 'browser',
            jsx: 'automatic',
            plugins: [fixturePlugin],
        });
        const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? bundle.outputFiles[0].text;
        server = createServer((_request, response) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end('<style>html,body,#root{margin:0;min-height:100%;font-family:sans-serif}*{box-sizing:border-box}</style><main id="root"></main><script>' + script + '</script>');
        });
        await new Promise<void>((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Markdown browser fixture did not bind');
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
        ['Web Desktop', { width: 1440, height: 900, hasTouch: false, isMobile: false }],
        ['390x844 Web Mobile', { width: 390, height: 844, hasTouch: true, isMobile: true }],
    ])('renders dark themed Markdown and original chips on %s', async (_surface, viewport) => {
        const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            hasTouch: viewport.hasTouch,
            isMobile: viewport.isMobile,
        });
        const page = await context.newPage();
        const pageErrors = recordPageErrors(page);
        await page.goto(`${origin}/?theme=dark`);

        const root = page.locator('.hh-markdown-root');
        const options = root.locator('.hh-markdown-options');
        const chips = options.locator('.hh-markdown-option');
        await chips.first().waitFor();
        await expect(options.locator('ul').count()).resolves.toBe(0);
        await expect(options.locator('li').count()).resolves.toBe(0);
        await expect(root.locator('ul').count()).resolves.toBe(1);
        await expect(root.locator('li').count()).resolves.toBe(2);

        const chipLayout = await chips.first().evaluate((element) => {
            const chip = getComputedStyle(element);
            const container = getComputedStyle(element.parentElement!);
            return {
                background: chip.backgroundColor,
                color: chip.color,
                radius: chip.borderRadius,
                padding: [chip.paddingTop, chip.paddingRight, chip.paddingBottom, chip.paddingLeft],
                fontFamily: chip.fontFamily,
                fontSize: chip.fontSize,
                lineHeight: chip.lineHeight,
                textAlign: chip.textAlign,
                width: element.getBoundingClientRect().width,
                containerWidth: element.parentElement!.getBoundingClientRect().width,
                gap: container.gap,
                margin: [container.marginTop, container.marginBottom],
            };
        });
        expect(chipLayout).toMatchObject({
            background: 'rgb(41, 41, 41)',
            color: 'rgb(255, 255, 255)',
            radius: '12px',
            padding: ['8px', '12px', '8px', '12px'],
            fontFamily: 'IBMPlexSans-Regular',
            fontSize: '16px',
            lineHeight: '24px',
            textAlign: 'left',
            gap: '8px',
            margin: ['8px', '8px'],
        });
        expect(Math.abs(chipLayout.width - chipLayout.containerWidth)).toBeLessThan(1);
        await expect(chips.nth(1).evaluate((element) => ({
            wraps: element.getBoundingClientRect().height > 40,
            contained: element.scrollWidth <= element.clientWidth,
        }))).resolves.toEqual({ wraps: true, contained: true });

        const colors = await root.evaluate((element) => {
            const computed = (selector: string) => getComputedStyle(element.querySelector(selector)!);
            return {
                body: getComputedStyle(element).color,
                heading: computed('h2').color,
                list: computed('li').color,
                link: computed('a').color,
                quoteColor: computed('blockquote p').color,
                quoteBackground: computed('blockquote').backgroundColor,
                quoteBorder: computed('blockquote').borderLeftColor,
                inlineCodeColor: computed('p code').color,
                inlineCodeBackground: computed('p code').backgroundColor,
                fencedBackground: computed('pre').backgroundColor,
                fencedText: computed('pre code').color,
                syntaxKeyword: computed('pre .hljs-keyword').color,
                tableText: computed('td').color,
                tableBorder: computed('td').borderTopColor,
                tableHeaderBackground: computed('th').backgroundColor,
            };
        });
        expect(colors).toEqual({
            body: 'rgb(255, 255, 255)',
            heading: 'rgb(255, 255, 255)',
            list: 'rgb(255, 255, 255)',
            link: 'rgb(255, 255, 255)',
            quoteColor: 'rgb(202, 196, 208)',
            quoteBackground: 'rgb(23, 23, 23)',
            quoteBorder: 'rgb(41, 41, 41)',
            inlineCodeColor: 'rgb(255, 255, 255)',
            inlineCodeBackground: 'rgb(23, 23, 23)',
            fencedBackground: 'rgb(41, 41, 41)',
            fencedText: 'rgb(255, 255, 255)',
            syntaxKeyword: 'rgb(86, 156, 214)',
            tableText: 'rgb(255, 255, 255)',
            tableBorder: 'rgb(41, 41, 41)',
            tableHeaderBackground: 'rgb(23, 23, 23)',
        });

        if (viewport.hasTouch) {
            await chips.first().tap();
        } else {
            const chipBox = await chips.first().boundingBox();
            if (!chipBox) throw new Error('Suggestion chip has no layout');
            await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
            await page.mouse.down();
            await expect(chips.first().evaluate((element) => getComputedStyle(element).opacity)).resolves.toBe('0.7');
            await page.mouse.up();
        }
        await expect(page.evaluate(() => window.__MARKDOWN_OPTION_PRESSES__)).resolves.toEqual(['把 Speaker 2 改成 Maria']);
        expect(pageErrors).toEqual([]);
        await context.close();
    }, 15_000);

    it('leaves the established light Markdown palette intact while restoring chip styling', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const pageErrors = recordPageErrors(page);
        await page.goto(`${origin}/?theme=light`);
        const root = page.locator('.hh-markdown-root');
        await root.locator('.hh-markdown-option').first().waitFor();

        const colors = await root.evaluate((element) => {
            const computed = (selector: string) => getComputedStyle(element.querySelector(selector)!);
            return {
                body: getComputedStyle(element).color,
                heading: computed('h2').color,
                list: computed('li').color,
                link: computed('a').color,
                quoteBackground: computed('blockquote').backgroundColor,
                quoteOpacity: computed('blockquote').opacity,
                inlineCodeBackground: computed('p code').backgroundColor,
                fencedBackground: computed('pre').backgroundColor,
                optionBackground: computed('.hh-markdown-option').backgroundColor,
                optionColor: computed('.hh-markdown-option').color,
            };
        });
        expect(colors).toEqual({
            body: 'rgb(0, 0, 0)',
            heading: 'rgb(0, 0, 0)',
            list: 'rgb(0, 0, 0)',
            link: 'rgb(0, 0, 0)',
            quoteBackground: 'rgba(0, 0, 0, 0)',
            quoteOpacity: '0.85',
            inlineCodeBackground: 'rgba(0, 0, 0, 0)',
            fencedBackground: 'rgba(127, 127, 127, 0.12)',
            optionBackground: 'rgb(240, 240, 240)',
            optionColor: 'rgb(0, 0, 0)',
        });
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);
});
