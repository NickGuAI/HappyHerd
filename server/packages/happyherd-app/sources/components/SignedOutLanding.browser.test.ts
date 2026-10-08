import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Route } from 'playwright-core';
import en from '@/text/locales/en.json';
import cn from '@/text/locales/cn.json';
import de from '@/text/locales/de.json';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const catalogs = { en, cn, de };
// Keep the last awaited operation visible when Vitest's whole-case deadline
// expires before Playwright reports an operation-specific error. Labels contain
// fixture phases only; never log account inputs or authentication responses.
function traceJourney(journey: string) {
    const started = performance.now();
    return (phase: string) => console.info('[signed-out-phase]', JSON.stringify({
        journey, phase, elapsedMs: Math.round(performance.now() - started),
    }));
}

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
    '@/auth/AuthContext': `
        import React from 'react';
        let authenticated = false;
        const listeners = new Set();
        export const useAuth = () => ({
            isAuthenticated: React.useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => authenticated),
            login: async (_token, _secret, method) => { globalThis.__LOGIN_METHOD__ = method; authenticated = true; listeners.forEach(listener => listener()); },
        });
    `,
    '@/auth/authChallenge': `export const authChallenge = () => ({ challenge: new Uint8Array(32), signature: new Uint8Array(64), publicKey: new Uint8Array(32) });`,
    '@/sync/apiSocket': `export const getHappyHerdClientId = () => 'fixture-client';`,
    '@/auth/authQRStart': `export const generateAuthKeyPair = () => ({ publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) }); export const authQRStart = () => new Promise(() => {});`,
    '@/auth/authQRWait': `export const authQRWait = () => new Promise(() => {});`,
    '@/encryption/base64': `export const encodeBase64 = () => 'fixture-key'; export const decodeBase64 = () => new Uint8Array(32);`,
    '@/components/herd/pages/HerdLanding': `import React from 'react'; export const HerdLanding = () => React.createElement('div', { 'data-testid': 'authenticated-destination' }, 'Authenticated destination fixture');`,
    '@/components/herd/mobile/PhoneHome': `export { HerdLanding as PhoneHome } from '@/components/herd/pages/HerdLanding';`,
    '@/components/qr/QRCode': `export const QRCode = () => null;`,
    '@/components/MobileGlass': `import { View } from 'react-native'; export const MobileGlassSurface = View;`,
    '@/components/navigation/MobileHeaderScrim': `export const MobileHeaderScrim = () => null; export const MOBILE_HOME_SCRIM_OVERLAY_OPACITY = 1; export const MOBILE_STRONG_HEADER_SCRIM_UNDERLAP_OPACITY = .96; export const MOBILE_STRONG_HEADER_SCRIM_RESTING_OPACITY = .8;`,
    '@/components/ShortcutHints': `export const ShortcutHintBadge = () => null; export const useShortcutHints = () => ({ visible: false });`,
    '@/components/StatusDot': `export const StatusDot = () => null;`,
    '@/sync/storage': `export const useSocketStatus = () => ({ status: 'connected' });`,
    '@/sync/serverConfig': `export const getServerInfo = () => ({ isCustom: false }); export const getServerUrl = () => location.origin;`,
    '@/components/AnimatedOverlay': `export const AnimatedBlurBackdrop = () => null;`,
    '@/modal/components/CustomModal': `export const CustomModal = () => null;`,
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
                const path = [`${sourcePath}.ts`, `${sourcePath}.tsx`, resolve(sourcePath, 'index.ts'), resolve(sourcePath, 'index.tsx'), sourcePath].find(existsSync);
                if (!path) throw new Error(`missing fixture source: ${args.path}`);
                return { path };
            }
            return null;
        });
        bundle.onLoad({ filter: /.*/, namespace: 'fixture-stub' }, (args) => ({ contents: virtualModules[args.path], loader: 'tsx', resolveDir: appRoot }));
    },
};

