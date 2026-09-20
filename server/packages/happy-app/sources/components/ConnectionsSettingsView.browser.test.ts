import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');
const evidenceDir = process.env.HAPPYHERD_PAIRING_EVIDENCE_DIR?.trim() || resolve(appRoot, '../../../.artifacts/issue-288');

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
        import { lightTheme as theme } from '@/theme';
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
    `,
    'expo-clipboard': `export const setStringAsync = async () => {};`,
    '@/auth/AuthContext': `export const useAuth = () => ({ credentials: { token: 'test' } });`,
    '@/components/Avatar': `import { View } from 'react-native'; export const Avatar = View;`,
    '@/components/StyledText': `import { Text as NativeText } from 'react-native'; export const Text = NativeText;`,
    '@/components/layout': `export const layout = { maxWidth: 800 };`,
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
    '@/hooks/useHappyAction': `export const useHappyAction = (action) => [false, action];`,
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
        };
        export const t = (key) => labels[key] ?? key;
    `,
    '@/track': `export const trackPaywallButtonClicked = () => {}; export const trackWhatsNewClicked = () => {};`,
    '@/utils/machineUtils': `export const isMachineOnline = () => true;`,
};

Object.assign(virtualModules, {
    'expo-crypto': `export const randomUUID = () => crypto.randomUUID();`,
    'expo-router': `
        export const useRouter = () => ({
            push(path) {
                globalThis.__ROUTES__.push(path);
                const route = typeof path === 'string' ? path : path.pathname;
                history.pushState({}, '', route);
                dispatchEvent(new PopStateEvent('popstate'));
            },
        });
    `,
    '@/sync/storage': `
        import React from 'react';
        const listen = (callback) => { addEventListener('fixture-state', callback); return () => removeEventListener('fixture-state', callback); };
        export const useAllMachines = () => React.useSyncExternalStore(listen, () => globalThis.__STATE__.machines);
        export const useProfile = () => React.useSyncExternalStore(listen, () => globalThis.__STATE__.profile);
        export const useSocketStatus = () => ({ status: React.useSyncExternalStore(listen, () => globalThis.__STATE__.socketStatus) });
        export const useEntitlement = () => false;
        export const useLocalSettingMutable = () => [false, () => {}];
        export const useSetting = () => false;
    `,
    '@/sync/serverConfig': `
        export const isUsingCustomServer = () => false;
        export const getServerUrl = () => globalThis.__STATE__.configuredServer;
    `,
    '@/sync/persistence': `
        export const loadNewSessionDraft = () => JSON.parse(localStorage.getItem('new-session-draft') || 'null');
        export const saveNewSessionDraft = (draft) => localStorage.setItem('new-session-draft', JSON.stringify(draft));
    `,
    '@/text': `
        import catalog from '@/text/locales/en.json';
        export const t = (key, params = {}) => {
            const text = key.split('.').reduce((value, part) => value?.[part], catalog) ?? key;
            return Object.entries(params).reduce((value, [name, replacement]) => value.replaceAll('{' + name + '}', String(replacement)), text);
        };
    `,
    '@/sync/apiSocket': `
        export const apiSocket = {
            getActiveEndpoint: () => globalThis.__STATE__.activeServer,
            async machineRPC(machineId, method, params) {
                const state = globalThis.__STATE__;
                state.calls.push({ machineId, method, params });
                if (method.endsWith('-identity')) {
                    if (state.identityFailure) throw new Error('offline');
                    return { machineId: state.identityMismatch ? 'wrong-machine' : machineId, host: 'Target Mac' };
                }
                if (method.endsWith('-check')) {
                    if (state.checkDeferred) await new Promise((resolve) => { globalThis.__RELEASE_CHECK__ = resolve; });
                    if (state.checkNetwork) throw new Error('network');
                    if (state.failure) return { status: state.failure };
                    if (params.code !== '12345678') return { status: 'not_found' };
                    return { status: 'pending', machineId, host: 'Target Mac', expiresAt: Date.now() + 60000 };
                }
                if (method.endsWith('-confirm')) {
                    if (state.confirmDeferred) await new Promise((resolve) => { globalThis.__RELEASE_CONFIRM__ = resolve; });
                    if (state.lostAck && !state.consumedRequestId) {
                        state.consumedRequestId = params.requestId;
                        throw new Error('lost acknowledgement');
                    }
                    if (state.consumedRequestId && state.consumedRequestId !== params.requestId) return { status: 'used' };
                    return { status: state.confirmFailure ?? 'connected', machineId: state.confirmMismatch ? 'wrong-machine' : machineId, host: 'Target Mac' };
                }
                throw new Error('unexpected method');
            },
        };
    `,
});

