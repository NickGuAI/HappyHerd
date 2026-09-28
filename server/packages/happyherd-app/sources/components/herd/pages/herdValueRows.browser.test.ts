import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@babel/core';
import { chromium, type Browser } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../../..');
const sourcesRoot = resolve(appRoot, 'sources');
const iconFonts = resolve(appRoot, '../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts');

/**
 * The machine and session details pages' title row and value rows (UI overhaul),
 * rendered through the Unistyles Babel transform and web runtime the Expo build
 * uses, with the real icon fonts and the English catalog. Only the clipboard,
 * the modal system and the press animation are stubbed.
 */
const PRODUCTION_STYLE_FILES = /components\/(herd\/pages\/(HerdList|HerdPage)|Item|ItemGroup|StyledText)\.tsx$/;

const virtualModules: Record<string, string> = {
    'react-native': `
        import * as ReactNativeWeb from 'react-native-web';
        export * from 'react-native-web';
        export const Platform = { ...ReactNativeWeb.Platform, OS: 'web', select: (options) => options.web ?? options.default };
    `,
    'fixture-theme': `
        import { lightTheme, darkTheme } from '@/theme';
        export const theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? darkTheme : lightTheme;
    `,
    'expo-font': `export const isLoaded = () => true; export const loadAsync = async () => {}; export const useFonts = () => [true, null];`,
    'expo-asset': `export const Asset = { fromModule: (module) => ({ uri: typeof module === 'string' ? module : module.uri }) };`,
    'expo-clipboard': `export const setStringAsync = async (text) => { (window.__COPIED__ ??= []).push(text); return true; };`,
    '@/modal': `export const Modal = { alert() {}, confirm: async () => false, prompt: async () => null };`,
    'fixture-bubble-pressable': `
        import React from 'react';
        import { Pressable } from 'react-native';
        export const BubblePressable = ({ bubbleScale, pressedStyle, ...props }) => React.createElement(Pressable, props);
    `,
    '@/text': `
        import en from '@/text/locales/en.json';
        export const t = (key) => key.split('.').reduce((value, part) => value?.[part], en) ?? key;
    `,
};

const fixturePlugin: Plugin = {
    name: 'herd-value-rows-browser-fixture',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, (args) => {
            if (args.path.startsWith('react-native-unistyles/components/native/')) {
                return { path: resolve(appRoot, '../../node_modules/react-native-unistyles/lib/module/components/native', `${args.path.split('/').at(-1)}.js`) };
            }
            if (args.path === 'react-native-unistyles') return { path: 'production-styles', namespace: 'fixture-stub' };
            if (args.path === './BubblePressable') return { path: 'fixture-bubble-pressable', namespace: 'fixture-stub' };
            if (args.path in virtualModules) return { path: args.path, namespace: 'fixture-stub' };
            if (args.path.startsWith('@/')) {
                const sourcePath = resolve(sourcesRoot, args.path.slice(2));
                const path = [sourcePath, `${sourcePath}.web.tsx`, `${sourcePath}.tsx`, `${sourcePath}.ts`].find(existsSync);
                if (!path) throw new Error(`missing fixture source: ${args.path}`);
                return { path };
            }
            return null;
        });
        bundle.onLoad({ filter: /.*/, namespace: 'fixture-stub' }, (args) => ({
            contents: args.path === 'production-styles'
                ? `
                    import { theme } from 'fixture-theme';
                    import { StyleSheet, useUnistyles } from ${JSON.stringify(resolve(appRoot, '../../node_modules/react-native-unistyles/lib/module/index.js'))};
                    StyleSheet.configure({ themes: { fixture: theme }, settings: { initialTheme: 'fixture' } });
                    export { StyleSheet, useUnistyles };
                `
                : virtualModules[args.path],
            loader: 'tsx',
            resolveDir: here,
        }));
        bundle.onLoad({ filter: PRODUCTION_STYLE_FILES }, (args) => {
            // Unistyles disables its component transform under Vitest's NODE_ENV=test.
            const previousNodeEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            let transformed;
            try {
                transformed = transformSync(readFileSync(args.path, 'utf8'), {
                    filename: args.path,
                    configFile: false,
                    babelrc: false,
                    caller: { name: 'metro', platform: 'web', supportsStaticESM: true } as any,
                    presets: [['babel-preset-expo', { jsxRuntime: 'automatic' }]],
                    plugins: [['react-native-unistyles/plugin', { root: 'sources' }]],
                });
            } finally {
                process.env.NODE_ENV = previousNodeEnv;
            }
            if (!transformed?.code) throw new Error(`production style transform failed: ${args.path}`);
            return { contents: transformed.code, loader: 'js', resolveDir: dirname(args.path) };
        });
    },
};

