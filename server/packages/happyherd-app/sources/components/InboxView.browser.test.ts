import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@babel/core';
import { chromium, type Browser, type Page } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');
const sourcesRoot = resolve(appRoot, 'sources');
const iconsRoot = resolve(appRoot, '../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons');
const productionStyleFiles = /sources\/components\/.*\.tsx$/;

// Production route, Header, cards, bell/popover, read service and unread hook.
// Account storage and transport are fixtures, not authenticated runtime proof.
const virtualModules: Record<string, string> = {
    'react-native': `export * from 'react-native-web';`,
    'fixture-theme': `import { lightTheme, darkTheme } from '@/theme'; export const theme = new URLSearchParams(location.search).get('theme') === 'dark' ? darkTheme : lightTheme;`,
    'react-native-unistyles': `import { theme } from 'fixture-theme'; export const StyleSheet = { create: (factory) => typeof factory === 'function' ? factory(theme, {}) : factory, hairlineWidth: 1 }; export const useUnistyles = () => ({ theme });`,
    '@expo/vector-icons': `import React from 'react'; import glyphs from '${resolve(iconsRoot, 'glyphmaps/Ionicons.json')}'; export const Ionicons = ({ name, size, color }) => React.createElement('span', { 'aria-hidden': true, style: { width: size, height: size, fontFamily: 'ionicons', fontSize: size, color }, 'data-icon': name }, String.fromCodePoint(glyphs[name]));`,
    'expo-image': `import React from 'react'; export const Image = () => React.createElement('span');`,
    'expo-clipboard': `export const setStringAsync = async () => {};`,
    'react-native-keyboard-controller': `export { View as KeyboardAvoidingView } from 'react-native';`,
    'react-native-safe-area-context': `import React from 'react'; export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 }); export const SafeAreaInsetsContext = React.createContext(null);`,
    'expo-router': `
        import React from 'react'; let path = '/inbox'; const listeners = new Set();
        const push = (next) => { window.__NAVIGATION__ = [...(window.__NAVIGATION__ ?? []), next]; path = next; listeners.forEach((listener) => listener()); };
        export const useRouter = () => ({ push });
        export const usePathname = () => React.useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => path);
    `,
    '@/utils/platform': `export const isRunningOnMac = () => false;`,
    '@/utils/responsive': `import { useWindowDimensions } from 'react-native'; export const useIsTablet = () => useWindowDimensions().width >= 700; export const useHeaderHeight = () => 56; export const getDeviceType = () => 'tablet';`,
    '@/components/MobileGlass': `export { View as MobileGlassSurface } from 'react-native';`,
    '@/components/navigation/MobileHeaderScrim': `export const MobileHeaderScrim = () => null; export const MOBILE_HOME_SCRIM_OVERLAY_OPACITY = 1; export const MOBILE_STRONG_HEADER_SCRIM_RESTING_OPACITY = 1; export const MOBILE_STRONG_HEADER_SCRIM_UNDERLAP_OPACITY = 1;`,
    '@/components/BubblePressable': `export { Pressable as BubblePressable } from 'react-native';`,
    '@/components/UserCard': `export const UserCard = () => null;`,
    '@/components/Avatar': `export const Avatar = () => null;`,
    '@/components/UpdateBanner': `export const UpdateBanner = () => null;`,
    '@/components/VoiceAssistantStatusBar': `export const VoiceAssistantStatusBar = () => null;`,
    '@/track': `export const trackFriendsSearch = () => {}; export const trackFriendsProfileView = () => {};`,
    '@/hooks/useUpdates': `export const useUpdates = () => ({ updateAvailable: false });`,
    '@/hooks/useChangelog': `export const useChangelog = () => ({ hasUnread: false });`,
    '@/sync/sync': `export const sync = { getCredentials: () => ({ token: 'inbox-fixture-token' }) };`,
    '@/sync/serverConfig': `export const getServerUrl = () => location.origin;`,
    '@/sync/apiSocket': `export const getHappyHerdClientId = () => 'inbox-fixture';`,
    '@/sync/storage': `
        import React from 'react'; const listeners = new Set(); const emit = () => listeners.forEach((listener) => listener());
        const item = (id, counter, body, readAt = null) => ({ id, counter, cursor: '0-' + counter, repeatKey: null, body, createdAt: Date.now() - 120000, readAt });
        let feed = new URLSearchParams(location.search).has('empty') ? [] : [
            item('text', 3, { kind: 'text', text: 'Nightly audit finished' }),
            item('friend', 2, { kind: 'friend_request', uid: 'ada' }),
            item('accepted', 1, { kind: 'friend_accepted', uid: 'ada' }, 100),
        ];
        if (new URLSearchParams(location.search).has('automation')) feed = [
            item('blocked', 5, { kind: 'automation_blocked', machineId: 'machine-1', automationId: 'automation-1', runId: 'run-1' }),
            item('blocked-done', 4, { kind: 'automation_blocked', machineId: 'machine-1', automationId: 'automation-2', runId: 'run-2' }),
            ...feed,
        ];
        export const useFeedItems = () => React.useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => feed);
        export const useFeedLoaded = () => true; export const useFriendsLoaded = () => true;
        export const useAcceptedFriends = () => []; export const useFriendRequests = () => []; export const useRequestedFriends = () => [];
        export const useRealtimeStatus = () => 'disconnected';
        export const useUser = (id) => id ? { id, firstName: 'Ada', username: 'ada' } : undefined;
        export const useMachine = () => ({ metadata: { displayName: 'Work laptop', host: 'work-host' } });
        export const storage = { getState: () => ({ feedAccount: 'fixture-account', feedItems: feed, feedHead: feed[0]?.cursor ?? null,
            applyFeedRead: (receipt) => { feed = feed.map((entry) => (entry.id === receipt.id || entry.counter <= Number(receipt.through?.slice(2))) && entry.readAt == null ? { ...entry, readAt: receipt.readAt } : entry); emit(); },
        }) };
        window.__ARRIVE__ = () => { feed = [item('incoming', 4, { kind: 'text', text: 'New update during Done' }), ...feed]; emit(); };
    `,
    '@/modal': `export const Modal = { alert: (title, message) => window.alert(title + ': ' + message) };`,
    '@/text': `import en from '@/text/locales/en.json'; export const t = (key, params) => { let value = key.split('.').reduce((node, part) => node?.[part], en) ?? key; if (value.select) value = value.select.cases[params?.[value.select.param] === 1 ? 'one' : 'other']; for (const [name, replacement] of Object.entries(params ?? {})) value = value.split('{' + name + '}').join(String(replacement)); return value; };`,
};
const fixturePlugin: Plugin = {
    name: 'inbox-production-route-fixture',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, (args) => {
            if (args.path.startsWith('react-native-unistyles/components/native/')) return { path: resolve(appRoot, '../../node_modules/react-native-unistyles/lib/module/components/native', `${args.path.split('/').at(-1)}.js`) };
            if (args.path === 'react-native-unistyles' && productionStyleFiles.test(args.importer)) return { path: 'production-styles', namespace: 'inbox-fixture' };
            const relative = args.path.startsWith('.') && args.importer.startsWith(sourcesRoot) ? '@/' + resolve(dirname(args.importer), args.path).slice(sourcesRoot.length + 1) : null;
            if (relative && relative in virtualModules) return { path: relative, namespace: 'inbox-fixture' };
            if (args.path in virtualModules) return { path: args.path, namespace: 'inbox-fixture' };
            if (args.path.startsWith('@/')) {
                const base = resolve(sourcesRoot, args.path.slice(2));
                const path = [base, `${base}.web.tsx`, `${base}.tsx`, `${base}.web.ts`, `${base}.ts`].find(existsSync);
                if (!path) throw new Error(`Missing Inbox fixture source: ${args.path}`);
                return { path };
            }
            return null;
        });
        bundle.onLoad({ filter: /.*/, namespace: 'inbox-fixture' }, (args) => ({
            contents: args.path === 'production-styles' ? `import { theme } from 'fixture-theme'; import { StyleSheet, useUnistyles } from ${JSON.stringify(resolve(appRoot, '../../node_modules/react-native-unistyles/lib/module/index.js'))}; StyleSheet.configure({ themes: { fixture: theme }, settings: { initialTheme: 'fixture' } }); export { StyleSheet, useUnistyles };` : virtualModules[args.path],
            loader: 'tsx', resolveDir: here,
        }));
        bundle.onLoad({ filter: productionStyleFiles }, (args) => {
            const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
            try {
                const transformed = transformSync(readFileSync(args.path, 'utf8'), {
                    filename: args.path, configFile: false, babelrc: false,
                    caller: { name: 'metro', platform: 'web', supportsStaticESM: true } as any,
                    presets: [['babel-preset-expo', { jsxRuntime: 'automatic' }]], plugins: [['react-native-unistyles/plugin', { root: 'sources' }]],
                });
                if (!transformed?.code) throw new Error(`Inbox style transform failed: ${args.path}`);
                return { contents: transformed.code, loader: 'js', resolveDir: dirname(args.path) };
            } finally { process.env.NODE_ENV = previous; }
        });
    },
};

