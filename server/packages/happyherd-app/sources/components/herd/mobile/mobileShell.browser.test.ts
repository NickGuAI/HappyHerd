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
const nodeModules = resolve(appRoot, '../../node_modules');
const ioniconsRoot = resolve(nodeModules, '@expo/vector-icons/build/vendor/react-native-vector-icons');
const opsSource = readFileSync(resolve(sourcesRoot, 'sync/ops.ts'), 'utf8');
const opNames = [...opsSource.matchAll(/export (?:async )?function (\w+)/g)].map((match) => match[1]);
const testData = (name: string) => resolve(here, '__testdata__', name);

/**
 * The Web Mobile shell (MainView's phone variant, the tab bar, full-screen
 * pages and the phone bottom sheets), with every app source file compiled
 * through the Unistyles Babel transform and web runtime as in the Expo build.
 * Only data, navigation, device services and other slices' surfaces are stubbed.
 */
const virtualModules: Record<string, string> = {
    'react-native': `
        import * as ReactNativeWeb from 'react-native-web';
        export * from 'react-native-web';
        export const Platform = { ...ReactNativeWeb.Platform, OS: 'web', select: (options) => options.web ?? options.default };
        export const TurboModuleRegistry = { get: () => null, getEnforcing: () => ({}) };
    `,
    'fixture-theme': `
        import { lightTheme, darkTheme } from '@/theme';
        export const theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? darkTheme : lightTheme;
    `,
    // The real Ionicons glyphs, drawn with the bundled font.
    '@expo/vector-icons': `
        import React from 'react';
        import glyphs from '${resolve(ioniconsRoot, 'glyphmaps/Ionicons.json')}';
        const icon = (map) => {
            const Icon = ({ name, color, size = 16 }) => React.createElement('span', {
                'data-icon': name, 'aria-hidden': true,
                style: { fontFamily: 'ionicons', fontStyle: 'normal', fontWeight: 'normal', color, fontSize: size, width: size, height: size, lineHeight: size + 'px', textAlign: 'center', display: 'inline-block', flexShrink: 0, userSelect: 'none' },
            }, map[name] ? String.fromCodePoint(map[name]) : '•');
            Icon.glyphMap = map;
            return Icon;
        };
        export const Ionicons = icon(glyphs);
        export const Octicons = icon({});
        export const MaterialCommunityIcons = icon({});
    `,
    // Tinted images (the header mark) keep their shape through a CSS mask.
    'expo-image': `
        import React from 'react';
        export const Image = ({ source, style, tintColor }) => {
            const flat = Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity).filter(Boolean)) : (style ?? {});
            const uri = typeof source === 'string' ? source : source?.uri;
            const mask = uri ? { WebkitMaskImage: 'url(' + uri + ')', maskImage: 'url(' + uri + ')', WebkitMaskSize: 'contain', maskSize: 'contain', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskPosition: 'center' } : {};
            return React.createElement('span', { 'data-image': 'true', style: { display: 'inline-block', width: flat.width, height: flat.height, background: tintColor ?? '#888', ...mask } });
        };
    `,
    'expo-glass-effect': `import { View } from 'react-native-unistyles/components/native/View'; export const GlassView = View; export const isGlassEffectAPIAvailable = () => false; export const isLiquidGlassAvailable = () => false;`,
    'expo-blur': `import { View } from 'react-native-unistyles/components/native/View'; export const BlurView = View;`,
    'expo-linear-gradient': `import { View } from 'react-native-unistyles/components/native/View'; export const LinearGradient = View;`,
    '@react-native-masked-view/masked-view': `import { View } from 'react-native-unistyles/components/native/View'; export default View;`,
    'expo-haptics': `
        export const impactAsync = async () => {}; export const notificationAsync = async () => {}; export const selectionAsync = async () => {};
        export const ImpactFeedbackStyle = { Light: 'light', Medium: 'medium', Heavy: 'heavy' };
        export const NotificationFeedbackType = { Success: 'success', Warning: 'warning', Error: 'error' };
    `,
    'expo-clipboard': `export const setStringAsync = async () => true; export const getStringAsync = async () => '';`,
    'expo-constants': `export default { statusBarHeight: 0, expoConfig: { extra: {} } };`,
    'expo-router': `
        import { router } from '${testData('mobileShellRouter.ts')}';
        import { useFixturePath } from '${testData('mobileShellRouter.ts')}';
        export { router };
        export const useRouter = () => router;
        export const usePathname = () => useFixturePath();
        export const useSegments = () => [];
        export const useLocalSearchParams = () => ({});
        export const useNavigation = () => ({ setOptions() {}, addListener: () => () => {}, goBack: () => router.back(), canGoBack: () => router.canGoBack() });
        export const Stack = { Screen: () => null };
    `,
    // Phone safe areas come from the page URL, so the notch and home indicator are exercised.
    'react-native-safe-area-context': `
        import React from 'react';
        const params = new URLSearchParams(window.location.search);
        const insets = { top: Number(params.get('top') ?? 0), right: 0, bottom: Number(params.get('bottom') ?? 0), left: 0 };
        export const useSafeAreaInsets = () => insets;
        export const SafeAreaInsetsContext = React.createContext(insets);
        export const SafeAreaProvider = ({ children }) => children;
    `,
    'react-native-reanimated': `
        import React from 'react';
        import { View, Text, ScrollView } from 'react-native';
        const builder = new Proxy({}, { get: () => () => builder });
        const Animated = { View, Text, ScrollView, createAnimatedComponent: (component) => component };
        export default Animated;
        export const FadeIn = builder, FadeOut = builder, FadeInDown = builder, FadeOutUp = builder, LinearTransition = builder;
        export const ReduceMotion = { System: 'system', Always: 'always', Never: 'never' };
        const identity = (x) => x;
        export const Easing = { out: () => identity, in: () => identity, inOut: () => identity, bezier: () => identity, quad: identity, cubic: identity, linear: identity, ease: identity };
        export const Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' };
        export const useSharedValue = (value) => React.useRef({ value }).current;
        export const useDerivedValue = (factory) => ({ value: factory() });
        export const useAnimatedStyle = (factory) => factory();
        export const useAnimatedReaction = () => {};
        export const useReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        export const withTiming = (value) => value;
        export const withSpring = (value) => value;
        export const withRepeat = (value) => value;
        export const withSequence = (...values) => values[values.length - 1];
        export const withDelay = (_delay, value) => value;
        export const cancelAnimation = () => {};
        export const runOnJS = (fn) => fn;
        export const interpolate = (value, input, output) => {
            if (value <= input[0]) return output[0];
            for (let index = 1; index < input.length; index++) {
                if (value <= input[index]) return output[index - 1] + ((value - input[index - 1]) / (input[index] - input[index - 1])) * (output[index] - output[index - 1]);
            }
            return output[output.length - 1];
        };
        export const interpolateColor = (_value, _input, output) => output[0];
    `,
    'react-native-worklets': `export const runOnJS = (fn) => fn; export const scheduleOnRN = (fn, ...args) => fn(...args);`,
    'react-native-gesture-handler': `
        import React from 'react';
        const chain = new Proxy({}, { get: () => () => chain });
        export const Gesture = new Proxy({}, { get: () => () => chain });
        export const GestureDetector = ({ children }) => children;
        export const Swipeable = React.forwardRef(({ children }, _ref) => children);
    `,
    'react-native-svg': `
        import React from 'react';
        const Svg = ({ testID, children, ...props }) => React.createElement('svg', { ...props, 'data-testid': testID, style: { display: 'block' } }, children);
        export default Svg;
        export const Circle = (props) => React.createElement('circle', props);
        export const Path = (props) => React.createElement('path', props);
        export const G = ({ children, ...props }) => React.createElement('g', props, children);
        export const Rect = (props) => React.createElement('rect', props);
    `,
    '@/utils/responsive': `
        export * from '${resolve(sourcesRoot, 'utils/responsive.ts')}';
        const phone = () => window.innerWidth < 700;
        export const useDeviceType = () => (phone() ? 'phone' : 'tablet');
        export const useIsTablet = () => !phone();
        export const useHeaderHeight = () => 56;
        export const useIsLandscape = () => window.innerWidth > window.innerHeight;
    `,
    '@/utils/platform': `export const isRunningOnMac = () => false;`,
    '@/text': `
        import en from '${resolve(sourcesRoot, 'text/locales/en.json')}';
        export const t = (key, params) => {
            const value = key.split('.').reduce((node, part) => node?.[part], en);
            let text = typeof value === 'string' ? value : key;
            for (const [name, replacement] of Object.entries(params ?? {})) text = text.split('{' + name + '}').join(String(replacement));
            return text;
        };
        export const getCurrentLanguage = () => 'en';
    `,
    '@/sync/storage': `
        import React from 'react';
        import * as fixtureList from '${testData('mobileShellFixtureList.tsx')}';
        const params = new URLSearchParams(window.location.search);
        const settings = {
            machineWorkspace: params.get('workspace') !== 'off', sessionListGrouping: 'flat', focusMode: null,
            hideInactiveSessions: true, expResumeSession: false, devModeEnabled: false,
        };
        window.__SETTINGS__ = settings;
        const listeners = new Set();
        const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
        const emit = () => listeners.forEach((listener) => listener());
        const read = (key) => React.useSyncExternalStore(subscribe, () => settings[key], () => settings[key]);
        const write = (key) => (value) => { settings[key] = value; emit(); };
        export const useSetting = read;
        export const useSettingMutable = (key) => [read(key), write(key)];
        export const useLocalSetting = read;
        export const useLocalSettingMutable = (key) => [read(key), write(key)];
        const requests = Array.from({ length: Number(params.get('requests') ?? 0) }, (_, index) => ({ id: 'friend-' + index }));
        export const useFriendRequests = () => requests;
        const socket = { status: params.get('socket') ?? 'connected' };
        export const useSocketStatus = () => socket;
        export const useRealtimeStatus = () => 'disconnected';
        const machines = [
            { id: 'studio-mac', active: true, createdAt: 3, metadata: { host: 'studio-mac', displayName: 'studio-mac', platform: 'darwin' } },
            { id: 'build-box', active: true, createdAt: 1, metadata: { host: 'build-box', platform: 'linux' } },
            { id: 'gpu-lab', active: false, createdAt: 2, metadata: { host: 'gpu-lab', platform: 'linux' } },
        ];
        export const useAllMachines = () => machines;
        export const useMachine = (id) => machines.find((machine) => machine.id === id) ?? null;
        export const useProjects = () => ({});
        export const useSessionGitStatus = () => null;
        export const useSession = (id) => {
            const row = fixtureList.fixtureRows.find((item) => item.session.id === id);
            return row ? { id, active: true, metadata: { summary: { text: row.session.name }, machineId: row.session.machineId, path: row.session.path } } : null;
        };
        export const storage = { getState: () => ({ settings, localSettings: settings, applyLocalSettings(delta) { Object.assign(settings, delta); emit(); } }) };
    `,
    '@/sync/serverConfig': `export const isUsingCustomServer = () => new URLSearchParams(window.location.search).get('server') === 'custom';`,
    '@/sync/ops': opNames.map((name) => `export const ${name} = async () => ({ success: true });`).join('\n'),
    '@/track': `export const trackFriendsSearch = () => { window.__FRIENDS_SEARCHES__ = (window.__FRIENDS_SEARCHES__ ?? 0) + 1; };`,
    '@/modal': `export const Modal = { alert: () => {}, confirm: async () => false, show: () => {} }; export const useModal = () => ({ dismissTopModal: () => false });`,
    '@/hooks/useVisibleSessionListViewData': `export const useVisibleSessionListViewData = () => []; export const useHasArchivedSessions = () => false;`,
    '@/hooks/useInboxHasContent': `export const useInboxHasContent = () => true;`,
    '@/hooks/useNewSessionDraft': `
        import React from 'react';
        const listeners = new Set();
        const state = {
            selectedMachineId: 'studio-mac', attachments: [], input: '',
            setInput(input) { state.input = input; },
            setMachineId(id) { window.__DRAFT_MACHINE_WRITES__ = [...(window.__DRAFT_MACHINE_WRITES__ ?? []), id]; state.selectedMachineId = id; listeners.forEach((listener) => listener()); },
        };
        export const useNewSessionDraft = (selector) => React.useSyncExternalStore(
            (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
            () => selector(state),
            () => selector(state),
        );
        useNewSessionDraft.getState = () => state;
    `,
    '@/hooks/useStartSessionFromDraft': `export const useStartSessionFromDraft = () => ({ isStarting: false, phase: 'idle', startSession: async () => false, cancelStart() {} });`,
    '@/hooks/useNavigateToSession': `
        import { router } from '${testData('mobileShellRouter.ts')}';
        export const useNavigateToSession = () => (id) => router.push('/session/' + id);
        export const useSessionPressHandlers = (id) => ({ onPress: () => router.push('/session/' + id), onPressIn: () => {} });
    `,
    // The row menu's real action set (ids, icons, labels), recording the chosen action.
    '@/hooks/useSessionQuickActions': `
        import { t } from '@/text';
        const record = (id) => () => { window.__ACTIONS__ = [...(window.__ACTIONS__ ?? []), id]; };
        export const useSessionQuickActions = () => ({ actionItems: [
            { id: 'details', icon: 'information-circle-outline', label: t('profile.details'), onPress: record('details') },
            { id: 'fork', icon: 'git-branch-outline', label: t('session.forkAction'), onPress: record('fork') },
            { id: 'duplicate', icon: 'time-outline', label: t('session.duplicateAction'), onPress: record('duplicate') },
            { id: 'continue-provider', icon: 'swap-horizontal-outline', label: t('session.providerContinuationAction'), onPress: record('continue-provider') },
            { id: 'copy-metadata', icon: 'bug-outline', label: t('sessionInfo.copyMetadata'), onPress: record('copy-metadata') },
            { id: 'archive', icon: 'archive-outline', label: t('uiCopy.archive'), onPress: record('archive'), destructive: true },
        ] });
        export const useSessionActionAlert = () => () => {};
    `,
    '@/hooks/useHappyHerdAction': `export const useHappyHerdAction = () => [false, () => {}];`,
    '@/utils/sessionListTimestamp': `export const formatSessionListTimestamp = () => '2m';`,
    '@/components/SessionsListWrapper': `export { FixtureSessionsListWrapper as SessionsListWrapper } from '${testData('mobileShellFixtureList.tsx')}';`,
    '@/components/SettingsViewWrapper': `export { FixtureSettingsViewWrapper as SettingsViewWrapper } from '${testData('mobileShellFixtureSettings.tsx')}';`,
    '@/components/InboxView': `
        import React from 'react';
        import { Text, View } from 'react-native';
        import { theme } from 'fixture-theme';
        export const InboxView = () => React.createElement(View, { testID: 'fixture-inbox', style: { flex: 1, padding: 16, backgroundColor: theme.colors.groupped.background } },
            React.createElement(Text, { style: { fontSize: 13, color: theme.colors.textSecondary, fontFamily: 'SpaceGrotesk-Regular' } }, 'Inbox body (pages slice)'));
    `,
    '@/components/HomeDock': `export const HomeDock = () => null; export const MOBILE_HOME_DOCK_CONTENT_INSET = 0;`,
    '@/components/NativeSettingsMenu': `export const NativeSettingsMenu = ({ children }) => children;`,
    '@/components/EmptySessionsTablet': `export const EmptySessionsTablet = () => null;`,
    '@/components/SessionsList': `export const SessionsList = () => null;`,
    '@/components/VoiceAssistantStatusBar': `export const VoiceAssistantStatusBar = () => null;`,
    '@/components/MobileGlass': `
        import React from 'react';
        import { View } from 'react-native-unistyles/components/native/View';
        export const MobileGlassSurface = ({ children, style }) => React.createElement(View, { style }, children);
        export const MobileGlassBackdrop = () => null;
    `,
    '@/components/AnimatedOverlay': `import React from 'react'; import { View } from 'react-native-unistyles/components/native/View'; export const AnimatedClickAwayBackdrop = ({ exitImmediately, ...props }) => React.createElement(View, props); export const AnimatedPopup = ({ exitImmediately, ...props }) => React.createElement(View, props); export const LocalBlurHalo = () => null;`,
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
    '@/components/RigGitLineChanges': `
        import React from 'react';
        import { Text } from 'react-native';
        export const RigGitLineChanges = ({ insertions, deletions }) => React.createElement(Text, { style: { fontSize: 11, fontFamily: 'JetBrainsMono-Regular' } }, '+' + insertions + ' −' + deletions);
    `,
};