// A machine page's title row and Daemon list, with a long path and a copyable id.
const FIXTURE = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { ScrollView, View } from 'react-native';
    import { Ionicons } from '@expo/vector-icons';
    import { HerdItem, HerdItemGroup, HerdListHeader, HerdValueItem } from '@/components/herd/pages/HerdList';
    import { HerdButton, HerdDot, HerdPageHeader } from '@/components/herd/pages/HerdPage';
    function Fixture() {
        return React.createElement(ScrollView, { style: { flex: 1 } },
            React.createElement(HerdListHeader, { testID: 'fixture-header' },
                React.createElement(HerdPageHeader, {
                    title: 'studio-mac',
                    subtitle: 'online · macOS · studio.local',
                    subtitlePrefix: React.createElement(View, { testID: 'fixture-dot' }, React.createElement(HerdDot, { tone: 'ok' })),
                    leading: React.createElement(View, { testID: 'fixture-tile', style: { width: 52, height: 52 } }, React.createElement(Ionicons, { name: 'laptop-outline', size: 24 })),
                    actions: React.createElement(HerdButton, { icon: 'pencil-outline', label: 'Rename Machine', testID: 'fixture-rename' }),
                    testID: 'fixture-page-header',
                })),
            React.createElement(HerdItemGroup, { title: 'Daemon' },
                React.createElement(HerdValueItem, { title: 'Status', value: 'online', prefix: React.createElement(HerdDot, { tone: 'ok' }), testID: 'row-status' }),
                React.createElement(HerdValueItem, { title: 'Process ID', value: '48213', mono: true, testID: 'row-pid' }),
                React.createElement(HerdValueItem, { title: 'Home Directory', value: '/Users/example-user/code/an-unusually-long/workspace/path/that/cannot/fit/on/one/phone/row', mono: true, testID: 'row-path' }),
                React.createElement(HerdValueItem, { title: 'Machine ID', value: 'machine-7f3a', mono: true, copyText: 'machine-7f3a-full', testID: 'row-copy' }),
                React.createElement(HerdValueItem, { title: 'Delete Machine', destructive: true, testID: 'row-danger' }),
                React.createElement(HerdItem, { title: 'Browse machine files', onPress: () => {} })));
    }
    createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;

