import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');

const virtualModules: Record<string, string> = {
    'react-native': `
        import * as ReactNativeWeb from 'react-native-web';
        export * from 'react-native-web';
        const platformOs = globalThis.__SETTINGS_PLATFORM__ ?? 'web';
        export const Platform = {
            ...ReactNativeWeb.Platform,
            OS: platformOs,
            select: (options) => options[platformOs] ?? options.default,
        };
    `,
    'react-native-unistyles': `
        import { lightTheme, darkTheme } from '@/theme';
        const theme = globalThis.__SETTINGS_THEME__ === 'dark' ? darkTheme : lightTheme;
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
    `,
    'react-native-device-info': `export const getDeviceType = () => 'Handset';`,
    'expo-image': `import { View } from 'react-native'; export const Image = View;`,
    'expo-constants': `
        export default { expoConfig: { version: '1.2.2', runtimeVersion: '21', extra: { app: {} } } };
    `,
    'expo-router': `
        export const useRouter = () => ({
            push(path) { globalThis.__SETTINGS_ROUTES__ = [...(globalThis.__SETTINGS_ROUTES__ ?? []), path]; },
        });
        export const usePathname = () => '/settings';
        export const Stack = { Screen: () => null };
    `,
    'expo-clipboard': `export const setStringAsync = async () => {};`,
    '@/auth/AuthContext': `export const useAuth = () => ({ credentials: { token: 'test' } });`,
    '@/components/Avatar': `import { View } from 'react-native'; export const Avatar = View;`,
    '@/components/StyledText': `import { Text as NativeText } from 'react-native'; export const Text = NativeText;`,
    '@/components/layout': `export const layout = { maxWidth: 800 };`,
    '@/constants/Typography': `export const Typography = { default: () => ({}), mono: () => ({}) };`,
    '@/constants/product': `
        export const PRODUCT = {
            displayName: 'HappyHerd',
            issueUrl: 'https://example.com/happyherd/issues/new',
            repositoryDisplay: 'NickGuAI/HappyHerd',
            repositoryUrl: 'https://github.com/NickGuAI/HappyHerd',
            supportUrl: 'https://buymeacoffee.com/nickguy',
        };
    `,
    '@/hooks/useConnectTerminal': `
        export const useConnectTerminal = () => ({ connectTerminal() {}, connectWithUrl() {}, isLoading: false });
    `,
    '@/hooks/useHappyHerdAction': `export const useHappyHerdAction = (action) => [false, action];`,
    '@/hooks/useMultiClick': `export const useMultiClick = (callback) => callback;`,
    '@/modal': `
        export const Modal = { alert() {}, confirm: async () => false, prompt: async () => undefined };
    `,
    '@/sync/apiGithub': `
        export const disconnectGitHub = async () => {};
        export const getGitHubOAuthParams = async () => ({ url: '' });
    `,
    '@/sync/apiServices': `export const disconnectService = async () => {};`,
    '@/sync/profile': `
        export const getAvatarUrl = () => undefined;
        export const getBio = () => undefined;
        export const getDisplayName = () => 'Test User';
    `,
    '@/sync/serverConfig': `export const isUsingCustomServer = () => false;`,
    '@/sync/storage': `
        export const useAllMachines = () => [];
        export const useEntitlement = () => false;
        export const useLocalSettingMutable = () => [false, () => {}];
        export const useProfile = () => ({ id: 'profile-test', firstName: 'Test', avatar: null, connectedServices: [] });
        export const useSetting = () => false;
    `,
    '@/sync/sync': `
        export const sync = {
            presentPaywall: async (flow) => {
                globalThis.__PAYWALL_CALLS__ = [...(globalThis.__PAYWALL_CALLS__ ?? []), flow];
                return { success: true };
            },
            refreshProfile: async () => {},
        };
    `,
    '@/text': `
        const labels = {
            'common.version': 'Version',
            'common.runtime': 'Runtime',
            'settings.about': 'About',
            'settings.aboutFooter': 'About HappyHerd',
            'settings.connectedAccounts': 'Connected Accounts',
            'settings.features': 'Features',
            'settings.github': 'GitHub',
            'settings.privacyPolicy': 'Privacy Policy',
            'settings.reportIssue': 'Report Issue',
            'settings.supportUs': 'Support Us',
            'settings.supportUsSubtitle': 'Support HappyHerd',
            'settings.termsOfService': 'Terms of Service',
            'settings.whatsNew': "What's New",
            'settings.whatsNewSubtitle': 'Recent changes',
            'settingsCredentials.settingsRow': 'Credentials & Accounts',
            'settingsCredentials.settingsRowSubtitle': 'Provider accounts and saved credentials',
            // The phone section list's labels, and the subtitles of the rows it replaces.
            'settings.sectionsLabel': 'Settings sections',
            'settings.account': 'Account',
            'settings.accountSubtitle': 'Manage your account details',
            'newSession.streamline.modeStreamline': 'Streamline',
            'settings.appearance': 'Appearance',
            'uiCopy.agentDefaults': 'Agent Defaults',
            'settingsCredentials.title': 'Credentials & Accounts',
            'devicePairing.title': 'Connections',
            'devicePairing.settingsSubtitle': 'Add a device and open your connected machines',
            'settings.featuresTitle': 'Features',
            'settings.voiceAssistant': 'Voice Assistant',
            'settingsLanguage.title': 'Language',
            'happyHerd.commander.category': 'Commanders',
        };
        export const t = (key) => labels[key] ?? key;
    `,
    '@/track': `export const trackPaywallButtonClicked = () => {}; export const trackWhatsNewClicked = () => {};`,
    '@/utils/machineUtils': `export const isMachineOnline = () => true;`,
};

