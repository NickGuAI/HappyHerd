import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@babel/core';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../../..');
const sourcesRoot = resolve(appRoot, 'sources');
const opsSource = readFileSync(resolve(sourcesRoot, 'sync/ops.ts'), 'utf8');
const opNames = [...opsSource.matchAll(/export (?:async )?function (\w+)/g)].map((match) => match[1]);
// A home folder as the daemon lists it, longer than the phone folder browser's card.
const homeEntries = [
    ...['.config', '.ssh', 'Applications', 'Desktop', 'Documents', 'Downloads', 'Library', 'Movies', 'Music', 'Pictures', 'Public', 'code', 'notes']
        .map((name) => ({ name, type: 'directory' })),
    ...['.gitconfig', '.zshrc'].map((name) => ({ name, type: 'file' })),
];

/**
 * The real New Session screen in Streamline mode, with every app source file
 * compiled through the Unistyles Babel transform and web runtime as in the
 * Expo build. Only data, device services and unrelated surfaces are stubbed.
 */
const virtualModules: Record<string, string> = {
    // Settings' What's New entries report through @/track (SettingsFrame).
    '@/track': `export const trackWhatsNewClicked = () => {}; export const trackSessionSwitched = () => {};`,
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
    '@expo/vector-icons': `
        import React from 'react';
        const Icon = ({ name, color, size }) => React.createElement('span', {
            'data-icon': name, 'aria-hidden': true,
            style: { color, fontSize: Math.round(size * 0.8), width: size, height: size, lineHeight: size + 'px', textAlign: 'center', display: 'inline-block' },
        }, name.includes('chevron-down') ? '⌄' : name.includes('add') || name.includes('plus') ? '+' : name.includes('folder') ? '▣' : name.includes('checkmark') || name.includes('check') ? '✓' : '•');
        Icon.glyphMap = {};
        export const Ionicons = Icon; export const Octicons = Icon; export const MaterialCommunityIcons = Icon;
    `,
    'expo-image': `
        import React from 'react';
        export const Image = ({ style, tintColor }) => {
            const flat = Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity).filter(Boolean)) : (style ?? {});
            return React.createElement('span', { style: { display: 'inline-block', width: flat.width, height: flat.height, borderRadius: 4, background: tintColor ?? '#888' } });
        };
    `,
    'expo-glass-effect': `import { View } from 'react-native-unistyles/components/native/View'; export const GlassView = View; export const isGlassEffectAPIAvailable = () => false; export const isLiquidGlassAvailable = () => false;`,
    'expo-blur': `import { View } from 'react-native-unistyles/components/native/View'; export const BlurView = View;`,
    'expo-constants': `export default { statusBarHeight: 0, expoConfig: { extra: {} } };`,
    'expo-crypto': `export const randomUUID = () => 'fixture-' + Math.random().toString(16).slice(2);`,
    'expo-router': `
        import React from 'react';
        const router = {
            back() {}, replace() {}, navigate(path) { window.__ROUTES__ = [...(window.__ROUTES__ ?? []), path]; },
            push(path) { window.__ROUTES__ = [...(window.__ROUTES__ ?? []), path]; },
        };
        export const useRouter = () => router;
        export const useLocalSearchParams = () => ({});
        export const useNavigation = () => ({ setOptions() {}, addListener: () => () => {} });
        export const usePathname = () => '/new';
        // Settings pages set their header through the Stack screen.
        export const Stack = { Screen: () => null };
    `,
    'react-native-safe-area-context': `
        import React from 'react';
        export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });
        export const SafeAreaInsetsContext = React.createContext(null);
    `,
    // Screens pass Unistyles styles, so stand-ins use the Unistyles View wrapper.
    'react-native-keyboard-controller': `import { View } from 'react-native-unistyles/components/native/View'; export const KeyboardAvoidingView = View; export const KeyboardStickyView = View; export const KeyboardProvider = ({ children }) => children;`,
    'react-native-reanimated': `
        import React from 'react';
        import { View } from 'react-native';
        const builder = { duration: () => builder, easing: () => builder, reduceMotion: () => builder, withInitialValues: () => builder, delay: () => builder };
        const Animated = { View, createAnimatedComponent: (component) => component };
        export default Animated;
        export const FadeIn = builder, FadeOut = builder, FadeInDown = builder, FadeOutUp = builder, LinearTransition = builder;
        export const ReduceMotion = { System: 'system' };
        export const Easing = { out: (x) => x, in: (x) => x, inOut: (x) => x, cubic: 'cubic' };
        export const useSharedValue = (value) => React.useRef({ value }).current;
        export const useAnimatedStyle = (factory) => factory();
        export const useReducedMotion = () => false;
        export const withTiming = (value) => value;
        export const withSpring = (value) => value;
        export const cancelAnimation = () => {};
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
        const listeners = new Set();
        const emit = () => listeners.forEach((listener) => listener());
        const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
        const efforts = ['low', 'medium', 'high', 'xhigh', 'max'].map((code) => ({ code, value: code, ...(code === 'max' ? { isDefault: true } : {}) }));
        const customModelNames = new URLSearchParams(window.location.search).get('modelNames') === 'custom';
        const claude = {
            detectedAt: 1,
            sources: { models: 'happyherd-release-catalog', effortLevels: 'cli-help', permissionModes: 'daemon-defaults' },
            models: [
                // Daemon model IDs and human-facing display names remain separate.
                { code: 'claude-opus-5', value: 'Opus 5', isDefault: true, effortLevels: efforts },
                { code: 'claude-opus-5-5', value: customModelNames ? 'Opus Research Preview' : 'Opus 5.5', effortLevels: efforts },
                { code: 'claude-sonnet-5', value: customModelNames ? 'Sonnet Team Edition' : 'Sonnet 5', effortLevels: efforts },
            ],
            effortLevels: efforts,
            permissionModes: [
                { code: 'default', value: 'default' },
                { code: 'acceptEdits', value: 'acceptEdits' },
                { code: 'plan', value: 'plan' },
                { code: 'bypassPermissions', value: 'bypassPermissions', isDefault: true },
            ],
        };
        const now = Date.now();
        export const machines = [
            { id: 'studio-mac', active: true, activeAt: now, createdAt: 3, metadata: { host: 'studio-mac', displayName: 'studio-mac', platform: 'darwin', homeDir: '/Users/example-user', cliAvailability: { claude: true, codex: true }, agentCapabilities: { claude } } },
            { id: 'gpu-lab', active: new URLSearchParams(window.location.search).has('duplicateFolders'), activeAt: now - 7200000, createdAt: 2, metadata: { host: 'gpu-lab', platform: 'linux', homeDir: '/home/example-user', cliAvailability: { claude: true }, agentCapabilities: { claude } } },
        ];
        const machineMap = Object.fromEntries(machines.map((machine) => [machine.id, machine]));
        const projects = {
            'project-web': { id: 'project-web', kind: 'personal', name: 'HappyHerd web' },
            'project-docs': { id: 'project-docs', kind: 'personal', name: 'Docs site' },
        };
        const settings = {
            agentInputEnterToSend: true, fileDiffsSidebar: new URLSearchParams(window.location.search).get('panel') !== 'off', expImageUpload: false,
            newSessionMode: new URLSearchParams(window.location.search).get('mode') ?? 'streamline',
            streamlineAgent: 'claude', streamlineAgentDefaults: {}, streamlineGithubWorktree: true,
            agentDefaultOverrides: {}, favoriteMachinePaths: [], recentMachinePaths: [], focusMode: null,
        };
        window.__SETTINGS__ = settings;
        const read = (key) => React.useSyncExternalStore(subscribe, () => settings[key], () => settings[key]);
        export const useSetting = read;
        export const useSettingMutable = (key) => [read(key), (value) => { settings[key] = value; emit(); }];
        export const useLocalSetting = () => false;
        export const useAllMachines = () => machines;
        export const useMachine = (id) => machineMap[id] ?? null;
        export const useProjects = () => projects;
        export const useSessions = () => [];
        export const storage = { getState: () => ({ machines: machineMap, projects, settings, sessions: {}, sessionsData: [], localSettings: {} }) };
    `,
    '@/hooks/useNewSessionDraft': `
        import React from 'react';
        const listeners = new Set();
        let state = {
            input: '', attachments: [], selectedMachineId: 'studio-mac', selectedPath: '/Users/example-user/code/happyherd',
            selectedAccountProjectId: undefined, selectedCommanderId: null, agentType: 'claude',
            permissionMode: null, modelMode: null, effortLevel: null, sessionType: 'simple', worktreeKey: null,
        };
        const set = (patch) => { state = { ...state, ...patch }; window.__DRAFT__ = { ...state }; listeners.forEach((listener) => listener()); };
        Object.assign(state, {
            setInput: (input) => set({ input }), setAttachments: (attachments) => set({ attachments }),
            setMachineId: (id) => set({ selectedMachineId: id, selectedPath: null, selectedCommanderId: null, permissionMode: null, modelMode: null, effortLevel: null, sessionType: 'simple', worktreeKey: null }),
            renameMachineId: (id) => set({ selectedMachineId: id }),
            setPath: (selectedPath) => set({ selectedPath, worktreeKey: null }),
            setCommanderId: (selectedCommanderId) => set({ selectedCommanderId, worktreeKey: null }),
            setAccountProjectId: (selectedAccountProjectId) => set({ selectedAccountProjectId }),
            setAgentType: (agentType) => set(agentType === state.agentType ? { agentType } : { agentType, permissionMode: null, modelMode: null, effortLevel: null }),
            setPermissionMode: (permissionMode) => set({ permissionMode }),
            setModelMode: (modelMode) => set({ modelMode }),
            setEffortLevel: (effortLevel) => set({ effortLevel }),
            setSessionType: (sessionType) => set({ sessionType }),
            setWorktreeKey: (worktreeKey) => set({ worktreeKey }),
        });
        let snapshot = { ...state };
        listeners.add(() => { snapshot = { ...state }; });
        export const useNewSessionDraft = (selector) => React.useSyncExternalStore(
            (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
            () => selector(state),
            () => selector(state),
        );
        useNewSessionDraft.getState = () => state;
    `,
    '@/sync/githubRepository': `
        const statusOf = (path) => (path ?? '').includes('happyherd') ? 'github' : (path ?? '').includes('notes') ? 'none' : 'git';
        export const useGithubRepository = (machineId, path) => ({ status: machineId && path ? statusOf(path) : 'unknown', loading: false });
        export const detectGithubRepository = async (_machineId, path) => statusOf(path);
    `,
    '@/hooks/useStreamlineLocations': `
        export const useStreamlineLocations = () => new URLSearchParams(window.location.search).has('duplicateFolders') ? [
            { machineId: 'studio-mac', path: '/work/shared', name: 'shared', machineName: 'studio-mac', online: true },
            { machineId: 'studio-mac', path: '/other/shared', name: 'shared', machineName: 'studio-mac', online: true },
            { machineId: 'gpu-lab', path: '/work/shared', name: 'shared', machineName: 'gpu-lab', online: true },
        ] : [
            { machineId: 'studio-mac', path: '/Users/example-user/code/happyherd', name: 'happyherd', machineName: 'studio-mac', online: true },
            { machineId: 'studio-mac', path: '/Users/example-user/notes', name: 'notes', machineName: 'studio-mac', online: true },
            { machineId: 'gpu-lab', path: '/home/example-user/bench', name: 'bench', machineName: 'gpu-lab', online: false },
        ];
    `,
    '@/sync/ops': opNames.map((name) => name === 'machineListCommanders'
        ? `export const machineListCommanders = async () => ({ commanders: [
            { id: 'athena', name: 'Athena', role: 'Engineering commander', workspace: '/Users/example-user/code/happyherd', commanderPath: '/c/athena', agentContextPath: '/c/athena/ctx' },
            { id: 'hermes', name: 'Hermes', role: 'Writing and research', workspace: '/Users/example-user/notes', commanderPath: '/c/hermes', agentContextPath: '/c/hermes/ctx' },
        ], globalAgentsPath: null });`
        : name === 'machineSpawnNewSession'
            ? `import { gate, enabled } from 'group16-transport'; export const machineSpawnNewSession = async (options) => { window.__SPAWNS__ = [...(window.__SPAWNS__ ?? []), options]; return enabled ? gate('spawn', options) : { type: 'error', errorMessage: 'fixture stops after the payload' }; };`
            : name === 'machineGetDirectoryTree'
                ? `export const machineGetDirectoryTree = async (_machineId, path) => ({ success: true, tree: { name: path, path, type: 'directory',
                    children: ${JSON.stringify(homeEntries)}.map((entry) => ({ ...entry, path: (path === '/' ? '' : path) + '/' + entry.name })) } });`
                : `export const ${name} = async () => ({ success: true });`).join('\n'),
    'group16-transport': `
        export const enabled = new URLSearchParams(location.search).has('proof16');
        const pending = new Map();
        const calls = { spawn: [], hydrate: [], send: [] };
        export const gate = (stage, payload) => {
            calls[stage].push(payload);
            return new Promise((resolve, reject) => {
                if (pending.has(stage)) throw new Error('Duplicate in-flight stage: ' + stage);
                pending.set(stage, { resolve, reject });
            });
        };
        window.__GROUP16__ = {
            calls,
            release(stage, reject = false) {
                const waiter = pending.get(stage);
                if (!waiter) throw new Error('No pending stage: ' + stage);
                pending.delete(stage);
                if (reject) waiter.reject(new Error('fixture-first-send-rejected'));
                else waiter.resolve(stage === 'spawn'
                    ? { type: 'success', sessionId: 'group16-session' }
                    : stage === 'send' ? { sessionId: 'group16-session', localId: 'group16-accepted' } : undefined);
            },
        };
    `,
    '@/sync/sync': `
        import { gate, enabled } from 'group16-transport';
        export const sync = {
            refreshSessions: async () => {},
            ensureSessionReady: async (id) => enabled ? gate('hydrate', id) : undefined,
            sendMessage: async (id, text, options) => enabled
                ? gate('send', { id, text, attachments: options.attachments, current: options.isCurrent() }) : ({}),
            assignSessionProject: async () => {},
        };
    `,
    '@/utils/worktree': `
        export * from '${resolve(sourcesRoot, 'utils/worktreePaths.ts')}';
        export const createWorktree = async () => { window.__WORKTREES__ = (window.__WORKTREES__ ?? 0) + 1; return { success: true, worktreePath: '/Users/example-user/code/happyherd/.dev/worktree/fixture', branchName: 'fixture' }; };
        export const listWorktrees = async () => [];
    `,
    '@/hooks/useWorktrees': `export const useWorktrees = () => ({ worktrees: [] });`,
    '@/modal': `export const Modal = { alert: (title, message) => { window.__GROUP16_ALERTS__ = [...(window.__GROUP16_ALERTS__ ?? []), { title, message }]; }, confirm: async () => false, show: () => {} }; export const useModal = () => ({ dismissTopModal: () => false });`,
    '@/hooks/useImagePicker': `export const useImagePicker = () => ({ selectedImages: [], clearImages() {}, removeImage() {}, pickImages: async () => {}, pickImagesForUpload: async () => [] });`,
    '@/hooks/useMachineFileUpload': `export const useMachineFileUpload = () => ({ state: { phase: 'idle' }, canCancel: false, canRetry: false, reset() {}, cancel() {}, retry() {}, pickAndUpload: async () => {}, uploadAssets: async () => [] });`,
    '@/hooks/useVoiceDictation': `export const useVoiceDictation = () => ({ phase: 'idle', error: null, canRetry: false, toggle() {}, cancel() {}, retry() {} });`,
    '@/hooks/useVoiceInputAvailability': `export const useVoiceInputAvailability = () => ({ available: false });`,
    '@/hooks/useFocusMode': `export const useFocusMode = () => null;`,
    '@/sync/agentSessionPlaces': `export * from '${resolve(sourcesRoot, 'sync/agentSessionPlaces.ts')}'; export const collectSessionPlaces = () => []; export const collectSessionWorkspaces = () => [];`,
    '@/sync/workspaceContext': `export const MAX_WORKSPACE_CONTEXT_ITEMS = 5; export const addWorkspaceContextEntry = (list) => list; export const buildWorkspaceContextMessage = async (_id, prompt) => ({ promptText: prompt, displayText: prompt }); export const clearWorkspaceContextFiles = async () => {}; export const workspaceContextEntryKey = (entry) => entry.path;`,
    '@/components/CommanderSessionAvatar': `
        import React from 'react';
        import { View, Text } from 'react-native';
        export const CommanderSessionAvatar = ({ size, commanderName }) => React.createElement(View, { style: { width: size, height: size, borderRadius: size / 2, backgroundColor: '#5E6B52', alignItems: 'center', justifyContent: 'center' } },
            React.createElement(Text, { style: { color: '#FFF9EC', fontSize: size * 0.4 } }, (commanderName ?? '?').slice(0, 1)));
    `,
    '@/components/ProviderIcon': `import React from 'react'; export const ProviderIcon = ({ size }) => React.createElement('span', { style: { display: 'inline-block', width: size, height: size, borderRadius: size / 2, background: '#C9AE85' } });`,
    '@/components/navigation/Header': `export const Header = () => null;`,
    '@/components/AnimatedOverlay': `import React from 'react'; import { View } from 'react-native-unistyles/components/native/View'; export const AnimatedClickAwayBackdrop = ({ exitImmediately, ...props }) => React.createElement(View, props); export const AnimatedPopup = ({ exitImmediately, ...props }) => React.createElement(View, props); export const LocalBlurHalo = () => null;`,
    '@/components/MachineWorkspaceContextPicker': `export const MachineWorkspaceContextPicker = () => null;`,
    '@/components/MachineFileUploadStatus': `export const MachineFileUploadStatus = () => null;`,
    '@/components/AgentInputAttachmentStrip': `export const AgentInputAttachmentStrip = () => null;`,
    '@/components/WorkspaceContextStrip': `export const WorkspaceContextStrip = () => null;`,
    '@/components/MobileTypographyFloor': `export const MobileTypographyFloor = ({ children }) => children;`,
    '@/components/navigation/headerMetrics': `export const MOBILE_GLASS_HEADER_HEIGHT = 0;`,
    '@/components/glassInteractionPolicy': `export const getNativeGlassInteractivity = () => false;`,
};