// Production signed-out/restore routes, RoundButton, modal host and authGetToken
// run in Chromium. Signing, auth storage and authenticated destinations are doubles;
// Playwright controls HTTP responses. This proves the welcome action and login
// handoff, not a live authenticated app, native safe areas or actual iPhone zoom.
describe('KILV signed-out routes browser journeys', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const phase = traceJourney('setup');
        phase('bundle');
        const bundle = await build({
            stdin: {
                contents: `
                    import React from 'react'; import { createRoot } from 'react-dom/client';
                    import Home from '@/app/(app)/index';
                    import RestoreKey from '@/app/(app)/restore/manual';
                    import RestoreDevice from '@/app/(app)/restore/index';
                    import { ModalProvider } from '@/modal';
                    function App() {
                        const route = React.useSyncExternalStore(callback => { addEventListener('popstate', callback); return () => removeEventListener('popstate', callback); }, () => location.pathname);
                        return route === '/restore/manual' ? <RestoreKey /> : route === '/restore' ? <RestoreDevice /> : <Home />;
                    }
                    createRoot(document.getElementById('root')).render(<ModalProvider><App /></ModalProvider>);
                `,
                loader: 'tsx', resolveDir: appRoot,
            },
            bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
            define: { __DEV__: 'false', 'process.env.EXPO_OS': '"web"', 'process.env.NODE_ENV': '"test"', 'process.env': '{}' },
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
        phase('server-listen');
        await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('landing fixture did not bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        phase('browser-launch');
        browser = await chromium.launch({ ...(executablePath ? { executablePath } : { channel: 'chrome' }), headless: true, args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
        phase('complete');
    }, 30_000);

    afterAll(async () => {
        const phase = traceJourney('teardown');
        phase('browser-close');
        await browser?.close();
        phase('server-close');
        if (server) await new Promise<void>(closed => server.close(() => closed()));
        phase('complete');
    });

    const matrix = (['light', 'dark'] as const).flatMap(theme => (['en', 'cn', 'de'] as const).flatMap(locale => ([{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 800 }]).map(viewport => ({ theme, locale, viewport }))));
    it.each(matrix)('preserves account entries, input state and readable geometry: $theme/$locale/$viewport.width', async ({ theme, locale, viewport }) => {
        const phase = traceJourney(`${theme}/${locale}/${viewport.width}`);
        const labels = catalogs[locale];
        phase('page-create');
        const page = await browser.newPage({ viewport });
        const errors: string[] = [];
        page.on('pageerror', error => { errors.push(error.message); console.error('Signed-out fixture page error:', error.message); });
        phase('welcome-navigation');
        await page.goto(`${origin}/?theme=${theme}&locale=${locale}`);
        phase('welcome-title');
        await page.getByText(labels.welcome.title, { exact: true }).waitFor();
        phase('welcome-fonts');
        await page.evaluate(() => document.fonts.ready);
        const create = page.getByRole('button', { name: labels.welcome.createAccount, exact: true });
        const accountKey = page.getByRole('button', { name: labels.navigation.restoreWithSecretKey, exact: true });
        const linkedDevice = page.getByRole('button', { name: labels.welcome.loginWithMobileApp, exact: true });
        for (const [entry, button] of [['create', create], ['account-key', accountKey], ['linked-device', linkedDevice]] as const) {
            phase(`geometry-${entry}-button`);
            const bounds = await button.boundingBox();
            expect(bounds?.height).toBeGreaterThanOrEqual(44);
            expect(bounds?.width).toBeGreaterThan(200);
            phase(`geometry-${entry}-text`);
            const textBounds = await button.locator('[dir="auto"]').last().evaluate(element => ({
                scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
                scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
            }));
            expect(textBounds.scrollWidth).toBeLessThanOrEqual(textBounds.clientWidth + 1);
            expect(textBounds.scrollHeight).toBeLessThanOrEqual(textBounds.clientHeight + 1);
        }
        phase('geometry-page');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const screenshotDir = process.env.HAPPYHERD_KILV_SCREENSHOTS;
        if (screenshotDir) {
            mkdirSync(screenshotDir, { recursive: true });
            phase('welcome-screenshot');
            await page.screenshot({ path: resolve(screenshotDir, `landing-${theme}-${locale}-${viewport.width}.png`), fullPage: true });
        }
        phase('account-key-click');
        await accountKey.click();
        const input = page.getByRole('textbox');
        phase('account-key-input');
        await input.waitFor();
        phase('account-key-fill');
        await input.fill('draft account key');
        phase('account-key-focus');
        await input.focus();
        phase('account-key-font-size');
        expect(await input.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
        phase('account-key-resize');
        await page.setViewportSize({ width: viewport.width === 1440 ? 390 : 800, height: viewport.height });
        phase('account-key-retained-input');
        expect(await input.inputValue()).toBe('draft account key');
        phase('welcome-back');
        await page.goBack();
        phase('welcome-resize');
        await page.setViewportSize(viewport);
        phase('linked-device-click');
        await linkedDevice.click();
        phase('linked-device-instructions');
        await page.getByText(labels.uiCopy.step1OpenHappyHerdOnYourMobileDevice, { exact: false }).waitFor();
        phase('linked-device-manual-click');
        await page.getByRole('button', { name: labels.uiCopy.restoreWithSecretKeyInstead, exact: true }).click();
        phase('linked-device-manual-input');
        await page.getByRole('textbox').waitFor();
        phase('create-navigation');
        await page.goto(`${origin}/?theme=${theme}&locale=${locale}`);
        let pending: Route | undefined;
        phase('create-interception');
        await page.route('**/v1/auth', route => { pending = route; });
        phase('create-click');
        await create.click();
        phase('create-request');
        await expect.poll(() => pending !== undefined).toBe(true);
        phase('create-disabled');
        expect(await create.getAttribute('aria-disabled')).toBe('true');
        phase('create-response');
        await pending!.fulfill({ json: { token: 'fixture-token' } });
        phase('create-completion');
        await page.waitForFunction(() => (window as any).__ACCOUNT_CREATED__ === true);
        phase('create-login-method');
        expect(await page.evaluate(() => (window as any).__LOGIN_METHOD__)).toBe('new-account');
        expect(errors).toEqual([]);
        phase('page-close');
        await page.close();
        phase('complete');
    }, 20_000);

    const recoveryMatrix = (['en', 'cn', 'de'] as const).flatMap(locale => [
        { surface: 'Web Desktop', viewport: { width: 1440, height: 900 }, locale },
        { surface: 'Web Mobile', viewport: { width: 390, height: 844 }, locale },
    ]);
    it.each(recoveryMatrix)('shows account creation failures and recovers through the welcome action: $surface/$locale', async ({ viewport, locale }) => {
        const labels = catalogs[locale];
        const page = await browser.newPage({ viewport });
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        const requests: Route[] = [];
        await page.route('**/v1/auth', route => { requests.push(route); });
        await page.goto(`${origin}/?locale=${locale}`);
        const create = page.getByRole('button', { name: labels.welcome.createAccount, exact: true });
        await create.waitFor();

        // Real DOM clicks in the same turn exercise the pre-render duplicate window.
        await create.evaluate(element => { for (let i = 0; i < 8; i++) (element as HTMLElement).click(); });
        await expect.poll(() => requests.length).toBe(1);
        expect(await create.getAttribute('aria-disabled')).toBe('true');
        expect(await create.getAttribute('aria-busy')).toBe('true');
        expect(await page.getByRole('progressbar').count()).toBe(1);
        await create.evaluate(element => { for (let i = 0; i < 8; i++) (element as HTMLElement).click(); });
        expect(requests).toHaveLength(1);
        await requests[0].abort('internetdisconnected');
        const message = page.getByText(labels.welcome.accountCreationFailed, { exact: true });
        await message.waitFor();
        await page.getByText(labels.common.error, { exact: true }).waitFor();
        const retry = page.getByRole('button', { name: labels.common.retry, exact: true });
        const cancel = page.getByRole('button', { name: labels.common.cancel, exact: true });
        await retry.waitFor();
        // Wait for the production modal fade, so evidence captures the visible error.
        await expect.poll(() => message.evaluate(element => {
            let opacity = 1;
            for (let current: Element | null = element; current; current = current.parentElement) {
                opacity *= Number(getComputedStyle(current).opacity);
            }
            return opacity;
        })).toBe(1);
        expect(await page.getByRole('progressbar').count()).toBe(0);
        expect(await page.evaluate(() => (window as any).__LOGIN_METHOD__)).toBeUndefined();
        for (const action of [retry, cancel]) {
            const bounds = await action.boundingBox();
            expect(bounds?.height).toBeGreaterThanOrEqual(44);
            expect(bounds!.x).toBeGreaterThanOrEqual(0);
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
        }
        const screenshotDir = process.env.HAPPYHERD_KILV_SCREENSHOTS;
        if (screenshotDir) {
            mkdirSync(screenshotDir, { recursive: true });
            await page.screenshot({ path: resolve(screenshotDir, `create-account-error-${locale}-${viewport.width}.png`), fullPage: true });
        }

        // Cancel resets the action, and keyboard activation reaches the same button.
        await cancel.click();
        await message.waitFor({ state: 'hidden' });
        expect(await create.getAttribute('aria-disabled')).not.toBe('true');
        expect(await create.getAttribute('aria-busy')).not.toBe('true');
        await create.focus();
        await page.keyboard.press('Enter');
        await expect.poll(() => requests.length).toBe(2);
        await requests[1].fulfill({ status: 503, json: { error: 'private-server-diagnostic', token: 'private-token-do-not-display' } });
        await message.waitFor();
        expect(await page.getByText('private-server-diagnostic', { exact: false }).count()).toBe(0);
        expect(await page.getByText('private-token-do-not-display', { exact: false }).count()).toBe(0);
        expect(await page.evaluate(() => (window as any).__ACCOUNT_CREATED__)).toBeUndefined();

        await retry.click();
        await message.waitFor({ state: 'hidden' });
        await expect.poll(() => requests.length).toBe(3);
        expect(await create.getAttribute('aria-disabled')).toBe('true');
        expect(await create.getAttribute('aria-busy')).toBe('true');
        await create.evaluate(element => { for (let i = 0; i < 8; i++) (element as HTMLElement).click(); });
        expect(requests).toHaveLength(3);
        await requests[2].fulfill({ json: { token: 'fixture-token' } });
        await page.getByTestId('authenticated-destination').waitFor();
        await expect.poll(() => page.evaluate(() => (window as any).__ACCOUNT_CREATED__)).toBe(true);
        expect(await page.evaluate(() => (window as any).__LOGIN_METHOD__)).toBe('new-account');
        expect(await create.count()).toBe(0);
        expect(await message.count()).toBe(0);
        expect(errors).toEqual([]);
        await page.close();
    }, 20_000);

});
