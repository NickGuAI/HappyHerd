import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@babel/core';
import { chromium, type Browser, type Page } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../../..');
const sourcesRoot = resolve(appRoot, 'sources');

/**
 * The fluid shell is rendered through the same Unistyles Babel transform and
 * web runtime the Expo build uses, so `_web._classNames`, the theme.css motion
 * layer and hover reveals are exercised for real. Only data, navigation and
 * unrelated product surfaces are stubbed.
 */
const PRODUCTION_STYLE_FILES = /components\/(SidebarNavigator|SidebarView|SidebarNavigationButton|FlatSessionRow|ActiveSessionsGroupCompact|StyledText|herd\/[A-Za-z/]+)\.tsx$/;

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
    'react-native-unistyles': `
        import { theme } from 'fixture-theme';
        export const StyleSheet = {
            create: (factory) => typeof factory === 'function' ? factory(theme, {}) : factory,
            hairlineWidth: 1,
            absoluteFillObject: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
        };
        export const useUnistyles = () => ({ theme });
        export const UnistylesRuntime = { setAdaptiveThemes() {}, setTheme() {}, setRootViewBackgroundColor() {} };
    `,
    '@expo/vector-icons': `
        import React from 'react';
        const Icon = ({ name, color, size }) => React.createElement('span', {
            'data-icon': name, 'aria-hidden': true,
            style: { color, fontSize: size, width: size, height: size, lineHeight: size + 'px', textAlign: 'center', display: 'inline-block' },
        }, name.includes('back') ? '‹' : name.includes('forward') ? '›' : name.includes('down') ? '⌄' : name.includes('ellipsis') ? '⋯' : '•');
        Icon.glyphMap = {};
        export const Ionicons = Icon; export const Octicons = Icon; export const MaterialCommunityIcons = Icon;
    `,
    'expo-image': `
        import React from 'react';
        export const Image = ({ style, tintColor }) => {
            const flat = Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity).filter(Boolean)) : (style ?? {});
            return React.createElement('span', { 'data-image': 'true', style: { display: 'inline-block', width: flat.width, height: flat.height, borderRadius: 4, background: tintColor ?? '#888' } });
        };
    `,
    'expo-router': `
        import React from 'react';
        let pathname = '/';
        const listeners = new Set();
        const record = (path) => { window.__ROUTER_CALLS__ = [...(window.__ROUTER_CALLS__ ?? []), path]; pathname = path; listeners.forEach((l) => l()); };
        const router = { push: record, navigate: record, replace: record, back() { window.__ROUTER_BACK_COUNT__ = (window.__ROUTER_BACK_COUNT__ ?? 0) + 1; } };
        export const useRouter = () => router;
        export const usePathname = () => React.useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => pathname, () => pathname);
    `,
    'expo-router/drawer': `
        import React from 'react';
        import { View, Text } from 'react-native';
        export const Drawer = ({ screenOptions, drawerContent }) => {
            const width = screenOptions.drawerStyle.width;
            return React.createElement(View, { style: { flex: 1, flexDirection: 'row' } },
                React.createElement(View, { testID: 'navigation-drawer', style: [screenOptions.drawerStyle, { height: '100%' }] }, drawerContent ? drawerContent() : null),
                React.createElement(View, { testID: 'navigation-screen', style: { flex: 1, padding: 24 } },
                    React.createElement(Text, { style: { fontSize: 13, opacity: 0.6 } }, 'Session screen (M3 slice) · drawer width ' + width)));
        };
    `,
    'react-native-safe-area-context': `
        import React from 'react';
        export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });
        export const SafeAreaInsetsContext = React.createContext(null);
    `,
    'react-native-reanimated': `export const useReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;`,
    'react-native-gesture-handler': `import React from 'react'; export const Swipeable = React.forwardRef(({ children }, _ref) => children);`,
    '@/auth/AuthContext': `export const useAuth = () => ({ isAuthenticated: true });`,
    '@/utils/responsive': `export const useIsTablet = () => true; export const useHeaderHeight = () => 56; export const useDeviceType = () => 'tablet';`,
    '@/utils/isTauri': `export const isTauri = () => false;`,
    '@/hooks/useTauriZoom': `export const DEFAULT_APP_ZOOM = 1;`,
    '@/navigation/browserNavigation': `
        export const canUseRouteBack = () => true;
        export const canRouteForward = () => true;
        export const getNavigatorCanGoBack = () => true;
    `,
    '@/navigation/browserNavigationStore': `
        const state = { routeHistory: {}, markRouteBack() {}, markRouteForward() { window.__ROUTE_FORWARD__ = (window.__ROUTE_FORWARD__ ?? 0) + 1; } };
        export const useBrowserNavigationStore = (selector) => selector(state);
        useBrowserNavigationStore.getState = () => state;
    `,
    '@/-session/sessionOverlayNav': `
        const state = { canBack: false, canForward: false, back: () => false, forward: () => false };
        export const useOverlayNav = (selector) => selector(state);
        useOverlayNav.getState = () => state;
    `,
    '@/sync/storage': `
        import React from 'react';
        const settings = { navigationSidebarCollapsed: false, zenMode: false, machineWorkspace: true, hideInactiveSessions: true, commandPaletteEnabled: true };
        const listeners = new Set();
        const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
        const emit = () => listeners.forEach((l) => l());
        const read = (key) => React.useSyncExternalStore(subscribe, () => settings[key], () => settings[key]);
        const write = (key) => (value) => { settings[key] = value; emit(); };
        const now = 1_800_000_000_000;
        const machines = [
            { id: 'studio-mac', active: true, createdAt: 3, metadata: { host: 'studio-mac', displayName: 'studio-mac', platform: 'darwin' } },
            { id: 'gpu-lab', active: false, createdAt: 2, metadata: { host: 'gpu-lab', platform: 'linux' } },
            { id: 'build-box', active: true, createdAt: 1, metadata: { host: 'build-box', platform: 'linux' } },
        ];
        const feed = [
            { id: 'feed-1', body: { kind: 'text', text: 'Automation "Nightly triage" finished' } },
            { id: 'feed-2', body: { kind: 'text', text: 'Session "Refresh token rotation" needs approval' } },
        ];
        const requests = [{ id: 'friend-1' }, { id: 'friend-2' }];
        export const useLocalSetting = read;
        export const useLocalSettingMutable = (key) => [read(key), write(key)];
        export const useSetting = read;
        export const useSettingMutable = (key) => [read(key), write(key)];
        export const useAllMachines = () => machines;
        export const useFeedItems = () => feed;
        export const useFriendRequests = () => requests;
        export const useRealtimeStatus = () => 'disconnected';
        export const useSessionGitStatus = () => null;
        export const storage = { getState: () => ({ localSettings: settings, applyLocalSettings(delta) { Object.assign(settings, delta); emit(); } }) };
        window.__SETTINGS__ = settings;
    `,
    '@/hooks/useVisibleSessionListViewData': `export const useHasArchivedSessions = () => true;`,
    '@/hooks/useInboxHasContent': `export const useInboxHasContent = () => true;`,
    '@/hooks/useNewSessionDraft': `
        import React from 'react';
        const state = { selectedMachineId: 'studio-mac', setMachineId(id) { window.__DRAFT_MACHINE_WRITES__ = [...(window.__DRAFT_MACHINE_WRITES__ ?? []), id]; state.selectedMachineId = id; listeners.forEach((l) => l()); } };
        const listeners = new Set();
        window.__SET_DRAFT_MACHINE__ = (id) => { state.selectedMachineId = id; listeners.forEach((l) => l()); };
        export const useNewSessionDraft = (selector) => React.useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => selector(state), () => selector(state));
    `,
    '@/components/FocusModeControl': `
        import React from 'react';
        import { Pressable, Text } from 'react-native';
        export function FocusModeControl() {
            return React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: 'Focus mode', testID: 'focus-mode-enter', style: { height: 32, paddingHorizontal: 10, justifyContent: 'center' } },
                React.createElement(Text, { style: { fontSize: 12.5, opacity: 0.8 } }, 'Focus mode'));
        }
    `,
    '@/components/FeedItemCard': `
        import React from 'react';
        import { Pressable, Text } from 'react-native';
        import { useRouter } from 'expo-router';
        export const FeedItemCard = ({ item }) => {
            const router = useRouter();
            return React.createElement(Pressable, { testID: 'feed-item', onPress: () => router.push('/feed/' + item.id), style: { padding: 10 } }, React.createElement(Text, null, item.body.text));
        };
    `,
    '@/components/UpdateBanner': `export const UpdateBanner = () => null;`,
    '@/components/VoiceAssistantStatusBar': `export const VoiceAssistantStatusBar = () => null;`,
    '@/components/ShortcutHints': `
        export const ShortcutHintBadge = () => null;
        export const SessionShortcutHintBadge = () => null;
        export const useShortcutHints = () => ({ visible: false, modifier: null, browserSafeShortcuts: true, sessionShortcutNumbers: {} });
    `,
    '@/components/SessionStatusAvatar': `
        import React from 'react';
        import { View } from 'react-native';
        export const SessionStatusAvatar = ({ size, state }) => React.createElement(View, {
            style: { width: size, height: size, borderRadius: size / 2, borderWidth: 3, borderColor: state === 'permission_required' || state === 'input_required' ? '#c9a15d' : state === 'thinking' ? '#8fa3b8' : '#999', opacity: 0.85 },
        });
    `,
    '@/components/SessionActionsPopover': `
        import React from 'react';
        export const SessionActionsPopover = ({ anchor, visible, onClose }) => visible && anchor ? React.createElement('div', {
            'data-testid': 'session-actions-popover', 'data-anchor': JSON.stringify(anchor), onClick: onClose,
            style: { position: 'fixed', left: anchor.x, top: anchor.y + (anchor.height ?? 0) + 8, width: 240, height: 120, background: '#222', color: '#fff', zIndex: 50 },
        }, 'Session actions') : null;
    `,
    '@/components/RigGitLineChanges': `
        import React from 'react';
        import { Text } from 'react-native';
        export const RigGitLineChanges = ({ insertions, deletions }) => React.createElement(Text, { style: { fontSize: 11, fontFamily: 'JetBrainsMono-Regular' } }, '+' + insertions + ' −' + deletions);
    `,
    '@/components/MainView': `
        export { FixtureSessionList as MainView } from '${resolve(here, '__testdata__/herdShellFixtureList.tsx')}';
    `,
    '@/hooks/useNavigateToSession': `
        import { selectFixtureSession } from '${resolve(here, '__testdata__/herdShellFixtureState.ts')}';
        export const useSessionPressHandlers = (id) => ({ onPress: () => selectFixtureSession(id), onPressIn: () => {} });
    `,
    '@/hooks/useSessionQuickActions': `export const useSessionActionAlert = () => () => {};`,
    '@/hooks/useHappyHerdAction': `export const useHappyHerdAction = () => [false, () => {}];`,
    '@/sync/ops': `export const sessionKill = async () => ({ success: true }); export const machineBash = async () => ({ success: false });`,
    '@/utils/sessionListTimestamp': `export const formatSessionListTimestamp = () => '2m';`,
    '@/text': `
        const labels = {
            'navigation.collapseSidebar': 'Collapse navigation sidebar', 'navigation.expandSidebar': 'Expand navigation sidebar',
            'zen.toggle': 'Zen mode', 'sidebar.sessionsTitle': 'HappyHerd', 'common.back': 'Back', 'common.forward': 'Forward',
            'commandPalette.placeholder': 'Type a command or search...', 'tabs.inbox': 'Inbox', 'inbox.updates': 'Updates',
            'inbox.emptyTitle': 'Empty Inbox', 'friends.pendingRequests': 'Pending Requests', 'settings.machines': 'Machines',
            'sessionInfo.viewMachine': 'View Machine', 'status.online': 'online', 'status.offline': 'offline',
            'status.permissionRequired': 'permission required', 'status.inputRequired': 'waiting for your answer',
            'sessionInfo.quickActions': 'Quick Actions', 'workspace.title': 'Workspace', 'sidebar.projects': 'Projects',
            'happyHerd.automations.title': 'Automations', 'sidebar.newSession': 'New session', 'settings.title': 'Settings',
            'sidebar.showArchived': 'Show archived', 'sidebar.hideArchived': 'Hide archived', 'superSession.pinned': 'Assistant',
            'agentInput.agent.claude': 'Claude', 'agentInput.agent.codex': 'Codex', 'agentInput.agent.gemini': 'Gemini',
            'agentInput.agent.grok': 'GrokBuild', 'agentInput.agent.dsh': 'dsh', 'sessionInfo.archiveSession': 'Archive',
        };
        export const t = (key) => labels[key] ?? key;
    `,
};

