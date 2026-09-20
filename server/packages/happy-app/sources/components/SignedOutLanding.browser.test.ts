import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import en from '@/text/locales/en.json';
import cn from '@/text/locales/cn.json';
import de from '@/text/locales/de.json';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const catalogs = { en, cn, de };
const virtualModules: Record<string, string> = {
    'react-native': `export * from 'react-native-web';`,
    'react-native-unistyles': `
        import { StyleSheet as NativeStyleSheet } from 'react-native-web';
        import { lightTheme, darkTheme } from '@/theme';
        const theme = globalThis.__LANDING_THEME__ === 'dark' ? darkTheme : lightTheme;
        export const StyleSheet = {
            ...NativeStyleSheet,
            create: (factory) => typeof factory === 'function' ? factory(theme, {}) : factory,
        };
        export const useUnistyles = () => ({ theme });
        export const withUnistyles = Component => Component;
    `,
    'react-native-safe-area-context': `export const useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });`,
    'react-native-device-info': `export const getDeviceType = () => 'Handset';`,
    '@expo/vector-icons': `
        import React from 'react';
        export const Ionicons = ({ name, size, color }) => React.createElement('span', { 'data-icon': name, style: { width: size, height: size, color } });
    `,
    'expo-image': `
        import React from 'react';
        import { Image as NativeImage } from 'react-native';
        export const Image = ({ contentFit, tintColor, style, ...props }) => React.createElement(NativeImage, { ...props, resizeMode: contentFit, style: [style, { tintColor }] });
    `,
    'expo-crypto': `export const getRandomBytesAsync = async (size) => new Uint8Array(size).fill(42);`,
    'expo-router': `
        export const useSegments = () => [];
        export const useRouter = () => ({
            push(path) { history.pushState({}, '', path + location.search); dispatchEvent(new PopStateEvent('popstate')); },
            back() { history.back(); },
        });
    `,
    '@/auth/AuthContext': `export const useAuth = () => ({ isAuthenticated: false, login: async (_token, _secret, method) => { globalThis.__LOGIN_METHOD__ = method; } });`,
    '@/auth/authGetToken': `export const authGetToken = () => new Promise(resolve => { globalThis.__FINISH_CREATE__ = () => resolve('fixture-token'); });`,
    '@/auth/authQRStart': `export const generateAuthKeyPair = () => ({ publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) }); export const authQRStart = () => new Promise(() => {});`,
    '@/auth/authQRWait': `export const authQRWait = () => new Promise(() => {});`,
    '@/encryption/base64': `export const encodeBase64 = () => 'fixture-key'; export const decodeBase64 = () => new Uint8Array(32);`,
    '@/components/MainView': `export const MainView = () => null;`,
    '@/components/qr/QRCode': `export const QRCode = () => null;`,
    '@/components/MobileGlass': `import { View } from 'react-native'; export const MobileGlassSurface = View;`,
    '@/components/navigation/MobileHeaderScrim': `export const MobileHeaderScrim = () => null; export const MOBILE_HOME_SCRIM_OVERLAY_OPACITY = 1; export const MOBILE_STRONG_HEADER_SCRIM_UNDERLAP_OPACITY = .96; export const MOBILE_STRONG_HEADER_SCRIM_RESTING_OPACITY = .8;`,
    '@/components/ShortcutHints': `export const ShortcutHintBadge = () => null; export const useShortcutHints = () => ({ visible: false });`,
    '@/components/StatusDot': `export const StatusDot = () => null;`,
    '@/sync/storage': `export const useSocketStatus = () => ({ status: 'connected' });`,
    '@/sync/serverConfig': `export const getServerInfo = () => ({ isCustom: false });`,
    '@/modal': `export const Modal = { alert() {} };`,
    '@/track': `export const trackAccountCreated = () => { globalThis.__ACCOUNT_CREATED__ = true; }; export const trackAccountRestored = () => {};`,
    '@/text': `
        import en from '@/text/locales/en.json'; import cn from '@/text/locales/cn.json'; import de from '@/text/locales/de.json';
        const catalog = ({ en, cn, de })[globalThis.__LANDING_LOCALE__] ?? en;
        export const t = (key) => key.split('.').reduce((value, part) => value?.[part], catalog) ?? key;
    `,
};

const fixturePlugin: Plugin = {
    name: 'signed-out-production-routes',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, (args) => {
            const normalized = args.path.startsWith('.') && args.resolveDir.startsWith(resolve(appRoot, 'sources'))
                ? `@/${relative(resolve(appRoot, 'sources'), resolve(args.resolveDir, args.path))}` : args.path;
            if (normalized in virtualModules) return { path: normalized, namespace: 'fixture-stub' };
            if (args.path.startsWith('@/')) {
                const sourcePath = resolve(appRoot, 'sources', args.path.slice(2));
                const path = [sourcePath, `${sourcePath}.ts`, `${sourcePath}.tsx`].find(existsSync);
                if (!path) throw new Error(`missing fixture source: ${args.path}`);
                return { path };
            }
            return null;
        });
        bundle.onLoad({ filter: /.*/, namespace: 'fixture-stub' }, (args) => ({ contents: virtualModules[args.path], loader: 'tsx', resolveDir: appRoot }));
    },
};

