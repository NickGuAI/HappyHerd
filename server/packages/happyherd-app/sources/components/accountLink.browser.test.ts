import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page, type Locator } from 'playwright-core';
import { authLogin, authStatus } from '../../../happyherd-control-agent/src/auth';
import { readCredentials } from '../../../happyherd-control-agent/src/credentials';
import en from '@/text/locales/en.json';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');
const evidenceDir = process.env.HAPPYHERD_ACCOUNT_LINK_EVIDENCE_DIR?.trim() || resolve(appRoot, '../../../.artifacts/issue-467');
// Public synthetic fixture values; no configured account or host credentials are read.
const accountSecret = Buffer.alloc(32, 17);
const accountToken = 'synthetic-account-link-token';

// Keep production Settings/Account, row, prompt, hook, crypto and HTTP client.
// Replace only router/platform adapters and unrelated account service state.
const modules: Record<string, string> = {
    'react-native': `
        import * as RN from 'react-native-web';
        export * from 'react-native-web';
        const OS = new URLSearchParams(location.search).get('platform') || 'web';
        export const Platform = { ...RN.Platform, OS, select: values => values[OS] ?? values.default };
        export const Alert = { alert() { throw new Error('Unexpected native alert'); }, prompt() { throw new Error('Unexpected native prompt'); } };
    `,
    'react-native-unistyles': `
        import { lightTheme as theme } from '@/theme';
        export const StyleSheet = { create: factory => typeof factory === 'function' ? factory(theme, {}) : factory, hairlineWidth: 1 };
        export const useUnistyles = () => ({ theme });
        export const withUnistyles = Component => Component;
    `,
    'react-native-reanimated': `
        import React from 'react';
        export default { createAnimatedComponent: Component => Component };
        export const cancelAnimation = () => {};
        export const Easing = { out: value => value, quad: 'quad' };
        export const useAnimatedStyle = factory => factory();
        export const useSharedValue = value => React.useRef({ value }).current;
        export const withSpring = value => value;
        export const withTiming = value => value;
    `,
    'react-native-safe-area-context': `export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });`,
    'react-native-device-info': `export const getDeviceType = () => 'Handset';`,
    'expo-font': `export const isLoaded = () => true; export const loadAsync = async () => {}; export const useFonts = () => [true, null];`,
    'expo-asset': `export const Asset = { fromModule: value => ({ uri: typeof value === 'string' ? value : value.uri }) };`,
    'expo-blur': `export { View as BlurView } from 'react-native';`,
    'expo-glass-effect': `export { View as GlassView } from 'react-native'; export const isGlassEffectAPIAvailable = () => false;`,
    'expo-linear-gradient': `export { View as LinearGradient } from 'react-native';`,
    '@react-navigation/native': `import React from 'react'; export const useFocusEffect = effect => React.useEffect(effect, [effect]);`,
    'expo-image': `
        import React from 'react'; import { Image as NativeImage } from 'react-native-web';
        export const Image = React.forwardRef(({ contentFit, source, tintColor, ...props }, ref) => <NativeImage
            {...props} ref={ref} source={typeof source === 'string' ? { uri: source } : source}
            resizeMode={contentFit === 'cover' ? 'cover' : 'contain'} />);
    `,
    'expo-clipboard': `export const setStringAsync = async () => {};`,
    'expo-crypto': `export const getRandomBytes = size => crypto.getRandomValues(new Uint8Array(size));`,
    'expo-camera': `
        export const useCameraPermissions = () => [{ granted: true }, async () => ({ granted: true })];
        export const CameraView = {
            isModernBarcodeScannerAvailable: true,
            onModernBarcodeScanned: () => ({ remove() {} }),
            launchScanner: options => { globalThis.__SCANNER_CALLS__.push(options); },
            dismissScanner: async () => {},
        };
    `,
    'expo-router': `
        import React from 'react';
        const go = (path, method) => {
            history[method]({}, '', path + location.search);
            dispatchEvent(new PopStateEvent('popstate'));
        };
        const router = { push: path => go(path, 'pushState'), navigate: path => go(path, 'pushState'), replace: path => go(path, 'replaceState') };
        export const useRouter = () => router;
        export const usePathname = () => location.pathname;
        export function Redirect({ href }) { React.useEffect(() => router.replace(href), [href]); return null; }
        export const Stack = { Screen: () => null };
    `,
    '@/auth/AuthContext': `
        const auth = { isAuthenticated: true, credentials: { token: '${accountToken}', secret: '${accountSecret.toString('base64url')}' } };
        export const useAuth = () => auth;
    `,
    '@/sync/storage': `
        import React from 'react';
        const profile = { id: 'fixture-account', firstName: null, lastName: null, avatar: null, github: null, connectedServices: [] };
        export const useProfile = () => profile;
        export const useSetting = () => false;
        export const useSettingMutable = () => React.useState(false);
    `,
    '@/sync/sync': `export const sync = { anonID: 'fixture-account', serverID: 'fixture-server', refreshProfile: async () => {} };`,
    '@/sync/serverConfig': `export const getServerUrl = () => location.origin; export const isUsingCustomServer = () => false;`,
    '@/sync/apiSocket': `export const getHappyHerdClientId = () => 'account-link-browser-fixture';`,
    '@/sync/apiGithub': `export const disconnectGitHub = async () => {}; export const getGitHubOAuthParams = async () => ({ url: '' });`,
    '@/sync/apiServices': `export const disconnectService = async () => {};`,
    '@/sync/apiPush': `export const fetchPushTokens = async () => [];`,
    '@/sync/pushRegistration': `
        export const getCurrentPushDeviceMetadata = () => ({ deviceName: 'Fixture browser' });
        export const getCurrentExpoPushToken = async () => null;
        export const getPushPermissionInfo = async () => ({ status: 'unsupported', granted: false, canAskAgain: false });
        export const requestPushPermissionOrOpenSettings = async () => ({});
        export const removePushToken = async () => {};
        export const syncCurrentPushToken = async () => ({});
    `,
    '@/components/Avatar': `export const Avatar = () => null;`,
    '@/components/AnimatedOverlay': `export const AnimatedBlurBackdrop = () => null;`,
    '@/track': `export const trackWhatsNewClicked = () => {};`,
    '@/text': `import en from '@/text/locales/en.json'; export const t = key => key.split('.').reduce((value, part) => value?.[part], en) ?? key;`,
    'unused-custom-modal': `export const CustomModal = () => null;`,
};
const plugin: Plugin = {
    name: 'account-link-production-host',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, args => {
            if (args.path === './components/CustomModal' && args.importer.endsWith('/modal/ModalProvider.tsx')) return { path: 'unused-custom-modal', namespace: 'boundary' };
            if (Object.hasOwn(modules, args.path)) return { path: args.path, namespace: 'boundary' };
            if (args.path.startsWith('@/')) {
                const base = resolve(appRoot, 'sources', args.path.slice(2));
                const path = [base, `${base}.web.tsx`, `${base}.tsx`, `${base}.web.ts`, `${base}.ts`, `${base}.json`, `${base}/index.ts`].find(candidate => existsSync(candidate) && statSync(candidate).isFile());
                if (!path) throw new Error(`Missing account-link fixture source: ${args.path}`);
                return { path };
            }
            return null;
        });
        bundle.onLoad({ filter: /.*/, namespace: 'boundary' }, args => ({ contents: modules[args.path], loader: 'tsx', resolveDir: appRoot }));
    },
};

