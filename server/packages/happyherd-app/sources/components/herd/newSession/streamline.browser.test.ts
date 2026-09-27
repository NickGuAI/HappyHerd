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
const opsSource = readFileSync(resolve(sourcesRoot, 'sync/ops.ts'), 'utf8');
const opNames = [...opsSource.matchAll(/export (?:async )?function (\w+)/g)].map((match) => match[1]);

/**
 * The real New Session screen in Streamline mode, with every app source file
 * compiled through the Unistyles Babel transform and web runtime as in the
 * Expo build. Only data, device services and unrelated surfaces are stubbed.
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
        const claude = {
            detectedAt: 1,
            sources: { models: 'happyherd-release-catalog', effortLevels: 'cli-help', permissionModes: 'daemon-defaults' },
            models: [
                // The daemon advertises its slugs and codes as display values.
                { code: 'claude-opus-5', value: 'claude-opus-5', isDefault: true, effortLevels: efforts },
                { code: 'claude-opus-5-5', value: 'claude-opus-5-5', effortLevels: efforts },
                { code: 'claude-sonnet-5', value: 'claude-sonnet-5', effortLevels: efforts },
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
            { id: 'gpu-lab', active: false, activeAt: now - 7200000, createdAt: 2, metadata: { host: 'gpu-lab', platform: 'linux', homeDir: '/home/example-user', cliAvailability: { claude: true }, agentCapabilities: { claude } } },
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
        export const storage = { getState: () => ({ machines: machineMap, projects, settings, localSettings: {} }) };
    `,
    '@/hooks/useNewSessionDraft': `
        import React from 'react';
        const listeners = new Set();
        const state = {
            input: '', attachments: [], selectedMachineId: 'studio-mac', selectedPath: '/Users/example-user/code/happyherd',
            selectedAccountProjectId: undefined, selectedCommanderId: null, agentType: 'claude',
            permissionMode: null, modelMode: null, effortLevel: null, sessionType: 'simple', worktreeKey: null,
        };
        const set = (patch) => { Object.assign(state, patch); window.__DRAFT__ = { ...state }; listeners.forEach((listener) => listener()); };
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
        export const useStreamlineLocations = () => [
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
            ? `export const machineSpawnNewSession = async (options) => { window.__SPAWNS__ = [...(window.__SPAWNS__ ?? []), options]; return { type: 'error', errorMessage: 'fixture stops after the payload' }; };`
            : `export const ${name} = async () => ({ success: true });`).join('\n'),
    '@/sync/sync': `export const sync = { refreshSessions: async () => {}, ensureSessionReady: async () => {}, sendMessage: async () => ({}), assignSessionProject: async () => {} };`,
    '@/utils/worktree': `
        export * from '${resolve(sourcesRoot, 'utils/worktreePaths.ts')}';
        export const createWorktree = async () => { window.__WORKTREES__ = (window.__WORKTREES__ ?? 0) + 1; return { success: true, worktreePath: '/Users/example-user/code/happyherd/.dev/worktree/fixture', branchName: 'fixture' }; };
        export const listWorktrees = async () => [];
    `,
    '@/hooks/useWorktrees': `export const useWorktrees = () => ({ worktrees: [] });`,
    '@/modal': `export const Modal = { alert: () => {}, confirm: async () => false, show: () => {} }; export const useModal = () => ({ dismissTopModal: () => false });`,
    '@/hooks/useNavigateToSession': `export const useNavigateToSession = () => () => {}; export const useSessionPressHandlers = () => ({});`,
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
    '@/components/MachinePathBrowser': `export const MachinePathBrowser = () => null;`,
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

    async function open(options: { theme?: 'light' | 'dark'; width?: number; height?: number; mode?: 'streamline' | 'advanced'; screen?: 'settings' } = {}) {
        const page = await browser.newPage({ viewport: { width: options.width ?? 1440, height: options.height ?? 900 } });
        page.setDefaultTimeout(5_000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
        await page.goto(`${origin}/?theme=${options.theme ?? 'light'}&mode=${options.mode ?? 'streamline'}${options.screen ? `&screen=${options.screen}` : ''}`);
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

    const summaryText = (page: Page) => page.getByTestId('streamline-summary').innerText();

    it('starts in Streamline with the Claude defaults and a worktree for the GitHub folder', async () => {
        const { page, errors } = await open();
        await page.getByTestId('streamline-sections').waitFor();
        // Mono labels are uppercased by CSS; the DOM keeps the catalog text.
        for (const label of ['Commanders', 'Working folder', 'Project']) {
            await expect(page.getByTestId('streamline-sections').getByRole('heading', { name: label, exact: true }).count()).resolves.toBe(1);
        }
        await expect.poll(() => summaryText(page)).toContain('Uses claude-opus-5-5 with xhigh effort and acceptEdits.');
        await expect(summaryText(page)).resolves.toContain('Creates a new git worktree');
        await expect(page.getByTestId('streamline-github-badge').count()).resolves.toBe(1);
        await expect(page.getByTestId('streamline-folder-gpu-lab-bench').isDisabled()).resolves.toBe(true);
        await evidence(page, 'streamline-desktop-light-1440');
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('switches folder, Commander and project, and edits a chip for this launch only', async () => {
        const { page, errors } = await open({ theme: 'dark' });
        await page.getByTestId('streamline-sections').waitFor();
        await page.getByTestId('streamline-folder-studio-mac-notes').click();
        await expect.poll(() => summaryText(page)).toContain('Runs directly in the selected folder');
        await expect(page.getByTestId('streamline-not-git-badge').count()).resolves.toBe(1);

        await page.getByTestId('streamline-commander-athena').click();
        await expect.poll(() => page.evaluate(() => (window as any).__DRAFT__?.selectedPath)).toBe('/Users/example-user/code/happyherd');
        // A Commander runs in its own workspace, even in a GitHub repository.
        await expect.poll(() => summaryText(page)).toContain('Runs directly in the selected folder');

        await page.getByRole('radio', { name: 'Docs site' }).click();
        await expect.poll(() => page.evaluate(() => (window as any).__DRAFT__?.selectedAccountProjectId)).toBe('project-docs');

        await page.getByTestId('streamline-chip-model').click();
        const picker = page.getByTestId('streamline-chip-picker');
        await picker.waitFor();
        await evidence(page, 'streamline-chip-picker-dark-1440');
        await picker.getByRole('radio', { name: 'claude-sonnet-5' }).click();
        await expect.poll(() => summaryText(page)).toContain('Uses claude-sonnet-5 with');
        await evidence(page, 'streamline-desktop-dark-1440');
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('uses the desktop column even when the New Session side panel is off', async () => {
        const { page, errors } = await open();
        await page.goto(`${origin}/?theme=light&mode=streamline&panel=off`);
        await page.getByTestId('streamline-sections').waitFor();
        await expect(page.getByTestId('streamline-chip-model').count()).resolves.toBe(1);
        await expect(page.getByTestId('streamline-chip-effort').count()).resolves.toBe(1);
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('keeps the full Advanced form one switch away', async () => {
        const { page, errors } = await open();
        await page.getByTestId('streamline-sections').waitFor();
        await page.getByTestId('new-session-mode').getByRole('radio', { name: 'Advanced' }).click();
        await expect(page.getByTestId('streamline-sections').count()).resolves.toBe(0);
        await page.getByTestId('new-session-right-sidebar').waitFor();
        await evidence(page, 'advanced-desktop-light-1440');
        await page.getByTestId('new-session-mode').getByRole('radio', { name: 'Streamline' }).click();
        await page.getByTestId('streamline-sections').waitFor();
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);

    it('scrolls each choice as a swipe row on a phone', async () => {
        for (const theme of ['light', 'dark'] as const) {
            const { page, errors } = await open({ theme, width: 390, height: 844 });
            await page.getByTestId('streamline-sections').waitFor();
            const rows = await page.getByTestId('streamline-sections').evaluate((root) => [...root.querySelectorAll('div')]
                .filter((node) => getComputedStyle(node).overflowX === 'auto' || getComputedStyle(node).overflowX === 'scroll')
                .map((node) => ({ scroll: node.scrollWidth, client: node.clientWidth })));
            expect(rows.length).toBeGreaterThanOrEqual(3);
            expect(rows.some((row) => row.scroll > row.client)).toBe(true);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await evidence(page, `streamline-phone-${theme}-390`);
            expect(errors).toEqual([]);
            await page.close();
        }
    }, 40_000);

    it('opens a chip picker as a bottom sheet on a phone and applies the choice', async () => {
        for (const theme of ['light', 'dark'] as const) {
            const { page, errors } = await open({ theme, width: 390, height: 844 });
            await page.getByTestId('streamline-sections').waitFor();
            // Phones show the agent, permission and worktree chips.
            await page.getByTestId('streamline-chip-permission').click();
            const picker = page.getByTestId('streamline-chip-picker');
            await picker.waitFor();
            // Full width on the bottom edge, with a drag handle that is also Cancel.
            const box = (await picker.boundingBox())!;
            expect(box.x).toBe(0);
            expect(box.width).toBe(390);
            await expect.poll(async () => { const current = (await picker.boundingBox())!; return Math.round(current.y + current.height); }).toBe(844);
            await expect(page.getByTestId('streamline-chip-picker-handle').getAttribute('aria-label')).resolves.toBe('Cancel');
            expect(await picker.evaluate((element) => [...element.classList])).toContain('herd-sheet-up');
            await evidence(page, `streamline-chip-sheet-${theme}-390`);
            await picker.getByRole('radio', { name: 'plan' }).click();
            await expect(picker.count()).resolves.toBe(0);
            await expect.poll(() => page.evaluate(() => (window as any).__DRAFT__?.permissionMode)).toBe('plan');
            expect(errors).toEqual([]);
            await page.close();
        }
    }, 40_000);

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
        await expect(page.getByText('claude-opus-5-5', { exact: true }).count()).resolves.toBeGreaterThan(0);
        await page.getByText('Model', { exact: true }).first().click();
        await page.getByText('claude-sonnet-5', { exact: true }).click();
        await expect.poll(async () => (await settings()).streamlineAgentDefaults?.claude?.modelMode).toBe('claude-sonnet-5');
        await evidence(page, 'streamline-settings-light-1440');
        await page.getByText('Reset', { exact: true }).first().click();
        await expect.poll(async () => (await settings()).streamlineAgentDefaults?.claude?.modelMode).toBeUndefined();
        expect(errors).toEqual([]);
        await page.close();
    }, 30_000);
});