// These are production signed-out and restore routes with network/auth state
// replaced at the service boundary. This does not prove live account creation,
// native safe areas, actual iPhone zoom, or hardware keyboard behavior.
describe('KILV signed-out routes browser journeys', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            stdin: {
                contents: `
                    import React from 'react'; import { createRoot } from 'react-dom/client';
                    import Home from '@/app/(app)/index';
                    import RestoreKey from '@/app/(app)/restore/manual';
                    import RestoreDevice from '@/app/(app)/restore/index';
                    function App() {
                        const route = React.useSyncExternalStore(callback => { addEventListener('popstate', callback); return () => removeEventListener('popstate', callback); }, () => location.pathname);
                        return route === '/restore/manual' ? <RestoreKey /> : route === '/restore' ? <RestoreDevice /> : <Home />;
                    }
                    createRoot(document.getElementById('root')).render(<App />);
                `,
                loader: 'tsx', resolveDir: appRoot,
            },
            bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
            define: { __DEV__: 'false', 'process.env.EXPO_OS': '"web"', 'process.env.NODE_ENV': '"test"' },
            loader: { '.png': 'dataurl', '.webp': 'dataurl' }, plugins: [fixturePlugin],
        });
        const script = bundle.outputFiles[0].text;
        const fonts = ['SpaceGrotesk-Regular', 'SpaceGrotesk-Medium', 'SpaceGrotesk-SemiBold', 'JetBrainsMono-Regular', 'JetBrainsMono-SemiBold'];
        const fontCss = fonts.map(font => `@font-face{font-family:'${font}';src:url(data:font/ttf;base64,${readFileSync(resolve(appRoot, 'sources/assets/fonts', font + '.ttf')).toString('base64')}) format('truetype');}`).join('');
        server = createServer((request, response) => {
            const params = new URL(request.url ?? '/', 'http://fixture').searchParams;
            const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
            const locale = params.get('locale') ?? 'en';
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${fontCss}html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style><main id="root"></main><script>globalThis.__LANDING_THEME__=${JSON.stringify(theme)};globalThis.__LANDING_LOCALE__=${JSON.stringify(locale)};globalThis.global=globalThis;${script}</script>`);
        });
        await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('landing fixture did not bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({ ...(executablePath ? { executablePath } : { channel: 'chrome' }), headless: true, args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
    }, 30_000);

    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>(closed => server.close(() => closed()));
    });

    const matrix = (['light', 'dark'] as const).flatMap(theme => (['en', 'cn', 'de'] as const).flatMap(locale => ([{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 800 }]).map(viewport => ({ theme, locale, viewport }))));
    it.each(matrix)('preserves account entries, input state and readable geometry: $theme/$locale/$viewport.width', async ({ theme, locale, viewport }) => {
        const labels = catalogs[locale];
        const page = await browser.newPage({ viewport });
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${origin}/?theme=${theme}&locale=${locale}`);
        await page.getByText(labels.welcome.title, { exact: true }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        const create = page.getByRole('button', { name: labels.welcome.createAccount, exact: true });
        const accountKey = page.getByRole('button', { name: labels.navigation.restoreWithSecretKey, exact: true });
        const linkedDevice = page.getByRole('button', { name: labels.welcome.loginWithMobileApp, exact: true });
        for (const button of [create, accountKey, linkedDevice]) {
            const bounds = await button.boundingBox();
            expect(bounds?.height).toBeGreaterThanOrEqual(44);
            expect(bounds?.width).toBeGreaterThan(200);
            const textBounds = await button.locator('[dir="auto"]').last().evaluate(element => ({
                scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
                scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
            }));
            expect(textBounds.scrollWidth).toBeLessThanOrEqual(textBounds.clientWidth + 1);
            expect(textBounds.scrollHeight).toBeLessThanOrEqual(textBounds.clientHeight + 1);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const screenshotDir = process.env.HAPPYHERD_KILV_SCREENSHOTS;
        if (screenshotDir) {
            mkdirSync(screenshotDir, { recursive: true });
            await page.screenshot({ path: resolve(screenshotDir, `landing-${theme}-${locale}-${viewport.width}.png`), fullPage: true });
        }
        await accountKey.click();
        const input = page.getByRole('textbox');
        await input.waitFor();
        await input.fill('draft account key');
        await input.focus();
        expect(await input.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
        await page.setViewportSize({ width: viewport.width === 1440 ? 390 : 800, height: viewport.height });
        expect(await input.inputValue()).toBe('draft account key');
        await page.goBack();
        await page.setViewportSize(viewport);
        await linkedDevice.click();
        await page.getByText(labels.uiCopy.step1OpenHappyOnYourMobileDevice, { exact: false }).waitFor();
        await page.getByRole('button', { name: labels.uiCopy.restoreWithSecretKeyInstead, exact: true }).click();
        await page.getByRole('textbox').waitFor();
        await page.goto(`${origin}/?theme=${theme}&locale=${locale}`);
        await create.click();
        await page.waitForFunction(() => typeof (window as any).__FINISH_CREATE__ === 'function');
        expect(await create.getAttribute('aria-disabled')).toBe('true');
        await page.evaluate(() => (window as any).__FINISH_CREATE__());
        await page.waitForFunction(() => (window as any).__ACCOUNT_CREATED__ === true);
        expect(await page.evaluate(() => (window as any).__LOGIN_METHOD__)).toBe('new-account');
        expect(errors).toEqual([]);
        await page.close();
    }, 20_000);
});