const fixturePlugin: Plugin = {
    name: 'mobile-shell-browser-fixture',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, (args) => {
            if (args.path.startsWith('react-native-unistyles/components/native/')) {
                return { path: resolve(nodeModules, 'react-native-unistyles/lib/module/components/native', `${args.path.split('/').at(-1)}.js`) };
            }
            if (args.path === 'react-native-unistyles' && args.importer.startsWith(sourcesRoot)) {
                return { path: 'production-styles', namespace: 'fixture-stub' };
            }
            const relative = args.path.startsWith('.') && args.importer.startsWith(sourcesRoot)
                ? '@/' + resolve(dirname(args.importer), args.path).slice(sourcesRoot.length + 1).replace(/\.(tsx?|jsx?)$/, '')
                : null;
            if (relative && relative in virtualModules) return { path: relative, namespace: 'fixture-stub' };
            if (args.path in virtualModules) return { path: args.path, namespace: 'fixture-stub' };
            if (args.path.startsWith('@/')) {
                const sourcePath = resolve(sourcesRoot, args.path.slice(2));
                const path = [sourcePath + '.web.tsx', sourcePath + '.web.ts', sourcePath, `${sourcePath}.ts`, `${sourcePath}.tsx`, `${sourcePath}/index.ts`, `${sourcePath}/index.tsx`]
                    .find((candidate) => existsSync(candidate) && !candidate.endsWith('/'));
                if (!path) throw new Error(`missing fixture source: ${args.path}`);
                return { path };
            }
            return null;
        });
        bundle.onLoad({ filter: /.*/, namespace: 'fixture-stub' }, (args) => ({
            contents: args.path === 'production-styles'
                ? `
                    import { theme } from 'fixture-theme';
                    import { StyleSheet, useUnistyles, UnistylesRuntime, withUnistyles } from ${JSON.stringify(resolve(nodeModules, 'react-native-unistyles/lib/module/index.js'))};
                    StyleSheet.configure({ themes: { fixture: theme }, settings: { initialTheme: 'fixture' } });
                    export { StyleSheet, useUnistyles, UnistylesRuntime, withUnistyles };
                `
                : virtualModules[args.path],
            loader: 'tsx',
            resolveDir: here,
        }));
        bundle.onLoad({ filter: /\/sources\/.*\.tsx$/ }, (args) => {
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

const PHONE = { width: 390, height: 844 };
/** An iPhone-style notch and home indicator. */
const PHONE_INSETS = { top: 47, bottom: 34 };
const FONTS = ['SpaceGrotesk-Regular', 'SpaceGrotesk-Medium', 'SpaceGrotesk-SemiBold', 'JetBrainsMono-Regular', 'JetBrainsMono-SemiBold'];

describe('HappyHerd Web Mobile shell in the production style runtime', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            entryPoints: [testData('mobileShell.browser.fixture.tsx')],
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
            sourcemap: 'inline',
            define: { __DEV__: 'false', 'process.env.EXPO_OS': '"web"', 'process.env.NODE_ENV': '"test"' },
            jsx: 'automatic',
            loader: { '.png': 'dataurl', '.ttf': 'dataurl', '.js': 'jsx', '.webp': 'dataurl', '.jpg': 'dataurl' },
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
            if (url.pathname === '/fonts/Ionicons.ttf') {
                response.setHeader('content-type', 'font/ttf');
                response.end(readFileSync(resolve(ioniconsRoot, 'Fonts/Ionicons.ttf')));
                return;
            }
            const background = url.searchParams.get('theme') === 'dark' ? '#151B28' : '#FFF9EC';
            response.setHeader('content-type', 'text/html; charset=utf-8');
            const escapeProbe = `window.__UNHANDLED_ESCAPES__=0;window.addEventListener('keydown',function(e){if(e.key==='Escape'&&!e.defaultPrevented)window.__UNHANDLED_ESCAPES__++;});`;
            const fontFaces = FONTS.map((family) => `@font-face{font-family:${family};src:url(/fonts/${family}.ttf)}`).join('')
                + '@font-face{font-family:ionicons;src:url(/fonts/Ionicons.ttf)}';
            response.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><script>${escapeProbe}</script><style>${fontFaces}html,body,#root{height:100%;margin:0;background:${background}}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><style>${themeCss}</style><main id="root"></main><script>globalThis.global=globalThis;${script.replaceAll('</script', '<\\/script')}</script>`);
        });
        await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('mobile shell fixture did not bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({
            ...(executablePath ? { executablePath } : { channel: 'chrome' }),
            headless: true,
            args: process.platform === 'linux' ? ['--no-sandbox'] : [],
        });
    }, 120_000);

    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>((closed) => server.close(() => closed()));
    });

    async function open(options: {
        theme?: 'light' | 'dark';
        width?: number;
        height?: number;
        insets?: boolean;
        query?: Record<string, string>;
        reducedMotion?: boolean;
        touch?: boolean;
    } = {}) {
        const width = options.width ?? PHONE.width;
        const page = await browser.newPage({
            viewport: { width, height: options.height ?? PHONE.height },
            deviceScaleFactor: 2,
            ...(options.touch ? { hasTouch: true, isMobile: true } : {}),
        });
        page.setDefaultTimeout(5_000);
        await page.emulateMedia({ reducedMotion: options.reducedMotion ? 'reduce' : 'no-preference' });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
        const insets: Record<string, string> = options.insets === false ? {} : { top: String(PHONE_INSETS.top), bottom: String(PHONE_INSETS.bottom) };
        const query = new URLSearchParams({ theme: options.theme ?? 'light', ...insets, ...options.query });
        await page.goto(`${origin}/?${query}`);
        await page.evaluate(() => document.fonts.ready);
        return { page, errors };
    }

    async function evidence(page: Page, name: string) {
        const directory = process.env.HERD_MOBILE_EVIDENCE_DIR?.trim();
        if (!directory) return;
        mkdirSync(directory, { recursive: true });
        await page.waitForTimeout(600);
        await page.screenshot({ path: resolve(directory, `${name}.png`) });
    }

    const box = async (page: Page, testID: string) => (await page.getByTestId(testID).first().boundingBox())!;
    const classList = (page: Page, testID: string) => page.getByTestId(testID).first().evaluate((element) => [...element.classList]);
    const routerCalls = (page: Page) => page.evaluate(() => (window as any).__ROUTER_CALLS__ ?? []);
    const indicatorX = (page: Page) => page.getByTestId('tab-indicator').evaluate((element) => element.getBoundingClientRect().x);

    it('lays out the phone home: brand header, focus row, rows, New session button and tab bar', async () => {
        for (const theme of ['light', 'dark'] as const) {
            const { page, errors } = await open({ theme });
            await page.getByTestId('mobile-home-header').waitFor();
            const header = await box(page, 'mobile-home-header');
            // The header clears the notch, then keeps the mock's 58 px row.
            expect(header.y).toBe(0);
            expect(header.height).toBe(PHONE_INSETS.top + 58 + 1);
            await expect(page.getByRole('heading', { name: 'HappyHerd', exact: true }).count()).resolves.toBe(1);
            for (const label of ['Workspace', 'Projects', 'Automations']) {
                await expect(page.getByTestId('mobile-home-header').getByRole('button', { name: label, exact: true }).count()).resolves.toBe(1);
            }
            // New session moved from the header to the floating button.
            await expect(page.getByTestId('mobile-home-header').getByRole('button', { name: 'New session', exact: true }).count()).resolves.toBe(0);

            const focusRow = await box(page, 'mobile-focus-row');
            expect(focusRow.y).toBe(header.y + header.height);
            expect(focusRow.height).toBe(46);
            await expect(page.getByTestId('mobile-focus-row').getByTestId('herd-machine-menu').innerText()).resolves.toContain('studio-mac');
            await expect(page.getByTestId('mobile-focus-row').getByText('Focus mode', { exact: true }).count()).resolves.toBe(1);

            const tabBar = (await page.getByRole('tablist').boundingBox())!;
            // The tab bar sits on the home indicator inset, flush with the bottom edge.
            expect(tabBar.y + tabBar.height).toBe(PHONE.height - PHONE_INSETS.bottom);
            expect(tabBar.height).toBe(58);
            // The button pops in; measure it once the entrance settles.
            await expect.poll(async () => (await box(page, 'mobile-new-session-fab')).width).toBe(56);
            const fab = await box(page, 'mobile-new-session-fab');
            expect(fab.x + fab.width).toBe(PHONE.width - 16);
            expect(tabBar.y - (fab.y + fab.height)).toBeCloseTo(16 + 1, 0);
            expect(await classList(page, 'mobile-new-session-fab')).toEqual(expect.arrayContaining(['herd-transition', 'herd-press']));

            await expect(page.getByTestId('tab-sessions').getAttribute('aria-selected')).resolves.toBe('true');
            await expect(page.getByTestId('tab-sessions').innerText()).resolves.toContain('Sessions');
            await expect(page.getByTestId('tab-inbox-unread').count()).resolves.toBe(1);
            expect(await indicatorX(page)).toBeCloseTo(PHONE.width / 3, 0);
            // The list scrolls clear of the floating button.
            const listPadding = await page.getByTestId('fixture-session-list').evaluate((element) => getComputedStyle(element.firstElementChild!).paddingBottom);
            expect(listPadding).toBe('88px');
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await evidence(page, `mobile-home-${theme}-390`);
            expect(errors).toEqual([]);
            await page.close();
        }
    }, 40_000);

    it('slides the tab indicator between tabs and swaps the header for each tab', async () => {
        const { page, errors } = await open({ query: { requests: '3' } });
        await page.getByTestId('mobile-home-header').waitFor();
        await expect(page.getByTestId('tab-inbox-badge').innerText()).resolves.toBe('3');
        expect(await classList(page, 'tab-indicator')).toContain('herd-glide');

        // The indicator is still travelling a frame after the tap, then lands on Inbox.
        const travelling = page.waitForFunction(() => {
            const indicator = document.querySelector('[data-testid="tab-indicator"]');
            const x = indicator?.getBoundingClientRect().x ?? 0;
            return x > 1 && x < 129 ? x : null;
        }, undefined, { polling: 'raf', timeout: 1_000 });
        await page.getByTestId('tab-inbox').click();
        expect(await (await travelling).jsonValue()).toBeGreaterThan(0);
        await expect.poll(() => indicatorX(page)).toBeCloseTo(0, 0);
        await expect(page.getByTestId('tab-inbox').getAttribute('aria-selected')).resolves.toBe('true');
        await expect(page.getByTestId('tab-sessions').getAttribute('aria-selected')).resolves.toBe('false');
        await expect(page.getByRole('heading', { name: 'Inbox', exact: true }).count()).resolves.toBe(1);
        await expect(page.getByTestId('mobile-new-session-fab').count()).resolves.toBe(0);
        await expect(page.getByTestId('mobile-focus-row').count()).resolves.toBe(0);
        await page.getByTestId('mobile-home-header').getByRole('button', { name: 'Find Friends', exact: true }).click();
        expect(await routerCalls(page)).toEqual(['/friends/search']);
        expect(await page.evaluate(() => (window as any).__FRIENDS_SEARCHES__)).toBe(1);
        await page.getByTestId('header-back').click();
        await page.getByTestId('mobile-home-header').waitFor();

        await page.getByTestId('tab-settings').click();
        await expect.poll(() => indicatorX(page)).toBeCloseTo((PHONE.width / 3) * 2, 0);
        await expect(page.getByRole('heading', { name: 'Settings', exact: true }).count()).resolves.toBe(1);
        await evidence(page, 'mobile-settings-tab-light-390');
        await page.getByText('Appearance', { exact: true }).click();
        await page.getByTestId('fixture-page').waitFor();
        await expect(page.getByTestId('header-back').count()).resolves.toBe(1);
        expect(errors).toEqual([]);
        await page.close();

        const dark = await open({ theme: 'dark' });
        await dark.page.getByTestId('tab-inbox').click();
        await expect.poll(() => indicatorX(dark.page)).toBeCloseTo(0, 0);
        await evidence(dark.page, 'mobile-inbox-tab-dark-390');
        expect(dark.errors).toEqual([]);
        await dark.page.close();
    }, 30_000);

    it('opens New Session from the floating button and full-screen pages with a back header', async () => {
        for (const theme of ['light', 'dark'] as const) {
            const { page, errors } = await open({ theme });
            await page.getByTestId('mobile-new-session-fab').click();
            expect(await routerCalls(page)).toEqual(['/new']);
            await page.getByTestId('fixture-page').waitFor();
            await page.getByTestId('header-back').click();
            expect(await page.evaluate(() => (window as any).__ROUTER_BACK_COUNT__)).toBe(1);
            await page.getByTestId('mobile-home-header').waitFor();

            await page.getByTestId('mobile-home-header').getByRole('button', { name: 'Projects', exact: true }).click();
            await page.getByTestId('fixture-page').waitFor();
            const back = page.getByTestId('header-back');
            await expect(back.getAttribute('aria-label')).resolves.toBe('Back');
            const backBox = (await back.boundingBox())!;
            expect(backBox.width).toBe(40);
            expect(backBox.height).toBe(40);
            // The 56 px back bar starts under the notch and ends in a hairline.
            const bar = await back.evaluate((element) => {
                let node: HTMLElement | null = element as HTMLElement;
                while (node && getComputedStyle(node).borderBottomWidth !== '1px') node = node.parentElement;
                return node ? { bottom: node.getBoundingClientRect().bottom, top: node.getBoundingClientRect().top } : null;
            });
            expect(bar).toEqual({ top: 0, bottom: PHONE_INSETS.top + 56 + 1 });
            // A hairline, not a shadow, separates the bar from the page.
            await expect(back.evaluate((element) => {
                let node: HTMLElement | null = element as HTMLElement;
                while (node && getComputedStyle(node).borderBottomWidth !== '1px') node = node.parentElement;
                return node ? getComputedStyle(node).boxShadow : null;
            })).resolves.toBe('none');
            expect(backBox.x).toBe(10);
            await expect(page.getByText('Projects', { exact: true }).evaluate((element) => getComputedStyle(element).fontSize)).resolves.toBe('16px');
            await evidence(page, `mobile-page-header-${theme}-390`);
            await back.click();
            await page.getByTestId('mobile-home-header').waitFor();
            expect(await routerCalls(page)).toEqual(['/new', '/projects']);
            expect(errors).toEqual([]);
            await page.close();
        }
    }, 30_000);

    it('opens a session full screen from its row and returns with Back', async () => {
        const { page, errors } = await open();
        await page.locator('[data-herd-row="auth"]').click();
        await page.getByTestId('fixture-session').waitFor();
        expect(await routerCalls(page)).toEqual(['/session/auth']);
        await evidence(page, 'mobile-session-light-390');
        await page.getByTestId('fixture-session').locator('[data-icon="arrow-back"]').click();
        await page.getByTestId('mobile-home-header').waitFor();
        await expect(page.locator('[data-herd-row="auth"]').count()).resolves.toBe(1);
        expect(errors).toEqual([]);
        await page.close();
    }, 20_000);

    it('opens the session actions as a bottom sheet and runs the chosen action', async () => {
        for (const theme of ['light', 'dark'] as const) {
            const { page, errors } = await open({ theme });
            const row = page.locator('[data-herd-row="dock"]');
            await row.click({ button: 'right' });
            const sheet = page.getByTestId('session-actions-sheet');
            await sheet.waitFor();
            // A secondary click opens the menu without opening the session.
            expect(await routerCalls(page)).toEqual([]);
            // A labelled modal dialog of action buttons.
            await expect(sheet.getAttribute('role')).resolves.toBe('dialog');
            await expect(sheet.getAttribute('aria-label')).resolves.toBe('Composer chips and context meter');
            await expect(sheet.getByText('Composer chips and context meter', { exact: true }).count()).resolves.toBe(1);
            // Full width, resting on the bottom edge, above a scrim.
            const sheetBox = (await sheet.boundingBox())!;
            expect(sheetBox.x).toBe(0);
            expect(sheetBox.width).toBe(PHONE.width);
            await expect.poll(async () => { const current = (await sheet.boundingBox())!; return current.y + current.height; }).toBeCloseTo(PHONE.height, 0);
            expect(await classList(page, 'session-actions-sheet')).toContain('herd-sheet-up');
            expect(await classList(page, 'session-actions-sheet-backdrop')).toContain('herd-fade');
            // Every action, label and shortcut stays; rows grow to touch size.
            const items = await sheet.getByRole('button').evaluateAll((nodes) => nodes.map((node) => [...node.querySelectorAll('*')]
                .filter((element) => element.children.length === 0 && !element.closest('[aria-hidden="true"]'))
                .map((element) => element.textContent?.trim() ?? '')
                .filter(Boolean)));
            // The drag handle is also the labelled Cancel button for assistive technology.
            expect(items[0]).toEqual([]);
            await expect(sheet.getByRole('button').first().getAttribute('aria-label')).resolves.toBe('Cancel');
            expect(items.slice(1).map(([label]) => label)).toEqual([
                'Details', 'Fork session', 'Duplicate from message…', 'Continue with…', 'Copy session metadata', 'Archive',
            ]);
            expect(items.slice(1).map(([, shortcut]) => shortcut)).toEqual([
                'Ctrl+Alt+O', 'Ctrl+Alt+F', 'Ctrl+Alt+Shift+D', 'Ctrl+Alt+Shift+C', 'Ctrl+Alt+M', 'Ctrl+Shift+A',
            ]);
            // Labels are never cut short by their shortcut; Archive sits after a separator.
            const truncated = await sheet.getByRole('button').evaluateAll((nodes) => nodes.flatMap((node) => [...node.querySelectorAll('div[dir="auto"]')]
                .filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent)));
            expect(truncated).toEqual([]);
            await expect(sheet.getByRole('button', { name: /Archive/ }).evaluate((element) => {
                const separator = element.previousElementSibling as HTMLElement | null;
                return separator ? Math.round(separator.getBoundingClientRect().height) : null;
            })).resolves.toBe(1);
            const detailsBox = (await sheet.getByRole('button', { name: /Details/ }).boundingBox())!;
            expect(Math.round(detailsBox.height)).toBeGreaterThanOrEqual(48);
            await expect(sheet.getByText('Details', { exact: true }).evaluate((element) => getComputedStyle(element).fontSize)).resolves.toBe('16px');
            // The sheet clears the home indicator.
            const lastItem = (await sheet.getByRole('button', { name: /Archive/ }).boundingBox())!;
            expect(PHONE.height - (lastItem.y + lastItem.height)).toBeGreaterThanOrEqual(PHONE_INSETS.bottom);
            await evidence(page, `mobile-session-actions-${theme}-390`);

            await sheet.getByRole('button', { name: /Fork/ }).click();
            await expect.poll(() => page.getByTestId('session-actions-sheet').count()).toBe(0);
            expect(await page.evaluate(() => (window as any).__ACTIONS__)).toEqual(['fork']);
            expect(errors).toEqual([]);
            await page.close();
        }
    }, 40_000);

    it('opens the session actions from a long press on a touch screen, without opening the session', async () => {
        const { page, errors } = await open({ touch: true });
        const cdp = await page.context().newCDPSession(page);
        const row = page.locator('[data-herd-row="dock"]');
        const box = (await row.boundingBox())!;
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        // iOS Safari sends no context menu on a long press; the row reads the press itself.
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
        await page.waitForTimeout(800);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const sheet = page.getByTestId('session-actions-sheet');
        await sheet.waitFor();
        await expect(sheet.getAttribute('aria-label')).resolves.toBe('Composer chips and context meter');
        // Lifting the finger neither clicks the new sheet's backdrop nor opens the session.
        await page.waitForTimeout(300);
        await expect(sheet.isVisible()).resolves.toBe(true);
        expect(await routerCalls(page)).toEqual([]);
        // A quick tap still opens the session.
        await page.keyboard.press('Escape');
        await expect.poll(() => sheet.count()).toBe(0);
        await page.touchscreen.tap(point.x, point.y);
        await expect.poll(() => routerCalls(page)).toEqual(['/session/dock']);
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('dismisses the phone sheet with Escape, the scrim, the handle, or a downward drag', async () => {
        const { page, errors } = await open();
        const row = page.locator('[data-herd-row="question"]');
        const sheet = page.getByTestId('session-actions-sheet');

        await row.click({ button: 'right' });
        await sheet.waitFor();
        // The sheet slides back down, redrawn on the inert exit layer, before
        // it unmounts. The watch is in place before Escape is pressed.
        await page.evaluate(() => {
            const selector = '[data-testid="session-actions-sheet"].herd-sheet-down';
            (window as any).__HERD_SLID_DOWN__ = new Promise<boolean>((resolve) => {
                const observer = new MutationObserver(() => {
                    if (!document.querySelector(selector)) return;
                    observer.disconnect();
                    resolve(true);
                });
                observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
                setTimeout(() => { observer.disconnect(); resolve(false); }, 2_000);
            });
        });
        await page.keyboard.press('Escape');
        await expect(page.evaluate(() => (window as any).__HERD_SLID_DOWN__ as Promise<boolean>)).resolves.toBe(true);
        await expect.poll(() => sheet.count()).toBe(0);
        expect(await page.evaluate(() => (window as any).__UNHANDLED_ESCAPES__)).toBe(0);

        await row.click({ button: 'right' });
        await sheet.waitFor();
        await page.mouse.click(PHONE.width / 2, 120);
        await expect.poll(() => sheet.count()).toBe(0);

        await row.click({ button: 'right' });
        await sheet.waitFor();
        await expect(page.getByTestId('session-actions-sheet-handle').getAttribute('aria-label')).resolves.toBe('Cancel');
        await page.getByTestId('session-actions-sheet-handle').click();
        await expect.poll(() => sheet.count()).toBe(0);

        // A short drag springs back; a long one dismisses.
        await row.click({ button: 'right' });
        await sheet.waitFor();
        await page.waitForTimeout(500);
        const handle = (await page.getByTestId('session-actions-sheet-handle').boundingBox())!;
        const restingY = (await sheet.boundingBox())!.y;
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await page.mouse.down();
        // A slow drag: a fast downward flick dismisses by velocity alone.
        for (let step = 1; step <= 10; step++) {
            await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + step * 3);
            await page.waitForTimeout(20);
        }
        await expect.poll(async () => (await sheet.boundingBox())!.y).toBeGreaterThan(restingY + 20);
        await page.mouse.up();
        await expect.poll(async () => (await sheet.boundingBox())!.y, { timeout: 2_000 }).toBeCloseTo(restingY, 0);
        await expect(sheet.count()).resolves.toBe(1);

        const again = (await page.getByTestId('session-actions-sheet-handle').boundingBox())!;
        await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
        await page.mouse.down();
        // A fast flick: its first move already leaves the 26 px handle.
        await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2 + 140, { steps: 4 });
        await page.mouse.up();
        await expect.poll(() => sheet.count()).toBe(0);
        expect(await page.evaluate(() => (window as any).__ACTIONS__ ?? [])).toEqual([]);
        // Nothing under the dismissed sheet was pressed.
        expect(await routerCalls(page)).toEqual([]);
        await page.getByTestId('mobile-home-header').waitFor();
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('follows touch on the handle: a flick dismisses, a short drag springs back, a tap cancels', async () => {
        const { page, errors } = await open({ touch: true });
        const cdp = await page.context().newCDPSession(page);
        const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) => {
            await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
        };
        const row = page.locator('[data-herd-row="unread"]');
        const sheet = page.getByTestId('session-actions-sheet');
        // Touch-only browsers hide the hover ⋯; the row's context menu opens the sheet.
        await expect(row.getByTestId('session-row-more').isVisible()).resolves.toBe(false);

        await row.click({ button: 'right' });
        await sheet.waitFor();
        await page.waitForTimeout(500);
        const restingY = (await sheet.boundingBox())!.y;
        let handle = (await page.getByTestId('session-actions-sheet-handle').boundingBox())!;
        let [x, y] = [handle.x + handle.width / 2, handle.y + handle.height / 2];
        await touch('touchStart', x, y);
        for (let step = 1; step <= 8; step++) {
            await touch('touchMove', x, y + step * 4);
            await page.waitForTimeout(20);
        }
        await expect.poll(async () => (await sheet.boundingBox())!.y).toBeGreaterThan(restingY + 20);
        await touch('touchEnd', x, y + 32);
        await expect.poll(async () => (await sheet.boundingBox())!.y, { timeout: 2_000 }).toBeCloseTo(restingY, 0);
        await page.waitForTimeout(300);
        await expect(sheet.count()).resolves.toBe(1);

        // A flick: two large moves in quick succession.
        handle = (await page.getByTestId('session-actions-sheet-handle').boundingBox())!;
        [x, y] = [handle.x + handle.width / 2, handle.y + handle.height / 2];
        await touch('touchStart', x, y);
        await touch('touchMove', x, y + 40);
        await touch('touchMove', x, y + 90);
        await touch('touchEnd', x, y + 90);
        await expect.poll(() => sheet.count()).toBe(0);

        await row.click({ button: 'right' });
        await sheet.waitFor();
        await page.waitForTimeout(500);
        handle = (await page.getByTestId('session-actions-sheet-handle').boundingBox())!;
        await page.touchscreen.tap(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await expect.poll(() => sheet.count()).toBe(0);
        expect(await page.evaluate(() => (window as any).__ACTIONS__ ?? [])).toEqual([]);
        expect(await routerCalls(page)).toEqual([]);
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('switches the New Session machine from the focus row as a bottom sheet', async () => {
        const { page, errors } = await open({ theme: 'dark' });
        await page.getByTestId('herd-machine-menu').click();
        const sheet = page.getByTestId('herd-machine-popover');
        await sheet.waitFor();
        await expect(sheet.getAttribute('role')).resolves.toBe('menu');
        expect(await classList(page, 'herd-machine-popover')).toContain('herd-sheet-up');
        expect((await sheet.boundingBox())!.width).toBe(PHONE.width);
        const options = await sheet.locator('[data-testid^="herd-machine-option-"]').evaluateAll((items) => items.map((item) => item.getAttribute('data-testid')));
        expect(options).toEqual(['herd-machine-option-studio-mac', 'herd-machine-option-build-box', 'herd-machine-option-gpu-lab']);
        await expect(sheet.getByTestId('herd-machine-option-studio-mac').getAttribute('aria-selected')).resolves.toBe('true');
        await expect(sheet.getByTestId('herd-machine-option-gpu-lab').isDisabled()).resolves.toBe(true);
        expect(Math.round((await sheet.getByTestId('herd-machine-option-build-box').boundingBox())!.height)).toBeGreaterThanOrEqual(48);
        await evidence(page, 'mobile-machine-sheet-dark-390');

        await sheet.getByTestId('herd-machine-option-build-box').click();
        await expect.poll(() => sheet.count()).toBe(0);
        expect(await page.evaluate(() => (window as any).__DRAFT_MACHINE_WRITES__)).toEqual(['build-box']);
        await expect(page.getByTestId('herd-machine-menu').innerText()).resolves.toContain('build-box');
        expect(errors).toEqual([]);
        await page.close();
    }, 20_000);

    it('shows the connection line, hides Workspace when it is off, and honors reduced motion', async () => {
        const { page, errors } = await open({ query: { socket: 'connecting', workspace: 'off' }, reducedMotion: true });
        await page.getByTestId('mobile-home-header').waitFor();
        await expect(page.getByTestId('mobile-home-header').getByText('connecting', { exact: false }).count()).resolves.toBeGreaterThan(0);
        await expect(page.getByTestId('mobile-home-header').getByRole('button', { name: 'Workspace', exact: true }).count()).resolves.toBe(0);
        await page.getByTestId('tab-settings').click();
        // Reduced motion: the indicator jumps without a transition.
        await expect(page.getByTestId('tab-indicator').evaluate((element) => getComputedStyle(element).transitionDuration)).resolves.toMatch(/^0s/);
        expect(await indicatorX(page)).toBeCloseTo((PHONE.width / 3) * 2, 0);
        expect(errors).toEqual([]);
        await page.close();

        const noInsets = await open({ insets: false });
        await noInsets.page.getByTestId('mobile-home-header').waitFor();
        expect((await box(noInsets.page, 'mobile-home-header')).height).toBe(58 + 1);
        const tabBar = (await noInsets.page.getByRole('tablist').boundingBox())!;
        expect(tabBar.y + tabBar.height).toBe(PHONE.height);
        await noInsets.page.close();
    }, 20_000);

    it.each([
        ['desktop card', { width: 1440, height: 900, insets: false, query: { screen: 'desktop' } }],
        ['phone sheet', {}],
    ] as const)('hands input back to the page as soon as the %s closes', async (_presentation, options) => {
        const openMenu = async (page: Page) => {
            await page.locator('[data-herd-row="dock"]').click({ button: 'right', position: { x: 120, y: 20 } });
            await page.getByRole('button', { name: /Fork/ }).first().waitFor();
        };
        // A key press while the menu leaves never runs a dismissed action.
        const keys = await open(options);
        await openMenu(keys.page);
        await keys.page.getByRole('button', { name: /Fork/ }).first().focus();
        await keys.page.keyboard.press('Escape');
        await keys.page.keyboard.press('Enter');
        await keys.page.waitForTimeout(400);
        expect(await keys.page.evaluate(() => (window as any).__ACTIONS__ ?? [])).toEqual([]);
        expect(keys.errors).toEqual([]);
        await keys.page.close();
        // The next click reaches the page while the menu is still leaving.
        const { page, errors } = await open(options);
        await openMenu(page);
        await page.keyboard.press('Escape');
        await page.locator('[data-herd-row="auth"]').click({ position: { x: 120, y: 20 } });
        await expect.poll(() => routerCalls(page)).toContain('/session/auth');
        expect(errors).toEqual([]);
        await page.close();
    }, 40_000);

    it('keeps anchored cards at desktop width', async () => {
        const { page, errors } = await open({ width: 1440, height: 900, insets: false, query: { screen: 'desktop' } });
        await page.getByTestId('fixture-desktop').waitFor();
        const pill = await box(page, 'herd-machine-menu');
        await page.getByTestId('herd-machine-menu').click();
        const menu = page.getByTestId('herd-machine-popover');
        await menu.waitFor();
        expect(await classList(page, 'herd-machine-popover')).toContain('herd-pop');
        expect(await classList(page, 'herd-machine-popover')).not.toContain('herd-sheet-up');
        await expect(page.getByTestId('herd-machine-popover-handle').count()).resolves.toBe(0);
        const menuBox = (await menu.boundingBox())!;
        expect(menuBox.width).toBeLessThan(400);
        expect(menuBox.y).toBeGreaterThan(pill.y + pill.height);
        await expect(menu.getByTestId('herd-machine-option-build-box').evaluate((element) => getComputedStyle(element).minHeight)).resolves.not.toBe('48px');
        await page.keyboard.press('Escape');
        await expect.poll(() => menu.count()).toBe(0);

        await page.locator('[data-herd-row="dock"]').click({ button: 'right', position: { x: 120, y: 20 } });
        await expect(page.getByTestId('session-actions-sheet').count()).resolves.toBe(0);
        const fork = page.getByRole('button', { name: /Fork/ });
        await fork.waitFor();
        const forkBox = (await fork.boundingBox())!;
        expect(forkBox.width).toBeLessThan(300);
        expect(forkBox.x).toBeGreaterThan(100);
        await evidence(page, 'desktop-menus-unchanged-light-1440');
        await fork.click();
        expect(await page.evaluate(() => (window as any).__ACTIONS__)).toEqual(['fork']);
        expect(errors).toEqual([]);
        await page.close();
    }, 20_000);
});