const fixturePlugin: Plugin = {
    name: 'streamline-browser-fixture',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, (args) => {
            if (args.path.startsWith('react-native-unistyles/components/native/')) {
                return { path: resolve(appRoot, '../../node_modules/react-native-unistyles/lib/module/components/native', `${args.path.split('/').at(-1)}.js`) };
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
                    import { StyleSheet, useUnistyles, UnistylesRuntime, withUnistyles } from ${JSON.stringify(resolve(appRoot, '../../node_modules/react-native-unistyles/lib/module/index.js'))};
                    StyleSheet.configure({ themes: { fixture: theme }, settings: { initialTheme: 'fixture' } });
                    export { StyleSheet, useUnistyles, UnistylesRuntime, withUnistyles };
                `
                : virtualModules[args.path],
            loader: 'tsx',
            resolveDir: here,
        }));
        bundle.onLoad({ filter: /\/sources\/.*\.tsx$/ }, (args) => {
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

// Fidelity captures (UI overhaul) render the real icon fonts and images: the
// stubs above keep ordinary runs fast, but they once hid invisible icons.
const REAL_ASSETS = process.env.HERD_REAL_ASSETS === '1';
if (REAL_ASSETS) {
    delete virtualModules['@expo/vector-icons'];
    delete virtualModules['expo-image'];
}

describe('Streamline New Session in the production style runtime', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            entryPoints: [resolve(here, '__testdata__/streamline.browser.fixture.tsx')],
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
            const background = url.searchParams.get('theme') === 'dark' ? '#151B28' : '#FFF9EC';
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<style>${['SpaceGrotesk-Regular', 'SpaceGrotesk-Medium', 'SpaceGrotesk-SemiBold', 'JetBrainsMono-Regular', 'JetBrainsMono-SemiBold'].map((family) => `@font-face{font-family:${family};src:url(/fonts/${family}.ttf)}`).join('')}html,body,#root{height:100%;margin:0;background:${background}}*{box-sizing:border-box}</style><style>${themeCss}</style><main id="root"></main><script>globalThis.global=globalThis;${script.replaceAll('</script', '<\\/script')}</script>`);
        });
        await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('streamline fixture did not bind');
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

    async function open(options: { theme?: 'light' | 'dark'; width?: number; height?: number; mode?: 'streamline' | 'advanced'; screen?: 'settings' | 'alpha'; duplicateFolders?: boolean; modelNames?: 'custom'; proof16?: boolean } = {}) {
        const page = await browser.newPage({ viewport: { width: options.width ?? 1440, height: options.height ?? 900 } });
        page.setDefaultTimeout(5_000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
        await page.goto(`${origin}/?theme=${options.theme ?? 'light'}&mode=${options.mode ?? 'streamline'}${options.screen ? `&screen=${options.screen}` : ''}${options.duplicateFolders ? '&duplicateFolders=1' : ''}${options.modelNames ? `&modelNames=${options.modelNames}` : ''}${options.proof16 ? '&proof16=1' : ''}`);
        await page.evaluate(() => document.fonts.ready);
        return { page, errors };
    }

    async function evidence(page: Page, name: string) {
        const directory = process.env.HERD_STREAMLINE_EVIDENCE_DIR?.trim();
        if (!directory) return;
        mkdirSync(directory, { recursive: true });
        await page.waitForTimeout(500);
        await page.screenshot({ path: resolve(directory, `${name}.png`) });
    }

    // A chip's label, without its chevron glyph.
    const chipLabel = async (page: Page, key: string) => (await page.getByTestId(`streamline-chip-${key}`).innerText()).split('\n')[0];

    it.each([1440, 390].flatMap(width => (['light', 'dark'] as const).map(theme => ({ width, height: width === 390 ? 844 : 900, theme }))))('shows New Chat with one Agent chip and a settings link at $width px in $theme', async surface => {
        const { page, errors } = await open(surface);
        await page.getByTestId('streamline-sections').waitFor();
        await expect(page.getByText('New Chat', { exact: true }).count()).resolves.toBe(1);
        await expect(page.getByText('Start a session quickly using your preconfigured agent defaults.', { exact: true }).count()).resolves.toBe(0);
        await expect(page.getByTestId('streamline-composer-chips').getByRole('button').count()).resolves.toBe(1);
        await expect(chipLabel(page, 'agent')).resolves.toBe('Agent: Claude');
        for (const key of ['model', 'effort', 'permission', 'worktree']) {
            await expect(page.getByTestId(`streamline-chip-${key}`).count()).resolves.toBe(0);
        }
        await expect(page.getByTestId('streamline-summary').innerText()).resolves.not.toMatch(/Uses |Creates a new git worktree|Runs directly/);
        await expect(page.getByTestId('streamline-summary').locator('[data-icon="sparkles-outline"]').count()).resolves.toBe(0);
        await evidence(page, `group18-streamline-single-chip-${surface.width}-${surface.theme}`);
        await page.getByTestId('streamline-settings-link').click();
        await expect.poll(() => page.evaluate(() => (window as any).__ROUTES__ ?? [])).toContain('/settings/streamline');
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it.each([
        { width: 1440, height: 900, theme: 'light' },
        { width: 1440, height: 900, theme: 'dark' },
        { width: 390, height: 844, theme: 'light' },
        { width: 390, height: 844, theme: 'dark' },
    ] as const)('keeps the New Chat input and newer draft through deferred preparation and a failed first-send retry at $width px in $theme', async surface => {
        const { page, errors } = await open({ ...surface, proof16: true });
        try {
            await page.getByTestId('streamline-sections').waitFor();
            await expect.poll(() => page.evaluate(() => (window as any).__DRAFT__?.modelMode)).toBe('claude-opus-5-5');
            const input = page.locator('textarea').first();
            await input.fill('First instruction');
            const original = await input.elementHandle();
            expect(original).not.toBeNull();
            const sameInput = async () => {
                expect(await original!.evaluate(element => element.isConnected && element === document.querySelector('textarea'))).toBe(true);
            };
            const count = (stage: 'spawn' | 'hydrate' | 'send') => page.evaluate(stage => (window as any).__GROUP16__.calls[stage].length, stage);
            const release = (stage: 'spawn' | 'hydrate' | 'send', reject = false) => page.evaluate(({ stage, reject }) => (window as any).__GROUP16__.release(stage, reject), { stage, reject });
            const send = page.getByRole('button', { name: 'Send', exact: true });

            await send.click();
            await expect.poll(() => count('spawn')).toBe(1);
            await sameInput();
            // Edits stay on the live input while the captured initial prompt is preparing.
            await input.fill('Edited while preparing');
            await expect.poll(() => page.evaluate(() => (window as any).__DRAFT__.input)).toBe('Edited while preparing');
            await release('spawn');
            await expect.poll(() => count('hydrate')).toBe(1);
            await sameInput();
            expect(await input.inputValue()).toBe('Edited while preparing');
            await release('hydrate');
            await expect.poll(() => count('send')).toBe(1);
            expect(await page.evaluate(() => (window as any).__GROUP16__.calls.send[0])).toMatchObject({ id: 'group16-session', text: 'First instruction', current: true });
            await sameInput();
            expect(await page.evaluate(() => (window as any).__ROUTES__ ?? [])).toEqual([]);

            await release('send', true);
            await expect.poll(() => page.evaluate(() => (window as any).__GROUP16_ALERTS__?.length ?? 0)).toBe(1);
            await expect.poll(() => send.isEnabled()).toBe(true);
            await sameInput();
            expect(await input.inputValue()).toBe('Edited while preparing');
            expect(await page.evaluate(() => (window as any).__ROUTES__ ?? [])).toEqual([]);

            await send.click();
            await expect.poll(() => count('hydrate')).toBe(2);
            expect(await count('spawn')).toBe(1);
            await sameInput();
            // The retry captures the retained draft, and still must not clear later edits.
            await input.fill('Keep this newer draft after retry');
            await release('hydrate');
            await expect.poll(() => count('send')).toBe(2);
            expect(await page.evaluate(() => (window as any).__GROUP16__.calls.send[1])).toMatchObject({ id: 'group16-session', text: 'Edited while preparing', current: true });
            await sameInput();
            await release('send');
            await expect.poll(() => page.evaluate(() => (window as any).__ROUTES__ ?? [])).toEqual(['/session/group16-session']);
            expect(await count('spawn')).toBe(1);
            expect(await page.evaluate(() => (window as any).__DRAFT__.input)).toBe('Keep this newer draft after retry');
            await evidence(page, `group16-preparation-retry-${surface.width}-${surface.theme}`);
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    }, 30_000);

    it('starts in Streamline with the Claude defaults and a worktree for the GitHub folder', async () => {
        const { page, errors } = await open();
        await page.getByTestId('streamline-sections').waitFor();
        // Mono labels are uppercased by CSS; the DOM keeps the catalog text.
        for (const label of ['Commanders', 'Working folder', 'Project']) {
            await expect(page.getByTestId('streamline-sections').getByRole('heading', { name: label, exact: true }).count()).resolves.toBe(1);
        }
        await expect.poll(() => page.evaluate(() => (window as any).__DRAFT__?.modelMode)).toBe('claude-opus-5-5');
        await expect.poll(() => page.evaluate(() => (window as any).__DRAFT__?.sessionType)).toBe('worktree');
        await expect(chipLabel(page, 'agent')).resolves.toBe('Agent: Claude');
        await expect(page.getByTestId('streamline-settings-link').innerText()).resolves.toContain('Streamline settings');
        await expect(page.getByTestId('streamline-github-badge').count()).resolves.toBe(1);
        await expect(page.getByTestId('streamline-folder-gpu-lab-bench').isDisabled()).resolves.toBe(true);
        // Folders show home-relative paths, as the mock does.
        await expect(page.getByTestId('streamline-folder-studio-mac-notes').innerText()).resolves.toContain('~/notes');
        await expect(page.getByTestId('streamline-folder-gpu-lab-bench').innerText()).resolves.toContain('~/bench');
        await expect(page.getByTestId('streamline-sections').innerText()).resolves.not.toContain('/Users/example-user');
        // "Commanders ›" on the COMMANDERS label row opens the Commanders page.
        const commandersLink = page.getByTestId('streamline-open-commanders');
        const [linkBox, headingBox] = await Promise.all([
            commandersLink.boundingBox(),
            page.getByTestId('streamline-sections').getByRole('heading', { name: 'Commanders', exact: true }).boundingBox(),
        ]);
        expect(Math.abs((linkBox!.y + linkBox!.height / 2) - (headingBox!.y + headingBox!.height / 2))).toBeLessThanOrEqual(2);
        await commandersLink.click();
        await expect.poll(() => page.evaluate(() => (window as any).__ROUTES__ ?? [])).toContain('/commanders');
        await evidence(page, 'streamline-desktop-light-1440');
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('draws token translucency in the real style runtime', async () => {
        // Unistyles hands web style factories CSS variables; herdAlpha must mix
        // them rather than pass the opaque token through.
        const { page, errors } = await open({ screen: 'alpha' });
        const alpha = await page.getByTestId('herd-alpha-probe').evaluate((element) => {
            const color = getComputedStyle(element).borderTopColor;
            const match = /\/\s*([\d.]+)\s*\)$/.exec(color) ?? /rgba\([^)]*,\s*([\d.]+)\)$/.exec(color);
            return match ? Number(match[1]) : 1;
        });
        expect(alpha).toBeCloseTo(0.55, 2);
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('switches folder, Commander and project, and opens the Agent picker', async () => {
        const { page, errors } = await open({ theme: 'dark' });
        await page.getByTestId('streamline-sections').waitFor();
        await page.getByTestId('streamline-folder-studio-mac-notes').click();
        await expect.poll(() => page.evaluate(() => (window as any).__DRAFT__?.sessionType)).toBe('simple');
        await expect(page.getByTestId('streamline-not-git-badge').count()).resolves.toBe(1);

        await page.getByTestId('streamline-commander-athena').click();
        await expect.poll(() => page.evaluate(() => (window as any).__DRAFT__?.selectedPath)).toBe('/Users/example-user/code/happyherd');
        // A Commander runs in its own workspace, even in a GitHub repository.
        await expect.poll(() => page.evaluate(() => (window as any).__DRAFT__?.sessionType)).toBe('simple');

        await page.getByRole('radio', { name: 'Docs site' }).click();
        await expect.poll(() => page.evaluate(() => (window as any).__DRAFT__?.selectedAccountProjectId)).toBe('project-docs');

        await page.getByTestId('streamline-chip-agent').click();
        const picker = page.getByTestId('streamline-chip-picker');
        await picker.waitFor();
        await evidence(page, 'streamline-chip-picker-dark-1440');
        await picker.getByRole('radio', { name: 'codex', exact: true }).click();
        await expect.poll(() => page.evaluate(() => (window as any).__DRAFT__?.agentType)).toBe('codex');
        await expect(chipLabel(page, 'agent')).resolves.toBe('Agent: Codex');
        // This fixture advertises no Codex model or effort catalog.
        await expect(page.getByTestId('streamline-settings-link').count()).resolves.toBe(1);
        await evidence(page, 'streamline-desktop-dark-1440');
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it.each([
        { width: 1440, height: 900, theme: 'light' },
        { width: 1440, height: 900, theme: 'dark' },
        { width: 390, height: 844, theme: 'light' },
        { width: 390, height: 844, theme: 'dark' },
    ] as const)('uses advertised Claude names and exact model IDs when switching Streamline and Advanced at $width px in $theme mode', async (surface) => {
        const { page, errors } = await open({ ...surface, modelNames: 'custom' });
        try {
            await page.getByTestId('streamline-sections').waitFor();
            // Streamline intentionally keeps only the Agent chip after #358.
            await expect(page.getByTestId('streamline-chip-model').count()).resolves.toBe(0);
            await expect(chipLabel(page, 'agent')).resolves.toBe('Agent: Claude');
            await expect.poll(() => page.evaluate(() => (window as any).__DRAFT__?.modelMode)).toBe('claude-opus-5-5');
            await page.getByTestId('new-session-mode').getByRole('radio', { name: 'Advanced' }).click();
            const opus = page.getByTestId('advanced-model-claude-opus-5-5');
            const sonnet = page.getByTestId('advanced-model-claude-sonnet-5');
            await expect(opus.innerText()).resolves.toBe('Opus Research Preview');
            await expect(opus.getAttribute('aria-checked')).resolves.toBe('true');
            await expect(sonnet.innerText()).resolves.toBe('Sonnet Team Edition');
            if (surface.width >= 700) {
                await expect(page.getByTestId('advanced-chip-model').innerText()).resolves.toBe('Opus Research Preview');
            } else {
                await expect(page.getByTestId('advanced-chip-model').count()).resolves.toBe(0);
            }
            await sonnet.click();
            await expect.poll(() => page.evaluate(() => (window as any).__DRAFT__?.modelMode)).toBe('claude-sonnet-5');
            await expect(sonnet.getAttribute('aria-checked')).resolves.toBe('true');
            if (surface.width >= 700) {
                await expect(page.getByTestId('advanced-chip-model').innerText()).resolves.toBe('Sonnet Team Edition');
            } else {
                await expect(page.getByTestId('advanced-chip-model').count()).resolves.toBe(0);
            }
            await evidence(page, `claude-model-names-advanced-${surface.width}-${surface.theme}`);
            await page.getByTestId('new-session-mode').getByRole('radio', { name: 'Streamline' }).click();
            await expect(page.getByTestId('streamline-chip-model').count()).resolves.toBe(0);
            // Re-entering Streamline reapplies its configured defaults.
            await expect.poll(() => page.evaluate(() => (window as any).__DRAFT__?.modelMode)).toBe('claude-opus-5-5');
            await expect(page.getByTestId('streamline-settings-link').innerText()).resolves.toContain('Streamline settings');
            await evidence(page, `claude-model-names-streamline-${surface.width}-${surface.theme}`);
            await page.getByTestId('new-session-mode').getByRole('radio', { name: 'Advanced' }).click();
            await expect(opus.innerText()).resolves.toBe('Opus Research Preview');
            await expect(opus.getAttribute('aria-checked')).resolves.toBe('true');
            if (surface.width >= 700) {
                await expect(page.getByTestId('advanced-chip-model').innerText()).resolves.toBe('Opus Research Preview');
            } else {
                await expect(page.getByTestId('advanced-chip-model').count()).resolves.toBe(0);
            }
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    }, 30_000);

    it.each([
        { width: 1440, height: 900, theme: 'light' },
        { width: 1440, height: 900, theme: 'dark' },
        { width: 390, height: 844, theme: 'light' },
        { width: 390, height: 844, theme: 'dark' },
    ] as const)('uses advertised names in Streamline model defaults at $width px in $theme mode', async (surface) => {
        const { page, errors } = await open({ ...surface, screen: 'settings', modelNames: 'custom' });
        try {
            await page.getByText('Opus Research Preview', { exact: true }).first().waitFor();
            await page.getByText('Model', { exact: true }).first().click();
            await page.getByText('Sonnet Team Edition', { exact: true }).click();
            await expect.poll(() => page.evaluate(() => (window as any).__SETTINGS__?.streamlineAgentDefaults?.claude?.modelMode)).toBe('claude-sonnet-5');
            await page.getByText('Model', { exact: true }).first().click();
            await page.getByText('Sonnet Team Edition', { exact: true }).waitFor();
            await page.getByText('Model', { exact: true }).first().click();
            // The catalog choice follows the Reset row's description.
            await page.getByText('Opus Research Preview', { exact: true }).last().click();
            await expect.poll(() => page.evaluate(() => (window as any).__SETTINGS__?.streamlineAgentDefaults?.claude?.modelMode)).toBe('claude-opus-5-5');
            await page.getByText('Model', { exact: true }).first().click();
            await page.getByText('Opus Research Preview', { exact: true }).waitFor();
            await evidence(page, `claude-model-names-settings-${surface.width}-${surface.theme}`);
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    }, 30_000);

    it('uses the desktop column even when the New Session side panel is off', async () => {
        const { page, errors } = await open();
        await page.goto(`${origin}/?theme=light&mode=streamline&panel=off`);
        await page.getByTestId('streamline-sections').waitFor();
        await expect(page.getByTestId('streamline-chip-agent').count()).resolves.toBe(1);
        await expect(page.getByTestId('streamline-chip-model').count()).resolves.toBe(0);
        await expect(page.getByTestId('streamline-chip-effort').count()).resolves.toBe(0);
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('keeps the full Advanced form one switch away', async () => {
        const { page, errors } = await open();
        await page.getByTestId('streamline-sections').waitFor();
        await page.getByTestId('new-session-mode').getByRole('radio', { name: 'Advanced' }).click();
        await expect(page.getByTestId('streamline-sections').count()).resolves.toBe(0);
        // Advanced (UI overhaul): the mock's full form in the same New Session card.
        await page.getByTestId('new-session-card').getByTestId('advanced-sections').waitFor();
        await expect(page.getByTestId('new-session-right-sidebar').count()).resolves.toBe(0);
        await evidence(page, 'advanced-desktop-light-1440');
        await page.getByTestId('new-session-mode').getByRole('radio', { name: 'Streamline' }).click();
        await page.getByTestId('streamline-sections').waitFor();
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    // Advanced (UI overhaul): the mock's full form, two columns wide and stacked on phones.
    it('lays Advanced out as the mock: paired columns on Web Desktop, one column on Web Mobile', async () => {
        const box = async (page: Page, testID: string) => (await page.getByTestId(testID).first().boundingBox())!;
        const desktop = await open({ mode: 'advanced', width: 1440, height: 900 });
        await desktop.page.getByTestId('advanced-sections').waitFor();
        const card = await box(desktop.page, 'new-session-card');
        expect(card.width).toBeLessThanOrEqual(977);
        const path = await box(desktop.page, 'advanced-path');
        const provider = await box(desktop.page, 'advanced-provider-claude');
        // Workspace and AI provider share a row, the provider in the right column.
        expect(Math.abs(path.y - provider.y)).toBeLessThan(12);
        expect(provider.x).toBeGreaterThan(path.x + path.width);
        const effort = await box(desktop.page, 'advanced-effort');
        const permission = await box(desktop.page, 'advanced-permission');
        expect(permission.y).toBeGreaterThan(effort.y + effort.height);
        // The permission mode spans the card's content.
        expect(permission.width).toBeGreaterThan(card.width * 0.85);
        const machineA = await box(desktop.page, 'advanced-machine-studio-mac');
        const machineB = await box(desktop.page, 'advanced-machine-gpu-lab');
        expect(Math.abs(machineA.y - machineB.y)).toBeLessThan(2);
        expect(Math.abs(machineA.width - machineB.width)).toBeLessThan(2);
        expect(desktop.errors).toEqual([]);
        await desktop.page.close();

        const phone = await open({ mode: 'advanced', width: 390, height: 844 });
        await phone.page.getByTestId('advanced-sections').waitFor();
        expect(await phone.page.getByTestId('new-session-card').count()).toBe(0);
        // The page opens at its title, as the mock does; the composer waits at its end.
        await phone.page.waitForTimeout(400);
        expect(await phone.page.getByTestId('new-session-advanced').evaluate((element) => element.scrollTop)).toBe(0);
        const phonePath = await box(phone.page, 'advanced-path');
        const phoneProvider = await box(phone.page, 'advanced-provider-claude');
        expect(phoneProvider.y).toBeGreaterThan(phonePath.y + phonePath.height);
        expect(Math.round(phonePath.x)).toBe(16);
        expect(Math.round(phonePath.width)).toBe(390 - 32);
        const phoneMachine = await box(phone.page, 'advanced-machine-studio-mac');
        expect(Math.round(phoneMachine.width)).toBe(390 - 32);
        // Stacked sections never overlap: every project chip takes its own clicks.
        for (const chip of await phone.page.getByTestId('advanced-sections').getByRole('radio').all()) {
            const chipBox = await chip.boundingBox();
            if (!chipBox) continue;
            await chip.scrollIntoViewIfNeeded();
            const hit = await chip.evaluate((element) => {
                const rect = element.getBoundingClientRect();
                const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                return !!top && (top === element || element.contains(top));
            });
            expect(hit).toBe(true);
        }
        expect(await phone.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(phone.errors).toEqual([]);
        await phone.page.close();
    }, 40_000);

    // Every visible control of the dropdown takes its own press: nothing below draws over it.
    const dropdownOnTop = (page: Page) => page.getByTestId('new-session-path-dropdown').evaluate((dropdown) => {
        const misses: string[] = [];
        const bounds = dropdown.getBoundingClientRect();
        let checked = 0;
        for (const control of dropdown.querySelectorAll<HTMLElement>('[role="button"], [role="radio"], input')) {
            const box = control.getBoundingClientRect();
            const x = box.left + box.width / 2;
            const y = box.top + box.height / 2;
            // Rows scrolled out of the dropdown's own body are not on screen.
            if (box.height === 0 || y <= bounds.top || y >= bounds.bottom || y >= innerHeight) continue;
            checked += 1;
            const top = document.elementFromPoint(x, y);
            if (!top || !dropdown.contains(top)) misses.push(`${control.getAttribute('aria-label') ?? control.tagName} under ${top?.getAttribute('data-testid') ?? top?.tagName}`);
        }
        return checked > 4 ? misses : ['fewer than five controls on screen'];
    });

    it('opens the mock\'s folder dropdown over the form, from the Advanced path and Streamline\'s Choose folder', async () => {
        const box = async (page: Page, testID: string) => (await page.getByTestId(testID).first().boundingBox())!;
        const draftPath = (page: Page) => page.evaluate(() => (window as any).__DRAFT__?.selectedPath);
        for (const [width, height] of [[1440, 900], [390, 844]] as const) {
            const { page, errors } = await open({ mode: 'advanced', width, height });
            await page.getByTestId('advanced-sections').waitFor();
            const provider = page.getByTestId(width < 700 ? 'advanced-effort' : 'advanced-model-claude-opus-5-5');
            const before = (await provider.boundingBox())!;
            await page.getByTestId('advanced-path').click();
            const dropdown = page.getByTestId('new-session-path-dropdown');
            await dropdown.getByRole('button', { name: 'Open folder code', exact: true }).waitFor();
            await settle(page);
            await expect(page.getByTestId('advanced-path').getAttribute('aria-expanded')).resolves.toBe('true');
            // It hangs 8 px below the field, as wide as it, and floats: the form below does not move.
            const path = await box(page, 'advanced-path');
            const menu = await box(page, 'new-session-path-dropdown');
            expect(Math.round(menu.x)).toBe(Math.round(path.x));
            expect(Math.round(menu.width)).toBe(Math.round(path.width));
            expect(Math.round(menu.y - (path.y + path.height))).toBe(8);
            expect(menu.height).toBeLessThanOrEqual(360);
            expect((await provider.boundingBox())!.y).toBeCloseTo(before.y, 0);
            await expect(dropdownOnTop(page)).resolves.toEqual([]);
            // The mock's order: Recent, Favorites (none saved here), Host folders.
            const sections = await dropdown.evaluate((element) => [...element.querySelectorAll('div')]
                .map((node) => node.textContent ?? '')
                .filter((text) => text === 'Recent' || text === 'Host folders'));
            expect([...new Set(sections)]).toEqual(['Recent', 'Host folders']);
            // Browse into a folder, then use it.
            await dropdown.getByRole('button', { name: 'Open folder code', exact: true }).click();
            await expect.poll(() => dropdown.innerText()).toContain('studio-mac · ~/code');
            await dropdown.getByRole('button', { name: 'Browse parent folder', exact: true }).click();
            await expect.poll(() => dropdown.innerText()).toContain('studio-mac · ~\n');
            await dropdown.getByRole('button', { name: 'Open folder code', exact: true }).click();
            await dropdown.getByRole('button', { name: /^Use .*\/code as workspace$/ }).click();
            await expect.poll(() => draftPath(page)).toBe('/Users/example-user/code');
            await expect.poll(() => dropdown.count()).toBe(0);
            // A typed path, Escape, a press outside, and the field itself close it.
            await page.getByTestId('advanced-path').click();
            await dropdown.getByPlaceholder('Enter project path').fill('/Users/example-user/typed');
            await expect.poll(() => draftPath(page)).toBe('/Users/example-user/typed');
            await page.keyboard.press('Escape');
            await expect.poll(() => dropdown.count()).toBe(0);
            await page.getByTestId('advanced-path').click();
            await dropdown.waitFor();
            await page.mouse.click(width - 4, 4);
            await expect.poll(() => dropdown.count()).toBe(0);
            await page.getByTestId('advanced-path').click();
            await dropdown.waitFor();
            await page.getByTestId('advanced-path').click();
            await expect.poll(() => dropdown.count()).toBe(0);
            await expect(page.getByTestId('advanced-path').getAttribute('aria-expanded')).resolves.toBe('false');
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            expect(errors).toEqual([]);
            await page.close();
        }

        const { page, errors } = await open({ width: 1440, height: 900 });
        await page.getByTestId('streamline-sections').waitFor();
        const project = page.getByRole('radio', { name: 'Docs site' });
        const before = (await project.boundingBox())!;
        await page.getByTestId('streamline-choose-folder').click();
        const dropdown = page.getByTestId('new-session-path-dropdown');
        await dropdown.getByRole('button', { name: 'Open folder code', exact: true }).waitFor();
        await settle(page);
        const card = await box(page, 'streamline-choose-folder');
        const menu = await box(page, 'new-session-path-dropdown');
        expect(Math.round(menu.x)).toBe(Math.round(card.x));
        expect(Math.round(menu.width)).toBe(360);
        expect(Math.round(menu.y - (card.y + card.height))).toBe(8);
        expect((await project.boundingBox())!.y).toBeCloseTo(before.y, 0);
        await expect(dropdownOnTop(page)).resolves.toEqual([]);
        await page.getByTestId('streamline-choose-folder').click();
        await expect.poll(() => dropdown.count()).toBe(0);
        expect(errors).toEqual([]);
        await page.close();
    }, 60_000);

    it('fits long display labels in the phone segments at the 16 px floor', async () => {
        const { page, errors } = await open({ mode: 'advanced', width: 390, height: 844 });
        await page.getByTestId('advanced-sections').waitFor();
        // A phone browser floors every label at 16 px.
        await page.addStyleTag({ content: '[data-testid="advanced-sections"] [role="radiogroup"] div[dir] { font-size: 16px !important; }' });
        await page.waitForTimeout(300);
        for (const group of ['advanced-effort', 'advanced-permission', 'advanced-worktree']) {
            const truncated = await page.getByTestId(group).evaluate((element) => [...element.querySelectorAll<HTMLElement>('[role="radio"] div[dir]')]
                .filter((label) => label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > label.clientHeight + 1)
                .map((label) => label.textContent));
            expect(truncated, group).toEqual([]);
            const track = (await page.getByTestId(group).boundingBox())!;
            expect(Math.round(track.width)).toBe(390 - 32);
        }
        await expect(page.getByTestId('advanced-permission').getByRole('radio', { name: 'accept edits' }).count()).resolves.toBe(1);
        // The thumb sits under the selected segment, whatever its width.
        const [thumb, selected] = await page.getByTestId('advanced-permission').evaluate((element) => {
            const segment = element.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')!.getBoundingClientRect();
            const bar = [...element.children].find((child) => child.getAttribute('role') !== 'radio')!.getBoundingClientRect();
            return [[Math.round(bar.x), Math.round(bar.width)], [Math.round(segment.x), Math.round(segment.width)]];
        });
        expect(Math.abs(thumb[0] - selected[0])).toBeLessThanOrEqual(1);
        expect(Math.abs(thumb[1] - selected[1])).toBeLessThanOrEqual(1);
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it.runIf(!!process.env.HERD_STREAMLINE_EVIDENCE_DIR)('captures Advanced for the fidelity record', async () => {
        for (const theme of ['light', 'dark'] as const) {
            for (const [width, height] of [[1440, 900], [390, 844]] as const) {
                const { page } = await open({ theme, mode: 'advanced', width, height });
                await page.getByTestId('advanced-sections').waitFor();
                await page.waitForTimeout(700);
                await evidence(page, `advanced-${width}-${theme}`);
                if (width < 700) {
                    // Phones: the effort and permission segments, further down the page.
                    await page.getByTestId('advanced-effort').scrollIntoViewIfNeeded();
                    await page.waitForTimeout(300);
                    await evidence(page, `advanced-${width}-${theme}-segments`);
                    await page.getByTestId('new-session-advanced').evaluate((element) => element.scrollTo(0, 0));
                }
                await page.getByTestId('advanced-path').click();
                await page.getByTestId('new-session-recent-path-list').first().waitFor();
                await page.waitForTimeout(400);
                await evidence(page, `advanced-${width}-${theme}-path-open`);
                await page.close();
                // Streamline, at rest and with its folder dropdown (a card on phones) open.
                const streamline = (await open({ theme, width, height })).page;
                await streamline.getByTestId('streamline-sections').waitFor();
                await streamline.waitForTimeout(700);
                await evidence(streamline, `streamline-${width}-${theme}`);
                if (width < 700) await streamline.getByTestId('streamline-folder-dropdown').click();
                await streamline.getByTestId('streamline-choose-folder').click();
                await streamline.getByTestId('new-session-recent-path-list').first().waitFor();
                await streamline.waitForTimeout(400);
                await evidence(streamline, `streamline-${width}-${theme}-path-open`);
                await streamline.close();
            }
        }
    }, 150_000);

    const settle = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity))
        .map((animation) => animation.finished.catch(() => undefined))));
    const rect = async (page: Page, testID: string) => {
        const box = (await page.getByTestId(testID).first().boundingBox())!;
        return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
    };

    it('lays the phone page out as the approved mock, every choice on the 16 px gutter', async () => {
        for (const theme of ['light', 'dark'] as const) {
            const { page, errors } = await open({ theme, width: 390, height: 844 });
            const sections = page.getByTestId('streamline-sections');
            await sections.waitFor();
            await settle(page);
            // The title and a full-width mode switch with 44 px segments.
            const title = (await page.getByText('New Chat', { exact: true }).boundingBox())!;
            expect(Math.round(title.x)).toBe(16);
            await expect(page.getByText('Start a session quickly using your preconfigured agent defaults.', { exact: true }).count()).resolves.toBe(0);
            const mode = await rect(page, 'new-session-mode');
            expect(mode).toMatchObject({ x: 16, width: 390 - 32 });
            expect(mode.y).toBeGreaterThanOrEqual(Math.floor(title.y + title.height));
            for (const height of await page.getByTestId('new-session-mode').getByRole('radio').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))) {
                expect(Math.round(height)).toBeGreaterThanOrEqual(44);
            }
            // Commanders: 104 px squares, the avatar or glyph above the name.
            expect(await rect(page, 'streamline-commander-none')).toMatchObject({ x: 16, width: 104, height: 104 });
            expect(await rect(page, 'streamline-commander-athena')).toMatchObject({ width: 104, height: 104 });
            await expect(page.getByTestId('streamline-commander-athena').getAttribute('aria-label')).resolves.toBe('Athena, Engineering commander');
            await expect(page.getByTestId('streamline-commander-create').getAttribute('role')).resolves.toBe('button');
            // Working folder is one trigger spanning the form.
            const folder = page.getByTestId('streamline-folder-dropdown');
            expect(await rect(page, 'streamline-folder-dropdown')).toMatchObject({ x: 16, width: 390 - 32 });
            await expect(folder.innerText()).resolves.toContain('happyherd');
            await expect(folder.innerText()).resolves.toContain('~/code/happyherd · studio-mac');
            // Commanders scroll sideways edge to edge; the project chips wrap.
            const rows = page.getByTestId('streamline-swipe-row');
            await expect(rows.count()).resolves.toBe(1);
            for (const row of await rows.evaluateAll((nodes) => nodes.map((node) => ({ left: Math.round(node.getBoundingClientRect().left), width: Math.round(node.getBoundingClientRect().width) })))) {
                expect(row).toEqual({ left: 0, width: 390 });
            }
            const projects = sections.getByRole('radio', { name: 'No Project', exact: true });
            expect(Math.round((await projects.boundingBox())!.x)).toBe(16);
            expect(Math.round((await projects.boundingBox())!.height)).toBe(44);
            // The composer follows the choices in the page, then the summary.
            const composer = await rect(page, 'streamline-composer');
            expect(composer).toMatchObject({ x: 16, width: 390 - 32 });
            const lastProject = (await sections.getByRole('radio').last().boundingBox())!;
            expect(composer.y).toBeGreaterThan(lastProject.y + lastProject.height);
            expect((await rect(page, 'streamline-summary')).y).toBeGreaterThanOrEqual(composer.y + composer.height);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await evidence(page, `streamline-phone-${theme}-390`);
            expect(errors).toEqual([]);
            await page.close();
        }
    }, 40_000);

    it('opens a chip picker across the composer on a phone, above it, and applies the choice', async () => {
        for (const theme of ['light', 'dark'] as const) {
            const { page, errors } = await open({ theme, width: 390, height: 844 });
            await page.getByTestId('streamline-sections').waitFor();
            // A person brings the composer into view before choosing.
            await page.getByTestId('streamline-composer').scrollIntoViewIfNeeded();
            await settle(page);
            const composer = await rect(page, 'streamline-composer');
            await page.getByTestId('streamline-chip-agent').click();
            const picker = page.getByTestId('streamline-chip-picker');
            await picker.waitFor();
            expect(await picker.evaluate((element) => [...element.classList])).toContain('herd-pop');
            await expect(page.getByTestId('streamline-chip-picker-handle').count()).resolves.toBe(0);
            await settle(page);
            const box = await rect(page, 'streamline-chip-picker');
            // The mock's picker: as wide as the composer, resting just above it.
            expect({ x: box.x, width: box.width }).toEqual({ x: composer.x, width: composer.width });
            expect(box.y + box.height).toBeLessThanOrEqual(composer.y - 7);
            expect(box.y).toBeGreaterThanOrEqual(8);
            await evidence(page, `streamline-chip-picker-${theme}-390`);
            await picker.getByRole('radio', { name: 'codex', exact: true }).click();
            await expect.poll(() => picker.count()).toBe(0);
            await expect.poll(() => page.evaluate(() => (window as any).__DRAFT__?.agentType)).toBe('codex');
            expect(errors).toEqual([]);
            await page.close();
        }
    }, 40_000);

    it('opens the phone folder dropdown across the form and selects a recent folder', async () => {
        const { page, errors } = await open({ width: 390, height: 844 });
        const trigger = page.getByTestId('streamline-folder-dropdown');
        await trigger.click();
        const menu = page.getByTestId('streamline-folder-menu');
        await menu.waitFor();
        await settle(page);
        const triggerBox = (await trigger.boundingBox())!;
        const menuBox = (await menu.boundingBox())!;
        expect(menuBox.x).toBeCloseTo(triggerBox.x, 0);
        expect(menuBox.width).toBeCloseTo(triggerBox.width, 0);
        await expect(menu.getByRole('radio').count()).resolves.toBe(3);
        await expect(menu.getByRole('button', { name: 'Choose folder', exact: true }).count()).resolves.toBe(1);
        await expect(menu.getByTestId('streamline-folder-gpu-lab:/home/example-user/bench').isDisabled()).resolves.toBe(true);
        const rows = await menu.getByRole('radio').evaluateAll((nodes) => nodes.map((node) => ({
            height: node.getBoundingClientRect().height,
            fontSizes: [...node.querySelectorAll('*')].filter((child) => [...child.childNodes].some((text) => text.nodeType === Node.TEXT_NODE && text.textContent?.trim()))
                .map((child) => Number.parseFloat(getComputedStyle(child).fontSize)),
        })));
        for (const row of rows) {
            expect(row.height).toBeGreaterThanOrEqual(44);
            expect(row.fontSizes.every((size) => size >= 16)).toBe(true);
        }
        await menu.getByTestId('streamline-folder-studio-mac:/Users/example-user/notes').click();
        await expect.poll(() => menu.count()).toBe(0);
        await expect.poll(() => page.evaluate(() => (window as any).__DRAFT__?.selectedPath)).toBe('/Users/example-user/notes');
        await expect(trigger.innerText()).resolves.toContain('~/notes · studio-mac');
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('matches phone folder choices by machine and path, including a selection absent from recents', async () => {
        const { page, errors } = await open({ width: 390, height: 844, duplicateFolders: true });
        const trigger = page.getByTestId('streamline-folder-dropdown');
        await trigger.click();
        const menu = page.getByTestId('streamline-folder-menu');
        await menu.waitFor();
        await expect(menu.getByRole('radio').count()).resolves.toBe(4);
        await expect(menu.getByTestId('streamline-folder-studio-mac:/Users/example-user/code/happyherd').getAttribute('aria-checked')).resolves.toBe('true');
        for (const [machineId, path] of [['studio-mac', '/other/shared'], ['gpu-lab', '/work/shared']]) {
            await menu.getByTestId(`streamline-folder-${machineId}:${path}`).click();
            await expect.poll(() => menu.count()).toBe(0);
            await expect.poll(() => page.evaluate(() => [(window as any).__DRAFT__?.selectedMachineId, (window as any).__DRAFT__?.selectedPath])).toEqual([machineId, path]);
            await trigger.click();
            await menu.waitFor();
            await expect(menu.getByRole('radio').count()).resolves.toBe(3);
            await expect(menu.getByRole('radio', { checked: true }).count()).resolves.toBe(1);
            await expect(menu.getByTestId(`streamline-folder-${machineId}:${path}`).getAttribute('aria-checked')).resolves.toBe('true');
        }
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('opens the folder browser on a phone as a card on the bottom edge, and closes it from outside', async () => {
        const { page, errors } = await open({ width: 390, height: 844 });
        await page.getByTestId('streamline-sections').waitFor();
        await page.getByTestId('streamline-folder-dropdown').click();
        await page.getByTestId('streamline-choose-folder').click();
        const browser = page.getByTestId('streamline-folder-browser');
        await browser.waitFor();
        await expect.poll(() => page.getByTestId('streamline-folder-menu').count()).toBe(0);
        await settle(page);
        const box = await rect(page, 'streamline-folder-browser');
        expect({ x: box.x, width: box.width }).toEqual({ x: 8, width: 390 - 16 });
        expect(844 - (box.y + box.height)).toBe(8);
        expect(box.height).toBeLessThanOrEqual(Math.round(844 * 0.56));
        await evidence(page, 'streamline-folder-browser-light-390');
        await page.mouse.click(195, 40);
        await expect.poll(() => browser.count()).toBe(0);
        await expect(page.getByTestId('streamline-folder-dropdown').getAttribute('aria-expanded')).resolves.toBe('false');
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('scrolls the whole folder browser inside its card on a short phone, so every control is reachable', async () => {
        const { page, errors } = await open({ width: 320, height: 568 });
        await page.getByTestId('streamline-sections').waitFor();
        await page.getByTestId('streamline-folder-dropdown').click();
        await page.getByTestId('streamline-choose-folder').click();
        const browser = page.getByTestId('streamline-folder-browser');
        // The real folder browser lists the home folder, taller than the card.
        await browser.getByRole('button', { name: 'Open folder Documents' }).waitFor();
        await settle(page);
        // The card keeps its cap and its 8 px margins, inside the window.
        const card = await rect(page, 'streamline-folder-browser');
        expect({ x: card.x, width: card.width, height: card.height }).toEqual({ x: 8, width: 320 - 16, height: Math.round(568 * 0.56) });
        expect(568 - (card.y + card.height)).toBe(8);
        // Pixels of a control above or below the card; 0 when all of it shows.
        const outsideCard = (control: Locator) => control.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const bounds = element.closest('[data-testid="streamline-folder-browser"]')!.getBoundingClientRect();
            return Math.round(Math.max(0, bounds.top - box.top) + Math.max(0, box.bottom - bounds.bottom));
        });
        // A person scrolls from the card's side padding, clear of the folder and
        // recent lists, which scroll on their own. The toolbar is the top-most
        // control, and the path field the bottom-most: the fixture has no recent folders.
        await page.mouse.move(card.x + 8, card.y + card.height / 2);
        await page.mouse.wheel(0, -2000);
        await expect.poll(() => outsideCard(browser.getByRole('button', { name: 'Browse filesystem root' })), { message: 'the toolbar scrolls into the card' }).toBe(0);
        await page.mouse.wheel(0, 2000);
        await expect.poll(() => outsideCard(browser.getByPlaceholder('Enter project path')), { message: 'the path field scrolls into the card' }).toBe(0);
        await evidence(page, 'streamline-folder-browser-light-320');
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('edits the Streamline defaults from their settings page', async () => {
        const { page, errors } = await open({ screen: 'settings', height: 1400 });
        await page.getByText('Always use git worktrees', { exact: true }).waitFor();
        const settings = () => page.evaluate(() => (window as any).__SETTINGS__);

        await page.getByText('Advanced', { exact: true }).click();
        await expect.poll(async () => (await settings()).newSessionMode).toBe('advanced');
        await page.getByText('Codex', { exact: true }).first().click();
        await expect.poll(async () => (await settings()).streamlineAgent).toBe('codex');
        await page.getByRole('switch').first().click();
        await expect.poll(async () => (await settings()).streamlineGithubWorktree).toBe(false);

        // Claude's model row shows the Streamline default from the catalog machine.
        await expect(page.getByText('Opus 5.5', { exact: true }).count()).resolves.toBeGreaterThan(0);
        await page.getByText('Model', { exact: true }).first().click();
        await page.getByText('Sonnet 5', { exact: true }).click();
        await expect.poll(async () => (await settings()).streamlineAgentDefaults?.claude?.modelMode).toBe('claude-sonnet-5');
        await evidence(page, 'streamline-settings-light-1440');
        await page.getByText('Reset', { exact: true }).first().click();
        await expect.poll(async () => (await settings()).streamlineAgentDefaults?.claude?.modelMode).toBeUndefined();
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);
});
