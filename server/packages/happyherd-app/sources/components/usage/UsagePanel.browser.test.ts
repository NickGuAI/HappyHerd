import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { transformSync } from '@babel/core';
import { lightTheme, darkTheme } from '@/theme';

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(here, '../..');
const appRoot = resolve(sourceRoot, '..');
const iconFonts = resolve(appRoot, '../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts');

const virtualModules: Record<string, string> = {
    'react-native': `
        import React from 'react';
        import { Animated } from 'react-native-web';
        export * from 'react-native-web';
        export const TurboModuleRegistry = { get: () => null };
        export const useAnimatedValue = (value) => React.useRef(new Animated.Value(value)).current;
    `,
    'react-native-unistyles': `
        import { lightTheme, darkTheme } from '@/theme';
        import { StyleSheet, useUnistyles } from ${JSON.stringify(resolve(appRoot, '../../node_modules/react-native-unistyles/lib/module/index.js'))};
        const theme = new URLSearchParams(location.search).get('theme') === 'dark' ? darkTheme : lightTheme;
        StyleSheet.configure({ themes: { fixture: theme }, settings: { initialTheme: 'fixture' } });
        export { StyleSheet, useUnistyles };
    `,
    'expo-font': `export const isLoaded = () => true; export const loadAsync = async () => {}; export const useFonts = () => [true, null];`,
    'expo-asset': `export const Asset = { fromModule: (module) => ({ uri: typeof module === 'string' ? module : module.uri }) };`,
    '@/auth/AuthContext': `export const useAuth = () => ({ credentials: { token: 'fixture-token', secret: 'fixture-secret' } });`,
    '@/text': `
        import en from '@/text/locales/en.json';
        export const t = (key, values = {}) => Object.entries(values).reduce(
            (text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), key.split('.').reduce((value, part) => value?.[part], en) ?? key);
    `,
    '@/sync/storage': `export const useSetting = () => true;`,
    '@/track': `export const trackWhatsNewClicked = () => {};`,
    '@/components/layout': `export const layout = { maxWidth: 800, headerMaxWidth: 800 };`,
    '@/utils/platform': `export const isRunningOnMac = () => false;`,
    '@/utils/responsive': `export const useHeaderHeight = () => 56; export const useIsTablet = () => false; export const getDeviceType = () => 'phone';`,
    'react-native-safe-area-context': `export const useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });`,
    '../MobileGlass': `export const MobileGlassSurface = ({ children }) => children;`,
    './MobileHeaderScrim': `export const MobileHeaderScrim = () => null; export const MOBILE_HOME_SCRIM_OVERLAY_OPACITY = 0; export const MOBILE_STRONG_HEADER_SCRIM_RESTING_OPACITY = 0; export const MOBILE_STRONG_HEADER_SCRIM_UNDERLAP_OPACITY = 0;`,
    'expo-router': `
        import React from 'react';
        let path = '/settings', options = {}, optionsSnapshot = '{}';
        const listeners = new Set();
        const subscribe = (callback) => { listeners.add(callback); return () => listeners.delete(callback); };
        const publish = () => listeners.forEach((callback) => callback());
        const navigate = (next) => { path = next; options = {}; optionsSnapshot = '{}'; publish(); };
        export const useRouter = () => ({ push: navigate, navigate, back: () => navigate('/settings') });
        export const usePathname = () => React.useSyncExternalStore(subscribe, () => path);
        export const useFixtureOptions = () => JSON.parse(React.useSyncExternalStore(subscribe, () => optionsSnapshot));
        export const Stack = { Screen: ({ options: next }) => {
            React.useLayoutEffect(() => {
                Object.assign(options, next);
                const snapshot = JSON.stringify(options);
                if (snapshot !== optionsSnapshot) { optionsSnapshot = snapshot; publish(); }
            }, [JSON.stringify(next)]);
            return null;
        } };
    `,
    './serverConfig': `export const getServerUrl = () => 'https://api.example.test';`,
    './apiSocket': `export const getHappyHerdClientId = () => 'usage-browser-fixture';`,
};