describe('Inbox Done through the production route and shared shell controls', () => {
    let browser: Browser; let server: Server; let origin: string;
    beforeAll(async () => {
        const bundle = await build({
            stdin: { contents: `
                import React from 'react'; import { createRoot } from 'react-dom/client'; import { View, useWindowDimensions } from 'react-native';
                import Inbox from '@/app/(app)/inbox/index'; import { HerdInboxBell } from '@/components/herd/shell/HerdInboxBell';
                import { HerdWindowInsetsContext } from '@/components/herd/shell/windowInsets'; import { HerdTopBarLayoutContext } from '@/components/herd/shell/topBarLayout';
                function Fixture() { const { width } = useWindowDimensions(); return <HerdWindowInsetsContext.Provider value={{ top: 0, right: 0, bottom: 0, left: 0 }}><HerdTopBarLayoutContext.Provider value={width < 700 ? 'phone' : 'desktop'}><View style={{ flex: 1 }}><View style={{ alignItems: 'flex-end', padding: 8 }}><HerdInboxBell /></View><Inbox /></View></HerdTopBarLayoutContext.Provider></HerdWindowInsetsContext.Provider>; }
                createRoot(document.getElementById('root')).render(<Fixture />);
            `, resolveDir: here, loader: 'tsx' },
            bundle: true, write: false, logOverride: { 'ignored-bare-import': 'silent' }, format: 'iife', platform: 'browser', jsx: 'automatic',
            define: { __DEV__: 'false', 'process.env.EXPO_OS': '"web"', 'process.env.NODE_ENV': '"test"' },
            loader: { '.png': 'dataurl', '.ttf': 'dataurl', '.js': 'jsx' }, resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.js', '.js', '.json'], plugins: [fixturePlugin],
        });
        const script = bundle.outputFiles[0].text; const css = readFileSync(resolve(sourcesRoot, 'theme.css'), 'utf8');
        server = createServer((request, response) => {
            if (request.url === '/fonts/Ionicons.ttf') { response.setHeader('content-type', 'font/ttf'); response.end(readFileSync(resolve(iconsRoot, 'Fonts/Ionicons.ttf'))); return; }
            if (request.url?.startsWith('/fonts/')) { response.setHeader('content-type', 'font/ttf'); response.end(readFileSync(resolve(sourcesRoot, 'assets', request.url.slice(1)))); return; }
            response.setHeader('content-type', 'text/html');
            response.end(`<style>${['SpaceGrotesk-Regular', 'SpaceGrotesk-SemiBold', 'JetBrainsMono-Regular'].map((font) => `@font-face{font-family:${font};src:url(/fonts/${font}.ttf)}`).join('')}@font-face{font-family:ionicons;src:url(/fonts/Ionicons.ttf)}html,body,#root{height:100%;margin:0}*{box-sizing:border-box}${css}</style><main id="root"></main><script>globalThis.global=globalThis;${script.replaceAll('</script', '<\\/script')}</script>`);
        });
        await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
        const address = server.address(); if (!address || typeof address === 'string') throw new Error('Inbox fixture did not bind'); origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({ ...(executablePath ? { executablePath } : { channel: 'chrome' }), headless: true, args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
    }, 60_000);
    afterAll(async () => { await browser?.close(); if (server) await new Promise<void>((closed) => server.close(() => closed())); });
    async function open(width: number, theme = 'light', empty = false, automation = false) {
        const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } }); page.setDefaultTimeout(5_000);
        const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`${origin}/inbox?theme=${theme}${empty ? '&empty=1' : ''}${automation ? '&automation=1' : ''}`);
        try { await page.getByRole('button', { name: 'Done', exact: true }).waitFor({ timeout: 4_000 }); } catch (error) { throw new Error('Inbox did not render: ' + errors.join('; '), { cause: error }); } await page.evaluate(() => document.fonts.ready);
        return { page, errors };
    }
    async function capture(page: Page, name: string) {
        const directory = process.env.INBOX_EVIDENCE_DIR?.trim(); if (!directory) return;
        mkdirSync(directory, { recursive: true }); await page.screenshot({ path: resolve(directory, `${name}.png`), animations: 'disabled' });
    }
    const unreadCards = (page: Page) => page.locator('[data-testid^="feed-card-"] [data-testid^="feed-unread-"]');
    async function acknowledge(page: Page) { await page.route('**/v1/feed/read', (route) => route.fulfill({ json: { ...route.request().postDataJSON(), readAt: 1234 } })); }
    for (const width of [1440, 390]) {
        it(`reads automation alerts individually and with Done while retaining detail navigation at ${width}px`, async () => {
            const { page, errors } = await open(width, 'light', false, true);
            let release!: () => void;
            const pending = new Promise<void>((ready) => { release = ready; });
            await page.route('**/v1/feed/read', async (route) => {
                await pending;
                await route.fulfill({ json: { ...route.request().postDataJSON(), readAt: 1234 } });
            });
            expect(await unreadCards(page).count()).toBe(4);
            const request = page.waitForRequest('**/v1/feed/read');
            await page.getByTestId('feed-card-blocked').click();
            expect((await request).postDataJSON()).toEqual({ id: 'blocked' });
            expect(await page.evaluate(() => (window as any).__NAVIGATION__)).toContainEqual({ pathname: '/automations', params: { machineId: 'machine-1', automationId: 'automation-1' } });
            expect(await page.getByTestId('feed-unread-blocked').count()).toBe(1);
            release();
            await page.getByTestId('feed-unread-blocked').waitFor({ state: 'detached' });
            expect(await page.getByTestId('feed-unread-blocked-done').count()).toBe(1);
            expect(await page.getByTestId('herd-inbox-dot').count()).toBe(1);
            await page.getByRole('button', { name: 'Done', exact: true }).click();
            await page.getByTestId('herd-inbox-dot').waitFor({ state: 'detached' });
            expect(await unreadCards(page).count()).toBe(0);
            await page.getByTestId('herd-inbox-bell').click();
            const menu = page.getByTestId('herd-inbox-popover');
            await menu.waitFor();
            await menu.getByRole('button', { name: /blocked by run run-2/ }).click();
            expect(await page.evaluate(() => (window as any).__NAVIGATION__)).toContainEqual({ pathname: '/automations', params: { machineId: 'machine-1', automationId: 'automation-2' } });
            await menu.waitFor({ state: 'detached' });
            expect(errors).toEqual([]);
            await page.close();
        }, 20_000);
        it(`clicks a card then Done, clears the remaining dots and bell at ${width}px`, async () => {
            const { page, errors } = await open(width); await acknowledge(page);
            expect(await unreadCards(page).count()).toBe(2); expect(await page.getByTestId('feed-unread-accepted').count()).toBe(0); expect(await page.getByTestId('herd-inbox-dot').count()).toBe(1);
            await page.getByTestId('feed-card-text').click(); await page.getByTestId('feed-unread-text').waitFor({ state: 'detached' });
            expect(await unreadCards(page).count()).toBe(1); expect(await page.getByTestId('herd-inbox-dot').count()).toBe(1);
            const request = page.waitForRequest('**/v1/feed/read'); await page.getByRole('button', { name: 'Done', exact: true }).click(); expect((await request).postDataJSON()).toEqual({ through: '0-3' });
            await page.getByTestId('herd-inbox-dot').waitFor({ state: 'detached' }); expect(await unreadCards(page).count()).toBe(0);
            // Already-read pages remain actionable to cover older server pages.
            await page.getByRole('button', { name: 'Done', exact: true }).click(); expect(await unreadCards(page).count()).toBe(0);
            await page.getByRole('button', { name: 'Find Friends', exact: true }).click(); expect(await page.evaluate(() => (window as any).__NAVIGATION__)).toContain('/friends/search');
            expect(errors).toEqual([]); await page.close();
        }, 20_000);
        it(`preserves a new arrival during Done and permits retry after failure at ${width}px`, async () => {
            const { page, errors } = await open(width);
            let release!: () => void; const pending = new Promise<void>((ready) => { release = ready; });
            await page.route('**/v1/feed/read', async (route) => { await pending; await route.fulfill({ json: { ...route.request().postDataJSON(), readAt: 1234 } }); });
            const request = page.waitForRequest('**/v1/feed/read'); await page.getByRole('button', { name: 'Done', exact: true }).click(); await request;
            expect(await page.getByTestId('inbox-mark-all-read').getAttribute('aria-disabled')).toBe('true'); expect(await unreadCards(page).count()).toBe(2);
            await page.evaluate(() => (window as any).__ARRIVE__()); release(); await page.getByTestId('feed-unread-text').waitFor({ state: 'detached' });
            expect(await page.getByTestId('feed-unread-incoming').count()).toBe(1); expect(await page.getByTestId('herd-inbox-dot').count()).toBe(1);
            await page.unroute('**/v1/feed/read'); await page.route('**/v1/feed/read', (route) => route.fulfill({ status: 503, json: { error: 'offline' } }));
            const dialog = page.waitForEvent('dialog'); await page.getByRole('button', { name: 'Done', exact: true }).click(); const failure = await dialog;
            expect(failure.message()).toContain('mark updates as read'); await failure.dismiss(); expect(await page.getByTestId('feed-unread-incoming').count()).toBe(1);
            await page.unroute('**/v1/feed/read'); await acknowledge(page); await page.getByRole('button', { name: 'Done', exact: true }).click(); await page.getByTestId('herd-inbox-dot').waitFor({ state: 'detached' });
            expect(await unreadCards(page).count()).toBe(0); expect(errors).toEqual([]); await page.close();
        }, 20_000);
        it(`reads a friend update from the real bell menu and preserves navigation at ${width}px`, async () => {
            const { page, errors } = await open(width); await acknowledge(page); await page.getByTestId('herd-inbox-bell').click();
            const menu = page.getByTestId('herd-inbox-popover'); await menu.waitFor(); await menu.getByRole('button', { name: /Ada/ }).first().click();
            await page.getByTestId('feed-card-friend').getByTestId('feed-unread-friend').waitFor({ state: 'detached' }); await menu.waitFor({ state: 'detached' }); expect(await page.evaluate(() => (window as any).__NAVIGATION__)).toContain('/user/ada');
            expect(await page.getByTestId('feed-unread-text').count()).toBe(1); expect(errors).toEqual([]); await page.close();
        }, 20_000);
        it(`has disabled Done and no bell dot for an empty Inbox at ${width}px`, async () => {
            const { page, errors } = await open(width, 'light', true); expect(await page.getByTestId('inbox-mark-all-read').getAttribute('aria-disabled')).toBe('true');
            expect(await unreadCards(page).count()).toBe(0); expect(await page.getByTestId('herd-inbox-dot').count()).toBe(0); expect(errors).toEqual([]); await page.close();
        });
        for (const theme of ['light', 'dark']) it(`keeps title actions and unread cards visible in ${theme} at ${width}px`, async () => {
            const { page, errors } = await open(width, theme);
            const done = await page.getByRole('button', { name: 'Done', exact: true }).boundingBox(); const find = await page.getByRole('button', { name: 'Find Friends', exact: true }).boundingBox();
            expect(done).not.toBeNull(); expect(find).not.toBeNull(); expect(done!.x + done!.width).toBeLessThanOrEqual(width); expect(Math.abs(done!.y - find!.y)).toBeLessThan(10);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width); await capture(page, `inbox-${width}-${theme}`); expect(errors).toEqual([]); await page.close();
        });
    }
});
