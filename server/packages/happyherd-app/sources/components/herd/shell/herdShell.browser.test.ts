import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@babel/core';
import { chromium, type Browser, type Page } from 'playwright-core';
import { focusPixelSwapTiles } from '@/components/focusPixelSwapTiming';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../../..');
const sourcesRoot = resolve(appRoot, 'sources');
const iconsRoot = resolve(appRoot, '../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons');
// Evidence captures draw the real Ionicons and Octicons glyphs with their bundled fonts.
const REAL_ICON_FONTS = !!process.env.HERD_SHELL_EVIDENCE_DIR?.trim();

/**
 * The fluid shell is rendered through the same Unistyles Babel transform and
 * web runtime the Expo build uses, so `_web._classNames`, the theme.css motion
 * layer and hover reveals are exercised for real. Only data, navigation and
 * unrelated product surfaces are stubbed.
 */
const PRODUCTION_STYLE_FILES = /components\/(FocusModeControl|SidebarNavigator|SidebarView|SidebarNavigationButton|FlatSessionRow|ActiveSessionsGroupCompact|StyledText|herd\/[A-Za-z/]+)\.tsx$/;

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
    // The native sheet's keyboard container; the web renders a plain View.
    'react-native-keyboard-controller': `export { View as KeyboardAvoidingView } from 'react-native';`,
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
    'react-native-reanimated': `
        import { View } from 'react-native';
        export const useReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        // The status dot's pulse, in the connection line on the desktop panel.
        export default { View };
        export const useSharedValue = (value) => ({ value });
        export const useAnimatedStyle = (factory) => factory();
        export const withRepeat = (value) => value;
        export const withTiming = (value) => value;
    `,
    'react-native-gesture-handler': `import React from 'react'; export const Swipeable = React.forwardRef(({ children }, _ref) => children);`,
    '@/auth/AuthContext': `export const useAuth = () => ({ isAuthenticated: true });`,
    // The production device rule, so the shell's own width rule is what keeps it on desktop.
    '@/utils/responsive': `
        export * from '${resolve(sourcesRoot, 'utils/responsive.ts')}';
        export const useHeaderHeight = () => 56;
    `,
    '@/utils/platform': `export const isRunningOnMac = () => false;`,
    '@/utils/isTauri': `export const isTauri = () => false;`,
    '@/hooks/useTauriZoom': `export const DEFAULT_APP_ZOOM = 1;`,
    '@/sync/storage': `
        import React from 'react';
        const settings = { navigationSidebarCollapsed: false, zenMode: false, machineWorkspace: true, hideInactiveSessions: true, commandPaletteEnabled: true, focusMode: new URLSearchParams(window.location.search).get('focus') === 'on' ? { projectId: 'web-app', endsAt: Date.now() + 25 * 60_000, startedAt: Date.now() } : null };
        const listeners = new Set();
        const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
        const emit = () => listeners.forEach((l) => l());
        const read = (key) => React.useSyncExternalStore(subscribe, () => settings[key], () => settings[key]);
        const write = (key) => (value) => { settings[key] = value; emit(); };
        const now = 1_800_000_000_000;
        // ?machines=none: an account without machines; ?machines=loading: not synced yet.
        const machineMode = new URLSearchParams(window.location.search).get('machines');
        const machines = machineMode === 'none' || machineMode === 'loading' ? [] : [
            { id: 'studio-mac', active: true, createdAt: 3, metadata: { host: 'studio-mac', displayName: 'studio-mac', platform: 'darwin' } },
            { id: 'gpu-lab', active: false, createdAt: 2, metadata: { host: 'gpu-lab', platform: 'linux' } },
            { id: 'build-box', active: true, createdAt: 1, metadata: { host: 'build-box', platform: 'linux' } },
        ];
        export const useSessionListViewData = () => (machineMode === 'loading' ? null : []);
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
        export const useProjects = () => ({
            'web-app': { id: 'web-app', name: 'Web App Suite', kind: 'personal' },
            'backend-api': { id: 'backend-api', name: 'Backend API', kind: 'personal' },
            'client-shop': { id: 'client-shop', name: 'Client Shop', kind: 'personal' },
        });
        export const useFeedItems = () => feed;
        export const useFriendRequests = () => requests;
        export const useRealtimeStatus = () => 'disconnected';
        const socket = { status: new URLSearchParams(window.location.search).get('socket') ?? 'connected' };
        export const useSocketStatus = () => socket;
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
    '@/hooks/useSessionQuickActions': `export const useSessionActionAlert = () => () => {};
        export const useSessionArchiveAction = () => ({ archiveSession() {}, archivingSession: false });`,
    '@/hooks/useHappyHerdAction': `export const useHappyHerdAction = () => [false, () => {}];`,
    '@/sync/ops': `export const sessionKill = async () => ({ success: true }); export const machineBash = async () => ({ success: false });`,
    '@/utils/sessionListTimestamp': `export const formatSessionListTimestamp = () => '2m';`,
    '@/text': `
        import en from '${resolve(sourcesRoot, 'text/locales/en.json')}';
        const labels = {
            'navigation.collapseSidebar': 'Collapse navigation sidebar', 'navigation.expandSidebar': 'Expand navigation sidebar',
            'zen.toggle': 'Zen mode', 'sidebar.sessionsTitle': 'HappyHerd', 'common.back': 'Back',
            'commandPalette.placeholder': 'Type a command or search...', 'tabs.inbox': 'Inbox', 'inbox.updates': 'Updates',
            'inbox.emptyTitle': 'Empty Inbox', 'friends.pendingRequests': 'Pending Requests', 'settings.machines': 'Machines',
            'sessionInfo.viewMachine': 'View Machine', 'status.online': 'online', 'status.offline': 'offline',
            'status.permissionRequired': 'permission required', 'status.inputRequired': 'waiting for your answer',
            'status.disconnected': 'disconnected', 'status.connecting': 'connecting', 'status.error': 'error',
            'sessionInfo.quickActions': 'Quick Actions', 'workspace.title': 'Workspace', 'sidebar.projects': 'Projects',
            'happyHerd.automations.title': 'Automations', 'sidebar.newSession': 'New Chat', 'settings.title': 'Settings',
            'sidebar.showArchived': 'Show archived', 'sidebar.hideArchived': 'Hide archived', 'superSession.pinned': 'Assistant',
            'agentInput.agent.claude': 'Claude', 'agentInput.agent.codex': 'Codex', 'agentInput.agent.gemini': 'Gemini',
            'agentInput.agent.grok': 'GrokBuild', 'agentInput.agent.dsh': 'dsh', 'sessionInfo.archiveSession': 'Archive',
            'focusMode.enter': 'Focus mode', 'common.loading': 'Loading...', 'devicePairing.title': 'Connections',
            'topBar.noMachine': 'No machine', 'topBar.addMachine': 'Add a machine', 'topBar.noMachinesYet': 'No machines on this account yet',
        };
        // Keys outside the map read the real English catalog.
        export const t = (key, params) => {
            const value = labels[key] ?? key.split('.').reduce((node, part) => node?.[part], en);
            let text = typeof value === 'string' ? value : key;
            for (const [name, replacement] of Object.entries(params ?? {})) text = text.split('{' + name + '}').join(String(replacement));
            return text;
        };
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