function fixturePlugin(): Plugin {
    return {
        name: 'usage-panel-fixture',
        setup(buildApi) {
            buildApi.onResolve({ filter: /.*/ }, (args) => {
                if (args.path in virtualModules) return { path: args.path, namespace: 'usage-virtual' };
                if (args.path.startsWith('react-native-unistyles/components/native/')) {
                    return { path: resolve(appRoot, '../../node_modules/react-native-unistyles/lib/module/components/native', `${args.path.split('/').at(-1)}.js`) };
                }
                return null;
            });
            buildApi.onResolve({ filter: /^@\// }, (args) => {
                const sourcePath = resolve(sourceRoot, args.path.slice(2));
                const path = [sourcePath, `${sourcePath}.ts`, `${sourcePath}.tsx`].find(existsSync);
                if (!path) throw new Error(`missing usage fixture source: ${args.path}`);
                return { path };
            });
            buildApi.onLoad({ filter: /.*/, namespace: 'usage-virtual' }, (args) => ({
                contents: virtualModules[args.path],
                loader: 'js',
                resolveDir: appRoot,
            }));
            buildApi.onLoad({ filter: /(?:components\/(?:usage\/\w+|herd\/pages\/(?:HerdPage|SettingsFrame)|herd\/SegmentedControl|navigation\/Header|StyledText|ItemList|ItemGroup)|app\/\(app\)\/settings\/usage)\.tsx$/ }, (args) => {
                const previous = process.env.NODE_ENV;
                process.env.NODE_ENV = 'production';
                try {
                    const transformed = transformSync(readFileSync(args.path, 'utf8'), {
                        filename: args.path, configFile: false, babelrc: false,
                        caller: { name: 'metro', platform: 'web', supportsStaticESM: true } as any,
                        presets: [['babel-preset-expo', { jsxRuntime: 'automatic' }]],
                        plugins: [['react-native-unistyles/plugin', { root: 'sources' }]],
                    });
                    if (!transformed?.code) throw new Error(`Usage style transform failed: ${args.path}`);
                    return { contents: transformed.code, loader: 'js', resolveDir: dirname(args.path) };
                } finally {
                    process.env.NODE_ENV = previous;
                }
            });
        },
    };
}

function recordPageErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
    return errors;
}