describe('Settings → Account → Link New Device production journey', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;
    const approvals: { publicKey: string; response: string; authorization?: string; client?: string }[] = [];
    const requests = new Set<string>();

    beforeAll(async () => {
        const bundle = await build({
            stdin: {
                contents: `
                    import React from 'react'; import { createRoot } from 'react-dom/client';
                    import SettingsScreen from '@/app/(app)/settings/index';
                    import AccountScreen from '@/app/(app)/settings/account';
                    import { ModalProvider } from '@/modal/ModalProvider';
                    import sodium from '@/encryption/libsodium.lib';
                    globalThis.__SCANNER_CALLS__ = [];
                    const subscribe = callback => { addEventListener('popstate', callback); return () => removeEventListener('popstate', callback); };
                    function Host() {
                        const path = React.useSyncExternalStore(subscribe, () => location.pathname);
                        return <ModalProvider>{path === '/settings/account' ? <AccountScreen /> : <SettingsScreen />}</ModalProvider>;
                    }
                    sodium.ready.then(() => createRoot(document.getElementById('root')).render(<Host />));
                `,
                loader: 'tsx', resolveDir: appRoot,
            },
            bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
            define: { __DEV__: 'false', 'process.env.NODE_ENV': '"test"', 'process.env.EXPO_OS': '"web"' },
            resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.js', '.js', '.json'],
            loader: { '.png': 'dataurl', '.webp': 'dataurl', '.js': 'jsx', '.ttf': 'dataurl' }, plugins: [plugin],
        });
        const script = bundle.outputFiles[0].text.replaceAll('</script', '<\\/script');
        const themeCss = readFileSync(resolve(appRoot, 'sources/theme.css'), 'utf8');
        const fontNames = ['SpaceGrotesk-Regular', 'SpaceGrotesk-Medium', 'SpaceGrotesk-SemiBold', 'JetBrainsMono-Regular', 'JetBrainsMono-SemiBold'];
        const fontCss = fontNames.map(name => `@font-face{font-family:'${name}';src:url(data:font/ttf;base64,${readFileSync(resolve(appRoot, 'sources/assets/fonts', `${name}.ttf`)).toString('base64')})}`).join('')
            + `@font-face{font-family:ionicons;src:url(data:font/ttf;base64,${readFileSync(resolve(appRoot, '../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf')).toString('base64')})}`;
        server = createServer(async (request, response) => {
            if (request.method === 'POST') {
                let raw = '';
                for await (const chunk of request) raw += chunk;
                const body = JSON.parse(raw) as { publicKey: string; response: string };
                response.setHeader('content-type', 'application/json');
                if (request.url === '/v1/auth/account/request') {
                    requests.add(body.publicKey);
                    const approved = approvals.find(entry => entry.publicKey === body.publicKey);
                    response.end(JSON.stringify(approved ? { state: 'authorized', token: accountToken, response: approved.response } : { state: 'requested' }));
                } else if (request.url === '/v1/auth/account/response') {
                    approvals.push({ ...body, authorization: request.headers.authorization, client: request.headers['x-happy-client'] as string });
                    response.end(JSON.stringify({ success: true }));
                } else { response.statusCode = 404; response.end('{}'); }
                return;
            }
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{height:100%;margin:0}*{box-sizing:border-box}</style><style>${fontCss}${themeCss}</style><main id="root"></main><script>globalThis.global=globalThis;globalThis.process={env:{NODE_ENV:"test"}};${script}</script>`);
        });
        await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Account link fixture did not bind');
        origin = `http://127.0.0.1:${address.port}`;
        await mkdir(evidenceDir, { recursive: true });
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({ ...(executablePath ? { executablePath } : { channel: 'chrome' }), headless: true, args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
    }, 60_000);
    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>(done => server.close(() => done()));
    });

    async function openAccount(page: Page, suffix = '') {
        await page.goto(`${origin}/settings${suffix}`);
        // Desktop production Settings redirects to Account; mobile exposes its Account row.
        if (page.viewportSize()!.width < 1000) await page.getByRole('button', { name: en.settings.account, exact: true }).click();
        await page.getByText(en.settingsAccount.linkNewDevice, { exact: true }).waitFor();
        expect(new URL(page.url()).pathname).toBe('/settings/account');
        await page.evaluate(() => document.fonts.ready);
    }

    async function settleModal(content: Locator) {
        await expect.poll(() => content.evaluate(node => {
            for (let parent: Element | null = node; parent; parent = parent.parentElement) {
                if (Number(getComputedStyle(parent).opacity) < 1) return false;
            }
            return true;
        })).toBe(true);
    }

    for (const [surface, viewport] of [
        ['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }],
    ] as const) {
        it(`${surface}: approves the printed link, authenticates the machine, and refuses wrong text without a request`, async () => {
            const page = await browser.newPage({ viewport });
            page.setDefaultTimeout(5_000);
            const errors: string[] = [];
            page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
            page.on('dialog', dialog => { errors.push(`Unexpected browser dialog: ${dialog.type()}`); void dialog.dismiss(); });
            const output: string[] = [];
            const capture = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => output.push(args.join(' ')));
            const homeDir = await mkdtemp(resolve(evidenceDir, `${surface}-control-home-`));
            const config = { serverUrl: origin, homeDir, credentialPath: resolve(homeDir, 'agent.key') };
            try {
                await openAccount(page);
                const dimensions = await page.evaluate(() => ({ innerWidth, scrollWidth: document.documentElement.scrollWidth }));
                expect(dimensions.scrollWidth).toBe(dimensions.innerWidth);
                await page.screenshot({ path: resolve(evidenceDir, `${surface}-item.png`) });
                const before = approvals.length;
                const login = authLogin(config);
                // Read the link actually printed by the existing machine-auth implementation.
                await expect.poll(() => output.find(line => line.startsWith('- URL:'))).toBeTruthy();
                const link = output.find(line => line.startsWith('- URL:'))!.match(/`(happyherd:\/\/\/account\?[^`]+)`/)![1];
                const publicKey = Buffer.from(link.split('?')[1], 'base64url').toString('base64');
                expect(requests.has(publicKey)).toBe(true);
                await page.getByText(en.settingsAccount.linkNewDevice, { exact: true }).click();
                const input = page.getByRole('textbox');
                await input.fill(link);
                await input.press('Home');
                await settleModal(input);
                expect(await input.evaluate(node => getComputedStyle(node).fontSize)).toBe('16px');
                await page.screenshot({ path: resolve(evidenceDir, `${surface}-pasted-link.png`) });
                await page.getByRole('button', { name: en.common.ok, exact: true }).click();
                await page.getByText(en.modals.deviceLinkedSuccessfully, { exact: true }).waitFor();
                await login;
                expect(approvals.length).toBe(before + 1);
                expect(approvals.at(-1)).toMatchObject({ publicKey, authorization: `Bearer ${accountToken}`, client: 'account-link-browser-fixture' });
                expect(readCredentials(config)?.secret).toEqual(new Uint8Array(accountSecret));
                const statusStart = output.length;
                await authStatus(config, { loginCommand: 'happyherd machine auth login' });
                const status = output.slice(statusStart).join('\n');
                expect(status).toContain('- Status: Authenticated');
                await writeFile(resolve(evidenceDir, `${surface}-auth-status.txt`), `${status}\n`);
                await page.screenshot({ path: resolve(evidenceDir, `${surface}-success.png`) });
                await page.getByRole('button', { name: en.common.ok, exact: true }).click();

                await page.getByText(en.settingsAccount.linkNewDevice, { exact: true }).click();
                await input.fill('not a device link');
                await page.getByRole('button', { name: en.common.ok, exact: true }).click();
                await page.getByText(en.modals.invalidAuthUrl, { exact: true }).waitFor();
                await settleModal(page.getByText(en.modals.invalidAuthUrl, { exact: true }));
                expect(approvals.length).toBe(before + 1);
                await page.screenshot({ path: resolve(evidenceDir, `${surface}-invalid-text.png`) });
                await page.getByRole('button', { name: en.common.ok, exact: true }).click();
                await page.getByText(en.settingsAccount.linkNewDevice, { exact: true }).click();
                expect(await input.inputValue()).toBe('');
                await page.getByRole('button', { name: en.common.cancel, exact: true }).click();
                expect(approvals.length).toBe(before + 1);
                expect(errors).toEqual([]);
                await writeFile(resolve(evidenceDir, `${surface}-boundary.json`), JSON.stringify({
                    viewport, dimensions, route: '/settings/account', approvedPublicKey: publicKey,
                    approvalRequests: 1, invalidTextApprovalRequests: 0, persistedSecretMatches: true,
                    status: 'Authenticated', realEncryption: true, fixtureServer: 'loopback',
                }, null, 2));
            } finally {
                capture.mockRestore();
                await page.close();
            }
        }, 30_000);
    }

    it('native platform adapter preserves the scanner entry and opens no text prompt', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const errors: string[] = [];
        page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
        try {
            await openAccount(page, '?platform=ios');
            const before = approvals.length;
            await page.getByText(en.settingsAccount.linkNewDevice, { exact: true }).click();
            await expect.poll(() => page.evaluate(() => (globalThis as any).__SCANNER_CALLS__)).toEqual([{ barcodeTypes: ['qr'] }]);
            expect(await page.getByRole('textbox').count()).toBe(0);
            expect(approvals.length).toBe(before);
            expect(errors).toEqual([]);
        } finally { await page.close(); }
    }, 15_000);
});