const fixturePlugin: Plugin = {
    name: 'settings-browser-fixture',
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

describe('Settings → Connections → Add device production component journeys', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;
    beforeAll(async () => {
        const bundle = await build({
            stdin: {
                contents: `
                    import React from 'react';
                    import { createRoot } from 'react-dom/client';
                    import SettingsScreen from '@/app/(app)/settings/index';
                    import ConnectionsScreen from '@/app/(app)/settings/connections';
                    import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
                    globalThis.__ROUTES__ = [];
                    globalThis.__DRAFT__ = useNewSessionDraft;
                    globalThis.__STATE__ = {
                        machines: [{ id: 'target-machine', active: true, metadata: { host: 'Target Mac', homeDir: '/target-home', devicePairingProtocolVersion: 1 } }],
                        profile: { id: 'account-one', firstName: 'Test', avatar: null, connectedServices: [] },
                        configuredServer: 'https://server.example', activeServer: 'https://server.example',
                        socketStatus: 'connected', calls: [],
                    };
                    globalThis.__UPDATE__ = (patch) => { Object.assign(globalThis.__STATE__, patch); dispatchEvent(new Event('fixture-state')); };
                    const subscribe = (fn) => { addEventListener('popstate', fn); return () => removeEventListener('popstate', fn); };
                    function Host() {
                        const path = React.useSyncExternalStore(subscribe, () => location.pathname);
                        return path === '/settings/connections' ? <ConnectionsScreen /> : <SettingsScreen />;
                    }
                    createRoot(document.getElementById('root')).render(<Host />);
                `,
                loader: 'tsx', resolveDir: appRoot,
            },
            bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
            define: { __DEV__: 'false', 'process.env.EXPO_OS': '"web"', 'process.env.NODE_ENV': '"test"' },
            loader: { '.png': 'dataurl' }, plugins: [fixturePlugin],
        });
        const script = bundle.outputFiles[0].text;
        server = createServer((_request, response) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<style>html,body,#root{height:100%;margin:0}*{box-sizing:border-box}</style><main id="root"></main><script>globalThis.global=globalThis;${script}</script>`);
        });
        await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('fixture bind failed');
        origin = `http://127.0.0.1:${address.port}`;
        await mkdir(evidenceDir, { recursive: true });
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({ ...(executablePath ? { executablePath } : { channel: 'chrome' }), headless: true });
    }, 30000);
    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    });

    async function open(page: Page, evidenceWidth?: number) {
        page.on('pageerror', error => console.error('Connections fixture page error:', error.message));
        page.setDefaultTimeout(2500);
        await page.goto(`${origin}/settings`);
        await page.getByText('Connections', { exact: true }).waitFor();
        if (evidenceWidth) await page.screenshot({ path: resolve(evidenceDir, `fixture-${evidenceWidth}-settings-entry.png`) });
        await page.getByText('Connections', { exact: true }).click();
        await page.getByRole('button', { name: 'Add device', exact: true }).waitFor();
    }
    async function enter(page: Page, code = '12345678') {
        await page.getByRole('button', { name: 'Add device', exact: true }).click();
        await page.getByRole('textbox', { name: 'Pairing code', exact: true }).fill(code);
        await page.getByRole('button', { name: 'Check code', exact: true }).click();
    }
    async function patch(page: Page, value: Record<string, unknown>) {
        await page.evaluate((update) => (globalThis as any).__UPDATE__(update), value);
    }
    async function calls(page: Page) {
        return page.evaluate(() => (globalThis as any).__STATE__.calls as { machineId: string; method: string; params: Record<string, string> }[]);
    }

    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        it(`selects the real target from the visible Settings entry, retains it after refresh at ${viewport.width}px`, async () => {
            const page = await browser.newPage({ viewport });
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await open(page, viewport.width);
            await page.getByRole('button', { name: 'Add device', exact: true }).click();
            const input = page.getByRole('textbox', { name: 'Pairing code', exact: true });
            await input.pressSequentially('12345678');
            expect(await input.inputValue()).toBe('1234-5678');
            await page.screenshot({ path: resolve(evidenceDir, `fixture-${viewport.width}-code-entry.png`) });
            expect(await input.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
            await page.getByRole('button', { name: 'Check code', exact: true }).click();
            await page.getByText('Machine ID: target-machine', { exact: true }).waitFor();
            await page.screenshot({ path: resolve(evidenceDir, `fixture-${viewport.width}-confirmation.png`) });
            await page.getByRole('button', { name: 'Connect', exact: true }).click();
            await page.getByText('Verified Target Mac and selected its existing machine for your next session.', { exact: true }).waitFor();
            await page.screenshot({ path: resolve(evidenceDir, `fixture-${viewport.width}-connected.png`) });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            expect(await page.evaluate(() => JSON.parse(localStorage.getItem('new-session-draft')!).selectedMachineId)).toBe('target-machine');
            await page.evaluate(() => (globalThis as any).__DRAFT__.getState().setMachineId('another-machine'));
            await page.getByRole('button', { name: 'New Session', exact: true }).click();
            expect(await page.evaluate(() => (globalThis as any).__DRAFT__.getState().selectedMachineId)).toBe('target-machine');
            expect(await page.evaluate(() => (globalThis as any).__ROUTES__.at(-1))).toBe('/new');
            await page.goto(`${origin}/settings/connections`);
            await page.getByText('online · Selected for new sessions', { exact: true }).waitFor();
            expect((await calls(page)).map((call) => call.method)).toEqual(['happyherd-device-pairing-identity']);
            expect(await page.evaluate(() => (globalThis as any).__STATE__.machines.length)).toBe(1);
            expect(await page.evaluate(() => localStorage.getItem('new-session-draft'))).not.toContain('12345678');
            expect(await page.getByRole('textbox', { name: 'Pairing code' }).count()).toBe(0);
            expect(errors).toEqual([]);
            await page.close();
        });
    }

    it('shows recoverable failures and accepts pasted grouped codes without stripping letters', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await open(page);
        await enter(page, '1234x5678');
        await page.getByRole('alert').filter({ hasText: 'exactly eight digits' }).waitFor();
        expect((await calls(page)).filter((call) => call.method.endsWith('-check'))).toHaveLength(0);
        for (const [failure, message] of [['expired', 'This code expired.'], ['used', 'This code was already used.'], ['cancelled', 'Pairing was cancelled'], ['not_found', 'Code not found.']]) {
            await patch(page, { failure });
            await page.getByRole('textbox', { name: 'Pairing code' }).fill('1234 5678');
            await page.getByRole('button', { name: 'Check code', exact: true }).click();
            await page.getByRole('alert').filter({ hasText: message }).waitFor();
            expect(await page.getByRole('button', { name: 'Connect', exact: true }).count()).toBe(0);
        }
        await patch(page, { failure: null, checkNetwork: true });
        await page.getByRole('button', { name: 'Check code', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'could not be reached' }).waitFor();
        await patch(page, { checkNetwork: false });
        await page.getByRole('button', { name: 'Check code', exact: true }).click();
        await page.getByRole('button', { name: 'Connect', exact: true }).waitFor();
        await page.close();
    });

    it('retries a lost confirm ACK with the same request ID and opens the exact target workspace', async () => {
        const page = await browser.newPage();
        await open(page);
        await patch(page, { lostAck: true });
        await enter(page);
        await page.getByRole('button', { name: 'Connect', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'could not be reached' }).waitFor();
        await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
        await page.getByText('Verified Target Mac and selected its existing machine for your next session.', { exact: true }).waitFor();
        const confirms = (await calls(page)).filter((call) => call.method.endsWith('-confirm'));
        expect(confirms).toHaveLength(2);
        expect(confirms[0].params.requestId).toBe(confirms[1].params.requestId);
        await page.getByRole('button', { name: 'Workspace', exact: true }).click();
        expect(await page.evaluate(() => (globalThis as any).__ROUTES__.at(-1))).toEqual({ pathname: '/workspace', params: { machineId: 'target-machine', path: '/target-home' } });
        await page.close();
    });

    it('hides stale online and connected states on daemon or transport loss and rechecks reconnect', async () => {
        const page = await browser.newPage();
        await open(page);
        await enter(page);
        await page.getByRole('button', { name: 'Connect', exact: true }).click();
        await page.getByRole('button', { name: 'New Session', exact: true }).waitFor();
        await page.evaluate(() => (globalThis as any).__UPDATE__({ machines: (globalThis as any).__STATE__.machines.map((machine: any) => ({ ...machine, active: false })) }));
        await page.getByText('offline · Selected for new sessions', { exact: true }).waitFor();
        expect(await page.getByRole('button', { name: 'New Session', exact: true }).count()).toBe(0);
        await page.evaluate(() => (globalThis as any).__UPDATE__({ machines: (globalThis as any).__STATE__.machines.map((machine: any) => ({ ...machine, active: true })) }));
        await page.getByText('online · Selected for new sessions', { exact: true }).waitFor();
        await patch(page, { socketStatus: 'disconnected' });
        await page.getByText('offline · Selected for new sessions', { exact: true }).waitFor();
        await patch(page, { socketStatus: 'connected' });
        await page.getByText('online · Selected for new sessions', { exact: true }).waitFor();
        expect((await calls(page)).filter((call) => call.method.endsWith('-identity')).length).toBeGreaterThanOrEqual(3);
        await page.close();
    });

    it('invalidates late confirmation on cancel or account change and never accepts a substituted identity', async () => {
        const page = await browser.newPage();
        await open(page);
        await patch(page, { confirmMismatch: true });
        await enter(page);
        await page.getByRole('button', { name: 'Connect', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'identity changed' }).waitFor();
        await patch(page, { confirmMismatch: false, confirmDeferred: true });
        await page.getByRole('button', { name: 'Connect', exact: true }).click();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.evaluate(() => (globalThis as any).__RELEASE_CONFIRM__());
        await page.getByRole('button', { name: 'Add device', exact: true }).waitFor();
        expect(await page.getByRole('button', { name: 'New Session', exact: true }).count()).toBe(0);
        expect(await page.evaluate(() => (globalThis as any).__DRAFT__.getState().selectedMachineId)).toBeNull();
        await enter(page);
        await page.getByRole('button', { name: 'Connect', exact: true }).click();
        await patch(page, { profile: { id: 'account-two', firstName: 'Test', connectedServices: [] } });
        await page.evaluate(() => (globalThis as any).__RELEASE_CONFIRM__());
        await page.getByRole('button', { name: 'Add device', exact: true }).waitFor();
        expect(await page.getByRole('button', { name: 'New Session', exact: true }).count()).toBe(0);
        expect(await page.evaluate(() => (globalThis as any).__DRAFT__.getState().selectedMachineId)).toBeNull();
        await page.close();
    });

    it('requires fresh identity on refresh and blocks pairing when configured and actual servers differ', async () => {
        const page = await browser.newPage();
        await open(page);
        await patch(page, { identityMismatch: true });
        await page.getByText('Refresh devices', { exact: true }).click();
        await page.getByText('offline', { exact: true }).waitFor();
        await patch(page, { configuredServer: 'https://changed.example' });
        await page.getByText('Refresh devices', { exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'server setting changed' }).waitFor();
        await page.getByText('Connected server: https://server.example', { exact: true }).waitFor();
        expect(await page.getByRole('button', { name: 'Add device', exact: true }).isDisabled()).toBe(true);
        expect((await calls(page)).filter((call) => call.method.endsWith('-check'))).toHaveLength(0);
        await page.close();
    });
});