describe('UsagePanel browser behavior', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            entryPoints: [resolve(here, '__testdata__/UsagePanel.browser.fixture.tsx')],
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
            jsx: 'automatic',
            define: { __DEV__: 'false', 'process.env.EXPO_OS': '"web"', 'process.env.NODE_ENV': '"test"' },
            loader: { '.js': 'jsx', '.ttf': 'dataurl', '.png': 'dataurl' },
            resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.js', '.js', '.json'],
            plugins: [fixturePlugin()],
            logOverride: { 'ignored-bare-import': 'silent' },
        });
        const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? bundle.outputFiles[0].text;
        const themeCss = readFileSync(resolve(sourceRoot, 'theme.css'), 'utf8');
        const fonts = ['SpaceGrotesk-Regular', 'SpaceGrotesk-SemiBold', 'JetBrainsMono-Regular', 'JetBrainsMono-SemiBold'];
        server = createServer((request, response) => {
            const font = request.url?.match(/^\/fonts\/([A-Za-z-]+)\.ttf$/);
            if (font) {
                response.setHeader('content-type', 'font/ttf');
                const appFont = resolve(sourceRoot, 'assets/fonts', `${font[1]}.ttf`);
                response.end(readFileSync(existsSync(appFont) ? appFont : resolve(iconFonts, `${font[1]}.ttf`)));
                return;
            }
            response.setHeader('content-type', 'text/html; charset=utf-8');
            const faces = [...fonts.map((family) => `@font-face{font-family:${family};src:url(/fonts/${family}.ttf)}`), '@font-face{font-family:ionicons;src:url(/fonts/Ionicons.ttf)}'].join('');
            response.end(`<style>${faces}html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><style>${themeCss}</style><main id="root"></main><script>globalThis.global=globalThis;${script.replaceAll('</script', '<\\/script')}</script>`);
        });
        await new Promise<void>((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Usage fixture did not bind');
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
        if (server) await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
    }, 30_000);

    it.each([
        ['Web Desktop', { width: 1440, height: 900 }, 'light'],
        ['Web Desktop', { width: 1440, height: 900 }, 'dark'],
        ['Web Mobile', { width: 390, height: 844 }, 'light'],
        ['Web Mobile', { width: 390, height: 844 }, 'dark'],
    ] as const)('opens the redesigned page and retains usage controls on %s at %s in %s', async (_surface, viewport, mode) => {
        const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
        const errors = recordPageErrors(page);
        const theme = mode === 'dark' ? darkTheme : lightTheme;
        await page.goto(`${origin}?theme=${mode}`);
        await page.getByTestId('settings-section-usage').click();

        await expect(page.getByText('350', { exact: true }).first().waitFor()).resolves.toBeUndefined();
        await expect(page.getByText('$0.1200', { exact: true }).count()).resolves.toBe(1);
        await expect(page.getByText('By Provider', { exact: true }).count()).resolves.toBe(1);
        for (const provider of ['claude', 'codex', 'grok']) {
            await expect(page.getByText(provider, { exact: true }).count()).resolves.toBe(1);
        }
        await expect(page.getByText("claude: cost is the provider's per-model estimate, not a billing statement.", { exact: true }).count()).resolves.toBe(1);
        await expect(page.getByText('codex: Cost is not reported by the provider.', { exact: true }).count()).resolves.toBe(1);
        await expect(page.getByText('dsh: Tokens is not reported by the provider.', { exact: true }).count()).resolves.toBe(1);

        const evidence = process.env.HAPPYHERD_ACCEPTANCE_DIR?.trim();
        if (evidence) {
            mkdirSync(evidence, { recursive: true });
            await page.evaluate(() => document.fonts.ready);
            await page.screenshot({ path: resolve(evidence, `usage-${mode}-${viewport.width}.png`), fullPage: true });
        }
        const title = viewport.width === 1440 ? page.getByTestId('settings-page-title') : page.getByText('Usage', { exact: true });
        await expect(title.count()).resolves.toBe(1);
        await expect(title.evaluate((node) => getComputedStyle(node).fontFamily)).resolves.toContain('SpaceGrotesk-SemiBold');
        await expect(title.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).resolves.toBeGreaterThanOrEqual(22);
        const period = page.getByRole('radio', { name: 'Last 7 days', exact: true });
        await expect(period.getAttribute('aria-checked')).resolves.toBe('true');
        await expect(period.evaluate((node) => node.getBoundingClientRect().height)).resolves.toBeGreaterThanOrEqual(44);
        const tokensCard = page.getByTestId('usage-stat-tokens');
        const costCard = page.getByTestId('usage-stat-cost');
        const expectedFill = await page.evaluate((color) => { const node = document.createElement('div'); node.style.color = color; document.body.appendChild(node); const resolved = getComputedStyle(node).color; node.remove(); return resolved; }, theme.colors.kilv.bgRaised);
        for (const card of [tokensCard, costCard]) {
            await expect(card.evaluate((node) => getComputedStyle(node).backgroundColor)).resolves.toBe(expectedFill);
            await expect(card.evaluate((node) => getComputedStyle(node).borderRadius)).resolves.toBe(`${theme.kilv.radiusCard}px`);
            await expect(card.evaluate((node) => getComputedStyle(node).borderTopWidth)).resolves.toBe('1px');
        }
        const tokenBounds = (await tokensCard.boundingBox())!;
        const costBounds = (await costCard.boundingBox())!;
        if (viewport.width === 390) expect(costBounds.y).toBeGreaterThanOrEqual(tokenBounds.y + tokenBounds.height);
        else expect(costBounds.y).toBe(tokenBounds.y);
        await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).resolves.toBe(true);

        const bar = page.getByTestId('usage-chart-bar').first();
        const colorOf = async (color: string) => page.evaluate((value) => { const node = document.createElement('div'); node.style.color = value; document.body.appendChild(node); const result = getComputedStyle(node).color; node.remove(); return result; }, color);
        await expect(bar.evaluate((node) => getComputedStyle(node).backgroundColor)).resolves.toBe(await colorOf(theme.colors.kilv.accent));
        await page.getByRole('radio', { name: 'Cost', exact: true }).click();
        await expect(bar.evaluate((node) => getComputedStyle(node).backgroundColor)).resolves.toBe(await colorOf(theme.colors.kilv.accentHot));
        await page.getByRole('radio', { name: 'Today', exact: true }).click();
        await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { __USAGE_REQUESTS__: unknown[] }).__USAGE_REQUESTS__.length)).toBe(2);
        await expect(page.getByRole('radio', { name: 'Cost', exact: true }).getAttribute('aria-checked')).resolves.toBe('true');
        await page.getByText('grok', { exact: true }).scrollIntoViewIfNeeded();
        await expect(page.getByText('grok', { exact: true }).isVisible()).resolves.toBe(true);
        if (evidence) await page.screenshot({ path: resolve(evidence, `usage-providers-${mode}-${viewport.width}.png`) });
        if (viewport.width === 390) {
            await page.getByRole('button', { name: 'Back', exact: true }).click();
            await expect(page.getByTestId('settings-section-usage').isVisible()).resolves.toBe(true);
        }
        expect(errors).toEqual([]);
        await page.close();
    }, 20_000);
});