describe('Entity page title row and value rows in the production style runtime', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            stdin: { contents: FIXTURE, loader: 'tsx', resolveDir: here },
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
            define: { __DEV__: 'false', 'process.env.EXPO_OS': '"web"', 'process.env.NODE_ENV': '"test"' },
            jsx: 'automatic',
            loader: { '.png': 'dataurl', '.ttf': 'dataurl', '.js': 'jsx' },
            resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.js', '.js', '.json'],
            plugins: [fixturePlugin],
        });
        const script = bundle.outputFiles[0].text;
        const themeCss = readFileSync(resolve(sourcesRoot, 'theme.css'), 'utf8');
        const fonts = ['SpaceGrotesk-Regular', 'SpaceGrotesk-Medium', 'SpaceGrotesk-SemiBold', 'JetBrainsMono-Regular'];
        server = createServer((request, response) => {
            const url = new URL(request.url ?? '/', 'http://fixture.test');
            const font = url.pathname.match(/^\/fonts\/([A-Za-z-]+)\.ttf$/);
            if (font) {
                const appFont = resolve(sourcesRoot, 'assets/fonts', `${font[1]}.ttf`);
                response.setHeader('content-type', 'font/ttf');
                response.end(readFileSync(existsSync(appFont) ? appFont : resolve(iconFonts, `${font[1]}.ttf`)));
                return;
            }
            const faces = [
                ...fonts.map((family) => `@font-face{font-family:${family};src:url(/fonts/${family}.ttf)}`),
                '@font-face{font-family:ionicons;src:url(/fonts/Ionicons.ttf)}',
            ].join('');
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<style>${faces}html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><style>${themeCss}</style><main id="root"></main><script>globalThis.global=globalThis;${script.replaceAll('</script', '<\\/script')}</script>`);
        });
        await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('value rows fixture did not bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({
            ...(executablePath ? { executablePath } : { channel: 'chrome' }),
            headless: true,
            args: process.platform === 'linux' ? ['--no-sandbox'] : [],
        });
    }, 60_000);

    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>((closed) => server.close(() => closed()));
    });

    async function open(theme: 'light' | 'dark', width: number, height: number) {
        const page = await browser.newPage({ viewport: { width, height } });
        page.setDefaultTimeout(5_000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
        await page.goto(`${origin}/?theme=${theme}`);
        await page.getByTestId('row-status').waitFor();
        await page.evaluate(() => document.fonts.ready);
        return { page, errors };
    }

    const box = async (page: import('playwright-core').Page, testID: string) => (await page.getByTestId(testID).boundingBox())!;

    it.each([
        ['light', 1440, 900],
        ['dark', 1440, 900],
        ['light', 390, 844],
        ['dark', 390, 844],
    ] as const)('draws each value on its label\'s line at the card\'s right edge (%s, %i px)', async (theme, width, height) => {
        const { page, errors } = await open(theme, width, height);
        for (const id of ['row-status', 'row-pid', 'row-path', 'row-copy']) {
            const row = await box(page, id);
            const label = await box(page, `${id}-title`);
            const value = await box(page, id === 'row-copy' ? 'row-copy-value' : `${id}-value`);
            // One line: the value's middle sits on the label's middle.
            expect(Math.abs((value.y + value.height / 2) - (label.y + label.height / 2))).toBeLessThanOrEqual(2);
            // Right edge: the value (or its copy icon) ends on the row's 16 px inset.
            const end = id === 'row-copy' ? await box(page, 'row-copy-copy-icon') : value;
            expect(Math.abs((row.x + row.width - 16) - (end.x + end.width))).toBeLessThanOrEqual(1);
            // The label is never covered by its value.
            expect(label.x + label.width).toBeLessThanOrEqual(value.x);
            // The row keeps to one line.
            expect(row.height).toBeLessThanOrEqual(56);
        }
        // A long path shortens instead of spilling past the card.
        const path = await page.getByTestId('row-path-value').evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth, overflow: getComputedStyle(node).textOverflow }));
        expect(path.overflow).toBe('ellipsis');
        expect(path.scroll).toBeGreaterThan(path.client);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(errors).toEqual([]);
        await page.close();
    });

    it('copies the full text and confirms with a check, then returns to the copy icon', async () => {
        const { page, errors } = await open('dark', 1440, 900);
        const icon = page.getByTestId('row-copy-copy-icon');
        const glyph = () => icon.evaluate((node) => node.textContent);
        const copyGlyph = await glyph();
        await page.getByTestId('row-copy').click();
        await expect.poll(() => page.evaluate(() => (window as any).__COPIED__ ?? [])).toEqual(['machine-7f3a-full']);
        await expect.poll(glyph).not.toBe(copyGlyph);
        await expect.poll(glyph, { timeout: 3_000 }).toBe(copyGlyph);
        await expect(page.getByTestId('row-copy').getAttribute('aria-label')).resolves.toBe('Machine ID: Copy');
        expect(errors).toEqual([]);
        await page.close();
    });

    it('draws a destructive row\'s label in the destructive tone', async () => {
        const { page } = await open('dark', 1440, 900);
        const colors = await page.evaluate(() => {
            const labelColor = (id: string) => getComputedStyle(document.querySelector(`[data-testid="${id}-title"]`)!).color;
            return { danger: labelColor('row-danger'), plain: labelColor('row-pid') };
        });
        expect(colors.danger).not.toBe(colors.plain);
        const { darkTheme } = await import('@/theme');
        const hex = darkTheme.colors.textDestructive.replace('#', '');
        const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
        expect(colors.danger).toBe(`rgb(${r}, ${g}, ${b})`);
        await page.close();
    });

    it.each([[1440, 900], [390, 844]] as const)('lays the title row\'s status dot on its subtitle line, beside the tile (%i px)', async (width, height) => {
        const { page, errors } = await open('dark', width, height);
        const header = await box(page, 'fixture-page-header');
        const card = (await page.getByText('Status', { exact: true }).boundingBox())!;
        const tile = await box(page, 'fixture-tile');
        const dot = await box(page, 'fixture-dot');
        const subtitle = (await page.getByText('online · macOS · studio.local', { exact: true }).boundingBox())!;
        // The header starts on the cards' left edge.
        expect(Math.abs(header.x - (card.x - 16))).toBeLessThanOrEqual(1);
        expect(Math.abs((dot.y + dot.height / 2) - (subtitle.y + subtitle.height / 2))).toBeLessThanOrEqual(2);
        expect(dot.x + dot.width).toBeLessThanOrEqual(subtitle.x);
        expect(tile.x + tile.width).toBeLessThan(dot.x);
        expect(errors).toEqual([]);
        await page.close();
    });
});