const fixturePlugin: Plugin = {
    name: 'herd-shell-browser-fixture',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, (args) => {
            if (args.path.startsWith('react-native-unistyles/components/native/')) {
                return { path: resolve(appRoot, '../../node_modules/react-native-unistyles/lib/module/components/native', `${args.path.split('/').at(-1)}.js`) };
            }
            if (args.path === 'react-native-unistyles' && PRODUCTION_STYLE_FILES.test(args.importer)) {
                return { path: 'production-styles', namespace: 'fixture-stub' };
            }
            if (args.path === './MainView' && args.importer.endsWith('/SidebarView.tsx')) {
                return { path: '@/components/MainView', namespace: 'fixture-stub' };
            }
            const relative = args.path.startsWith('.') && args.importer.startsWith(sourcesRoot)
                ? '@/' + resolve(dirname(args.importer), args.path).slice(sourcesRoot.length + 1)
                : null;
            if (relative && relative in virtualModules) return { path: relative, namespace: 'fixture-stub' };
            if (args.path in virtualModules) return { path: args.path, namespace: 'fixture-stub' };
            if (args.path.startsWith('@/')) {
                const sourcePath = resolve(sourcesRoot, args.path.slice(2));
                const path = [sourcePath, `${sourcePath}.ts`, `${sourcePath}.tsx`].find(existsSync);
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

/**
 * Starts watching the page for an element with `testId` and `className` (for
 * example a leaving overlay, which is redrawn on the exit layer). The watch is
 * in place when this resolves; the returned check reports whether such an
 * element appeared, waiting up to 2 s.
 */
async function watchClass(page: Page, testId: string, className: string): Promise<() => Promise<boolean>> {
    await page.evaluate(([id, name]) => {
        const selector = `[data-testid="${id}"].${name}`;
        (window as any).__HERD_CLASS_SEEN__ = new Promise<boolean>((resolve) => {
            const observer = new MutationObserver(() => {
                if (!document.querySelector(selector)) return;
                observer.disconnect();
                resolve(true);
            });
            observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
            setTimeout(() => { observer.disconnect(); resolve(false); }, 2_000);
        });
    }, [testId, className] as const);
    return () => page.evaluate(() => (window as any).__HERD_CLASS_SEEN__ as Promise<boolean>);
}

describe('HappyHerd fluid shell in the production style runtime', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            entryPoints: [resolve(here, '__testdata__/herdShell.browser.fixture.tsx')],
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
            sourcemap: 'inline',
            define: { __DEV__: 'false', 'process.env.EXPO_OS': '"web"', 'process.env.NODE_ENV': '"test"' },
            jsx: 'automatic',
            loader: { '.png': 'dataurl', '.ttf': 'dataurl', '.js': 'jsx' },
            resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.js', '.js', '.json'],
            plugins: [fixturePlugin],
        });
        const script = bundle.outputFiles[0].text;
        const themeCss = readFileSync(resolve(sourcesRoot, 'theme.css'), 'utf8');
        server = createServer((request, response) => {
            const url = new URL(request.url ?? '/', 'http://fixture.test');
            const font = url.pathname.match(/^\/fonts\/((SpaceGrotesk|JetBrainsMono)-[A-Za-z]+)\.ttf$/);
            if (font) {
                response.setHeader('content-type', 'font/ttf');
                response.end(readFileSync(resolve(sourcesRoot, 'assets/fonts', `${font[1]}.ttf`)));
                return;
            }
            const background = url.searchParams.get('theme') === 'dark' ? '#151B28' : '#FFF9EC';
            response.setHeader('content-type', 'text/html; charset=utf-8');
            const navigationProbe = `window.__UNHANDLED_ESCAPES__=0;window.addEventListener('keydown',function(e){if(e.key==='Escape'&&!e.defaultPrevented)window.__UNHANDLED_ESCAPES__++;});`;
            response.end(`<script>${navigationProbe}</script><style>${['SpaceGrotesk-Regular', 'SpaceGrotesk-Medium', 'SpaceGrotesk-SemiBold', 'JetBrainsMono-Regular', 'JetBrainsMono-SemiBold'].map((family) => `@font-face{font-family:${family};src:url(/fonts/${family}.ttf)}`).join('')}html,body,#root{height:100%;margin:0;background:${background}}*{box-sizing:border-box}</style><style>${themeCss}</style><main id="root"></main><script>globalThis.global=globalThis;${script.replaceAll('</script', '<\\/script')}</script>`);
        });
        await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('shell fixture did not bind');
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

    async function openShell(options: { theme?: 'light' | 'dark'; width?: number; reducedMotion?: boolean } = {}) {
        const page = await browser.newPage({ viewport: { width: options.width ?? 1440, height: 900 } });
        page.setDefaultTimeout(4_000);
        await page.emulateMedia({ reducedMotion: options.reducedMotion ? 'reduce' : 'no-preference' });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
        await page.goto(`${origin}/?theme=${options.theme ?? 'light'}`);
        await page.getByTestId('herd-top-bar').waitFor();
        await page.evaluate(() => document.fonts.ready);
        return { page, errors };
    }

    async function evidence(page: Page, name: string) {
        const directory = process.env.HERD_SHELL_EVIDENCE_DIR?.trim();
        if (!directory) return;
        mkdirSync(directory, { recursive: true });
        await page.screenshot({ path: resolve(directory, `${name}.png`) });
    }

    const row = (page: Page, id: string) => page.locator(`[data-herd-row="${id}"]`);
    const classList = (page: Page, selector: string) => page.locator(selector).first().evaluate((element) => [...element.classList]);

    it('applies the motion and reveal hooks through Unistyles on the real DOM', async () => {
        const { page, errors } = await openShell();
        expect(await classList(page, '[data-testid="navigation-sidebar-toggle"]')).toEqual(expect.arrayContaining(['herd-transition', 'herd-press']));
        expect(await classList(page, '[data-herd-row="auth"]')).toEqual(expect.arrayContaining(['herd-row', 'herd-transition', 'herd-slide-left']));
        expect(await classList(page, '[data-herd-row="dock"]')).toEqual(expect.arrayContaining(['herd-slide-left', 'herd-d1']));
        expect(await classList(page, '[data-testid="navigation-sidebar-edge-toggle"]')).toContain('herd-shell-reveal');
        expect(await page.locator('.herd-shell').count()).toBe(1);
        // Every radius on the restyled nav buttons comes from the token scale.
        expect(await page.getByLabel('Projects', { exact: true }).evaluate((element) => getComputedStyle(element).borderRadius)).toBe('8px');
        expect(errors).toEqual([]);
        await page.close();
    }, 15_000);

    it('shows a status line for sessions waiting on the user and reveals ⋯ on hover', async () => {
        const { page, errors } = await openShell();
        await expect(row(page, 'auth').getByTestId('session-row-status').innerText()).resolves.toBe('permission required');
        await expect(row(page, 'question').getByTestId('session-row-status').innerText()).resolves.toBe('waiting for your answer');
        expect(await row(page, 'dock').getByTestId('session-row-status').count()).toBe(0);
        await expect(row(page, 'auth').getByText('Claude', { exact: true }).count()).resolves.toBe(1);

        const more = row(page, 'unread').getByTestId('session-row-more');
        await page.mouse.move(1200, 800);
        await expect.poll(() => more.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
        await row(page, 'unread').hover();
        await expect.poll(() => more.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
        await evidence(page, 'shell-row-hover-light-1440');

        await more.click();
        const popover = page.getByTestId('session-actions-popover');
        await popover.waitFor();
        const anchor = JSON.parse((await popover.getAttribute('data-anchor'))!);
        const moreBox = (await more.boundingBox())!;
        expect(anchor.type).toBe('rect');
        expect(Math.abs(anchor.x - moreBox.x)).toBeLessThan(2);
        expect(await more.getAttribute('data-open')).toBe('true');
        // The ⋯ press opens the menu without also opening the session.
        expect(await page.evaluate(() => (window as any).__SELECTED_SESSION__ ?? null)).toBeNull();
        expect(errors).toEqual([]);
        await page.close();
    }, 15_000);

    it('glides the selection highlight from the previous row', async () => {
        const { page, errors } = await openShell();
        await row(page, 'auth').click();
        const firstHighlight = row(page, 'auth').locator('.herd-glide');
        await firstHighlight.waitFor();
        await page.waitForTimeout(500);
        await row(page, 'offline').click();
        const highlight = row(page, 'offline').locator('.herd-glide');
        await highlight.waitFor();
        const during = await highlight.evaluate((element) => getComputedStyle(element).transform);
        expect(during).not.toBe('none');
        const offsetY = Number(during.match(/matrix\(1, 0, 0, 1, 0, (-?[\d.]+)\)/)?.[1]);
        expect(offsetY).toBeLessThan(0);
        await expect.poll(() => highlight.evaluate((element) => getComputedStyle(element).transform), { timeout: 2_000 }).toBe('none');
        expect(await row(page, 'auth').locator('.herd-glide').count()).toBe(0);
        const [highlightBox, rowBox] = [await highlight.boundingBox(), await row(page, 'offline').boundingBox()];
        expect(Math.abs(highlightBox!.y - rowBox!.y)).toBeLessThan(1);
        expect(Math.abs(highlightBox!.height - rowBox!.height)).toBeLessThan(1);
        expect(await highlight.evaluate((element) => getComputedStyle(element).boxShadow)).toContain('inset');
        // A mouse selection leaves the timestamp visible; keyboard focus reveals ⋯.
        await page.mouse.move(1200, 850);
        const selectedMore = row(page, 'offline').getByTestId('session-row-more');
        await expect.poll(() => selectedMore.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
        await evidence(page, 'shell-selected-light-1440');
        await page.keyboard.press('Tab');
        await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('session-row-more');
        await expect.poll(() => selectedMore.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');

        // Workspace grouping's compact rows share the same selection language.
        await row(page, 'compact-a').click();
        await page.waitForTimeout(500);
        await row(page, 'compact-b').click();
        const compactHighlight = row(page, 'compact-b').locator('.herd-glide');
        await compactHighlight.waitFor();
        expect(await compactHighlight.evaluate((element) => getComputedStyle(element).transform)).not.toBe('none');
        await expect.poll(() => compactHighlight.evaluate((element) => getComputedStyle(element).transform), { timeout: 2_000 }).toBe('none');
        await row(page, 'compact-a').hover();
        await expect.poll(() => row(page, 'compact-a').getByTestId('session-row-more').evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
        expect(errors).toEqual([]);
        await page.close();

        const reduced = await openShell({ reducedMotion: true });
        await row(reduced.page, 'auth').click();
        await row(reduced.page, 'auth').locator('.herd-glide').waitFor();
        await row(reduced.page, 'offline').click();
        await expect(row(reduced.page, 'offline').locator('.herd-glide').evaluate((element) => getComputedStyle(element).transform)).resolves.toBe('none');
        await reduced.page.close();
    }, 15_000);

    it('collapses with ⌥⌘B or the top bar toggle: content leaves, then the width snaps', async () => {
        const { page, errors } = await openShell();
        const drawer = page.getByTestId('navigation-drawer');
        const openWidth = (await drawer.boundingBox())!.width;
        expect(openWidth).toBeGreaterThan(300);

        // The exit class and the still-open width, observed in the same frame.
        const exitingWidth = page.waitForFunction(() => {
            const panel = document.querySelector<HTMLElement>('[data-testid="navigation-drawer"]');
            const content = panel?.firstElementChild;
            return content?.classList.contains('herd-exit-left') ? panel!.getBoundingClientRect().width : null;
        }, undefined, { polling: 'raf', timeout: 1_000 });
        // Headless Linux Chromium reports a non-Mac platform: Ctrl+Alt+B.
        await page.keyboard.press('Control+Alt+KeyB');
        expect(await (await exitingWidth).jsonValue()).toBe(openWidth);
        await expect.poll(async () => (await drawer.boundingBox())!.width).toBe(0);
        expect(await page.evaluate(() => (window as any).__SETTINGS__.navigationSidebarCollapsed)).toBe(true);
        const toggle = page.getByTestId('navigation-sidebar-toggle');
        await expect(toggle.getAttribute('aria-label')).resolves.toBe('Expand navigation sidebar');
        await expect(toggle.getAttribute('title')).resolves.toBe('Expand navigation sidebar  Ctrl+Alt+B');
        await evidence(page, 'shell-collapsed-light-1440');

        const enteringWidth = page.waitForFunction(() => {
            const panel = document.querySelector<HTMLElement>('[data-testid="navigation-drawer"]');
            const content = panel?.firstElementChild;
            return content?.classList.contains('herd-slide-left') ? panel!.getBoundingClientRect().width : null;
        }, undefined, { polling: 'raf', timeout: 1_000 });
        await toggle.click();
        expect(await (await enteringWidth).jsonValue()).toBe(openWidth);
        expect(await page.evaluate(() => (window as any).__SETTINGS__.navigationSidebarCollapsed)).toBe(false);
        expect(errors).toEqual([]);
        await page.close();
    }, 15_000);

    it('opens the Inbox updates dropdown and the full Inbox page from the bell', async () => {
        const { page, errors } = await openShell({ theme: 'dark' });
        const bell = page.getByTestId('herd-inbox-bell');
        await expect(bell.getByTestId('herd-inbox-count').innerText()).resolves.toBe('2');
        await bell.click();
        const popover = page.getByTestId('herd-inbox-popover');
        await popover.waitFor();
        expect(await popover.getByTestId('feed-item').count()).toBe(2);
        expect(await popover.getByText('Pending Requests', { exact: true }).count()).toBe(1);
        expect(await popover.evaluate((element) => [...element.classList])).toContain('herd-pop');
        const [bellBox, popoverBox] = [await bell.boundingBox(), await popover.boundingBox()];
        expect(popoverBox!.y).toBeGreaterThan(bellBox!.y + bellBox!.height);
        expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(1440 - 12 + 1);
        await evidence(page, 'shell-inbox-dark-1440');

        // Escape closes the dropdown and never reaches the app's Back handling.
        // The card scales out before it unmounts.
        const exited = await watchClass(page, 'herd-inbox-popover', 'herd-pop-out');
        await page.keyboard.press('Escape');
        await expect(exited()).resolves.toBe(true);
        await expect.poll(() => popover.count()).toBe(0);
        expect(await page.evaluate(() => (window as any).__UNHANDLED_ESCAPES__)).toBe(0);
        await page.keyboard.press('Escape');
        expect(await page.evaluate(() => (window as any).__UNHANDLED_ESCAPES__)).toBe(1);

        await bell.click();
        await page.getByTestId('herd-inbox-open-page').click();
        await expect.poll(() => page.getByTestId('herd-inbox-popover').count()).toBe(0);
        // A destination opened from a preview item closes the dropdown too.
        await bell.click();
        await page.getByTestId('herd-inbox-popover').getByTestId('feed-item').first().click();
        await expect.poll(() => page.getByTestId('herd-inbox-popover').count()).toBe(0);
        expect(await page.evaluate(() => (window as any).__ROUTER_CALLS__)).toEqual(['/inbox', '/feed/feed-1']);
        expect(errors).toEqual([]);
        await page.close();
    }, 15_000);

    it('switches the New Session machine from the machine menu', async () => {
        const { page, errors } = await openShell();
        const pill = page.getByTestId('herd-machine-menu');
        await expect(pill.innerText()).resolves.toContain('studio-mac');
        await expect(pill.innerText()).resolves.toContain('online');
        await pill.click();
        const menu = page.getByTestId('herd-machine-popover');
        await menu.waitFor();
        const options = await menu.locator('[data-testid^="herd-machine-option-"]').evaluateAll((items) => items.map((item) => item.getAttribute('data-testid')));
        expect(options).toEqual(['herd-machine-option-studio-mac', 'herd-machine-option-build-box', 'herd-machine-option-gpu-lab']);
        await expect(menu.getByTestId('herd-machine-option-gpu-lab').isDisabled()).resolves.toBe(true);
        await expect(menu.getByTestId('herd-machine-option-studio-mac').getAttribute('aria-selected')).resolves.toBe('true');
        await evidence(page, 'shell-machine-menu-light-1440');

        await menu.getByTestId('herd-machine-option-build-box').click();
        await expect.poll(() => menu.count()).toBe(0);
        expect(await page.evaluate(() => (window as any).__DRAFT_MACHINE_WRITES__)).toEqual(['build-box']);
        await expect(pill.innerText()).resolves.toContain('build-box');

        await pill.click();
        await page.getByTestId('herd-machine-popover').getByText('View Machine', { exact: true }).click();
        expect(await page.evaluate(() => (window as any).__ROUTER_CALLS__)).toEqual(['/machine/build-box']);

        // A removed daemon stays the New Session target and reads as offline.
        await page.evaluate(() => (window as any).__SET_DRAFT_MACHINE__('removed-daemon'));
        await expect.poll(() => pill.innerText()).toContain('removed-daemon');
        await expect(pill.innerText()).resolves.toContain('offline');
        expect(errors).toEqual([]);
        await page.close();
    }, 15_000);

    it('opens the command palette from the search control and moves through history', async () => {
        const { page, errors } = await openShell();
        await page.getByTestId('herd-command-search').click();
        expect(await page.evaluate(() => (window as any).__PALETTE_OPENS__)).toBe(1);
        await page.getByTestId('herd-top-bar-back').click();
        expect(await page.evaluate(() => (window as any).__ROUTER_BACK_COUNT__)).toBe(1);
        await expect(page.getByTestId('herd-top-bar-forward').isEnabled()).resolves.toBe(true);
        await evidence(page, 'shell-top-bar-light-1440');
        expect(errors).toEqual([]);
        await page.close();

        const dark = await openShell({ theme: 'dark' });
        await row(dark.page, 'dock').click();
        await dark.page.waitForTimeout(500);
        await evidence(dark.page, 'shell-selected-dark-1440');
        await dark.page.close();

        const compact = await openShell({ width: 1024 });
        const search = compact.page.getByTestId('herd-command-search');
        expect((await search.boundingBox())!.width).toBeLessThanOrEqual(40);
        // Tablets have no screen-level Back, so history stays; the brand keeps only its mark.
        expect(await compact.page.getByTestId('herd-top-bar-back').count()).toBe(1);
        expect(await compact.page.getByTestId('herd-top-bar-brand').innerText()).toBe('');
        await evidence(compact.page, 'shell-compact-light-1024');
        await compact.page.close();
    }, 15_000);
});
