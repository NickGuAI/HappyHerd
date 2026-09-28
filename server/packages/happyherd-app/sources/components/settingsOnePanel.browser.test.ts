import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import en from '@/text/locales/en.json';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');

/** The English catalog, with the plural select the production `t` resolves. */
function label(key: string, params: Record<string, string | number> = {}): string {
    let value: any = key.split('.').reduce((node: any, part) => node?.[part], en);
    if (value && typeof value === 'object' && value.select) {
        value = value.select.cases[params[value.select.param] === 1 ? 'one' : 'other'] ?? value.select.cases.other;
    }
    if (typeof value !== 'string') throw new Error(`missing catalog key ${key}`);
    return Object.entries(params).reduce((text, [name, replacement]) => text.replaceAll(`{${name}}`, String(replacement)), value);
}

// Settings has no home page (UI overhaul): these routes render for real, and only
// the platform, the account and machine state, and the network are stand-ins.
const virtualModules: Record<string, string> = {
    'react-native': `
        import * as ReactNativeWeb from 'react-native-web';
        export * from 'react-native-web';
        const platformOs = globalThis.__PLATFORM__ ?? 'web';
        export const Platform = {
            ...ReactNativeWeb.Platform,
            OS: platformOs,
            select: (options) => options[platformOs] ?? options.default,
        };
    `,
    'react-native-unistyles': `
        import { lightTheme, darkTheme } from '@/theme';
        const theme = globalThis.__THEME__ === 'dark' ? darkTheme : lightTheme;
        export const StyleSheet = {
            create: (factory) => typeof factory === 'function' ? factory(theme, {}) : factory,
            hairlineWidth: 1,
        };
        export const useUnistyles = () => ({ theme });
    `,
    'react-native-reanimated': `
        import React from 'react';
        const Animated = { createAnimatedComponent: (component) => component };
        export default Animated;
        export const cancelAnimation = () => {};
        export const Easing = { out: (value) => value, quad: 'quad' };
        export const useAnimatedStyle = (factory) => factory();
        export const useSharedValue = (value) => React.useRef({ value }).current;
        export const withSpring = (value) => value;
        export const withTiming = (value) => value;
    `,
    '@expo/vector-icons': `
        import React from 'react';
        export const Ionicons = ({ name }) => React.createElement('span', { 'data-icon': name });
        export const Octicons = Ionicons;
    `,
    'react-native-device-info': `export const getDeviceType = () => 'Handset';`,
    'expo-image': `import { View } from 'react-native'; export const Image = View;`,
    'expo-constants': `export default { expoConfig: { version: '1.2.2', runtimeVersion: '21', extra: { app: {} } } };`,
    'expo-clipboard': `export const setStringAsync = async () => {};`,
    'expo-crypto': `export const randomUUID = () => crypto.randomUUID();`,
    // A history-backed router: push and navigate add an entry, replace and Redirect swap it.
    'expo-router': `
        import React from 'react';
        const listeners = new Set();
        const notify = () => listeners.forEach((listener) => listener());
        addEventListener('popstate', notify);
        addEventListener('fixture-route', notify);
        const go = (path, mode) => {
            const route = typeof path === 'string' ? path : path.pathname;
            globalThis.__ROUTES__.push(mode + ' ' + route);
            history[mode === 'replace' ? 'replaceState' : 'pushState']({}, '', route);
            dispatchEvent(new Event('fixture-route'));
        };
        export const router = {
            push: (path) => go(path, 'push'),
            navigate: (path) => go(path, 'navigate'),
            replace: (path) => go(path, 'replace'),
            back: () => history.back(),
            canGoBack: () => true,
        };
        export const useRouter = () => router;
        export const usePathname = () => React.useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => location.pathname);
        export function Redirect({ href }) {
            React.useEffect(() => { router.replace(href); }, [href]);
            return null;
        }
        // Each screen's options reach the stand-in header above the page.
        export const Stack = { Screen: ({ options }) => { React.useLayoutEffect(() => { globalThis.__SET_HEADER__?.(options); }, [options]); return null; } };
    `,
    '@react-navigation/native': `
        import React from 'react';
        export const useFocusEffect = (callback) => React.useEffect(() => callback(), [callback]);
    `,
    // One stable value, as the real provider holds it.
    '@/auth/AuthContext': `const auth = { credentials: { token: 'test', secret: '' }, isAuthenticated: true, logout() {} }; export const useAuth = () => auth;`,
    '@/components/Avatar': `import { View } from 'react-native'; export const Avatar = View;`,
    '@/components/StyledText': `import { Text as NativeText } from 'react-native'; export const Text = NativeText;`,
    '@/components/AccountKeyPanel': `export const AccountKeyPanel = () => null;`,
    '@/components/layout': `export const layout = { maxWidth: 800 };`,
    '@/constants/Typography': `export const Typography = { default: () => ({}), mono: () => ({}), logo: () => ({}) };`,
    '@/constants/product': `
        export const PRODUCT = {
            displayName: 'HappyHerd',
            issueUrl: 'https://example.com/happyherd/issues/new',
            repositoryDisplay: 'NickGuAI/HappyHerd',
            repositoryUrl: 'https://github.com/NickGuAI/HappyHerd',
            supportUrl: 'https://example.com/support',
        };
    `,
    '@/hooks/useConnectTerminal': `export const useConnectTerminal = () => ({ connectTerminal() { globalThis.__STATE__.calls.push('connectTerminal'); }, connectWithUrl() {}, isLoading: false });`,
    '@/hooks/useConnectAccount': `export const useConnectAccount = () => ({ connectAccount() {}, isLoading: false });`,
    '@/hooks/useHappyHerdAction': `export const useHappyHerdAction = (action) => [false, action];`,
    '@/modal': `
        export const Modal = {
            alert(title, message) { globalThis.__STATE__.calls.push('alert ' + title); },
            confirm: async () => false,
            prompt: async () => { globalThis.__STATE__.calls.push('prompt'); return undefined; },
        };
    `,
    '@/sync/apiGithub': `
        export const disconnectGitHub = async () => {};
        export const getGitHubOAuthParams = async () => ({ url: 'https://github.com/login/oauth/authorize?client_id=fixture' });
    `,
    '@/sync/apiServices': `export const disconnectService = async () => {};`,
    '@/sync/apiPush': `export const fetchPushTokens = async () => [];`,
    '@/sync/pushRegistration': `
        export const getCurrentExpoPushToken = async () => null;
        export const getCurrentPushDeviceMetadata = () => ({ platform: 'web' });
        export const getPushPermissionInfo = async () => ({ status: 'unsupported', granted: false, canAskAgain: false });
        export const requestPushPermissionOrOpenSettings = async () => ({ granted: false, permission: { status: 'unsupported', granted: false } });
        export const removePushToken = async () => {};
        export const syncCurrentPushToken = async () => ({ permission: { status: 'unsupported', granted: false } });
    `,
    '@/sync/profile': `
        export const getAvatarUrl = () => undefined;
        export const getBio = () => undefined;
        export const getDisplayName = (profile) => profile.firstName ? profile.firstName + ' Tester' : null;
    `,
    '@/sync/serverConfig': `
        export const isUsingCustomServer = () => globalThis.__STATE__.customServer;
        export const getServerUrl = () => 'https://server.example';
    `,
    '@/sync/storage': `
        import React from 'react';
        const listen = (callback) => { addEventListener('fixture-state', callback); return () => removeEventListener('fixture-state', callback); };
        const read = (key) => React.useSyncExternalStore(listen, () => globalThis.__STATE__[key]);
        export const useAllMachines = () => read('machines');
        export const useProfile = () => read('profile');
        export const useSocketStatus = () => ({ status: read('socketStatus') });
        export const useEntitlement = () => false;
        export const useSetting = (key) => key === 'experiments' ? read('experiments') : false;
        export const useSettingMutable = () => [false, () => {}];
        export const useLocalSettingMutable = (key) => [read(key), (value) => globalThis.__UPDATE__({ [key]: value })];
    `,
    '@/sync/sync': `
        export const sync = {
            anonID: 'anon-fixture',
            serverID: 'server-fixture',
            presentPaywall: async () => ({ success: true }),
            refreshProfile: async () => {},
        };
    `,
    '@/sync/apiSocket': `
        export const apiSocket = {
            getActiveEndpoint: () => 'https://server.example',
            async machineRPC(machineId) { return { machineId, host: 'fixture' }; },
        };
    `,
    '@/sync/persistence': `
        export const loadNewSessionDraft = () => null;
        export const saveNewSessionDraft = () => {};
    `,
    '@/text': `
        import catalog from '@/text/locales/en.json';
        export const t = (key, params = {}) => {
            let text = key.split('.').reduce((value, part) => value?.[part], catalog) ?? key;
            if (text && typeof text === 'object' && text.select) text = text.select.cases[params[text.select.param] === 1 ? 'one' : 'other'] ?? text.select.cases.other;
            return Object.entries(params).reduce((value, [name, replacement]) => value.replaceAll('{' + name + '}', String(replacement)), text);
        };
    `,
    '@/track': `export const trackPaywallButtonClicked = () => {}; export const trackWhatsNewClicked = () => {};`,
};