const fixturePlugin: Plugin = {
    name: 'settings-browser-fixture',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in virtualModules) return { path: args.path, namespace: 'fixture-stub' };
            if (args.path.startsWith('@/')) {
                const sourcePath = resolve(appRoot, 'sources', args.path.slice(2));
                const path = [sourcePath, `${sourcePath}.ts`, `${sourcePath}.tsx`].find(existsSync);
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

describe('Settings policy links browser interaction', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            stdin: {
                contents: `
                    import React from 'react';
                    import { createRoot } from 'react-dom/client';
                    import { SettingsView } from '@/components/SettingsView';
                    createRoot(document.getElementById('root')).render(React.createElement(SettingsView));
                `,
                loader: 'tsx',
                resolveDir: appRoot,
            },
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
            sourcemap: 'inline',
            define: {
                __DEV__: 'false',
                'process.env.EXPO_OS': '"web"',
                'process.env.NODE_ENV': '"test"',
            },
            jsx: 'automatic',
            loader: { '.png': 'dataurl' },
            plugins: [fixturePlugin],
        });
        const script = bundle.outputFiles[0].text;
        server = createServer((request, response) => {
            const platform = request.url?.includes('platform=ios') ? 'ios' : 'web';
            const theme = request.url?.includes('theme=dark') ? 'dark' : 'light';
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<style>html,body,#root{height:100%;margin:0}</style><main id="root"></main><script>globalThis.__SETTINGS_THEME__=${JSON.stringify(theme)};globalThis.__SETTINGS_PLATFORM__=${JSON.stringify(platform)};globalThis.global=globalThis;${script}</script>`);
        });
        await new Promise<void>((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('browser fixture did not bind');
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
        ['Web Desktop Light', { width: 1440, height: 900 }, 'light'],
        ['Web Desktop Dark', { width: 1440, height: 900 }, 'dark'],
        ['Web Mobile Light', { width: 390, height: 844 }, 'light'],
        ['Web Mobile Dark', { width: 390, height: 844 }, 'dark'],
    ] as const)('renders no About footer and opens the configured Web destinations on %s', async (_surface, viewport, theme) => {
        const page = await browser.newPage({ viewport });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (message.type() === 'error') pageErrors.push(message.text());
        });
        await page.addInitScript(() => {
            (window as any).__OPEN_CALLS__ = [];
            (window as any).__PAYWALL_CALLS__ = [];
            (window as any).__SETTINGS_ROUTES__ = [];
            window.open = ((url?: string | URL, target?: string, features?: string) => {
                (window as any).__OPEN_CALLS__.push({ url: String(url), target, features });
                return null;
            }) as typeof window.open;
        });
        await page.goto(`${origin}?theme=${theme}`);

        await expect(page.getByText('About HappyHerd', { exact: true }).count()).resolves.toBe(0);
        const aboutGroup = page.getByText('About', { exact: true }).locator('xpath=../..');
        await expect(aboutGroup.locator(':scope > *').count()).resolves.toBe(2);
        const support = page.getByText('Support Us', { exact: true });
        await support.waitFor({ state: 'visible' });
        await expect(page.locator('[data-icon="heart"]').count()).resolves.toBe(1);
        await expect(page.getByText('Support HappyHerd', { exact: true }).count()).resolves.toBe(1);
        await support.click();
        const privacy = page.getByText('Privacy Policy', { exact: true });
        await privacy.waitFor({ state: 'visible', timeout: 3_000 }).catch((error) => {
            throw new Error(`${String(error)}\nBrowser errors:\n${pageErrors.join('\n')}`);
        });
        await expect(page.locator('[data-icon="shield-checkmark-outline"]').count()).resolves.toBe(1);
        await privacy.click();
        const repositoryDetail = page.getByText('NickGuAI/HappyHerd', { exact: true });
        await expect(repositoryDetail.count()).resolves.toBe(1);
        await expect(repositoryDetail.locator('xpath=../..').locator('[data-icon="logo-github"]').count()).resolves.toBe(1);
        await page.getByText('GitHub', { exact: true }).last().click();
        await page.getByText('Report Issue', { exact: true }).click();
        await page.getByText('Terms of Service', { exact: true }).click();
        await expect(page.getByText("What's New", { exact: true }).count()).resolves.toBe(1);
        await expect(page.getByText('Version', { exact: true }).count()).resolves.toBe(1);
        await expect(page.getByText('HappyHerd 1.2.2 · Runtime 21', { exact: true }).count()).resolves.toBe(1);
        await page.getByText('Credentials & Accounts', { exact: true }).click();
        await expect(page.evaluate(() => (window as any).__SETTINGS_ROUTES__)).resolves.toContain('/settings/credentials');

        await page.waitForFunction(() => (window as any).__OPEN_CALLS__.length === 5);
        await expect(page.evaluate(() => (window as any).__OPEN_CALLS__)).resolves.toEqual([
            { url: 'https://buymeacoffee.com/nickguy', target: '_blank', features: 'noopener,noreferrer' },
            { url: 'https://flern.co/privacy', target: '_blank', features: 'noopener,noreferrer' },
            { url: 'https://github.com/NickGuAI/HappyHerd', target: '_blank', features: 'noopener,noreferrer' },
            { url: 'https://example.com/happyherd/issues/new', target: '_blank', features: 'noopener,noreferrer' },
            { url: 'https://flern.co/terms', target: '_blank', features: 'noopener,noreferrer' },
        ]);
        await expect(page.evaluate(() => (window as any).__PAYWALL_CALLS__)).resolves.toEqual([]);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);

    it.each(['light', 'dark'] as const)('opens Settings on Web Mobile (%s) with its section list after the profile, in place of the groups it repeats', async (theme) => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        await page.addInitScript(() => {
            (window as any).__OPEN_CALLS__ = [];
            (window as any).__PAYWALL_CALLS__ = [];
            (window as any).__SETTINGS_ROUTES__ = [];
        });
        await page.goto(`${origin}?theme=${theme}`);
        const list = page.getByTestId('settings-section-list');
        await list.waitFor({ state: 'visible' });
        await expect(list.getAttribute('aria-label')).resolves.toBe('Settings sections');
        const labels = await list.getByRole('button').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
        expect(labels).toEqual([
            'Account', 'Streamline', 'Appearance', 'Agent Defaults', 'Credentials & Accounts',
            'Connections', 'Features', 'Voice Assistant', 'Language', 'Commanders',
        ]);
        // The card sits on the 16 px gutter; its 48 px rows put their icons 16 px inside it.
        const card = (await list.boundingBox())!;
        expect({ x: Math.round(card.x), width: Math.round(card.width) }).toEqual({ x: 16, width: 390 - 32 });
        for (const row of await list.getByRole('button').evaluateAll((nodes) => nodes.map((node) => {
            const rect = node.getBoundingClientRect();
            const icon = node.querySelector('[data-icon]')!.getBoundingClientRect();
            return { height: Math.round(rect.height), icon: Math.round(icon.left) };
        }))) {
            expect(row.height).toBeGreaterThanOrEqual(48);
            expect(row.icon).toBe(Math.round(card.x) + 1 + 16);
        }
        // The Features group and the device pairing row only repeated these pages.
        await expect(page.getByText('Add a device and open your connected machines', { exact: true }).count()).resolves.toBe(0);
        await expect(page.getByText('Manage your account details', { exact: true }).count()).resolves.toBe(0);
        // Everything else stays, and a row opens its page.
        await expect(page.getByText('Support Us', { exact: true }).count()).resolves.toBe(1);
        await expect(page.getByText("What's New", { exact: true }).count()).resolves.toBe(1);
        await list.getByRole('button', { name: 'Appearance', exact: true }).click();
        await expect(page.evaluate(() => (window as any).__SETTINGS_ROUTES__)).resolves.toEqual(['/settings/appearance']);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 15_000);

    it.each([
        { label: 'on Web Desktop', width: 1440, height: 900 },
        // An 8-inch diagonal: useIsTablet() is false, but the web lays out by width (UI overhaul).
        { label: 'in a 1024 × 768 window, which the device rule calls a phone', width: 1024, height: 768 },
        { label: 'at the 700 px web breakpoint', width: 700, height: 900 },
    ])('keeps every Settings group, and no phone section list, $label', async ({ width, height }) => {
        const page = await browser.newPage({ viewport: { width, height } });
        await page.goto(`${origin}?theme=light`);
        await page.getByText('Support Us', { exact: true }).waitFor({ state: 'visible' });
        await expect(page.getByTestId('settings-section-list').count()).resolves.toBe(0);
        await expect(page.getByText('Credentials & Accounts', { exact: true }).count()).resolves.toBe(1);
        await page.close();
    }, 15_000);

    it('opens Settings with its section list 1 px below the web breakpoint', async () => {
        const page = await browser.newPage({ viewport: { width: 699, height: 900 } });
        await page.goto(`${origin}?theme=light`);
        await page.getByTestId('settings-section-list').waitFor({ state: 'visible' });
        await expect(page.getByText('Add a device and open your connected machines', { exact: true }).count()).resolves.toBe(0);
        await page.close();
    }, 15_000);

    it('retains the voluntary-support paywall on the non-Web platform branch', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        await page.addInitScript(() => {
            (window as any).__OPEN_CALLS__ = [];
            (window as any).__PAYWALL_CALLS__ = [];
            window.open = ((url?: string | URL, target?: string, features?: string) => {
                (window as any).__OPEN_CALLS__.push({ url: String(url), target, features });
                return null;
            }) as typeof window.open;
        });
        await page.goto(`${origin}/?platform=ios`);

        await expect(page.getByText('About HappyHerd', { exact: true }).count()).resolves.toBe(0);
        await expect(page.getByText('HappyHerd 1.2.2 · Runtime 21', { exact: true }).count()).resolves.toBe(1);
        const aboutGroup = page.getByText('About', { exact: true }).locator('xpath=../..');
        await expect(aboutGroup.locator(':scope > *').count()).resolves.toBe(2);
        const support = page.getByText('Support Us', { exact: true });
        await support.waitFor({ state: 'visible', timeout: 3_000 }).catch(async (error) => {
            throw new Error(`${String(error)}\nBrowser errors:\n${pageErrors.join('\n')}\nBody:\n${await page.locator('body').innerText()}`);
        });
        await support.click();
        await page.waitForFunction(() => (window as any).__PAYWALL_CALLS__.length === 1);
        await expect(page.evaluate(() => (window as any).__PAYWALL_CALLS__)).resolves.toEqual(['voluntary_support']);
        await expect(page.evaluate(() => (window as any).__OPEN_CALLS__)).resolves.toEqual([]);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);
});
