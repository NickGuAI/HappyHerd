import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../..');
const fontFaces = ['SpaceGrotesk-Regular', 'SpaceGrotesk-SemiBold', 'JetBrainsMono-Regular', 'JetBrainsMono-SemiBold'];

const virtualModules: Record<string, string> = {
    'react-native-unistyles': `
        import { lightTheme as light, darkTheme as dark } from '@/theme';
        export const useUnistyles = () => ({
            theme: new URLSearchParams(window.location.search).get('theme') === 'dark' ? dark : light,
        });
        export const StyleSheet = { create: (styles) => styles, hairlineWidth: 1 };
    `,
    'expo-router': `export const useRouter = () => ({ push() {} });`,
    'expo-clipboard': `export const setStringAsync = async () => {};`,
    '@/-session/workspaceLinkNavigation': `export const useWorkspaceLinkPress = () => null;`,
    '@/sync/storage': `
        import { useSyncExternalStore } from 'react';
        let session = { metadata: { machineId: 'fixture-machine', path: '/workspace', os: 'linux' }, activeAt: 0 };
        const listeners = new Set();
        window.__REFRESH_MARKDOWN_IMAGE_SESSION__ = () => {
            session = { ...session, activeAt: session.activeAt + 1 };
            for (const listener of listeners) listener();
        };
        export const useSession = (id) => useSyncExternalStore(
            (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
            () => id === 'image-session' ? session : null,
        );
    `,
    '@/sync/sync': `export const sync = { sendMessage: async () => ({ id: 'fixture-receipt' }) };`,
    '@/components/StyledText': `export { Text } from 'react-native';`,
    '@/sync/ops': `
        window.__MARKDOWN_IMAGE_READS__ = [];
        export const machineReadFileWithinRoot = async (...args) => {
            window.__MARKDOWN_IMAGE_READS__.push(args);
            await new Promise((resolve) => setTimeout(resolve, 100));
            return { success: true, content: btoa('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#438e78"/></svg>') };
        };
    `,
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
        if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
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
            alias: { 'react-native': 'react-native-web' },
            plugins: [fixturePlugin],
        });
        const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? bundle.outputFiles[0].text;
        const fonts = fontFaces.map((face) => `@font-face {font-family:'${face}';src:url('/${face}.ttf') format('truetype');}`).join('\n');
        const themeCss = readFileSync(resolve(appRoot, 'sources/theme.css'), 'utf8');
        server = createServer((request, response) => {
            const font = fontFaces.find((face) => request.url === `/${face}.ttf`);
            if (font) {
                response.setHeader('content-type', 'font/ttf');
                response.end(readFileSync(resolve(appRoot, 'sources/assets/fonts', `${font}.ttf`)));
                return;
            }
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end('<meta name="viewport" content="width=device-width, initial-scale=1"><style>' + fonts + '\n' + themeCss + '\nhtml,body,#root{margin:0;min-height:100%}*{box-sizing:border-box}</style><main id="root"></main><script>' + script + '</script>');
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

    it('visibly preserves Markdown emphasis and incidental weights with the shipped fonts', async () => {
        const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
        const errors = recordPageErrors(page);
        await page.goto(`${origin}/?typography`);
        await page.locator('#typography strong').first().waitFor();
        const loaded = await page.evaluate(async (families) => Promise.all(families.map(async (family) => {
            const faces = await document.fonts.load(`24px "${family}"`);
            return faces.length > 0 && faces.every((face) => face.status === 'loaded');
        })), fontFaces);
        expect(loaded).toEqual(fontFaces.map(() => true));

        // Normalize size and geometry only; font family/weight/style come from
        // the real Markdown component and app CSS. Equal PNGs mean emphasis
        // was silently lost even if computed font-weight still says "bold".
        const selectors = [
            '#typography .hh-markdown-root > p:first-of-type',
            '#typography strong:not(:has(code))',
            '#typography h2',
            '#typography em',
            '#typography th',
            '#incidental-weight',
            '#typography p > code',
            '#typography strong > code',
        ];
        const captures: Buffer[] = [];
        for (const selector of selectors) {
            const sample = page.locator(selector);
            await sample.evaluate((element) => {
                (element as HTMLElement).style.cssText += ';display:block;position:fixed;left:0;top:0;width:800px;height:40px;box-sizing:border-box;padding:0;margin:0;border:0;font-size:24px;line-height:40px;color:black;background:white;z-index:9999';
            });
            captures.push(await sample.screenshot());
            await sample.evaluate((element) => { (element as HTMLElement).style.visibility = 'hidden'; });
        }
        for (const emphasized of captures.slice(1, 6)) expect(emphasized.equals(captures[0])).toBe(false);
        expect(captures[7].equals(captures[6])).toBe(false);
        expect(errors).toEqual([]);
        await page.close();
    });

    it.each([
        ['Web Desktop', { width: 1440, height: 900 }],
        ['Web Mobile', { width: 390, height: 844 }],
    ])('retains the loaded image and layout through session updates on %s', async (_surface, viewport) => {
        const page = await browser.newPage({ viewport });
        const errors = recordPageErrors(page);
        await page.goto(`${origin}/?images`);
        await page.waitForFunction(() => document.querySelector('img')?.naturalWidth === 640);
        const image = await page.locator('.hh-markdown-root img').elementHandle();
        const initialLayout = await page.locator('.hh-markdown-root').boundingBox();
        for (let index = 0; index < 3; index += 1) {
            await page.evaluate(async () => {
                window.__REFRESH_MARKDOWN_IMAGE_SESSION__?.();
                await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
            });
            expect(await image?.evaluate((element) => element.isConnected)).toBe(true);
            expect(await page.locator('.hh-markdown-image-status').count()).toBe(0);
            expect(await page.locator('.hh-markdown-root').boundingBox()).toEqual(initialLayout);
        }
        expect(await page.evaluate(() => window.__MARKDOWN_IMAGE_READS__)).toEqual([
            ['fixture-machine', '/workspace/images/neutral.svg', '/workspace'],
        ]);
        expect(errors).toEqual([]);
        await page.close();
    });

    it.each([1, 3, 5, 7, 11, 15].flatMap((line) => (
        [1440, 390].map((width) => [line, width] as const)
    )))('retains typing and edit focus across host rerenders at Markdown line %s with width %s', async (line, width) => {
        const page = await browser.newPage({ viewport: { width, height: 844 } });
        page.setDefaultTimeout(3_000);
        const pageErrors = recordPageErrors(page);
        await page.goto(`${origin}/?review&theme=dark`, { timeout: 15_000 });
        await page.locator(`.hh-markdown-review-line[data-source-line="${line}"] > .hh-markdown-review-gutter button`).click();
        const thread = page.getByTestId(`inline-comment-thread:line:${line}`);
        const input = thread.getByRole('textbox');
        await input.pressSequentially('Keep ');
        const original = await input.elementHandle();
        await page.evaluate(() => window.__REFRESH_MARKDOWN_REVIEW__?.());
        await page.waitForFunction(() => document.querySelector('main[data-revision]')?.getAttribute('data-revision') === '1');
        expect(await original?.evaluate((element) => element.isConnected && element === document.activeElement)).toBe(true);
        await page.keyboard.type('this draft');
        expect(await input.inputValue()).toBe('Keep this draft');
        await thread.getByRole('button', { name: 'files.pinComment', exact: true }).click();
        await thread.getByRole('button', { name: 'files.editFile', exact: true }).click();
        // On macOS End scrolls the page; Command+Right moves the text caret.
        await input.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
        await page.keyboard.type(' edited');
        const editing = await input.elementHandle();
        await page.evaluate(() => window.__REFRESH_MARKDOWN_REVIEW__?.());
        await page.waitForFunction(() => document.querySelector('main[data-revision]')?.getAttribute('data-revision') === '2');
        expect(await editing?.evaluate((element) => element.isConnected && element === document.activeElement)).toBe(true);
        await page.keyboard.type(' after refresh');
        expect(await input.inputValue()).toBe('Keep this draft edited after refresh');
        await thread.getByRole('button', { name: 'common.save', exact: true }).click();
        expect(await thread.getByText('Keep this draft edited after refresh', { exact: true }).count()).toBe(1);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 20_000);

    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
    }, 30_000);

    it.each([
        ['Web Desktop', { width: 1440, height: 900, hasTouch: false, isMobile: false }],
        ['390x844 Web Mobile', { width: 390, height: 844, hasTouch: true, isMobile: true }],
    ])('renders dark themed Markdown, comment gutters, and original chips on %s', async (_surface, viewport) => {
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

        const firstLine = root.locator('p[data-source-line="1"]').first();
        const firstLineNumber = firstLine.locator('.hh-markdown-source-line');
        const firstLineGutter = firstLine.locator('.hh-markdown-comment-gutter');
        if (viewport.hasTouch) {
            await expect.poll(() => firstLineGutter.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
        } else {
            await expect(firstLineGutter.evaluate((element) => getComputedStyle(element).opacity)).resolves.toBe('0');
            await firstLine.hover();
            await expect.poll(() => firstLineGutter.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
            await page.mouse.move(viewport.width - 1, viewport.height - 1);
            await expect.poll(() => firstLineGutter.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
            await page.keyboard.press('Tab');
            await expect(firstLineGutter.evaluate((element) => element === document.activeElement)).resolves.toBe(true);
            await expect.poll(() => firstLineGutter.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
        }
        await expect(firstLineNumber.textContent()).resolves.toBe('1');
        const gutterLayout = await firstLine.evaluate((element) => {
            const lineNumber = element.querySelector('.hh-markdown-source-line')!;
            const button = element.querySelector('.hh-markdown-comment-gutter')!;
            const content = Array.from(element.childNodes).find((node) => (
                node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
            ));
            const lineRect = lineNumber.getBoundingClientRect();
            const buttonRect = button.getBoundingClientRect();
            const contentRange = document.createRange();
            contentRange.selectNode(content!);
            const contentRect = contentRange.getBoundingClientRect();
            const rootRect = element.closest('.hh-markdown-root')!.getBoundingClientRect();
            const hostRect = element.closest('[data-testid="markdown-host"]')!.getBoundingClientRect();
            const style = getComputedStyle(button);
            return {
                width: buttonRect.width,
                height: buttonRect.height,
                insideRoot: buttonRect.left >= rootRect.left - 0.5 && buttonRect.right <= rootRect.right + 0.5,
                insideHost: buttonRect.left >= hostRect.left - 0.5 && buttonRect.right <= hostRect.right + 0.5,
                sourceOrder: lineRect.right <= buttonRect.left && buttonRect.right <= contentRect.left,
                backgroundColor: style.backgroundColor,
                color: style.color,
                borderRadius: style.borderRadius,
                borderTopWidth: style.borderTopWidth,
                display: style.display,
                alignItems: style.alignItems,
                justifyContent: style.justifyContent,
            };
        });
        expect(gutterLayout).toMatchObject({
            width: 20,
            height: 20,
            insideRoot: true,
            insideHost: true,
            sourceOrder: true,
            borderRadius: '4px',
            borderTopWidth: '0px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        });
        expect(gutterLayout.backgroundColor).toBe('rgb(240, 220, 176)');

        const alignedReviewLines = [
            root.locator('h2[data-source-line="3"]'),
            root.locator('li[data-source-line="5"]'),
            root.locator('li[data-source-line="6"]'),
            root.locator('li[data-source-line="9"]'),
        ];
        const alignedGutters = await Promise.all(alignedReviewLines.map((line) => line.locator(':scope > .hh-markdown-review-gutter').boundingBox()));
        expect(alignedGutters.every(Boolean)).toBe(true);
        const expectedGutterLeft = alignedGutters[0]!.x;
        for (const gutter of alignedGutters.slice(1)) {
            expect(Math.abs(gutter!.x - expectedGutterLeft)).toBeLessThanOrEqual(0.5);
        }

        if (viewport.hasTouch) await firstLineGutter.tap();
        else await firstLineGutter.click();
        await expect(page.evaluate(() => window.__MARKDOWN_LINE_COMMENTS__)).resolves.toEqual([1]);

        await expect(options.locator('ul').count()).resolves.toBe(0);
        await expect(options.locator('li').count()).resolves.toBe(0);
        await expect(root.locator('ul').count()).resolves.toBe(2);
        await expect(root.locator('ol').count()).resolves.toBe(1);
        await expect(root.locator('li').count()).resolves.toBe(4);
        await expect(chips.allTextContents()).resolves.toEqual([
            '把 Speaker 2 改成 Maria',
            '保持 Speaker 2 不变，同时保留当前转录中的全部说话人标记以及这一条足够长、会在窄屏和宽屏容器中按可用宽度自然换行的建议文字',
            'Keep Speaker 2 (recommended))',
            'Keep Speaker 2 trailing \\',
            String.raw`Keep \[Speaker 2\]`,
        ]);

        const chipLayout = await chips.first().evaluate((element) => {
            const chip = getComputedStyle(element);
            const container = getComputedStyle(element.parentElement!);
            return {
                background: chip.backgroundImage,
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
            background: 'linear-gradient(rgb(36, 27, 14), rgb(26, 19, 9))',
            color: 'rgb(251, 244, 228)',
            radius: '6px',
            padding: ['12px', '16px', '12px', '16px'],
            fontFamily: 'SpaceGrotesk-Regular',
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
            body: 'rgb(247, 244, 236)',
            heading: 'rgb(247, 244, 236)',
            list: 'rgb(247, 244, 236)',
            link: 'rgb(247, 244, 236)',
            quoteColor: 'rgba(247, 244, 236, 0.88)',
            quoteBackground: 'rgb(21, 27, 40)',
            quoteBorder: 'rgba(247, 244, 236, 0.24)',
            inlineCodeColor: 'rgb(247, 244, 236)',
            inlineCodeBackground: 'rgb(21, 27, 40)',
            fencedBackground: 'rgb(27, 34, 49)',
            fencedText: 'rgb(247, 244, 236)',
            syntaxKeyword: 'rgb(240, 220, 176)',
            tableText: 'rgb(247, 244, 236)',
            tableBorder: 'rgba(247, 244, 236, 0.24)',
            tableHeaderBackground: 'rgb(21, 27, 40)',
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

    it('renders warm paper Markdown and warm island options', async () => {
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
            body: 'rgb(20, 16, 10)',
            heading: 'rgb(20, 16, 10)',
            list: 'rgb(20, 16, 10)',
            link: 'rgb(20, 16, 10)',
            quoteBackground: 'rgba(0, 0, 0, 0)',
            quoteOpacity: '0.85',
            inlineCodeBackground: 'rgba(0, 0, 0, 0)',
            fencedBackground: 'rgb(255, 249, 236)',
            optionBackground: 'rgba(0, 0, 0, 0)',
            optionColor: 'rgb(251, 244, 228)',
        });
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);

    it('centers rendered Web Markdown when the Human message host requests it', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const pageErrors = recordPageErrors(page);
        await page.goto(`${origin}/?theme=light&align=center`);
        const root = page.locator('.hh-markdown-root');
        await root.locator('p').first().waitFor();

        await expect(root.locator('p').first().evaluate((element) => getComputedStyle(element).textAlign)).resolves.toBe('center');
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);

    it.each([
        ['Web Desktop', { width: 1440, height: 900, hasTouch: false, isMobile: false }],
        ['390x844 Web Mobile', { width: 390, height: 844, hasTouch: true, isMobile: true }],
    ])('keeps wide Markdown tables readable and horizontally reachable on %s', async (_surface, viewport) => {
        const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            hasTouch: viewport.hasTouch,
            isMobile: viewport.isMobile,
        });
        const page = await context.newPage();
        const pageErrors = recordPageErrors(page);
        await page.goto(`${origin}/?theme=dark`);

        const root = page.locator('.hh-markdown-root');
        const scrollHost = page.getByTestId('markdown-host');
        const tableWrap = root.locator('.hh-markdown-table-wrap');
        const table = tableWrap.locator('table');
        await table.waitFor();

        const initial = await tableWrap.evaluate((element) => {
            const tableElement = element.querySelector('table')!;
            const firstCell = tableElement.querySelector('td')!;
            const cellStyle = getComputedStyle(firstCell);
            const textElements = [...element.closest('.hh-markdown-root')!.querySelectorAll('*')]
                .filter((candidate) => (
                    candidate.tagName !== 'STYLE'
                    && !candidate.closest('.hh-markdown-review-gutter')
                    && [...candidate.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
                ));
            return {
                overflowX: getComputedStyle(element).overflowX,
                tableDisplay: getComputedStyle(tableElement).display,
                tableOverflowX: getComputedStyle(tableElement).overflowX,
                scrollWidth: element.scrollWidth,
                clientWidth: element.clientWidth,
                cellWidth: firstCell.getBoundingClientRect().width,
                cellWordBreak: cellStyle.wordBreak,
                cellOverflowWrap: cellStyle.overflowWrap,
                minimumTextSize: Math.min(...textElements.map((candidate) => Number.parseFloat(getComputedStyle(candidate).fontSize))),
                hostCanScrollVertically: element.closest('[data-testid="markdown-host"]')!.scrollHeight
                    > element.closest('[data-testid="markdown-host"]')!.clientHeight,
                windowCanScrollVertically: document.documentElement.scrollHeight > window.innerHeight,
            };
        });
        expect(initial).toMatchObject({
            overflowX: 'auto',
            tableDisplay: 'table',
            tableOverflowX: 'visible',
            cellWordBreak: 'normal',
            cellOverflowWrap: 'break-word',
            minimumTextSize: 16,
            hostCanScrollVertically: true,
            windowCanScrollVertically: false,
        });
        expect(initial.scrollWidth).toBeGreaterThan(initial.clientWidth);
        expect(initial.cellWidth).toBeGreaterThanOrEqual(128);

        const tableBox = await tableWrap.boundingBox();
        if (!tableBox) throw new Error('Markdown table scroller has no layout');
        if (viewport.hasTouch) {
            const session = await context.newCDPSession(page);
            const y = tableBox.y + Math.min(tableBox.height / 2, 100);
            const startX = tableBox.x + tableBox.width - 20;
            const endX = tableBox.x + 20;
            await session.send('Input.dispatchTouchEvent', {
                type: 'touchStart',
                touchPoints: [{ x: startX, y }],
            });
            for (let step = 1; step <= 5; step += 1) {
                await session.send('Input.dispatchTouchEvent', {
                    type: 'touchMove',
                    touchPoints: [{ x: startX + ((endX - startX) * step) / 5, y }],
                });
            }
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

            const verticalX = tableBox.x + Math.min(tableBox.width / 2, 120);
            const startY = tableBox.y + tableBox.height - 20;
            const endY = tableBox.y + 20;
            await session.send('Input.dispatchTouchEvent', {
                type: 'touchStart',
                touchPoints: [{ x: verticalX, y: startY }],
            });
            for (let step = 1; step <= 5; step += 1) {
                await session.send('Input.dispatchTouchEvent', {
                    type: 'touchMove',
                    touchPoints: [{ x: verticalX, y: startY + ((endY - startY) * step) / 5 }],
                });
            }
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await expect.poll(() => scrollHost.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        } else {
            await tableWrap.hover();
            await page.mouse.wheel(2_000, 0);
            await page.mouse.wheel(0, 1_000);
            await expect.poll(() => scrollHost.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        }
        await expect.poll(() => tableWrap.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

        const tableReviewButton = root.locator('.hh-markdown-table-review > .hh-markdown-review-gutter > .hh-markdown-comment-gutter');
        await tableReviewButton.scrollIntoViewIfNeeded();
        if (viewport.hasTouch) {
            await tableReviewButton.tap();
        } else {
            await tableReviewButton.click();
        }
        await expect(page.evaluate(() => window.__MARKDOWN_LINE_COMMENTS__)).resolves.toEqual([17]);

        await tableWrap.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
        const farRight = await tableWrap.evaluate((element) => {
            const lastCell = element.querySelector('tr > :last-child')!;
            const wrapperRect = element.getBoundingClientRect();
            const cellRect = lastCell.getBoundingClientRect();
            return {
                atEnd: Math.abs(element.scrollWidth - element.clientWidth - element.scrollLeft) < 1,
                lastCellVisible: cellRect.right <= wrapperRect.right + 1 && cellRect.left < wrapperRect.right,
            };
        });
        expect(farRight).toEqual({ atEnd: true, lastCellVisible: true });
        expect(pageErrors).toEqual([]);
        await context.close();
    }, 15_000);
});