const fixturePlugin: Plugin = {
    name: 'settings-one-panel-fixture',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in virtualModules) return { path: args.path, namespace: 'fixture-stub' };
            if (args.path.startsWith('@/')) {
                const sourcePath = resolve(appRoot, 'sources', args.path.slice(2));
                const path = [sourcePath, `${sourcePath}.ts`, `${sourcePath}.tsx`, `${sourcePath}.json`].find(existsSync);
                if (!path) throw new Error(`missing fixture source: ${args.path}`);
                return { path };
            }
            return null;
        });
        bundle.onLoad({ filter: /.*/, namespace: 'fixture-stub' }, (args) => ({
            contents: virtualModules[args.path],
            loader: 'tsx',
            resolveDir: appRoot,
        }));
    },
};

const entry = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import SettingsScreen from '@/app/(app)/settings/index';
    import AccountScreen from '@/app/(app)/settings/account';
    import AboutScreen from '@/app/(app)/settings/about';
    import ConnectionsScreen from '@/app/(app)/settings/connections';
    import { router } from 'expo-router';
    globalThis.__ROUTES__ = [];
    globalThis.__STATE__ = {
        machines: [
            { id: 'studio-mac', active: true, activeAt: Date.now(), metadata: { host: 'studio-mac', displayName: 'Studio Mac', platform: 'darwin', devicePairingProtocolVersion: 1 } },
            { id: 'old-laptop', active: false, activeAt: Date.now() - 86400000, metadata: { host: 'old-laptop', displayName: 'Old Laptop', platform: 'linux', devicePairingProtocolVersion: 1 } },
        ],
        profile: { id: 'profile-test', firstName: 'Ada', avatar: null, connectedServices: [], github: null },
        socketStatus: 'connected',
        experiments: false,
        devModeEnabled: false,
        customServer: false,
        calls: [],
        ...(globalThis.__INITIAL__ ?? {}),
    };
    globalThis.__UPDATE__ = (patch) => { globalThis.__STATE__ = { ...globalThis.__STATE__, ...patch }; dispatchEvent(new Event('fixture-state')); };
    const subscribe = (fn) => { addEventListener('popstate', fn); addEventListener('fixture-route', fn); return () => { removeEventListener('popstate', fn); removeEventListener('fixture-route', fn); }; };
    const routes = {
        '/settings': SettingsScreen,
        '/settings/account': AccountScreen,
        '/settings/about': AboutScreen,
        '/settings/connections': ConnectionsScreen,
    };
    // The left panel's Settings button pushes /settings; this stand-in page does the same.
    function Start() {
        return <button onClick={() => router.push('/settings')}>Open Settings</button>;
    }
    function Header() {
        const [options, setOptions] = React.useState({});
        React.useLayoutEffect(() => { globalThis.__SET_HEADER__ = (next) => setOptions((current) => ({ ...current, ...next })); }, []);
        if (options.headerShown === false) return null;
        return <header data-testid="stack-header">{options.headerRight ? options.headerRight() : null}</header>;
    }
    function Host() {
        const path = React.useSyncExternalStore(subscribe, () => location.pathname);
        const Screen = routes[path];
        return (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Header key={path} />
                <div data-testid="route" data-path={path} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    {Screen ? <Screen /> : path === '/' ? <Start /> : <div>{'Page ' + path}</div>}
                </div>
            </div>
        );
    }
    createRoot(document.getElementById('root')).render(<Host />);