if (REAL_ICON_FONTS) {
    virtualModules['@expo/vector-icons'] = `
        import React from 'react';
        import ionicons from '${resolve(iconsRoot, 'glyphmaps/Ionicons.json')}';
        import octicons from '${resolve(iconsRoot, 'glyphmaps/Octicons.json')}';
        const icon = (map, fontFamily) => {
            const Icon = ({ name, color, size = 16 }) => React.createElement('span', {
                'data-icon': name, 'aria-hidden': true,
                style: { fontFamily, fontStyle: 'normal', fontWeight: 'normal', color, fontSize: size, width: size, height: size, lineHeight: size + 'px', textAlign: 'center', display: 'inline-block', flexShrink: 0, userSelect: 'none' },
            }, map[name] ? String.fromCodePoint(map[name]) : '•');
            Icon.glyphMap = map;
            return Icon;
        };
        export const Ionicons = icon(ionicons, 'ionicons');
        export const Octicons = icon(octicons, 'octicons');
        export const MaterialCommunityIcons = icon({}, 'ionicons');
    `;
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
            const iconFont = url.pathname.match(/^\/fonts\/(Ionicons|Octicons)\.ttf$/);
            if (iconFont) {
                response.setHeader('content-type', 'font/ttf');
                response.end(readFileSync(resolve(iconsRoot, `Fonts/${iconFont[1]}.ttf`)));
                return;
            }
            const background = url.searchParams.get('theme') === 'dark' ? '#151B28' : '#FFF9EC';
            response.setHeader('content-type', 'text/html; charset=utf-8');
            const navigationProbe = `window.__UNHANDLED_ESCAPES__=0;window.addEventListener('keydown',function(e){if(e.key==='Escape'&&!e.defaultPrevented)window.__UNHANDLED_ESCAPES__++;});`;
            response.end(`<script>${navigationProbe}</script><style>${['SpaceGrotesk-Regular', 'SpaceGrotesk-Medium', 'SpaceGrotesk-SemiBold', 'JetBrainsMono-Regular', 'JetBrainsMono-SemiBold'].map((family) => `@font-face{font-family:${family};src:url(/fonts/${family}.ttf)}`).join('')}@font-face{font-family:ionicons;src:url(/fonts/Ionicons.ttf)}@font-face{font-family:octicons;src:url(/fonts/Octicons.ttf)}html,body,#root{height:100%;margin:0;background:${background}}*{box-sizing:border-box}</style><style>${themeCss}</style><main id="root"></main><script>globalThis.global=globalThis;${script.replaceAll('</script', '<\\/script')}</script>`);
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

    async function openShell(options: { theme?: 'light' | 'dark'; width?: number; height?: number; reducedMotion?: boolean; socket?: string; machines?: 'none' | 'loading'; shortcutPlatform?: 'Linux' | 'macOS' } = {}) {
        const page = await browser.newPage({ viewport: { width: options.width ?? 1440, height: options.height ?? 900 } });
        page.setDefaultTimeout(4_000);
        if (options.shortcutPlatform) await page.addInitScript((platform) => {
            Object.defineProperty(navigator, 'platform', { configurable: true, value: platform === 'macOS' ? 'MacIntel' : 'Linux x86_64' });
            Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { platform } });
        }, options.shortcutPlatform);
        await page.emulateMedia({ reducedMotion: options.reducedMotion ? 'reduce' : 'no-preference' });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
        await page.goto(`${origin}/?theme=${options.theme ?? 'light'}${options.socket ? `&socket=${options.socket}` : ''}${options.machines ? `&machines=${options.machines}` : ''}`);
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

    it('shows an unhealthy connection in the desktop panel, and nothing while connected', async () => {
        for (const socket of ['disconnected', 'connecting', 'error']) {
            const { page, errors } = await openShell({ socket });
            const status = page.getByTestId('herd-sidebar').getByTestId('herd-connection-status');
            await status.waitFor();
            await expect(status.innerText()).resolves.toBe(socket);
            await expect(status.getAttribute('aria-live')).resolves.toBe('polite');
            expect(errors).toEqual([]);
            await page.close();
        }
        const { page, errors } = await openShell();
        await page.getByTestId('herd-sidebar').waitFor();
        await expect(page.getByTestId('herd-connection-status').count()).resolves.toBe(0);
        expect(errors).toEqual([]);
        await page.close();
    }, 20_000);

    it('draws the top bar and the panel as the mock: masked brand and Zen marks, Focus mode, the machine pill and the panel icons', async () => {
        for (const [theme, width, height] of [['light', 1440, 900], ['dark', 1440, 900], ['light', 1024, 768], ['dark', 1024, 768]] as const) {
            const { page, errors } = await openShell({ theme, width, height });
            const bar = page.getByTestId('herd-top-bar');
            // The brand mark and Zen icon are CSS masks over a painted fill (no SVG tint filter), so they show on either bar.
            for (const id of ['herd-brand-mark', 'herd-zen-icon']) {
                const paint = await bar.getByTestId(id).evaluate((element) => {
                    const style = getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    return { mask: style.maskImage || (style as any).webkitMaskImage, image: style.backgroundImage, color: style.backgroundColor, filter: style.filter, width: rect.width };
                });
                expect(paint.mask).toMatch(/^url\("data:image\/png/);
                expect(paint.filter).toBe('none');
                expect(paint.width).toBeGreaterThan(0);
                expect(paint.image !== 'none' || paint.color !== 'rgba(0, 0, 0, 0)').toBe(true);
            }
            const brandFill = await bar.getByTestId('herd-brand-mark').evaluate((element) => getComputedStyle(element).backgroundImage);
            expect(brandFill).toBe(theme === 'dark'
                ? 'linear-gradient(160deg, rgb(255, 249, 236) 5%, rgb(240, 220, 176) 45%, rgb(201, 174, 133) 92%)'
                : 'linear-gradient(160deg, rgb(143, 110, 54), rgb(110, 82, 34))');
            // Focus mode is the mock's labelled pill with the focus icon, not a tomato.
            const focus = bar.getByTestId('focus-mode-enter');
            await expect(focus.innerText()).resolves.toBe('Focus mode');
            await expect(focus.locator('[data-herd-icon="focus"]').count()).resolves.toBe(1);
            expect((await focus.boundingBox())!.height).toBe(32);
            await expect(bar.getByTestId('herd-inbox-bell').locator('[data-herd-icon="bell"]').count()).resolves.toBe(1);
            const machine = bar.getByTestId('herd-machine-menu');
            await expect(machine.innerText()).resolves.toMatch(/studio-mac\s*online/);
            await expect(machine.locator('[data-herd-icon="monitor"]').count()).resolves.toBe(1);
            // The panel: the mock's three destinations, New Chat with its pen and shortcut, and Settings.
            const panel = page.getByTestId('herd-sidebar');
            for (const [label, icon] of [['Workspace', 'split'], ['Projects', 'folders'], ['Automations', 'bolt']] as const) {
                await expect(panel.getByRole('button', { name: label, exact: true }).locator(`[data-herd-icon="${icon}"]`).count()).resolves.toBe(1);
            }
            const newSession = panel.getByRole('button', { name: 'New Chat', exact: true });
            await expect(newSession.locator('[data-herd-icon="pen"]').count()).resolves.toBe(1);
            // The mock's kbd names only the key, so the label stays on one line in the narrower panel.
            await expect(newSession.getByTestId('herd-panel-kbd-N').innerText()).resolves.toBe('N');
            expect((await newSession.boundingBox())!.height).toBe(44);
            const settingsRow = page.getByTestId('herd-panel-settings');
            await expect(settingsRow.locator('[data-herd-icon="gear"]').count()).resolves.toBe(1);
            await expect(settingsRow.getByTestId('herd-panel-kbd-,').innerText()).resolves.toBe(',');
            // No browser title tooltips remain on the shell's icon controls.
            await expect(page.locator('[data-testid="herd-top-bar"] [title], [data-testid="herd-sidebar"] [title]').count()).resolves.toBe(0);
            await evidence(page, `shell-top-bar-mock-${theme}-${width}`);
            expect(errors).toEqual([]);
            await page.close();
        }
    }, 60_000);

    it('opens the Focus setup as the mock dialog: a centered card over the dimmed app, title and labels inside', async () => {
        for (const theme of ['light', 'dark'] as const) {
            const { page, errors } = await openShell({ theme });
            await page.getByTestId('focus-mode-enter').click();
            const setup = page.getByTestId('focus-mode-setup');
            await setup.waitFor();
            // Let the sheet's scale-in finish (the rows' attention pulse never ends, so only finite animations).
            await page.evaluate(() => Promise.all(document.getAnimations()
                .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity))
                .map((animation) => animation.finished.catch(() => undefined))));
            const card = (await setup.boundingBox())!;
            expect(card.width).toBe(520);
            expect(Math.abs(card.x + card.width / 2 - 720)).toBeLessThanOrEqual(1);
            expect(Math.abs(card.y + card.height / 2 - 450)).toBeLessThanOrEqual(1);
            const scrim = page.getByTestId('focus-mode-scrim');
            await expect(scrim.evaluate((element) => getComputedStyle(element).backdropFilter)).resolves.toBe('blur(2px)');
            await expect(scrim.getAttribute('aria-hidden')).resolves.toBe('true');
            const centerOf = async (locator: ReturnType<Page['getByText']>) => {
                const box = (await locator.boundingBox())!;
                return box.x + box.width / 2;
            };
            const middle = card.x + card.width / 2;
            await expect(setup.getByTestId('focus-mode-mark').locator('[data-herd-icon="focus"]').count()).resolves.toBe(1);
            for (const text of ['Reclaim Your Focus', 'Duration', 'Project', 'Select a project']) {
                // The section labels carry 2 px letter spacing after the last letter too.
                expect(Math.abs(await centerOf(setup.getByText(text, { exact: true })) - middle)).toBeLessThanOrEqual(2);
            }
            await expect(setup.getByText('Reclaim Your Focus', { exact: true }).evaluate((element) => getComputedStyle(element).fontSize)).resolves.toBe('22px');
            await evidence(page, `focus-setup-${theme}-1440`);
            await page.keyboard.press('Escape');
            await setup.waitFor({ state: 'detached' });
            expect(errors).toEqual([]);
            await page.close();
        }
    }, 30_000);

    it('sweeps the amber pixel swap on the diagonal when Focus starts, then clears onto the countdown', async () => {
        for (const theme of ['light', 'dark'] as const) {
            const { page, errors } = await openShell({ theme });
            await page.getByTestId('focus-mode-enter').click();
            const setup = page.getByTestId('focus-mode-setup');
            await setup.waitFor();
            expect(await page.locator('[data-testid="focus-mode-pixel-swap-layer"]').count()).toBe(0);
            await setup.getByText('Web App Suite', { exact: true }).click();
            // Samples every tile each frame from the moment the layer appears until it is gone.
            const sampling = page.evaluate(() => new Promise<any>((done) => {
                const began = performance.now();
                let start: number | null = null;
                let layerStyle: Record<string, string | boolean> | null = null;
                let passesPointer: boolean | null = null;
                let covered = false;
                const tiles = new Map<Element, { left: number; top: number; onset?: number; full?: number; clear?: number }>();
                const frame = () => {
                    const now = performance.now();
                    const layer = document.querySelector('[data-testid="focus-mode-pixel-swap-layer"]') as HTMLElement | null;
                    if (!layer) {
                        if (start !== null) return done({ lifetime: now - start, layerStyle, passesPointer, covered, tiles: [...tiles.values()].map((tile) => ({ ...tile })) });
                        if (now - began > 4000) return done(null);
                        return requestAnimationFrame(frame);
                    }
                    if (start === null) {
                        start = now;
                        const style = getComputedStyle(layer);
                        layerStyle = { zIndex: style.zIndex, pointerEvents: style.pointerEvents, position: style.position, inert: layer.hasAttribute('inert'), ariaHidden: layer.getAttribute('aria-hidden') === 'true' };
                        const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
                        passesPointer = !!hit && !layer.contains(hit);
                    }
                    let all = true;
                    for (const element of layer.querySelectorAll('[data-testid="focus-mode-pixel-swap-tile"]')) {
                        const html = element as HTMLElement;
                        let tile = tiles.get(element);
                        if (!tile) tiles.set(element, tile = { left: html.offsetLeft, top: html.offsetTop });
                        const opacity = Number(getComputedStyle(html).opacity);
                        if (tile.onset === undefined && opacity > 0.02) tile.onset = now - start;
                        if (tile.full === undefined && opacity > 0.999) tile.full = now - start;
                        if (tile.full !== undefined && tile.clear === undefined && opacity < 0.98) tile.clear = now - start;
                        if (opacity < 0.999) all = false;
                    }
                    if (all && tiles.size > 0) covered = true;
                    requestAnimationFrame(frame);
                };
                requestAnimationFrame(frame);
            }));
            await setup.getByRole('button', { name: 'Start focus', exact: true }).click();
            const result = await sampling;
            expect(result).not.toBeNull();
            expect(result.layerStyle).toEqual({ zIndex: '10000', pointerEvents: 'none', position: 'fixed', inert: true, ariaHidden: true });
            expect(result.passesPointer).toBe(true);
            // Every tile was amber at once, midway: the window fully covered.
            expect(result.covered).toBe(true);
            const expected = focusPixelSwapTiles(1440, 900);
            expect(result.tiles).toHaveLength(expected.length);
            const byPosition = new Map(expected.map((tile) => [`${tile.left},${tile.top}`, tile.delay]));
            // Timed from the top-left tile's first frame: the layer mounts a moment before its tiles start.
            const first = result.tiles.find((tile: any) => tile.left === 0 && tile.top === 0);
            expect(Math.min(...result.tiles.map((tile: any) => tile.onset))).toBeGreaterThanOrEqual(first.onset - 20);
            for (const tile of result.tiles) {
                const delay = byPosition.get(`${tile.left},${tile.top}`);
                expect(delay, `${tile.left},${tile.top}`).toBeDefined();
                // Each tile grows in on its diagonal delay and starts clearing one 1.4 s swap later.
                expect(Math.abs(tile.onset - first.onset - delay!), `onset ${tile.left},${tile.top}`).toBeLessThan(150);
                expect(Math.abs(tile.clear - tile.onset - 1400), `clear ${tile.left},${tile.top}`).toBeLessThan(150);
            }
            expect(Math.abs(result.lifetime - first.onset - 2800)).toBeLessThan(400);
            // The countdown is already running underneath when the tiles clear.
            await expect(page.getByTestId('focus-mode-pill').isVisible()).resolves.toBe(true);
            expect(errors).toEqual([]);
            await page.close();
        }
    }, 40_000);

    it('never plays the pixel swap with reduced motion', async () => {
        const { page, errors } = await openShell({ reducedMotion: true });
        await page.getByTestId('focus-mode-enter').click();
        const setup = page.getByTestId('focus-mode-setup');
        await setup.getByText('Web App Suite', { exact: true }).click();
        const appeared = page.evaluate(() => new Promise<boolean>((done) => {
            const began = performance.now();
            const frame = () => {
                if (document.querySelector('[data-testid="focus-mode-pixel-swap-layer"]')) return done(true);
                if (performance.now() - began > 1500) return done(false);
                requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
        }));
        await setup.getByRole('button', { name: 'Start focus', exact: true }).click();
        await expect(appeared).resolves.toBe(false);
        await page.getByTestId('focus-mode-pill').waitFor();
        expect(errors).toEqual([]);
        await page.close();
    });

    it('captures the pixel swap frames for review', async () => {
        if (!process.env.HERD_SHELL_EVIDENCE_DIR?.trim()) return;
        for (const theme of ['light', 'dark'] as const) {
            const { page } = await openShell({ theme });
            await page.getByTestId('focus-mode-enter').click();
            const setup = page.getByTestId('focus-mode-setup');
            await setup.getByText('Web App Suite', { exact: true }).click();
            await setup.getByRole('button', { name: 'Start focus', exact: true }).click();
            const started = Date.now();
            for (const at of [500, 1400, 2200]) {
                await page.waitForTimeout(Math.max(0, at - (Date.now() - started)));
                await evidence(page, `focus-pixel-swap-${theme}-1440-${at}ms`);
            }
            await page.locator('[data-testid="focus-mode-pixel-swap-layer"]').waitFor({ state: 'detached' });
            await evidence(page, `focus-pixel-swap-${theme}-1440-settled`);
            await page.close();
        }
    }, 40_000);

    it('keeps the machine pill in the top bar while machines load and when the account has none', async () => {
        const loading = await openShell({ machines: 'loading' });
        const busy = loading.page.getByTestId('herd-machine-menu');
        await expect(busy.innerText()).resolves.toContain('Loading...');
        await expect(busy.getAttribute('aria-busy')).resolves.toBe('true');
        await expect(busy.getAttribute('aria-disabled')).resolves.toBe('true');
        expect(loading.errors).toEqual([]);
        await loading.page.close();

        const { page, errors } = await openShell({ machines: 'none' });
        const pill = page.getByTestId('herd-machine-menu');
        await expect(pill.innerText()).resolves.toContain('No machine');
        await pill.click();
        const menu = page.getByTestId('herd-machine-popover');
        await menu.waitFor();
        await expect(menu.getByTestId('herd-machine-empty').innerText()).resolves.toBe('No machines on this account yet');
        await menu.getByTestId('herd-machine-connections').click();
        await expect.poll(() => page.evaluate(() => (window as any).__ROUTER_CALLS__ ?? [])).toContain('/settings/connections');
        await evidence(page, 'shell-machine-pill-empty-light-1440');
        expect(errors).toEqual([]);
        await page.close();
    });

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

    it.each(['Linux', 'macOS'] as const)('collapses with the %s shortcut or the top bar toggle: content leaves, then the width snaps', async (shortcutPlatform) => {
        const { page, errors } = await openShell({ shortcutPlatform });
        const drawer = page.getByTestId('navigation-drawer');
        const openWidth = (await drawer.boundingBox())!.width;
        expect(openWidth).toBeGreaterThan(300);

        // The exit class and the still-open width, observed in the same frame.
        const exitingWidth = page.waitForFunction(() => {
            const panel = document.querySelector<HTMLElement>('[data-testid="navigation-drawer"]');
            const content = panel?.firstElementChild;
            return content?.classList.contains('herd-exit-left') ? panel!.getBoundingClientRect().width : null;
        }, undefined, { polling: 'raf', timeout: 1_000 });
        // Test both supported platform chords independently of the browser host OS.
        await page.keyboard.press(shortcutPlatform === 'macOS' ? 'Meta+Alt+KeyB' : 'Control+Alt+KeyB');
        expect(await (await exitingWidth).jsonValue()).toBe(openWidth);
        await expect.poll(async () => (await drawer.boundingBox())!.width).toBe(0);
        expect(await page.evaluate(() => (window as any).__SETTINGS__.navigationSidebarCollapsed)).toBe(true);
        const toggle = page.getByTestId('navigation-sidebar-toggle');
        await expect(toggle.getAttribute('aria-label')).resolves.toBe('Expand navigation sidebar');
        // No native title: hovering shows the mock's tooltip under the toggle, with the shortcut.
        await expect(toggle.getAttribute('title')).resolves.toBeNull();
        await toggle.hover();
        const tooltip = page.getByRole('tooltip');
        await expect(tooltip.innerText()).resolves.toContain('Expand navigation sidebar');
        await expect(tooltip.getByTestId('herd-tooltip-hint').innerText()).resolves.toBe(shortcutPlatform === 'macOS' ? '⌥⌘B' : 'Ctrl+Alt+B');
        const [toggleBox, tipBox] = [(await toggle.boundingBox())!, (await tooltip.boundingBox())!];
        expect(Math.round(tipBox.y - (toggleBox.y + toggleBox.height))).toBe(8);
        expect(Math.round(tipBox.x)).toBe(Math.round(toggleBox.x));
        await page.mouse.move(700, 600);
        await expect(tooltip.count()).resolves.toBe(0);
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

    it.each([
        { width: 1024, height: 768 },
        { width: 768, height: 1024 },
        { width: 700, height: 900 },
    ])('keeps the desktop shell in a $width × $height browser window, which the device rule calls a phone', async ({ width, height }) => {
        // Diagonals under 9 inches: useIsTablet() is false, but the web lays out by width (UI overhaul).
        const { page, errors } = await openShell({ width, height });
        await expect(page.getByTestId('herd-zen-toggle').count()).resolves.toBe(1);
        await expect(page.getByTestId('navigation-sidebar-edge-toggle').count()).resolves.toBe(1);
        await expect(page.getByTestId('herd-phone-drawer-layer').count()).resolves.toBe(0);
        await expect(page.evaluate(() => document.documentElement.scrollWidth)).resolves.toBeLessThanOrEqual(width);
        expect(errors).toEqual([]);
        await page.close();
    }, 15_000);

    it('opens the command palette from the search control and has no Back or Forward', async () => {
        const { page, errors } = await openShell();
        await page.getByTestId('herd-command-search').click();
        expect(await page.evaluate(() => (window as any).__PALETTE_OPENS__)).toBe(1);
        const topBar = page.getByTestId('herd-top-bar');
        await expect(topBar.getByRole('button', { name: 'Back', exact: true }).count()).resolves.toBe(0);
        await expect(topBar.getByRole('button', { name: 'Forward', exact: true }).count()).resolves.toBe(0);
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
        // As in the mock, only the search collapses; the brand keeps its name.
        expect(await compact.page.getByTestId('herd-top-bar-brand').innerText()).toBe('HappyHerd');
        await evidence(compact.page, 'shell-compact-light-1024');
        await compact.page.close();
    }, 15_000);
});
