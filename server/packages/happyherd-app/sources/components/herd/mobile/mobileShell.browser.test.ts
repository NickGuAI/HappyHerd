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
 * The Web Mobile shell (UI overhaul): the real SidebarNavigator with the phone
 * top bar, the panel docked as the session list and slid in as a drawer, and
 * the pages' title rows, with every app source file compiled through the
 * Unistyles Babel transform and web runtime as in the Expo build. Only data,
 * navigation, device services and other slices' surfaces are stubbed; the
 * navigator's stack is the fixture router's current screen.
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
    'expo-router/drawer': `
        import React from 'react';
        import { FixtureScreens } from '${testData('mobileShellScreens.tsx')}';
        export const Drawer = () => React.createElement(FixtureScreens);
    `,
    '@/auth/AuthContext': `export const useAuth = () => ({ isAuthenticated: true });`,
    '@/utils/isTauri': `export const isTauri = () => false;`,
    '@/hooks/useTauriZoom': `export const DEFAULT_APP_ZOOM = 1;`,
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
    // As in the library, a provider (the navigator's, below the top bar) overrides them.
    'react-native-safe-area-context': `
        import React from 'react';
        const params = new URLSearchParams(window.location.search);
        const insets = { top: Number(params.get('top') ?? 0), right: 0, bottom: Number(params.get('bottom') ?? 0), left: 0 };
        export const SafeAreaInsetsContext = React.createContext(insets);
        export const useSafeAreaInsets = () => React.useContext(SafeAreaInsetsContext);
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
            machineWorkspace: params.get('workspace') !== 'off', sessionListGrouping: 'flat',
            focusMode: params.get('focus') === 'on' ? { projectId: 'web-app', endsAt: Date.now() + 25 * 60_000, startedAt: Date.now(), durationMinutes: 25 } : null,
            hideInactiveSessions: true, expResumeSession: false, devModeEnabled: false,
            navigationSidebarCollapsed: false, zenMode: false,
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
        export const useProjects = () => ({ 'web-app': { id: 'web-app', name: 'Web App Suite' } });
        export const useFeedItems = () => [
            { id: 'feed-1', body: { kind: 'text', text: 'Automation "Nightly triage" finished' } },
            { id: 'feed-2', body: { kind: 'text', text: 'Session "Refresh token rotation" needs approval' } },
        ];
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
    // The drawer's panel lists the same fixture rows.
    '@/components/MainView': `export { FixtureSessionsListWrapper as MainView } from '${testData('mobileShellFixtureList.tsx')}';`,
    '@/components/FeedItemCard': `
        import React from 'react';
        import { Pressable, Text } from 'react-native';
        import { useRouter } from 'expo-router';
        export const FeedItemCard = ({ item }) => {
            const router = useRouter();
            return React.createElement(Pressable, { testID: 'feed-item', onPress: () => router.push('/feed/' + item.id), style: { padding: 10 } },
                React.createElement(Text, { style: { fontFamily: 'SpaceGrotesk-Regular' } }, item.body.text));
        };
    `,
    '@/components/UpdateBanner': `export const UpdateBanner = () => null;`,
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
            // Production, as in the Expo export: under "test", React Native Web swaps in a mock
            // Animated that jumps to every end value, and the drawer's slide would not run.
            define: { __DEV__: 'false', 'process.env.EXPO_OS': '"web"', 'process.env.NODE_ENV': '"production"' },
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
    /** Where the drawer's panel currently sits: its left edge and whether it is inert. */
    const drawer = (page: Page) => page.getByTestId('herd-phone-drawer').evaluate((element) => ({
        x: Math.round(element.getBoundingClientRect().x),
        width: Math.round(element.getBoundingClientRect().width),
        inert: (element as HTMLElement).inert,
        hidden: element.getAttribute('aria-hidden'),
    }));
    const openSession = async (page: Page, id = 'auth') => {
        await page.locator(`[data-herd-row="${id}"]`).first().click();
        await page.getByTestId('fixture-session').waitFor();
    };

    const offscreen = async (page: Page) => (await drawer(page)).x <= -PHONE.width * 0.9;
    /** Lets entrance motion (rows slide in, lists stagger) finish, so geometry is measured at rest. */
    const settled = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity))
        .map((animation) => animation.finished.catch(() => undefined))));
    const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

    it('lays out the phone home: the top bar over the docked panel, with no tab bar or floating button', async () => {
        for (const theme of ['light', 'dark'] as const) {
            const { page, errors } = await open({ theme });
            await page.getByTestId('herd-sidebar-docked').waitFor();
            const bar = await box(page, 'herd-top-bar');
            // The bar clears the notch, then keeps the mock's 52 px row.
            expect(bar).toMatchObject({ x: 0, y: 0, width: PHONE.width, height: PHONE_INSETS.top + 52 });
            // The list is the panel, docked open, so the brand leads and there is no panel toggle.
            await expect(page.getByTestId('navigation-sidebar-toggle').count()).resolves.toBe(0);
            expect(await box(page, 'herd-top-bar-brand')).toMatchObject({ x: 4, width: 44, height: 44 });
            // Focus, the Inbox bell and the machine pill are 44 px targets ending 4 px from the edge.
            for (const id of ['focus-mode-enter', 'herd-inbox-bell', 'herd-machine-menu']) {
                expect((await box(page, id)).height).toBeGreaterThanOrEqual(44);
            }
            const machine = await box(page, 'herd-machine-menu');
            expect(PHONE.width - (machine.x + machine.width)).toBeCloseTo(4, 0);
            await expect(page.getByTestId('herd-machine-menu').innerText()).resolves.toContain('studio-mac');
            // Search is the command palette, off by default in Features.
            await expect(page.getByTestId('herd-command-search').count()).resolves.toBe(0);

            // The docked panel fills the screen below the bar.
            const panel = await box(page, 'herd-sidebar-docked');
            expect(panel).toMatchObject({ x: 0, y: bar.height, width: PHONE.width, height: PHONE.height - bar.height });
            const docked = page.getByTestId('herd-sidebar-docked');
            // The desktop panel's own controls, starting on the 16 px gutter.
            const workspace = (await docked.getByRole('button', { name: 'Workspace', exact: true }).boundingBox())!;
            expect(workspace.x).toBe(16);
            const newSession = (await docked.getByRole('button', { name: /New session/ }).boundingBox())!;
            expect(newSession.x).toBe(16);
            for (const label of ['Projects', 'Automations']) {
                await expect(docked.getByRole('button', { name: label, exact: true }).count()).resolves.toBe(1);
            }
            await expect(docked.locator('[data-herd-row]').count()).resolves.toBe(6);
            await settled(page);
            // Rows: the highlight reaches 8 px past the content; the avatar and the time sit on the gutters.
            const rowEdges = await docked.locator('[data-herd-row]').evaluateAll((rows) => rows.map((row) => {
                const inside = [...row.querySelectorAll('*')].map((node) => node.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
                return {
                    row: Math.round(row.getBoundingClientRect().left),
                    left: Math.round(Math.min(...inside.map((rect) => rect.left))),
                    right: Math.round(Math.max(...inside.map((rect) => rect.right))),
                };
            }));
            for (const edge of rowEdges) expect(edge).toEqual({ row: 8, left: 16, right: PHONE.width - 16 });
            // Settings sits in the bottom row, its icon on the gutter, clear of the home indicator.
            const settings = (await docked.getByRole('button', { name: /Settings/ }).boundingBox())!;
            expect(PHONE.height - (settings.y + settings.height)).toBeGreaterThanOrEqual(PHONE_INSETS.bottom);
            expect((await docked.locator('[data-icon="settings-outline"]').boundingBox())!.x).toBe(16);
            // Nothing of the earlier phone shell remains.
            await expect(page.getByRole('tablist').count()).resolves.toBe(0);
            await expect(page.getByTestId('mobile-new-session-fab').count()).resolves.toBe(0);
            await expect(page.getByTestId('mobile-home-header').count()).resolves.toBe(0);
            expect(await noHorizontalOverflow(page)).toBe(true);
            await evidence(page, `phone-home-${theme}-390`);
            expect(errors).toEqual([]);
            await page.close();
        }
    }, 40_000);

    it('slides the panel in as a drawer, and closes it with the scrim, Escape, a drag, or a row', async () => {
        const { page, errors } = await open();
        await openSession(page);
        const toggle = page.getByTestId('navigation-sidebar-toggle');
        // Off the list the panel toggle leads the bar, its icon on the 16 px gutter.
        expect(await box(page, 'navigation-sidebar-toggle')).toMatchObject({ x: 4, width: 44, height: 44 });
        await expect(toggle.getAttribute('aria-expanded')).resolves.toBe('false');
        // The drawer mounts on first use.
        await expect(page.getByTestId('herd-phone-drawer').count()).resolves.toBe(0);

        await toggle.click();
        await expect(toggle.getAttribute('aria-expanded')).resolves.toBe('true');
        // It slides: a frame later it is still on its way, then it rests at the left edge at 92% width.
        expect((await drawer(page)).x).toBeLessThan(0);
        await expect.poll(async () => (await drawer(page)).x).toBe(0);
        // Open, it is reachable: not inert, and not hidden from assistive technology.
        expect(await drawer(page)).toMatchObject({ width: Math.round(PHONE.width * 0.92), inert: false, hidden: null });
        // Below the bar, which keeps its toggle reachable, over a scrim.
        expect((await box(page, 'herd-phone-drawer')).y).toBe(PHONE_INSETS.top + 52);
        await expect(page.getByTestId('herd-phone-drawer').locator('[data-herd-row]').count()).resolves.toBe(6);
        await evidence(page, 'phone-drawer-light-390');

        // The scrim closes it; closed, it is out of the tab order and hidden from assistive technology.
        await page.mouse.click(PHONE.width - 12, 500);
        await expect.poll(() => offscreen(page)).toBe(true);
        expect(await drawer(page)).toMatchObject({ inert: true, hidden: 'true' });
        await expect(toggle.getAttribute('aria-expanded')).resolves.toBe('false');

        // Escape closes it without also going Back.
        await toggle.click();
        await expect.poll(async () => (await drawer(page)).x).toBe(0);
        await page.keyboard.press('Escape');
        await expect.poll(() => offscreen(page)).toBe(true);
        expect(await page.evaluate(() => (window as any).__UNHANDLED_ESCAPES__)).toBe(0);
        expect(await page.evaluate(() => (window as any).__ROUTER_BACK_COUNT__ ?? 0)).toBe(0);

        // A drag to the left closes it; a short one springs back.
        await toggle.click();
        await expect.poll(async () => (await drawer(page)).x).toBe(0);
        const drag = async (fromX: number, toX: number) => {
            await page.mouse.move(fromX, 460);
            await page.mouse.down();
            await page.mouse.move(toX, 464, { steps: 10 });
            await page.mouse.up();
        };
        await drag(280, 250);
        await expect.poll(async () => (await drawer(page)).x).toBe(0);
        await drag(300, 150);
        await expect.poll(() => offscreen(page)).toBe(true);

        // A row opens its session and closes the drawer.
        await toggle.click();
        await expect.poll(async () => (await drawer(page)).x).toBe(0);
        await page.getByTestId('herd-phone-drawer').locator('[data-herd-row="dock"]').click();
        await expect.poll(() => routerCalls(page)).toEqual(['/session/auth', '/session/dock']);
        await expect.poll(() => offscreen(page)).toBe(true);
        expect(errors).toEqual([]);
        await page.close();
    }, 40_000);

    it('pulls the drawer in with a touch swipe from the left edge, and lets a short one fall back', async () => {
        const { page, errors } = await open({ touch: true });
        await page.locator('[data-herd-row="auth"]').first().tap();
        await page.getByTestId('fixture-session').waitFor();
        const cdp = await page.context().newCDPSession(page);
        const swipe = async (xs: number[]) => {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 4, y: 420 }] });
            for (const x of xs) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 422 }] });
        };
        await swipe([24, 70, 120, 170]);
        // The panel follows the finger before the release decides.
        const following = await drawer(page);
        expect(following.x).toBeGreaterThan(-PHONE.width);
        expect(following.x).toBeLessThan(0);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(async () => (await drawer(page)).x).toBe(0);

        // The scrim shows to the right of the panel.
        await page.touchscreen.tap(PHONE.width - 12, 500);
        await expect.poll(() => offscreen(page)).toBe(true);
        await swipe([20, 40]);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(() => offscreen(page)).toBe(true);
        await expect(page.getByTestId('navigation-sidebar-toggle').getAttribute('aria-expanded')).resolves.toBe('false');
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('gives the drawer’s own destinations a title row without Back, and nested pages Back on the gutter', async () => {
        for (const theme of ['light', 'dark'] as const) {
            const { page, errors } = await open({ theme });
            await page.getByTestId('herd-sidebar-docked').getByRole('button', { name: /Settings/ }).click();
            await page.getByTestId('fixture-page').waitFor();
            expect(await routerCalls(page)).toEqual(['/settings']);
            await expect(page.getByTestId('header-back').count()).resolves.toBe(0);
            // The title row is the page's first line: right under the bar (no second notch inset), on the gutter.
            const title = (await page.getByTestId('fixture-page').getByText('Settings', { exact: true }).boundingBox())!;
            expect(title.x).toBeCloseTo(16, 0);
            expect(title.y).toBeGreaterThan(PHONE_INSETS.top + 52);
            expect(title.y).toBeLessThan(PHONE_INSETS.top + 52 + 56);
            // No hairline of its own: the bar above already has one.
            const hairlines = await page.getByTestId('fixture-page').evaluate((element) => [...element.querySelectorAll('*')]
                .filter((node) => getComputedStyle(node).borderBottomWidth === '1px').length);
            expect(hairlines).toBe(0);
            await evidence(page, `phone-page-top-level-${theme}-390`);

            await page.evaluate(() => (window as any).__FIXTURE_ROUTER__.push('/settings/appearance'));
            const back = page.getByTestId('header-back');
            await back.waitFor();
            await expect(back.getAttribute('aria-label')).resolves.toBe('Back');
            expect(await box(page, 'header-back')).toMatchObject({ x: 5, width: 44, height: 44 });
            const chevron = (await back.locator('[data-icon="chevron-back"]').boundingBox())!;
            expect(chevron.x).toBe(16);
            await evidence(page, `phone-page-nested-${theme}-390`);
            await back.click();
            expect(await page.evaluate(() => (window as any).__ROUTER_BACK_COUNT__)).toBe(1);
            await expect(page.getByTestId('header-back').count()).resolves.toBe(0);
            expect(errors).toEqual([]);
            await page.close();
        }
    }, 40_000);

    it('opens the command palette from the search square when it is on', async () => {
        const { page, errors } = await open({ query: { palette: 'on' } });
        const search = page.getByTestId('herd-command-search');
        await search.waitFor();
        // A 44 px square right after the brand.
        expect(await box(page, 'herd-command-search')).toMatchObject({ x: 4 + 44 + 2, width: 44, height: 44 });
        await search.click();
        expect(await page.evaluate(() => (window as any).__PALETTE_OPENS__)).toBe(1);
        expect(errors).toEqual([]);
        await page.close();
    }, 20_000);

    it('fits the top bar at 320 px and while the Focus countdown runs', async () => {
        const fits = async (page: Page, width: number) => {
            expect(await noHorizontalOverflow(page)).toBe(true);
            const boxes = await page.getByTestId('herd-top-bar').evaluate((bar) => [...bar.querySelectorAll('[role="button"], button')]
                .map((node) => node.getBoundingClientRect()).map((rect) => [Math.round(rect.left), Math.round(rect.right)]));
            for (const [left, right] of boxes) {
                expect(left).toBeGreaterThanOrEqual(0);
                expect(right).toBeLessThanOrEqual(width);
            }
        };
        const narrow = await open({ width: 320, height: 568 });
        await openSession(narrow.page);
        await fits(narrow.page, 320);
        // Too narrow for the machine name: the pill keeps its status dot.
        await expect(narrow.page.getByTestId('herd-machine-menu').innerText()).resolves.not.toContain('studio-mac');
        await evidence(narrow.page, 'phone-session-top-bar-light-320');
        expect(narrow.errors).toEqual([]);
        await narrow.page.close();

        const focusing = await open({ query: { focus: 'on' } });
        await openSession(focusing.page);
        await focusing.page.getByTestId('focus-mode-pill').waitFor();
        await fits(focusing.page, PHONE.width);
        await expect(focusing.page.getByTestId('herd-machine-menu').innerText()).resolves.not.toContain('studio-mac');
        await evidence(focusing.page, 'phone-focus-top-bar-light-390');
        expect(focusing.errors).toEqual([]);
        await focusing.page.close();
    }, 30_000);

    it('opens and closes the drawer at once with reduced motion', async () => {
        const { page, errors } = await open({ reducedMotion: true });
        await openSession(page);
        await page.getByTestId('navigation-sidebar-toggle').click();
        await page.waitForTimeout(50);
        expect((await drawer(page)).x).toBe(0);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(50);
        expect(await offscreen(page)).toBe(true);
        expect(errors).toEqual([]);
        await page.close();
    }, 20_000);
});