`;

type Open = { width: number; height: number; theme?: 'light' | 'dark'; platform?: string; path?: string; state?: Record<string, unknown> };

describe('Settings as one panel, rendered from its real routes', { timeout: 20_000 }, () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            stdin: { contents: entry, loader: 'tsx', resolveDir: appRoot },
            bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
            define: { __DEV__: 'false', 'process.env.EXPO_OS': '"web"', 'process.env.NODE_ENV': '"test"' },
            loader: { '.png': 'dataurl' }, plugins: [fixturePlugin],
        });
        const script = bundle.outputFiles[0].text;
        server = createServer((request, response) => {
            const params = new URL(request.url ?? '/', 'http://fixture').searchParams;
            const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
            const platform = params.get('platform') ?? 'web';
            const initial = params.get('state') ?? '{}';
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<style>html,body,#root{height:100%;margin:0}*{box-sizing:border-box}</style><main id="root"></main><script>globalThis.__THEME__=${JSON.stringify(theme)};globalThis.__PLATFORM__=${JSON.stringify(platform)};globalThis.__INITIAL__=${JSON.stringify(JSON.parse(initial))};globalThis.global=globalThis;${script}</script>`);
        });
        await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('fixture bind failed');
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
        if (server) await new Promise<void>((done) => server.close(() => done()));
    });

    async function open({ width, height, theme = 'light', platform = 'web', path = '/', state = {} }: Open) {
        const page = await browser.newPage({ viewport: { width, height } });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
        page.setDefaultTimeout(4_000);
        await page.addInitScript(() => {
            (window as any).__OPEN_CALLS__ = [];
            window.open = ((url?: string | URL) => { (window as any).__OPEN_CALLS__.push(String(url)); return null; }) as typeof window.open;
        });
        // Fixture state is in place before the first render, as the app's stores are.
        await page.goto(`${origin}${path}?theme=${theme}&platform=${platform}&state=${encodeURIComponent(JSON.stringify(state))}`);
        await page.getByTestId('route').waitFor();
        return { page, errors };
    }
    const pathname = (page: Page) => page.evaluate(() => location.pathname);
    const routeLog = (page: Page) => page.evaluate(() => (window as any).__ROUTES__ as string[]);
    const navLabels = (page: Page) => page.locator('[data-testid^="settings-nav-"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));

    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
        for (const theme of ['light', 'dark'] as const) {
            it(`opens Settings at Account beside the section list, with no Settings home, at ${viewport.width} px (${theme})`, async () => {
                const { page, errors } = await open({ ...viewport, theme });
                await page.getByRole('button', { name: 'Open Settings' }).click();
                await page.getByTestId('settings-frame').waitFor();
                expect(await pathname(page)).toBe('/settings/account');
                // /settings replaced itself, so the history holds one Settings entry.
                expect(await routeLog(page)).toEqual(['push /settings', 'replace /settings/account']);
                expect(await navLabels(page)).toEqual([
                    label('settings.account'), label('newSession.streamline.modeStreamline'), label('settings.appearance'),
                    label('uiCopy.agentDefaults'), label('settingsCredentials.title'), label('devicePairing.title'),
                    label('settings.featuresTitle'), label('settings.voiceAssistant'), label('settingsLanguage.title'),
                    label('settings.about'), label('happyHerd.commander.category'), label('settings.whatsNew'),
                ]);
                await expect(page.getByTestId('settings-nav-general').count()).resolves.toBe(0);
                await expect(page.getByTestId('settings-page-title').innerText()).resolves.toBe(label('settings.account'));
                // The profile card heads Account, above its first group, with no Account button of its own.
                const card = page.getByTestId('settings-profile-card');
                await card.getByText('Ada Tester', { exact: true }).waitFor();
                await expect(card.getByRole('button').count()).resolves.toBe(0);
                const cardBox = (await card.boundingBox())!;
                const firstGroup = (await page.getByText(label('settingsAccount.accountInformation'), { exact: true }).boundingBox())!;
                expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(firstGroup.y);
                // Back leaves Settings instead of bouncing through /settings.
                await page.goBack();
                await page.getByRole('button', { name: 'Open Settings' }).waitFor();
                expect(await pathname(page)).toBe('/');
                expect(errors).toEqual([]);
                await page.close();
            });
        }
    }

    it('connects Claude Code and GitHub from Account, and keeps disconnecting them once connected', async () => {
        const { page, errors } = await open({ width: 1440, height: 900, path: '/settings/account' });
        const accounts = page.getByText(label('settings.connectedAccounts'), { exact: true });
        await accounts.waitFor();
        await page.getByText(label('settings.connectAccount'), { exact: true }).click();
        expect(await pathname(page)).toBe('/settings/connect/claude');
        await page.goBack();
        await page.getByText(label('settings.connectGithubAccount'), { exact: true }).click();
        await page.waitForFunction(() => (window as any).__OPEN_CALLS__.length === 1);
        expect(await page.evaluate(() => (window as any).__OPEN_CALLS__)).toEqual(['https://github.com/login/oauth/authorize?client_id=fixture']);

        await page.evaluate(() => (window as any).__UPDATE__({
            profile: { id: 'profile-test', firstName: 'Ada', avatar: null, connectedServices: ['anthropic'], github: { id: 1, login: 'ada', name: 'Ada', avatar_url: '', email: 'ada@example.com' } },
        }));
        await page.getByText('@ada', { exact: true }).waitFor();
        await expect(page.getByText(label('settings.connectAccount'), { exact: true }).count()).resolves.toBe(0);
        await expect(page.getByText(label('settings.connectGithubAccount'), { exact: true }).count()).resolves.toBe(0);
        await expect(page.getByText(label('uiCopy.claudeCode_rfuptw'), { exact: true }).count()).resolves.toBe(1);
        await expect(page.getByText(label('settingsAccount.tapToDisconnect'), { exact: true }).count()).resolves.toBe(2);
        await expect(page.getByTestId('settings-profile-card').getByText('ada@example.com', { exact: true }).count()).resolves.toBe(1);
        expect(errors).toEqual([]);
        await page.close();
    });

    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        it(`lists machines on Connections, offline ones behind the toggle, each opening its page, at ${viewport.width} px`, async () => {
            const { page, errors } = await open({ ...viewport, path: '/settings/connections', state: { customServer: true } });
            await page.getByText('Studio Mac', { exact: true }).waitFor();
            await expect(page.getByText('Old Laptop', { exact: true }).count()).resolves.toBe(0);
            await page.getByText(label('settings.showOfflineMachines', { count: 1 }), { exact: true }).click();
            await page.getByText('Old Laptop', { exact: true }).waitFor();
            await page.getByText(label('settings.hideOfflineMachines'), { exact: true }).click();
            await expect(page.getByText('Old Laptop', { exact: true }).count()).resolves.toBe(0);
            await page.getByText('Studio Mac', { exact: true }).click();
            expect(await pathname(page)).toBe('/machine/studio-mac');
            await page.goBack();
            // A custom server's configuration: beside the page title on desktop, in the header row elsewhere.
            const server = page.getByTestId('settings-server-configuration');
            await server.waitFor();
            await expect(server.getAttribute('aria-label')).resolves.toBe(label('server.serverConfiguration'));
            await expect(page.getByTestId(viewport.width >= 1000 ? 'settings-frame' : 'stack-header').getByTestId('settings-server-configuration').count()).resolves.toBe(1);
            await server.click();
            expect(await pathname(page)).toBe('/server');
            expect(errors).toEqual([]);
            await page.close();
        });
    }

    it('signs a terminal in from Connections in the apps', async () => {
        const { page, errors } = await open({ width: 390, height: 844, platform: 'ios', path: '/settings/connections' });
        await page.getByText(label('settings.scanQrCodeToAuthenticate'), { exact: true }).click();
        await page.getByText(label('connect.enterUrlManually'), { exact: true }).click();
        await page.waitForFunction(() => (window as any).__STATE__.calls.includes('prompt'));
        expect(await page.evaluate(() => (window as any).__STATE__.calls)).toEqual(['connectTerminal', 'prompt']);
        expect(errors).toEqual([]);
        await page.close();
    });

    it('keeps the terminal rows out of Connections on the web', async () => {
        const { page } = await open({ width: 1440, height: 900, path: '/settings/connections' });
        await page.getByText('Studio Mac', { exact: true }).waitFor();
        await expect(page.getByText(label('settings.scanQrCodeToAuthenticate'), { exact: true }).count()).resolves.toBe(0);
        await expect(page.getByText(label('connect.enterUrlManually'), { exact: true }).count()).resolves.toBe(0);
        await page.close();
    });

    for (const [platform, eula] of [['web', 0], ['ios', 1]] as const) {
        it(`gathers support, links, policies and the version on About, where ten Version taps turn on developer tools (${platform})`, async () => {
            const { page, errors } = await open({ width: platform === 'web' ? 1440 : 390, height: 900, platform, path: '/settings/about' });
            await page.getByText(label('settings.supportUs'), { exact: true }).waitFor();
            for (const key of ['settings.github', 'settings.reportIssue', 'settings.privacyPolicy', 'settings.termsOfService', 'common.version']) {
                await expect(page.getByText(label(key), { exact: true }).count()).resolves.toBe(1);
            }
            await expect(page.getByText('NickGuAI/HappyHerd', { exact: true }).count()).resolves.toBe(1);
            await expect(page.getByText('HappyHerd 1.2.2 · Runtime 21', { exact: true }).count()).resolves.toBe(1);
            await expect(page.getByText(label('settings.eula'), { exact: true }).count()).resolves.toBe(eula);
            await expect(page.getByText(label('settings.developerTools'), { exact: true }).count()).resolves.toBe(0);
            const version = page.getByText(label('common.version'), { exact: true });
            for (let tap = 0; tap < 10; tap += 1) await version.click();
            await page.getByText(label('settings.developerTools'), { exact: true }).click();
            expect(await pathname(page)).toBe('/dev');
            expect(await page.evaluate(() => (window as any).__STATE__.calls)).toContain(`alert ${'Developer Mode'}`);
            expect(errors).toEqual([]);
            await page.close();
        });
    }

    it('opens the configured Web destinations from About', async () => {
        const { page } = await open({ width: 1440, height: 900, path: '/settings/about' });
        for (const key of ['settings.supportUs', 'settings.github', 'settings.reportIssue', 'settings.privacyPolicy', 'settings.termsOfService']) {
            await page.getByText(label(key), { exact: true }).first().click();
        }
        await page.waitForFunction(() => (window as any).__OPEN_CALLS__.length === 5);
        expect(await page.evaluate(() => (window as any).__OPEN_CALLS__)).toEqual([
            'https://example.com/support',
            'https://github.com/NickGuAI/HappyHerd',
            'https://example.com/happyherd/issues/new',
            'https://flern.co/privacy',
            'https://flern.co/terms',
        ]);
        await page.close();
    });

    for (const viewport of [{ width: 800, height: 900 }, { width: 390, height: 844 }]) {
        for (const theme of ['light', 'dark'] as const) {
            it(`opens Settings on the section list, with About, at ${viewport.width} px (${theme})`, async () => {
                const { page, errors } = await open({ ...viewport, theme, state: { customServer: true } });
                await page.getByRole('button', { name: 'Open Settings' }).click();
                const list = page.getByTestId('settings-section-list');
                await list.waitFor();
                expect(await pathname(page)).toBe('/settings');
                await expect(page.getByTestId('settings-frame').count()).resolves.toBe(0);
                expect(await list.getByRole('button').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))).toEqual([
                    label('settings.account'), label('newSession.streamline.modeStreamline'), label('settings.appearance'),
                    label('uiCopy.agentDefaults'), label('settingsCredentials.title'), label('devicePairing.title'),
                    label('settings.featuresTitle'), label('settings.voiceAssistant'), label('settingsLanguage.title'),
                    label('settings.about'), label('happyHerd.commander.category'), label('settings.whatsNew'),
                ]);
                // Nothing else: the old home's groups are on their pages.
                for (const key of ['settings.supportUs', 'settings.connectedAccounts', 'settings.machines', 'settings.accountSubtitle', 'common.version']) {
                    await expect(page.getByText(label(key), { exact: true }).count()).resolves.toBe(0);
                }
                await expect(page.getByTestId('stack-header').getByTestId('settings-server-configuration').count()).resolves.toBe(1);
                await list.getByRole('button', { name: label('settings.about'), exact: true }).click();
                await page.getByText(label('settings.supportUs'), { exact: true }).waitFor();
                expect(await pathname(page)).toBe('/settings/about');
                await page.goBack();
                await list.waitFor();
                expect(await pathname(page)).toBe('/settings');
                expect(errors).toEqual([]);
                await page.close();
            });
        }
    }

    // Every option the removed Settings home offered, and the page that now holds it.
    const OLD_HOME_OPTIONS: { option: string; route: string; platform?: string; state?: Record<string, unknown>; find: (page: Page) => ReturnType<Page['getByText']> }[] = [
        { option: 'profile card', route: '/settings/account', find: (page) => page.getByTestId('settings-profile-card') },
        { option: 'Scan QR code to authenticate (apps)', route: '/settings/connections', platform: 'ios', find: (page) => page.getByText(label('settings.scanQrCodeToAuthenticate'), { exact: true }) },
        { option: 'Enter URL manually (apps)', route: '/settings/connections', platform: 'ios', find: (page) => page.getByText(label('connect.enterUrlManually'), { exact: true }) },
        { option: 'Support us', route: '/settings/about', find: (page) => page.getByText(label('settings.supportUs'), { exact: true }) },
        { option: 'Connections', route: '/settings/account', find: (page) => page.getByTestId('settings-nav-connections') },
        { option: 'Connect Claude Code', route: '/settings/account', find: (page) => page.getByText(label('settings.connectAccount'), { exact: true }) },
        { option: 'Connect GitHub', route: '/settings/account', find: (page) => page.getByText(label('settings.connectGithubAccount'), { exact: true }) },
        { option: 'machines', route: '/settings/connections', find: (page) => page.getByText('Studio Mac', { exact: true }) },
        { option: 'Show offline machines', route: '/settings/connections', find: (page) => page.getByText(label('settings.showOfflineMachines', { count: 1 }), { exact: true }) },
        { option: 'Account', route: '/settings/account', find: (page) => page.getByTestId('settings-nav-account') },
        { option: 'Credentials & Accounts', route: '/settings/account', find: (page) => page.getByTestId('settings-nav-credentials') },
        { option: 'Appearance', route: '/settings/account', find: (page) => page.getByTestId('settings-nav-appearance') },
        { option: 'Voice Assistant', route: '/settings/account', find: (page) => page.getByTestId('settings-nav-voice') },
        { option: 'Agent Defaults', route: '/settings/account', find: (page) => page.getByTestId('settings-nav-agents') },
        { option: 'Streamline', route: '/settings/account', find: (page) => page.getByTestId('settings-nav-streamline') },
        { option: 'Features', route: '/settings/account', find: (page) => page.getByTestId('settings-nav-features') },
        { option: 'Usage (experiments)', route: '/settings/account', state: { experiments: true }, find: (page) => page.getByTestId('settings-nav-usage') },
        { option: 'Commanders', route: '/settings/account', find: (page) => page.getByTestId('settings-nav-commanders') },
        { option: 'Developer Tools (developer mode)', route: '/settings/about', state: { devModeEnabled: true }, find: (page) => page.getByText(label('settings.developerTools'), { exact: true }) },
        { option: "What's New", route: '/settings/account', find: (page) => page.getByTestId('settings-nav-whatsNew') },
        { option: 'GitHub repository', route: '/settings/about', find: (page) => page.getByText('NickGuAI/HappyHerd', { exact: true }) },
        { option: 'Report an Issue', route: '/settings/about', find: (page) => page.getByText(label('settings.reportIssue'), { exact: true }) },
        { option: 'Privacy Policy', route: '/settings/about', find: (page) => page.getByText(label('settings.privacyPolicy'), { exact: true }) },
        { option: 'Terms of Service', route: '/settings/about', find: (page) => page.getByText(label('settings.termsOfService'), { exact: true }) },
        { option: 'EULA (iOS)', route: '/settings/about', platform: 'ios', find: (page) => page.getByText(label('settings.eula'), { exact: true }) },
        { option: 'Version', route: '/settings/about', find: (page) => page.getByText(label('common.version'), { exact: true }) },
        { option: 'custom server configuration', route: '/settings/connections', state: { customServer: true }, find: (page) => page.getByTestId('settings-server-configuration') },
    ];

    it('keeps every option of the removed Settings home on a section page', async () => {
        const missing: string[] = [];
        for (const { option, route, platform = 'web', state = {}, find } of OLD_HOME_OPTIONS) {
            const { page, errors } = await open({ width: platform === 'web' ? 1440 : 390, height: 900, platform, path: route, state });
            await page.getByTestId('route').waitFor();
            const visible = await find(page).first().waitFor({ state: 'visible', timeout: 2_000 }).then(() => true, () => false);
            if (!visible || errors.length) missing.push(`${option} on ${route}${errors.length ? `: ${errors[0]}` : ''}`);
            await page.close();
        }
        expect(missing).toEqual([]);
    }, 120_000);
});
