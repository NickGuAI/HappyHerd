import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { PRODUCT } from '../constants/product';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page, type Locator } from 'playwright-core';
import { darkTheme, lightTheme } from '@/theme';
import { replaySubagentRecords, subagentLifecycleFixture } from '@/sync/__testdata__/subagentLifecycle';
import { contextWindowReply } from './__testdata__/contextWindow.browser.fixture';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');
const newSessionProjectPath = '/work/project/extensions/browser-tools';
const newSessionRecentPath = (index: number) => `/workspace/products/example-project-${String(index).padStart(2, '0')}`;

const virtualModules: Record<string, string> = {
    // Settings' What's New entries report through @/track (SettingsFrame).
    '@/components/CommanderAvatarSettings': `export const CommanderAvatarSettings = () => null;`,
    '@/track': `export const trackWhatsNewClicked = () => {};`,
    'react-native': `
        import React from 'react';
        import { Animated } from 'react-native-web';
        export * from 'react-native-web';
        export const TurboModuleRegistry = { get: () => null };
        export const useAnimatedValue = (initialValue) => React.useRef(new Animated.Value(initialValue)).current;
    `,
    'react-native-unistyles': `
        import { lightTheme, darkTheme } from '@/theme';
        const theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? darkTheme : lightTheme;
        if (globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.commanderContext) document.body.style.backgroundColor = theme.colors.groupped.background;
        export const StyleSheet = {
            hairlineWidth: 1,
            absoluteFillObject: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
            create: (factory) => typeof factory === 'function' ? factory(theme) : factory,
        };
        export const useUnistyles = () => ({ theme });
    `,
    '@expo/vector-icons': `
        import React from 'react';
        import { Text } from 'react-native';
        import glyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json';
        import octicons from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Octicons.json';
        const Icon = ({ name }) => React.createElement('span', { 'data-icon': name });
        Icon.glyphMap = {};
        export const Ionicons = (props) => (globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.safeguard || globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.accountProject || globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.contextWindow || globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.commanderContext)
            ? React.createElement(Text, { ...props, style: [props.style, { fontFamily: 'ionicons', fontSize: props.size, color: props.color }], 'data-icon': props.name },
                glyphs[props.name] ? String.fromCodePoint(glyphs[props.name]) : '')
            : React.createElement(Icon, props);
        export const Octicons = (props) => globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.contextWindow
            ? React.createElement(Text, { ...props, style: [props.style, { fontFamily: 'octicons', fontSize: props.size, color: props.color }], 'data-icon': props.name },
                octicons[props.name] ? String.fromCodePoint(octicons[props.name]) : '')
            : React.createElement(Icon, props);
        export const MaterialCommunityIcons = Icon;
    `,
    'react-native-svg': `
        import React from 'react';
        const Svg = (props) => React.createElement('svg', props, props.children);
        export const Circle = (props) => React.createElement('circle', props, props.children);
        export default Svg;
    `,
    'react-native-safe-area-context': `export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });`,
    '@react-navigation/native': `
        export const CommonActions = {
            setParams: (params) => ({ type: 'SET_PARAMS', payload: { params } }),
        };
        export const StackActions = {
            pop: (count) => ({ type: 'POP', payload: { count } }),
        };
        export const useIsFocused = () => true;
        export const useNavigation = () => ({
            dispatch(action) { globalThis.__HAPPYHERD_ROUTE_ACTION__?.(action); },
            getState() { return globalThis.__HAPPYHERD_ROUTE_STATE__ ?? { index: 0, routes: [] }; },
            setOptions() {},
            setParams() {},
        });
    `,
    'expo-router': `
        import React from 'react';
        export const useFocusEffect = (effect) => React.useEffect(effect, [effect]);
        export const useRouter = () => ({
            push(href) { globalThis.__HAPPYHERD_ROUTE_PUSH__?.(href); },
            navigate(href) { globalThis.__HAPPYHERD_ROUTE_NAVIGATE__?.(href); },
            replace(href) { globalThis.__HAPPYHERD_ROUTE_REPLACE__?.(href); },
            back() {
                if (globalThis.__HAPPYHERD_ROUTE_BACK__) globalThis.__HAPPYHERD_ROUTE_BACK__();
                else window.__NEW_SESSION_BACK__ = true;
            },
            dismissTo() {},
        });
        export const useNavigation = () => ({ setOptions() {} });
        export const useLocalSearchParams = () => globalThis.__HAPPYHERD_ROUTE_PARAMS__ ?? {};
        export const usePathname = () => globalThis.__HAPPYHERD_ROUTE_PATHNAME__ ?? '/';
        export const Stack = { Screen: () => null };
    `,
    'react-native-reanimated': `
        import React from 'react';
        import { ScrollView, Text, View } from 'react-native';
        export default { ScrollView, Text, View };
        export const useSharedValue = (value) => ({ value });
        export const useAnimatedStyle = (factory) => factory();
        export const Extrapolation = { CLAMP: 'clamp' };
        export const interpolate = (_value, _input, output) => output[output.length - 1];
        export const interpolateColor = (_value, _input, output) => output[output.length - 1];
        export const runOnJS = (callback) => callback;
        export const withRepeat = (value) => value;
        export const withSequence = (...values) => values[values.length - 1];
        export const withTiming = (value) => value;
        export const Easing = { in: (value) => value, out: (value) => value, cubic: 'cubic' };
    `,
    'expo-linear-gradient': `import { View } from 'react-native'; export const LinearGradient = View;`,
    'expo-blur': `import { View } from 'react-native'; export const BlurView = View;`,
    'expo-glass-effect': `import { View } from 'react-native'; export const GlassView = View;`,
    'react-native-keyboard-controller': `
        import { View } from 'react-native';
        export const KeyboardAvoidingView = View;
        export const KeyboardStickyView = View;
        export const useKeyboardState = () => ({ isVisible: false, height: 0 });
        export const useReanimatedKeyboardAnimation = () => ({ height: { value: 0 }, progress: { value: 0 } });
    `,
    'expo-constants': `export default { statusBarHeight: 0 };`,
    'expo-crypto': `
        export const randomUUID = () => 'fixture-request-' + (globalThis.__FIXTURE_UUID_COUNT__ = (globalThis.__FIXTURE_UUID_COUNT__ ?? 0) + 1);
        export const getRandomBytes = (count) => new Uint8Array(count);
    `,
    'zustand/react/shallow': `export const useShallow = (selector) => selector;`,
    'expo-image': `import { View } from 'react-native'; export const Image = View;`,
    '@/constants/product': `export const PRODUCT = ${JSON.stringify(PRODUCT)};`,
    'expo-haptics': `
        export const NotificationFeedbackType = { Error: 'error' };
        export const ImpactFeedbackStyle = { Light: 'light' };
        export const notificationAsync = async () => {};
        export const impactAsync = async () => {};
    `,
    'react-native-gesture-handler': `
        import React from 'react';
        import { ScrollView } from 'react-native';
        const chain = new Proxy(() => chain, { get: () => chain });
        export { ScrollView };
        export const Gesture = new Proxy({}, { get: () => chain });
        export const GestureDetector = ({ children }) => React.createElement(React.Fragment, null, children);
        export const Swipeable = React.forwardRef(({ children }, _ref) => children);
    `,
    'react-native-mmkv': `
        export class MMKV {
            constructor() { this.values = new Map(); }
            getString(key) { return this.values.get(key); }
            getNumber(key) { return this.values.get(key); }
            getBoolean(key) { return this.values.get(key); }
            set(key, value) { this.values.set(key, value); }
            delete(key) { this.values.delete(key); }
            clearAll() { this.values.clear(); }
        }
    `,
    '@/encryption/libsodium': `
        export const decryptBox = () => null;
        export const decryptSecretBox = () => null;
        export const encryptBox = (value) => value;
        export const encryptSecretBox = (value) => value;
        export const getPublicKeyForBox = (value) => value;
    `,
    '@/encryption/libsodium.lib': `export default {};`,
    '@/sync/storage': `
        import React from 'react';
        import { selectSideChatSessions } from '@/sync/sideChatSessions';
        const fixtureOptions = globalThis.__HAPPYHERD_FIXTURE_OPTIONS__ ?? {};
        const legacyClaudeContinuation = fixtureOptions.legacyClaudeContinuation === true;
        const modelPicker = fixtureOptions.modelPicker === true;
        const dshReceipt = fixtureOptions.dshReceipt === true;
        const dshSession = fixtureOptions.dshSession === true || dshReceipt;
        const makeSession = (id, createdAt, metadata = {}, active = true) => ({
            id, seq: 0, createdAt, updatedAt: createdAt, active, activeAt: createdAt,
            presence: active ? 'online' : 'offline',
            metadata: { host: 'fixture', path: '/work/project', summary: { text: id }, ...metadata },
        });
        const sessions = {
            parent: dshSession
                ? {
                    ...makeSession('parent', 1, {
                        machineId: 'machine-1', flavor: 'dsh', commanderId: 'commander-1',
                        permissionMode: 'read-only',
                        ...(dshReceipt ? { spawnSettings: {
                            provider: 'dsh', model: 'deepseek-v4-flash', effort: 'high', permission: 'workspace-write',
                        } } : {}),
                    }),
                    permissionMode: 'danger-full-access',
                }
                : makeSession('parent', 1, legacyClaudeContinuation
                    ? { machineId: 'machine-1', claudeSessionId: 'claude-parent', commanderId: 'commander-1' }
                    : { machineId: 'machine-1', flavor: 'codex', codexThreadId: 'thread-parent', commanderId: 'commander-1' }),
            background: makeSession('background', 2, { machineId: 'machine-1', flavor: 'codex', codexThreadId: 'thread-background' }),
            'target-session': makeSession('target-session', 3, legacyClaudeContinuation
                ? { machineId: 'machine-1', flavor: 'codex', codexThreadId: 'codex-target', continuedFromSessionId: 'parent' }
                : { machineId: 'machine-1', flavor: 'claude', claudeSessionId: 'claude-target', continuedFromSessionId: 'parent' }),
            'child-oldest': makeSession('child-oldest', 10, {
                isSideChat: true, parentSessionId: 'parent', summary: { text: 'Oldest child' },
                machineId: 'machine-1', path: '/work/child-oldest', flavor: 'codex', codexThreadId: 'thread-child-oldest',
            }),
            'child-newest': makeSession('child-newest', 20, {
                isSideChat: true, parentSessionId: 'parent', summary: { text: 'Newest child' },
                machineId: 'machine-newest', path: '/work/child-newest', flavor: 'codex', codexThreadId: 'thread-child-newest',
            }),
            'other-child': makeSession('other-child', 30, { isSideChat: true, parentSessionId: 'other-parent' }),
        };
        if (fixtureOptions.subagentLifecycle) {
            sessions['child-newest'].metadata.flavor = 'claude';
        }
        if (fixtureOptions.contextWindow) {
            const provider = fixtureOptions.contextWindow.provider;
            sessions.parent.metadata = { ...sessions.parent.metadata, flavor: provider,
                claudeSessionId: provider === 'claude' ? 'claude-parent' : undefined,
                codexThreadId: provider === 'codex' ? 'thread-parent' : undefined,
                codexHome: provider === 'codex' ? '/work/provider-state/codex' : undefined,
            };
        if (fixtureOptions.commanderContext) {
            sessions.parent.metadata = { ...sessions.parent.metadata, commanderId: 'athena', commanderName: 'Athena', commanderContextFiles: [
                { kind: 'global-agents', path: '/global/AGENTS.md' },
                { kind: 'commander', path: '/athena/COMMANDER.md' },
                { kind: 'working-memory', path: '/athena/memory/1-working-memory.md' },
                { kind: 'long-term-memory', path: '/athena/memory/2-long-term-memory.md' },
            ] };
        }
        if (modelPicker) {
            sessions.parent = {
                ...sessions.parent,
                modelMode: fixtureOptions.customClaudeNames ? 'claude-opus-5-5' : 'Gemini 3.6 Flash (High)',
                permissionMode: 'default',
                metadata: { ...sessions.parent.metadata, flavor: fixtureOptions.customClaudeNames ? 'claude' : 'agy' },
            };
        }
        if (fixtureOptions.botLifecycle) {
            sessions.parent = {
                ...sessions.parent,
                metadata: {
                    ...sessions.parent.metadata,
                    flavor: 'rig',
                    bot: {
                        id: 'bot-one',
                        name: 'Bot assistant',
                        username: 'bot-assistant',
                        workspaceId: 'workspace-one',
                        orderKey: 'a0',
                    },
                },
            };
        }
        if (fixtureOptions.workspaceRetention) {
            sessions['child-newest'].metadata.machineId = 'machine-1';
            sessions['child-newest'].metadata.path = '/work/project';
        }
        if (fixtureOptions.newSessionLayout) {
            for (let index = 0; index < 24; index += 1) {
                const path = '/workspace/products/example-project-' + String(index).padStart(2, '0');
                sessions['recent-' + index] = makeSession('recent-' + index, 100 + index, {
                    machineId: 'machine-1', path,
                });
            }
        }
        const sessionList = Object.values(sessions);
        const sideChatSnapshots = {
            parent: selectSideChatSessions(sessions, 'parent'),
            background: selectSideChatSessions(sessions, 'background'),
            'other-parent': selectSideChatSessions(sessions, 'other-parent'),
        };
        const localSettings = {
            acknowledgedCliVersions: {},
            sidebarPanelsOpen: [],
            sidebarPanelActive: null,
            sidebarSideChatSessionId: null,
            zenMode: fixtureOptions.zenMode ?? false,
        };
        const projects = fixtureOptions.accountProject ? {
            'focus-project': { id: 'focus-project', name: 'Focused work', kind: 'personal' },
            'other-project': { id: 'other-project', name: 'Other work', kind: 'personal' },
            'rig-project': { id: 'rig-project', name: 'Agent workspace', kind: 'rig' },
        } : {};
        const settings = {
            focusMode: fixtureOptions.accountProject && fixtureOptions.activeFocus !== false
                ? { projectId: 'focus-project', endsAt: Date.now() + 30 * 60_000 } : null,
            agentDefaultOverrides: fixtureOptions.agentSettings
                ? { agy: { modelMode: 'Gemini 3.6 Flash (High)' } }
                : {},
            agentInputEnterToSend: false,
            diffStyle: 'unified',
            expImageUpload: fixtureOptions.imageAttachments === true,
            expContextWindow: fixtureOptions.contextWindow
                ? JSON.parse(localStorage.getItem('context-window-enabled') ?? 'false') : false,
            fileDiffsSidebar: fixtureOptions.newSessionLayout === true,
            machineWorkspace: fixtureOptions.machineWorkspaceEnabled ?? true,
            recentMachinePaths: [],
            favoriteMachinePaths: [],
        };
        const machines = [
            { id: 'machine-1', active: true, metadata: {
                displayName: 'MainEC2', host: 'fixture', homeDir: '/work/project', platform: 'linux', supportsFileDelete: true,
                cliAvailability: dshSession ? { claude: true, codex: true, dsh: true } : { claude: true, codex: true },
                ...(dshSession ? { agentCapabilities: { dsh: {
                    detectedAt: 1,
                    sources: { models: 'dsh-acp', effortLevels: 'dsh-acp', permissionModes: 'dsh-profile' },
                    models: [{ code: 'deepseek-v4-flash', value: 'DeepSeek V4 Flash', isDefault: true }],
                    effortLevels: [{ code: 'high', value: 'high', isDefault: true }],
                    permissionModes: [
                        { code: 'read-only', value: 'read-only' },
                        { code: 'workspace-write', value: 'workspace-write', isDefault: true },
                        { code: 'danger-full-access', value: 'danger-full-access' },
                    ],
                } } } : {}),
            } },
            { id: 'machine-newest', active: true, metadata: { displayName: 'SideEC2', host: 'fixture-side', homeDir: '/work/child-newest', platform: 'linux', supportsFileDelete: true, cliAvailability: { claude: true, codex: true } } },
        ];
        if (fixtureOptions.contextWindow?.failure === 'offline') machines[0].active = false;
        if (fixtureOptions.workspaceDelete) {
            for (const machine of machines) machine.metadata.supportsDirectoryDelete = true;
        }
        if (modelPicker) {
            machines[0].metadata.cliAvailability = { claude: true, codex: true, agy: true };
            machines[0].metadata.agentCapabilities = { agy: {
                detectedAt: 1,
                sources: { models: 'release-catalog', effortLevels: 'model-name', permissionModes: 'launch-profile' },
                models: [
                    ...(fixtureOptions.newSessionLayout ? [{ code: 'claude-sonnet-4-5', value: 'claude-sonnet-4-5', effortLevels: [] }] : []),
                    { code: 'Gemini 3.8 Flash', value: 'Gemini 3.8 Flash', isDefault: true, effortLevels: [] },
                    { code: 'Claude Sonnet 4.6 (Thinking)', value: 'Claude Sonnet 4.6 (Thinking)', effortLevels: [] },
                    { code: 'Claude Opus 4.6 (Thinking)', value: 'Claude Opus 4.6 (Thinking)', effortLevels: [] },
                    { code: 'GPT-OSS 120B (Medium)', value: 'GPT-OSS 120B (Medium)', effortLevels: [] },
                ],
                effortLevels: [],
                permissionModes: [{ code: 'default', value: 'default', isDefault: true }],
            } };
        }
        if (fixtureOptions.customClaudeNames) {
            machines[0].metadata.agentCapabilities = { claude: {
                detectedAt: 1,
                sources: { models: 'happyherd-release-catalog', effortLevels: 'cli-help', permissionModes: 'daemon-defaults' },
                models: [
                    { code: 'claude-opus-5-5', value: 'Opus Research Preview', isDefault: true },
                    { code: 'claude-sonnet-5', value: 'Sonnet Team Edition' },
                ],
                effortLevels: [],
                permissionModes: [{ code: 'default', value: 'default', isDefault: true }],
            } };
        }
        if (fixtureOptions.noRunnableHarness) {
            for (const machine of machines) machine.metadata.cliAvailability = { claude: false, codex: false, agy: false, grok: false, dsh: false };
        }
        const changedFiles = (sessionId) => ({
            stagedFiles: [],
            unstagedFiles: [{
                fullPath: sessionId === 'parent'
                    ? '/work/project/mobile-change.ts'
                    : '/work/' + sessionId + '-change.ts',
                status: 'untracked',
                isStaged: false,
                linesAdded: 1,
                linesRemoved: 0,
            }],
        });
        const pathProjectFiles = {};
        const listeners = new Set();
        const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
        const emit = () => listeners.forEach((listener) => listener());
        const getState = () => ({
            localSettings,
            settings,
            projects,
            sessions,
            machines: Object.fromEntries(machines.map((machine) => [machine.id, machine])),
            purchases: { entitlements: {} },
            currentViewingSessionId: null,
            pathProjectFiles,
            updateSessionDraft(sessionId, draft) {
                sessions[sessionId] = { ...sessions[sessionId], draft };
                emit();
            },
            applyLocalSettings(update) { Object.assign(localSettings, update); emit(); },
            applyGitStatusFiles() {},
            applyProjectFiles(pathKey, result) { pathProjectFiles[pathKey] = result; emit(); },
            getSessionPathKey: (sessionId) => sessionId,
            setCurrentViewingSession() {},
        });
        export const __applySessionModes = (sessionId, patch) => {
            sessions[sessionId] = { ...sessions[sessionId], ...patch };
            emit();
        };
        export const __applyBotArchiveSync = () => {
            sessions.parent = { ...sessions.parent, active: false, presence: 'offline' };
            emit();
        };
        export const storage = Object.assign(() => undefined, { getState, __applyBotArchiveSync });
        export const useIsDataReady = () => true;
        export const useLocalSettingMutable = (key) => [
            React.useSyncExternalStore(subscribe, () => localSettings[key] ?? false, () => localSettings[key] ?? false),
            (value) => { localSettings[key] = value; emit(); },
        ];
        export const useLocalSetting = (key) => React.useSyncExternalStore(subscribe, () => localSettings[key], () => localSettings[key]);
        export const useMachine = (id) => machines.find((machine) => machine.id === id) ?? null;
        export const useProjects = () => projects;
        export const useAllMachines = () => machines;
        export const useSessions = () => sessionList;
        export const useRealtimeStatus = () => fixtureOptions.realtimeStatus ?? 'disconnected';
        export const useSession = (id) => React.useSyncExternalStore(subscribe, () => sessions[id] ?? null, () => sessions[id] ?? null);
        export const useSessionAgentFormCommunication = () => null;
        export const useSessionGitStatus = () => null;
        export const useSessionGitStatusFiles = (sessionId) => changedFiles(sessionId);
        const messages = Array.from({ length: 80 }, (_, index) => ({
            kind: 'user-text',
            id: 'fixture-message-' + index,
            localId: null,
            createdAt: 1000 - index,
            text: fixtureOptions.providerContinuation && index === 0
                ? 'HIDDEN_PRIOR_HANDOFF_BROWSER_SENTINEL'
                : index === (fixtureOptions.providerContinuation ? 1 : 0)
                    ? 'HIDDEN_BROWSER_CONTEXT_SENTINEL'
                    : 'Fixture chat line ' + index + ' '.repeat(120),
            ...(fixtureOptions.providerContinuation && index === 0 ? {
                displayText: legacyClaudeContinuation
                    ? 'Continue from Codex session'
                    : 'Continue from Claude session',
                meta: { providerContinuationHandoff: true },
            } : {}),
            ...(index === (fixtureOptions.providerContinuation ? 1 : 0)
                ? { displayText: 'Visible browser context' }
                : {}),
        }));
        const localhostMessages = Object.fromEntries(Object.keys(sessions).map((id) => [id, [{
            kind: 'agent-text', id: 'localhost-link-' + id, localId: null, createdAt: 1001,
            text: '[Hosted page ' + id + '](' + (fixtureOptions.localhostUrl || 'http://localhost:8766/validation-map.html') + ') [External reference](https://example.com/docs)',
        }]]));
        let messagesLoaded = fixtureOptions.providerContinuationMessagesLoaded !== false;
        const safeguardStorageKey = 'safeguard-browser-messages';
        let safeguardMessages = fixtureOptions.safeguard
            ? JSON.parse(localStorage.getItem(safeguardStorageKey) ?? '[]')
            : [];
        let safeguardSnapshot = { hasMoreOlder: false, isLoaded: true, isLoadingOlder: false, messages: safeguardMessages };
        const subagentStorageKey = 'subagent-browser-messages';
        let subagentSnapshot = { hasMoreOlder: false, isLoaded: true, isLoadingOlder: false,
            messages: fixtureOptions.subagentLifecycle
                ? JSON.parse(localStorage.getItem(subagentStorageKey) ?? 'null') ?? fixtureOptions.subagentLifecycle
                : [],
        };
        // Synthetic synced-message transport; the test enters through SessionView's real Side chats button.
        globalThis.__APPLY_SUBAGENT_MESSAGES__ = (messages) => {
            subagentSnapshot = { ...subagentSnapshot, messages };
            localStorage.setItem(subagentStorageKey, JSON.stringify(messages));
            emit();
        };
        const saveSafeguardMessages = (next) => {
            safeguardMessages = next;
            safeguardSnapshot = { ...safeguardSnapshot, messages: next };
            localStorage.setItem(safeguardStorageKey, JSON.stringify(next));
            emit();
        };
        export const __sendSafeguardMessage = async (sessionId, text, options) => {
            if (!fixtureOptions.safeguard || sessionId !== 'parent') return;
            const createdAt = Date.now();
            const user = { kind: 'user-text', id: 'safeguard-user-' + createdAt, localId: null, createdAt, text };
            saveSafeguardMessages([user, ...safeguardMessages]);
            if (options?.source === 'option') return;
            const responseId = 'safeguard-agent-' + createdAt;
            const receiveText = (text) => saveSafeguardMessages([
                { kind: 'agent-text', id: responseId, localId: null, createdAt: createdAt + 1, text },
                ...safeguardMessages.filter((message) => message.id !== responseId),
            ]);
            receiveText(fixtureOptions.safeguard.partial);
            const response = await fetch('/fixture-safeguard-response').then((response) => response.json());
            receiveText(response.text);
        };
        export const __loadProviderContinuationMessages = () => {
            messagesLoaded = true;
            return messages;
        };
        export const useSessionMessages = (sessionId) => {
            const getSnapshot = () => fixtureOptions.subagentLifecycle ? subagentSnapshot : safeguardSnapshot;
            const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
            if (fixtureOptions.subagentLifecycle && sessionId === 'child-newest') return snapshot;
            if (fixtureOptions.safeguard && sessionId === 'parent') return snapshot;
            return {
                hasMoreOlder: false,
                isLoaded: messagesLoaded,
                isLoadingOlder: false,
                messages: fixtureOptions.commanderContext ? (fixtureOptions.commanderContextPopulated ? [messages[0]] : []) : fixtureOptions.localhostLinks ? localhostMessages[sessionId] ?? [] : messagesLoaded ? messages : [],
            };
        };
        export const useSessionPendingCommunications = () => [];
        export const useSessionProjectFiles = (sessionId) => React.useSyncExternalStore(
            subscribe,
            () => pathProjectFiles[sessionId] ?? null,
            () => pathProjectFiles[sessionId] ?? null,
        );
        export const useSessionUsage = () => null;
        export const useSetting = (key) => React.useSyncExternalStore(subscribe, () => key === 'sessionStatusBarDisplay' ? 'hidden' : settings[key], () => settings[key]);
        export const useSettingMutable = (key) => {
            const value = React.useSyncExternalStore(subscribe, () => settings[key], () => settings[key]);
            const setValue = React.useCallback((next) => {
                if (fixtureOptions.agentSettings && key === 'agentDefaultOverrides') {
                    globalThis.__MODEL_PICKER_SETTINGS_MUTATIONS__ = [...(globalThis.__MODEL_PICKER_SETTINGS_MUTATIONS__ ?? []), next];
                }
                settings[key] = next;
                if (fixtureOptions.contextWindow && key === 'expContextWindow') localStorage.setItem('context-window-enabled', JSON.stringify(next));
                emit();
            }, [key]);
            return [value, setValue];
        };
        export const useSideChatSessions = (parentId) => React.useSyncExternalStore(
            subscribe,
            () => sideChatSnapshots[parentId] ?? [],
            () => sideChatSnapshots[parentId] ?? [],
        );
        export const useProviderContinuationSessions = (sourceId) => fixtureOptions.providerContinuation
            ? Object.values(sessions).filter((session) => session.metadata?.continuedFromSessionId === sourceId)
            : [];
    `,
    '@/sync/gitStatusFiles': `export const getGitStatusFiles = async () => null;`,
    '@/sync/projectFiles': `
        export const getProjectFiles = async (sessionId) => ({
            files: sessionId === 'parent'
                ? globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.parentProjectFile
                    ? [{ fullPath: '/work/project/session-note.md' }]
                    : []
                : [{ fullPath: '/work/project/chat-' + sessionId + '.md' }],
            generatedAt: Date.now(),
        });
    `,
    '@/components/FileIcon': `import React from 'react'; export const FileIcon = () => React.createElement('span');`,
    '@/text': `
        import en from '@/text/locales/en.json';
        const productText = (key, params) => {
            const value = key.split('.').reduce((node, part) => node?.[part], en);
            if (typeof value !== 'string') return null;
            return Object.entries(params ?? {}).reduce((text, [name, replacement]) => text.replaceAll('{' + name + '}', String(replacement)), value);
        };
        export const t = (key, params) => ((globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.accountProject || globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.subagentLifecycle || globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.contextWindow || globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.commanderContext) ? productText(key, params) : null) ?? ({
            'message.safeguard.revise': en.message.safeguard.revise,
            'message.safeguard.ready': en.message.safeguard.ready,
            'newSession.showHidden': 'Show hidden',
            'uiCopy.hostFolders': 'Host folders',
            'uiCopy.useThisFolder': 'Use this folder',
            'uiCopy.openFolderValue': 'Open folder ' + (params?.value1 ?? ''),
            'uiCopy.enterProjectPath': 'Enter project path',
            'workspace.recent': 'Recent',
            'sideChat.panelTitle': 'Side chats',
            'sideChat.newChatDescription': 'Open a parallel chat forked from this session',
            'files.changesPanelDescription': 'Files this session changed',
            'files.hidePanel': 'Hide panel',
            'sideChat.resizePanel': 'Resize side panel',
            'sideChat.openCount': 'Open side chats (' + (params?.count ?? '') + ')',
            'sideChat.collapse': 'Collapse side chats',
            'sideChat.newChat': 'New side chat',
            'sideChat.tabLabel': 'Side chat ' + ((params?.index ?? 0) + 1),
            'sideChat.close': 'Close side chat',
            'sideChat.expand': 'Expand side chat',
            'files.changes': 'Changes',
            'sessionInfo.quickActions': 'Quick Actions',
            'sessionInfo.archiveSession': 'Archive Session',
            'sessionInfo.deleteSession': 'Delete Session',
            'sessionInfo.botArchiveRequiresMachine': 'Connect the owning machine to archive this bot session.',
            'profile.details': 'Details',
            'uiCopy.archive': 'Archive',
            'common.error': 'Error',
            'files.addPanel': 'Add panel',
            'files.resizeWorkspace': 'Resize file workspace',
            'files.openFileTab': 'Open file ' + (params?.name ?? ''),
            'files.closeFileTab': 'Close file ' + (params?.name ?? ''),
            'files.openExistingFile': 'Open existing file',
            'files.commentOnLine': 'Comment on line ' + (params?.line ?? ''),
            'files.commentPlaceholder': 'Write a comment',
            'files.pinComment': 'Pin comment',
            'files.sendComments': 'Send ' + (params?.count ?? '') + ' comments',
            'files.pinnedComment': 'Pinned comment',
            'files.editFile': 'Edit',
            'files.saveFile': 'Save',
            'files.deleteFile': 'Delete',
            'files.deleteFileTitle': 'Delete file?',
            'files.deleteFileMessage': 'Delete ' + (params?.name ?? '') + '?',
            'files.failedToDelete': 'Failed to delete file',
            'files.noChanges': 'No changes',
            'files.changedFiles': (params?.count ?? 0) + ' changed file',
            'files.searchPlaceholder': 'Search files',
            'files.noFilesInProject': 'No files in project',
            'happyHerd.composer.attachments': 'Attachments',
            'happyHerd.composer.addAttachment': 'Add attachment',
            'happyHerd.composer.photos': 'Photos',
            'happyHerd.composer.deviceFiles': 'Device files',
            'happyHerd.composer.moreActions': 'More actions',
            'happyHerd.composer.send': 'Send',
            'happyHerd.composer.addPhoto': 'Add attachment',
            'happyHerd.composer.addPhotos': 'Add attachment',
            'happyHerd.composer.sendFailedBody': 'Could not send feedback.',
            'happyHerd.composer.startVoice': 'Start dictation',
            'review.feedbackPrompt': 'Share file feedback',
            'settings.machines': 'Machines',
            'settingsAppearance.diffStyleOptions.unified': 'Unified',
            'settingsAppearance.diffStyleOptions.split': 'Split',
            'workspace.title': 'Workspace',
            'workspace.pathPlaceholder': 'Path',
            'workspace.go': 'Go',
            'workspace.home': 'Home',
            'workspace.root': 'Root',
            'workspace.parent': 'Parent',
            'workspace.refresh': 'Refresh',
            'workspace.favorites': 'Favorites',
            'workspace.upload': 'Upload',
            'workspace.newFolder': 'New folder',
            'workspace.deleteFileTitle': 'Delete file?',
            'workspace.deleteFolderTitle': 'Delete folder?',
            'workspace.deleteFileConfirm': 'Are you sure you want to permanently remove ' + params?.path + '? This action cannot be undone.',
            'workspace.deleteFolderConfirm': 'Are you sure you want to permanently remove ' + params?.path + ' and all its contents? This action cannot be undone.',
            'workspace.deleteItemAction': 'Delete ' + params?.name,
            'workspace.deleteItemFailed': 'Failed to delete the item.',
            'common.delete': 'Delete',
            'common.cancel': 'Cancel',
            'workspace.folderNamePlaceholder': 'Folder name',
            'common.create': 'Create',
            'workspace.searchPlaceholder': 'Search files',
            'workspace.browseMachine': 'Browse this machine',
            'workspace.selectedItemsCount': (params?.count ?? 0) + ' of ' + (params?.max ?? 0) + ' items selected',
            'uiCopy.attachValueToNextMessage': 'Attach ' + (params?.value1 ?? '') + ' to next message',
            'uiCopy.removeValueFromMessageContext': 'Remove ' + (params?.value1 ?? '') + ' from message context',
            'uiCopy.preview': 'Preview',
            'uiCopy.unsaved': 'Unsaved',
            'session.providerContinuationTitle': 'Continue session',
            'session.providerContinuationAction': 'Continue with…',
            'session.providerContinuationSubtitle': 'The original remains available while a fresh session opens.',
            'session.providerContinuationCurrent': 'Current session',
            'session.providerContinuationFreshSession': 'Start a fresh session',
            'session.providerContinuationNotAvailable': 'Target CLI unavailable',
            'session.providerContinuationHandoff': 'Continue from ' + (params?.provider ?? '') + ' session',
            'session.providerContinuationHandoffFailed': 'Recent context could not be sent.',
            'session.providerContinuationUnavailable': 'Cross-provider continuation is unavailable.',
            'session.providerContinuationFrom': 'Continued from ' + (params?.provider ?? ''),
            'session.providerContinuationTo': 'Continued with ' + (params?.provider ?? ''),
        }[key] ?? key);
    `,
    '@/keyboard/shortcuts': `
        export const SIDEBAR_PICKER_SHORTCUTS = { changes: {}, allFiles: {}, newSideChat: {} };
        export const SESSION_ACTION_SHORTCUTS = { 'continue-provider': {} };
        export const formatShortcutChord = () => '';
        export const getPreferredShortcutModifier = () => 'meta';
        export const matchesShortcutChord = () => false;
        export const formatShortcut = () => '';
    `,
    '@/components/AnimatedOverlay': `
        import { View } from 'react-native';
        export const AnimatedClickAwayBackdrop = View;
        export const AnimatedBlurBackdrop = View;
        export const AnimatedFade = ({ children, visible }) => visible ? children : null;
        export const AnimatedPopup = View;
        export const LocalBlurHalo = View;
    `,
    '@/components/MobileGlass': `import { View } from 'react-native'; export const MobileGlassSurface = View; export const MobileGlassBackdrop = () => null;`,
    '@/components/MobileTypographyFloor': `export const MobileTypographyFloor = ({ children }) => children;`,
    '@/components/navigation/Header': `import { View } from 'react-native'; export const Header = View;`,
    '@/components/ProviderIcon': `import React from 'react'; export const ProviderIcon = ({ kind }) => React.createElement('span', { 'data-provider': kind });`,
    '@/components/BubblePressable': `import { Pressable } from 'react-native'; export const BubblePressable = Pressable;`,
    '@/components/NativeOptionsPicker': `export const NativeOptionsPicker = ({ children }) => children;`,
    '@/components/navigation/MobileHeaderScrim': `
        export const MobileHeaderScrim = () => null;
        export const MOBILE_HOME_SCRIM_OVERLAY_OPACITY = 0;
        export const MOBILE_STRONG_HEADER_SCRIM_RESTING_OPACITY = 0;
        export const MOBILE_STRONG_HEADER_SCRIM_UNDERLAP_OPACITY = 1;
    `,
    '@/utils/platform': `export const isRunningOnMac = () => false;`,
    '@/utils/responsive': `
        import { useWindowDimensions } from 'react-native';
        export const useHeaderHeight = () => 64;
        export const useDeviceType = () => useWindowDimensions().width >= 768 ? 'tablet' : 'phone';
        export const useIsTablet = () => useDeviceType() === 'tablet';
        export const useIsLandscape = () => false;
        export const getDeviceType = () => 'tablet';
    `,
    '@/sync/sync': `
        import { __loadProviderContinuationMessages, __sendSafeguardMessage } from '@/sync/storage';
        export const sync = {
            onSessionVisible() {},
            ensureSessionMessagesLoaded: async (sessionId) => {
                window.__PROVIDER_CONTINUATION_SOURCE_LOAD__ = sessionId;
                return __loadProviderContinuationMessages();
            },
            refreshSessions: async () => {},
            ensureSessionReady: async () => {},
            assignSessionProject: async (sessionId, projectId) => {
                window.__NEW_SESSION_PROJECT_EVENTS__ = [...(window.__NEW_SESSION_PROJECT_EVENTS__ ?? []), { type: 'assign', sessionId, projectId }];
            },
            sendMessage: async (sessionId, text, options) => {
                window.__NEW_SESSION_PROJECT_EVENTS__ = [...(window.__NEW_SESSION_PROJECT_EVENTS__ ?? []), { type: 'send', sessionId }];
                options?.onAccepted?.();
                window.__PROVIDER_CONTINUATION_SEND__ = { sessionId, text, options };
                window.__COMPOSER_SENDS__ = [...(window.__COMPOSER_SENDS__ ?? []), { sessionId, text, options }];
                await __sendSafeguardMessage(sessionId, text, options);
                if (globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.deferWorkspaceFeedback && window.__COMPOSER_SENDS__.length === 1) {
                    await new Promise((resolve) => { window.__RESOLVE_WORKSPACE_FEEDBACK__ = resolve; });
                }
                return { localId: 'handoff-message' };
            },
            applySettings() {},
        };
    `,
    '@/modal': `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { WebPromptModal } from '@/modal/components/WebPromptModal';
        import { WebAlertModal } from '@/modal/components/WebAlertModal';
        export const Modal = {
            alert(title, message, buttons = []) {
                window.__HAPPYHERD_ALERTS__ = [...(window.__HAPPYHERD_ALERTS__ ?? []), { title, message }];
                document.querySelector('[data-testid="fixture-alert"]')?.remove();
                const host = document.createElement('div');
                host.dataset.testid = 'fixture-alert';
                host.setAttribute('role', 'alert');
                const text = document.createElement('div');
                text.textContent = [title, message].filter(Boolean).join(': ');
                host.append(text);
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = buttons[0]?.text ?? 'OK';
                button.onclick = () => {
                    buttons[0]?.onPress?.();
                    host.remove();
                };
                host.append(button);
                document.body.append(host);
            },
            confirm(title, message, options) {
                if (!globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.workspaceDelete) return Promise.resolve(true);
                return new Promise((resolve) => Modal.show({
                    component: WebAlertModal,
                    props: { config: { id: 'fixture-confirm', type: 'confirm', title, message, ...options }, onConfirm: resolve },
                }));
            },
            prompt(title, message, options) {
                return new Promise((resolve) => Modal.show({
                    component: WebPromptModal,
                    props: {
                        config: { id: 'fixture-prompt', type: 'prompt', title, message, ...options },
                        onConfirm: resolve,
                    },
                }));
            },
            show(request) {
                const host = document.createElement('div');
                host.dataset.testid = 'fixture-global-modal';
                document.body.append(host);
                const root = createRoot(host);
                const close = () => queueMicrotask(() => {
                    root.unmount();
                    host.remove();
                });
                root.render(React.createElement(request.component, {
                    ...(request.props ?? {}),
                    onClose: close,
                }));
            },
        };
    `,
    '@/components/AgentContentView': `
        import React from 'react';
        import { AgentContentView as ActualAgentContentView } from '${resolve(here, 'AgentContentView.tsx')}';
        import { WorkspaceLinkPressContext } from '@/-session/workspaceLinkNavigation';
        import { MarkdownView } from '@/components/markdown/MarkdownView';
        export const AgentContentView = (props) => {
            const openWorkspaceLink = React.useContext(WorkspaceLinkPressContext);
            if (globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.contextWindow) {
                return React.createElement(React.Fragment, null, props.content, props.placeholder, props.input);
            }
            if (globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.commanderContext) return React.createElement(ActualAgentContentView, props);
            if (globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.workspaceRetention) {
                return React.createElement(React.Fragment, null, props.content, props.placeholder, props.input,
                    React.createElement(MarkdownView, {
                        markdown: '[Browse reports](/work/reports) [Slow file](/work/project/session-note.md)',
                        sessionId: 'parent', enableWorkspaceLinks: true,
                    }));
            }
            return React.createElement(
                React.Fragment,
                null,
                props.content,
                props.placeholder,
                props.input,
                React.createElement('button', {
                    type: 'button',
                    'aria-label': 'Open Main Agent outside file',
                    onClick: () => openWorkspaceLink?.({
                        pathname: '/workspace',
                        params: {
                            mode: 'link',
                            originSessionId: 'parent',
                            machineId: 'machine-1',
                            absolutePath: '/outside/main-notes.md',
                            line: '27',
                            column: '9',
                        },
                    }),
                }, 'Open Main Agent outside file'),
                React.createElement('button', {
                    type: 'button',
                    'aria-label': 'Open Side chat outside file',
                    onClick: () => openWorkspaceLink?.({
                        pathname: '/workspace',
                        params: {
                            mode: 'link',
                            originSessionId: 'child-newest',
                            machineId: 'machine-1',
                            absolutePath: '/outside/side-notes.md',
                            line: '41',
                            column: '6',
                        },
                    }),
                }, 'Open Side chat outside file'),
                React.createElement('button', {
                    type: 'button',
                    'aria-label': 'Open Main Agent same-path file',
                    onClick: () => openWorkspaceLink?.({
                        pathname: '/workspace',
                        params: {
                            mode: 'link',
                            originSessionId: 'parent',
                            machineId: 'machine-1',
                            absolutePath: '/work/project/session-note.md',
                        },
                    }),
                }, 'Open Main Agent same-path file'),
            );
        };
    `,
    '@/components/AgentGoalBar': `export const AgentGoalBar = () => null;`,
    '@/components/AgentQuestionBanner': `export const AgentQuestionBanner = () => null;`,
    '@/components/QueuedMessagesPanel': `export const QueuedMessagesPanel = () => null;`,
    '@/components/MachineFileUploadStatus': `export const MachineFileUploadStatus = () => null;`,
    '@/components/Deferred': `export const Deferred = ({ children }) => children;`,

    '@/components/SessionStatusBar': `export const SessionStatusBar = () => null;`,
    '@/components/Avatar': `export const Avatar = () => null;`,
    '@/components/VoiceAssistantStatusBar': `
        import React from 'react';
        export const VOICE_PILL_TOTAL_HEIGHT = 36;
        export const VoiceAssistantStatusBar = () => React.createElement('div', {
            'data-testid': 'voice-status-bar',
            style: { height: VOICE_PILL_TOTAL_HEIGHT },
        });
    `,
    '@/components/RigActivityBar': `export const RigActivityBar = () => null;`,
    '@/components/agentGoalStatus': `export const resolveVisibleAgentGoalStatus = () => null;`,
    '@/components/modelModeOptions': `
        import * as actual from '${resolve(here, 'modelModeOptions.ts')}';
        const realModels = globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.modelPicker === true;
        export const groupModelModesByProvider = actual.groupModelModesByProvider;
        export const getAdvertisedDefaultOptionKey = (...args) => realModels ? actual.getAdvertisedDefaultOptionKey(...args) : undefined;
        export const getHardcodedModelModes = () => [];
        export const getHardcodedPermissionModes = () => [];
        export const filterPermissionModesForCli = (modes) => modes;
        export const getEffortLevelsForModel = () => [];
        export const getRigCurrentModelOptionKey = () => undefined;
        export const getSessionAvailableModels = (...args) => realModels ? actual.getSessionAvailableModels(...args) : [];
        export const getSessionAvailablePermissionModes = (flavor, _sessionMetadata, machineMetadata) =>
            flavor === 'dsh'
                ? (machineMetadata?.agentCapabilities?.dsh?.permissionModes ?? []).map((mode) => ({
                    key: mode.code, name: mode.value, description: mode.description ?? null, isDefault: mode.isDefault,
                }))
                : [];
        export const getSessionEffortLevelsForModel = () => [];
        export const getMachineAdvertisedModels = (...args) => realModels ? actual.getMachineAdvertisedModels(...args) : (args[0]?.agentCapabilities?.[args[1]]?.models ?? []).map((model) => ({ key: model.code, name: model.value, isDefault: model.isDefault }));
        export const getMachineAdvertisedEffortLevels = (metadata, flavor) => (metadata?.agentCapabilities?.[flavor]?.effortLevels ?? []).map((effort) => ({ key: effort.code, name: effort.value, isDefault: effort.isDefault }));
        export const getMachineAdvertisedPermissionModes = (metadata, flavor) => (metadata?.agentCapabilities?.[flavor]?.permissionModes ?? []).map((mode) => ({ key: mode.code, name: mode.value, isDefault: mode.isDefault }));
        export const getSupportsWorktree = () => false;
        export const includeConfiguredModel = (_flavor, models) => models;
        export const resolveCurrentOption = (...args) => realModels ? actual.resolveCurrentOption(...args) : null;
    `,
    '@/components/autocomplete/suggestions': `export const getSuggestions = () => [];`,
    '@/components/diff/PierreDiffView': `export const prefetchPierreDiff = () => {}; export const PierreDiffView = () => null;`,
    '@/hooks/useNewSessionDraft': `
        import React from 'react';
        const modelPicker = globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.modelPicker === true;
        const newSessionLayout = globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.newSessionLayout === true;
        const listeners = new Set();
        const draft = {
            input: 'Inspect attachments', attachments: [], selectedMachineId: 'machine-1', selectedPath: newSessionLayout ? '${newSessionProjectPath}' : '/work/project',
            selectedCommanderId: null, selectedAccountProjectId: undefined, agentType: modelPicker ? 'agy' : 'dsh', permissionMode: null,
            modelMode: newSessionLayout ? 'claude-sonnet-4-5' : modelPicker ? 'Gemini 3.6 Flash (High)' : null, effortLevel: null,
            sessionType: 'simple', worktreeKey: null,
        };
        for (const [setter, field] of Object.entries({
            setInput: 'input', setAttachments: 'attachments', setMachineId: 'selectedMachineId', setPath: 'selectedPath',
            setCommanderId: 'selectedCommanderId', setAccountProjectId: 'selectedAccountProjectId', setAgentType: 'agentType', setPermissionMode: 'permissionMode',
            setModelMode: 'modelMode', setEffortLevel: 'effortLevel', setSessionType: 'sessionType', setWorktreeKey: 'worktreeKey',
        })) {
            draft[setter] = (value) => {
                if (modelPicker && field === 'modelMode') {
                    globalThis.__MODEL_PICKER_DRAFT_MUTATIONS__ = [...(globalThis.__MODEL_PICKER_DRAFT_MUTATIONS__ ?? []), value];
                }
                if (draft[field] === value) return;
                draft[field] = value;
                listeners.forEach((listener) => listener());
            };
        }
        globalThis.__MODEL_PICKER_DRAFT__ = draft;
        export const useNewSessionDraft = (selector) => {
            const [, render] = React.useReducer((value) => value + 1, 0);
            React.useEffect(() => {
                listeners.add(render);
                return () => listeners.delete(render);
            }, []);
            return selector(draft);
        };
        useNewSessionDraft.getState = () => draft;
    `,
    '@/hooks/useImagePicker': `export const useImagePicker = () => ({
        addImages() {}, clearImages() {}, removeImage() {}, selectedImages: [],
        pickImages() { window.__ATTACHMENT_PICK_COUNT__ = (window.__ATTACHMENT_PICK_COUNT__ ?? 0) + 1; },
        async pickImagesForUpload() {
            return [{ id: 'fixture-photo', uri: 'file:///photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg', size: 123, width: 100, height: 80 }];
        },
    });`,
    '@/hooks/useMachineFileUpload': `export const useMachineFileUpload = (options) => ({
        canCancel: false, canRetry: false, cancel() {}, reset() {}, retry() {}, state: { phase: 'idle' },
        async uploadAssets(assets) {
            const paths = assets.map((asset) => (options.directory || '/work/project') + '/' + asset.name);
            paths.forEach((path) => options.onUploaded?.(path, {
                machineId: options.machineId,
                directory: options.directory,
                selectionKey: options.selectionKey,
            }));
            window.__MACHINE_UPLOADS__ = [...(window.__MACHINE_UPLOADS__ ?? []), ...paths];
            return paths;
        },
        async pickAndUpload() {
            const names = ['notes.txt', 'report.pdf', 'voice.m4a', 'archive.bin'];
            const paths = names.map((name) => (options.directory || '/work/project') + '/' + name);
            paths.forEach((path) => options.onUploaded?.(path, {
                machineId: options.machineId,
                directory: options.directory,
                selectionKey: options.selectionKey,
            }));
            window.__MACHINE_UPLOADS__ = [...(window.__MACHINE_UPLOADS__ ?? []), ...paths];
            return paths;
        },
    });`,
    '@/hooks/useVoiceDictation': `export const useVoiceDictation = () => ({
        canRetry: false, cancel() {}, error: null, phase: 'idle', retry() {},
        toggle() { window.__DICTATION_TOGGLE_COUNT__ = (window.__DICTATION_TOGGLE_COUNT__ ?? 0) + 1; },
    });`,
    '@/hooks/useVoiceInputAvailability': `export const useVoiceInputAvailability = () => {
        const available = globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.voiceAvailable === true;
        return { available, configured: available, enabled: available, loading: false };
    };`,
    '@/hooks/useWorktreeCleanup': `
        export const maybeCleanupWorktree = async (...args) => {
            window.__WORKTREE_CLEANUP_CALLS__ = [...(window.__WORKTREE_CLEANUP_CALLS__ ?? []), args];
        };
    `,
    '@/hooks/useNavigateToSession': `export const useNavigateToSession = () => (sessionId) => { window.__PROVIDER_CONTINUATION_NAVIGATED__ = sessionId; }; export const useSessionPressHandlers = (id) => ({onPress: () => { window.__PROVIDER_CONTINUATION_NAVIGATED__ = id; }, onPressIn() {}});`,
    '@/sync/agentSessionPlaces': `
        import * as actual from '${resolve(appRoot, 'sources/sync/agentSessionPlaces.ts')}';
        export const collectSessionPlaces = (options) => globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.newSessionLayout
            ? actual.collectSessionPlaces(options) : [];
        export const collectSessionWorkspaces = () => [];
        export const pairedMachineIds = actual.pairedMachineIds;
    `,
    '@/utils/worktree': `export const createWorktree = async () => ({ success: false, error: 'not used' }); export const listWorktrees = async () => [];`,
    '@/utils/pathUtils': `
        export const resolveAbsolutePath = (path, homeDir) => path === '~' ? (homeDir ?? path) : path.startsWith('~/') && homeDir ? homeDir.replace(/\\/$/, '') + '/' + path.slice(2) : path;
        export const resolvePath = (path, metadata) => metadata?.path && path.startsWith(metadata.path + '/') ? path.slice(metadata.path.length + 1) : path;
    `,
    '@/components/DuplicateSheet': `export const DuplicateSheet = () => null;`,
    '@/components/ShortcutHints': `export const SessionShortcutHintBadge = () => null; export const useShortcutHints = () => ({ visible: false, modifier: null, browserSafeShortcuts: true });`,
    '@/components/RigGitLineChanges': `export const RigGitLineChanges = () => null;`,
    '@/components/SessionStatusAvatar': `export const SessionStatusAvatar = () => null;`,
    '@/sync/messageMeta': `
        export class UnsupportedPermissionModeError extends Error {}
        export const resolveMessageModeMeta = () => ({});
    `,
    '@/utils/sessionFork': `export const getSessionForkSource = () => null;`,
    '@/utils/sessionResume': `
        export const getClaudeResumeModes = () => ({});
        export const getCodexResumeModes = () => ({});
        export const getDshResumeModes = () => ({});
        export const getGrokResumePermissionMode = () => undefined;
        export const getResumeAvailability = () => ({
            canResume: false, canShowResume: false, messageKey: null, subtitle: '', message: '',
        });
    `,
    '@/utils/copySessionMetadataToClipboard': `
        export const copySessionMetadataToClipboard = async () => false;
        export const copySessionMetadataAndLogsToClipboard = async () => false;
    `,
    '@/sync/gitStatusSync': `export const gitStatusSync = { getSync: () => ({ invalidate() {} }) };`,
    '@/sync/ops': `
        import { __applySessionModes } from '@/sync/storage';
        const deletedItems = new Set();
        export const machineControlHeartbeat = async () => {};
        export const machineBash = async () => ({ success: false, error: 'not used' });
        export const machineListCommanders = async () => ({ commanders: [] });
        export const machineResumeSession = async () => ({ type: 'error', errorMessage: 'not used' });
        export const forkAndSpawn = async () => ({ type: 'error', errorMessage: 'not used' });
        export const machineSpawnNewSession = async (options) => {
            window.__PROVIDER_CONTINUATION_SPAWN__ = options;
            return { type: 'success', sessionId: 'target-session' };
        };
        export const machineCreateSideChat = async () => {
            window.__SIDE_CHAT_CREATE_COUNT__ = (window.__SIDE_CHAT_CREATE_COUNT__ ?? 0) + 1;
            return { success: false, phases: [] };
        };
        export const machineGetDirectoryTree = async (_machineId, path) => {
            if (globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.workspaceDelete) {
                const children = [
                    { type: 'file', name: 'notes.md', path: path + '/notes.md', size: 12 },
                    { type: 'directory', name: 'reports', path: path + '/reports' },
                ].filter((entry) => !deletedItems.has(JSON.stringify([_machineId, entry.path])));
                return { success: true, tree: { type: 'directory', path, children } };
            }
            if (globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.newSessionLayout) return {
                success: true,
                tree: { type: 'directory', name: path.split('/').pop(), path, children: [
                    { type: 'directory', name: '.hidden', path: path + '/.hidden' },
                    ...Array.from({ length: 24 }, (_, index) => {
                        const name = 'folder-' + String(index).padStart(2, '0');
                        return { type: 'directory', name, path: path + '/' + name };
                    }),
                ] },
            };
            if (
                path === globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.deferDirectoryPath
                && !window.__BROWSER_DIRECTORY_DEFERRED__
            ) {
                window.__BROWSER_DIRECTORY_DEFERRED__ = true;
                await new Promise((resolve) => {
                    window.__RESOLVE_BROWSER_DIRECTORY__ = () => {
                        delete window.__RESOLVE_BROWSER_DIRECTORY__;
                        resolve();
                    };
                });
            }
            if (path === '/work/reports' || path === '/work/project/reports') return {
                success: true,
                tree: { type: 'directory', name: 'reports', path,
                    children: [{ type: 'file', name: 'report.md', path: path + '/report.md', size: 20 }] },
            };
            if (path === '/work/project' || path === '/work/child-oldest' || path === '/work/child-newest') {
                const fileName = path === '/work/project'
                    ? 'machine-file.md'
                    : path.split('/').pop() + '-machine-file.md';
                return {
                    success: true,
                    tree: {
                        type: 'directory', name: path.split('/').pop(), path,
                        children: [
                            { type: 'file', name: fileName, path: path + '/' + fileName, size: 12 },
                            ...(path === '/work/project' && globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.deferDirectoryPath
                                ? [{ type: 'directory', name: 'reports', path: '/work/project/reports' }]
                                : []),
                        ],
                    },
                };
            }
            window.__FILE_TREE_COUNT__ = (window.__FILE_TREE_COUNT__ ?? 0) + 1;
            const response = {
                success: true,
                tree: { type: 'file', name: path.split('/').pop() || path, path },
            };
            if (
                path === '/work/project/session-note.md'
                && globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.deferSamePathProbe
                && !window.__SAME_PATH_PROBE_DEFERRED__
            ) {
                window.__SAME_PATH_PROBE_DEFERRED__ = true;
                return new Promise((resolve) => {
                    window.__RESOLVE_SAME_PATH_PROBE__ = () => {
                        delete window.__RESOLVE_SAME_PATH_PROBE__;
                        resolve(response);
                    };
                });
            }
            return response;
        };
        export const machineCreateDirectory = async (machineId, options) => {
            if (!globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.deferCreateDirectory) return { success: false, error: 'not used' };
            window.__MACHINE_CREATE_DIRECTORY_CALL__ = { machineId, ...options };
            return new Promise((resolve) => {
                window.__RESOLVE_CREATE_DIRECTORY__ = () => {
                    delete window.__RESOLVE_CREATE_DIRECTORY__;
                    resolve({ success: true, path: options.directory + '/' + options.directoryName });
                };
            });
        };
        export const machineDeleteFile = async (machineId, path) => {
            window.__MACHINE_DELETE_CALLS__ = [...(window.__MACHINE_DELETE_CALLS__ ?? []), { machineId, path }];
            deletedItems.add(JSON.stringify([machineId, path]));
            return { success: true };
        };
        export const machineDeleteDirectory = async (machineId, path) => {
            window.__MACHINE_DELETE_CALLS__ = [...(window.__MACHINE_DELETE_CALLS__ ?? []), { machineId, path, recursive: true }];
            deletedItems.add(JSON.stringify([machineId, path]));
            return { success: true };
        };
        export const machineReadFile = async (machineId, path) => {
            window.__MACHINE_READ_CALLS__ = [...(window.__MACHINE_READ_CALLS__ ?? []), { machineId, path }];
            return { success: true, content: btoa('# Outside file\\nMachine transport') };
        };
        export const machineReadFileWithinRoot = async () => ({ success: false });
        export const machineWriteFile = async (machineId, path, content, expectedHash) => {
            window.__MACHINE_WRITE_CALLS__ = [...(window.__MACHINE_WRITE_CALLS__ ?? []), { machineId, path, content, expectedHash }];
            return { success: true, hash: 'hash' };
        };
        export const machineStopSession = async () => {};
        export const sessionAbort = async () => {};
        export const sessionAllow = async () => {};
        export const sessionDeny = async () => {};
        export const sessionAnswerQuestion = async () => {};
        export const sessionCancelCommunication = async () => {};
        export const sessionGoalAction = async () => {};
        export const sessionSetAgentModes = async (sessionId, patch) => {
            window.__SESSION_MODE_MUTATIONS__ = [...(window.__SESSION_MODE_MUTATIONS__ ?? []), { sessionId, patch }];
            if (globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.modelPicker) __applySessionModes(sessionId, patch);
        };
        export const sessionKill = async (sessionId) => {
            const calls = window.__SESSION_KILL_CALLS__ = [...(window.__SESSION_KILL_CALLS__ ?? []), sessionId];
            const results = globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.botArchiveResults ?? [];
            const accepted = results[calls.length - 1] ?? true;
            return accepted
                ? { success: true, message: 'accepted by owning machine' }
                : { success: false, message: '' };
        };
        export const sessionArchive = async (sessionId) => {
            window.__SESSION_ARCHIVE_CALLS__ = [...(window.__SESSION_ARCHIVE_CALLS__ ?? []), sessionId];
            return { success: true };
        };
        export const sessionDelete = async (sessionId) => {
            window.__SESSION_DELETE_CALLS__ = [...(window.__SESSION_DELETE_CALLS__ ?? []), sessionId];
            return { success: true };
        };
        export const sessionReadFile = async (sessionId, path) => {
            window.__SESSION_READ_CALLS__ = [...(window.__SESSION_READ_CALLS__ ?? []), { sessionId, path }];
            return path.startsWith('/outside/')
                ? { success: false, error: 'fixture session cwd rejection' }
                : { success: true, content: btoa('const mobile = true;') };
        };
        export const sessionWriteFile = async (sessionId, path) => {
            window.__SESSION_WRITE_CALLS__ = [...(window.__SESSION_WRITE_CALLS__ ?? []), { sessionId, path }];
            return { success: true, hash: 'saved-hash' };
        };
        export const sessionDeleteFile = async (sessionId, path) => {
            window.__SESSION_DELETE_CALLS__ = [...(window.__SESSION_DELETE_CALLS__ ?? []), { sessionId, path }];
            return { success: true };
        };
        export const sessionBash = async () => ({ success: true, stdout: '' });
    `,
    '@/sync/sideChatLifecycle': `export const closeSideChatSession = async () => {}; export const resolveSideChatCloseReconciliation = () => ({ error: null, restoreTab: false });`,
    '@/sync/attachmentSupport': `export const supportsImageAttachmentsForFlavor = (flavor) => flavor !== 'dsh' && globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.imageAttachments === true;`,
    // New Session's Streamline mode is covered by herd/newSession/streamline.browser.test.ts;
    // these flows exercise the Advanced form.
    '@/sync/streamlineDefaults': `
        export const STREAMLINE_CODE_DEFAULTS = {};
        export const normalizeStreamlineAgent = (agent) => agent ?? 'claude';
        export const resolveStreamlineSelection = () => ({ permissionMode: null, modelMode: null, effortLevel: null });
    `,
    '@/sync/githubRepository': `export const useGithubRepository = () => ({ status: 'unknown', loading: false }); export const detectGithubRepository = async () => 'unknown';`,
    '@/hooks/useStreamlineLocations': `export const useStreamlineLocations = () => [];`,
    '@/sync/agentDefaults': `
        import * as actual from '${resolve(appRoot, 'sources/sync/agentDefaults.ts')}';
        const realDefaults = globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.agentSettings === true;
        export const agentKeys = actual.agentKeys;
        export const hasAgentDefaultOverride = actual.hasAgentDefaultOverride;
        export const getCodeAgentDefaults = (...args) => realDefaults ? actual.getCodeAgentDefaults(...args) : ({ permissionMode: 'default', modelMode: 'default', effortLevel: null });
        export const getAgentDefaultOverrideValue = (...args) => realDefaults ? actual.getAgentDefaultOverrideValue(...args) : undefined;
        export const resolveAgentDefaultConfig = (...args) => realDefaults ? actual.resolveAgentDefaultConfig(...args) : ({ modelMode: undefined, permissionMode: undefined });
        export const resolveAgentDefaultEffortLevel = (...args) => realDefaults ? actual.resolveAgentDefaultEffortLevel(...args) : undefined;
        export const setAgentDefaultOverride = (...args) => realDefaults ? actual.setAgentDefaultOverride(...args) : args[0];
    `,
    '@/sync/rig': `
        export { qualifyRigModelKey } from '${resolve(appRoot, 'sources/sync/rig.ts')}';
        export const getRigGitSummary = () => null; export const getRigReasoningSelection = () => undefined;
        export const getRigIdentity = () => null;
        export const getProviderIconKind = () => 'codex'; export const usesControlledSessionUi = () => false;
        export const isRigMetadata = (metadata) => Boolean(metadata?.bot); export const isRigModelSelectionEnabled = () => globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.modelPicker === true;
        export const isRigMetadataV1 = () => false; export const getRigCurrentModel = () => null;
        export const getRigModels = () => []; export const getRigReasoningLevels = () => []; export const getRigSelectedModelKey = () => null;
        export const isRigPermissionSelectionEnabled = () => true; export const isRigReasoningSelectionEnabled = () => false;
        export const rigCanAbort = () => false; export const rigCanBrowseFiles = () => true;
        export const rigCanReadFiles = () => false;
        export const rigCanUseAttachments = () => globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.imageAttachments === true;
        export const rigCanUseShell = () => true;
        export const rigCanWriteFiles = () => true; export const sessionCanDeleteFiles = () => true;
    `,
    '@/sync/workspaceContext': `
        const entriesBySession = new Map();
        const listeners = new Set();
        const emit = () => listeners.forEach((listener) => listener());
        const entriesFor = (sessionId) => {
            if (!entriesBySession.has(sessionId)) entriesBySession.set(sessionId, []);
            return entriesBySession.get(sessionId);
        };
        export const MAX_WORKSPACE_CONTEXT_ITEMS = 8;
        export const addWorkspaceContextFile = (sessionId, path, source = { kind: 'session' }) => addWorkspaceContextEntry(sessionId, { path, kind: 'file', source });
        export const addWorkspaceContextEntry = (sessionId, entry) => {
            entriesBySession.set(sessionId, [...entriesFor(sessionId), entry]);
            window.__WORKSPACE_CONTEXT_CALLS__ = [...(window.__WORKSPACE_CONTEXT_CALLS__ ?? []), { sessionId, entry }];
            emit();
            return true;
        };
        export const buildWorkspaceContextMessage = async (_id, text, entries = []) => {
            if (entries.length === 0) return { displayText: text, promptText: text };
            const paths = entries.map((entry) => entry.path);
            return {
                displayText: ('Attached exact paths: ' + paths.join(', ') + '\\n\\n' + text).trim(),
                promptText: (text + '\\n\\nUse exact host paths:\\n' + paths.join('\\n')).trim(),
            };
        };
        export const workspaceContextEntryKey = (entry) => JSON.stringify(entry.source.kind === 'machine'
            ? ['machine', entry.source.machineId, entry.path]
            : ['session', entry.path]);
        export const clearWorkspaceContextFiles = (sessionId) => { entriesBySession.set(sessionId, []); emit(); };
        export const getWorkspaceContextEntries = (sessionId) => entriesFor(sessionId);
        export const removeWorkspaceContextEntry = (sessionId, entryOrPath) => {
            entriesBySession.set(sessionId, entriesFor(sessionId).filter((entry) => (
                typeof entryOrPath === 'string'
                    ? entry.path !== entryOrPath
                    : workspaceContextEntryKey(entry) !== workspaceContextEntryKey(entryOrPath)
            )));
        };
        export const subscribeWorkspaceContext = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
    `,
    '@/sync/queueProjection': `
        export const projectSessionQueue = (messages) => ({
            pendingItems: [], currentItems: [], pendingCount: 0, currentCount: 0,
            transcriptMessages: messages,
        });
    `,
    '@/sync/grokPermissionModeTransition': `export const transitionGrokPermissionModeAndCommit = async () => {};`,
    '@/utils/sessionStatusBar': `
        export const formatUsageLimitResetTime = () => '';
        export const getUsageLimitDisplayPercentage = (value) => value;
        export const getUsageLimitRows = () => [];
        export const resolveStatusBarGitBranch = () => null;
    `,
    '@/utils/rigGitLineChanges': `
        export const compactCount = (value) => String(value);
        export const visibleRigGitLineChanges = () => null;
    `,
    '@/utils/sessionUtils': `
        export const formatOSPlatform = (value) => value; export const formatPathRelativeToHome = (path) => path; export const formatLastSeen = () => '';
        export const getResumeCommand = () => null; export const getResumeCommandBlock = () => null;
        export const getSessionAvatarId = (session) => session.id; export const getSessionName = (session) => session.metadata?.summary?.text ?? session.id;
        export const useSessionStatus = (session) => ({ isConnected: session.active, isPulsing: false, state: session.active ? 'waiting' : 'disconnected', statusColor: '#111', statusDotColor: '#111', statusText: session.active ? 'online' : 'offline' });
    `,
    '@/utils/versionUtils': `export { compareVersionsWithPrerelease, isWellFormedVersion } from '${resolve(appRoot, 'sources/utils/versionUtils.ts')}'; export const MINIMUM_CLI_VERSION = '0.0.0'; export const isVersionSupported = () => true;`,
    '@/utils/heartbeatCommand': `
        export const HEARTBEAT_COMMAND = { dispatch: async () => ({ handled: false }) };
        export const formatHeartbeatStatusPresentation = () => ({ summary: '', details: [] });
    `,
    '@/utils/sessionContinuation': `export const deliverSessionTurn = async (options) => options.deliver({
        deliveryMode: options.requestedDeliveryMode,
        awaitDelivery: options.awaitDelivery,
    });`,
    '@/-session/sessionOverlayNav': `export const useOverlayNav = { getState: () => ({ publish() {}, reset() {} }) };`,
    '@/-session/agentGoalActionHandler': `export const performAgentGoalAction = async () => {};`,
    '@/-session/workspaceLinkNavigation': `
        import React from 'react';
        export const WorkspaceLinkPressContext = React.createContext(undefined);
        export const useWorkspaceLinkPress = () => React.useContext(WorkspaceLinkPressContext);
        export const dismissWorkspaceLinkToOrigin = () => undefined;
        export const useWorkspaceLinkDismissGuard = () => ({
            onSendingChange() {}, onDirtyChange() {}, guardDismiss: (action) => action(),
        });
    `,
    '@/utils/openExternalUrl': `
        export const openExternalUrl = async (url) => {
            window.__EXTERNAL_LINKS__ = [...(window.__EXTERNAL_LINKS__ ?? []), url];
        };
    `,
    '@/sync/apiSocket': `
        export const apiSocket = {
            machineRPC: async (machineId, method, request) => {
                if (method === 'session-context-window') {
                    globalThis.__CONTEXT_WINDOW_RPCS__ = [...(globalThis.__CONTEXT_WINDOW_RPCS__ ?? []), { machineId, method, request }];
                    return fetch('/fixture-context-window', { method: 'POST', body: JSON.stringify(request) }).then((response) => response.json());
                }
                window.__LOCALHOST_LINK_RPCS__ = [...(window.__LOCALHOST_LINK_RPCS__ ?? []), { machineId, method, url: request.url }];
                const pathname = new URL(request.url).pathname;
                if (method !== 'workspace-live-fetch' || !['machine-1', 'machine-newest'].includes(machineId)) {
                    return { success: false, code: 'request-failed', error: 'Unexpected fixture machine' };
                }
                const body = pathname === '/state'
                    ? 'Live from ' + machineId
                    : '<!doctype html><html><body><button id="live-target">Waiting</button><script>fetch("/state").then(r=>r.text()).then(t=>document.getElementById("live-target").textContent=t)</script></body></html>';
                return { success: true, status: 200, statusText: 'OK',
                    headers: { 'content-type': pathname === '/state' ? 'text/plain' : 'text/html; charset=utf-8' },
                    body: btoa(body), finalUrl: request.url };
            },
        };
    `,
    'expo-clipboard': `export const setStringAsync = async () => {};`,
};

const fixturePlugin: Plugin = {
    name: 'side-chat-browser-fixture',
    setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
            // Match Metro's web platform resolution for FlashList's DOM measurement code.
            if (args.resolveDir.includes('/@shopify/flash-list/') && args.path.startsWith('.')) {
                const webPath = resolve(args.resolveDir, args.path + '.web.js');
                if (existsSync(webPath)) return { path: webPath };
            }
            if (args.path in virtualModules) return { path: args.path, namespace: 'fixture-stub' };
            if (args.path.startsWith('.') && args.resolveDir.startsWith(resolve(appRoot, 'sources'))) {
                const key = '@/' + relative(resolve(appRoot, 'sources'), resolve(args.resolveDir, args.path)).replace(/\.(?:tsx?|jsx?)$/, '');
                if (key in virtualModules) return { path: key, namespace: 'fixture-stub' };
            }
            if (args.path === './apiSocket' && args.importer.endsWith('/sync/workspaceLive.ts')) {
                return { path: '@/sync/apiSocket', namespace: 'fixture-stub' };
            }
            if (args.path === '@/components/LocalhostLiveView') {
                return { path: resolve(appRoot, 'sources/components/LocalhostLiveView.web.tsx') };
            }
            if (args.path === './markdown/MarkdownView') {
                return { path: resolve(appRoot, 'sources/components/markdown/MarkdownView.web.tsx') };
            }
            if (args.path === './MobileGlass') return { path: '@/components/MobileGlass', namespace: 'fixture-stub' };
            if (args.path === './BubblePressable') return { path: '@/components/BubblePressable', namespace: 'fixture-stub' };
            if (args.path === './modelModeOptions') return { path: '@/components/modelModeOptions', namespace: 'fixture-stub' };
            if (args.path === './NativeOptionsPicker') return { path: '@/components/NativeOptionsPicker', namespace: 'fixture-stub' };
            if (args.path === './navigation/MobileHeaderScrim') return { path: '@/components/navigation/MobileHeaderScrim', namespace: 'fixture-stub' };
            if (args.path === './AnimatedOverlay') return { path: '@/components/AnimatedOverlay', namespace: 'fixture-stub' };
            if (args.path === './ShortcutHints') return { path: '@/components/ShortcutHints', namespace: 'fixture-stub' };
            if (args.path === './RigGitLineChanges') return { path: '@/components/RigGitLineChanges', namespace: 'fixture-stub' };
            if (args.path === './SessionStatusAvatar') return { path: '@/components/SessionStatusAvatar', namespace: 'fixture-stub' };
            if (args.path === './workspaceLinkNavigation') return { path: '@/-session/workspaceLinkNavigation', namespace: 'fixture-stub' };
            if (args.path === './agentGoalActionHandler') return { path: '@/-session/agentGoalActionHandler', namespace: 'fixture-stub' };
            if (args.path === './MultiTextInput') {
                return { path: resolve(appRoot, 'sources/components/MultiTextInput.web.tsx') };
            }
            if (args.path === './NativeSettingsMenu') {
                return { path: resolve(appRoot, 'sources/components/NativeSettingsMenu.web.tsx') };
            }
            if (args.path === './haptics') {
                return { path: resolve(appRoot, 'sources/components/haptics.web.ts') };
            }
            if (args.path === '@/components/CodeEditor') {
                return { path: resolve(appRoot, 'sources/components/CodeEditor.web.tsx') };
            }
            if (args.path === '@/components/markdown/MarkdownView' || args.path === '@/components/InlineCommentReview') {
                return { path: resolve(appRoot, 'sources', args.path.slice(2) + '.web.tsx') };
            }
            if (args.path.startsWith('@/')) {
                const sourcePath = resolve(appRoot, 'sources', args.path.slice(2));
                const path = [`${sourcePath}.web.tsx`, `${sourcePath}.web.ts`, sourcePath, `${sourcePath}.ts`, `${sourcePath}.tsx`, `${sourcePath}/index.web.tsx`, `${sourcePath}/index.ts`, `${sourcePath}/index.tsx`].find((path) => existsSync(path) && statSync(path).isFile());
                if (!path) throw new Error(`missing fixture source: ${args.path}`);
                return { path };
            }
            return null;
        });
        build.onLoad({ filter: /.*/, namespace: 'fixture-stub' }, (args) => ({
            contents: virtualModules[args.path],
            loader: 'tsx',
            resolveDir: appRoot,
        }));
    },
};

async function swipeUp(page: Page, x: number, startY: number, endY: number) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x, y: startY }],
    });
    for (let step = 1; step <= 8; step += 1) {
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x, y: startY + (endY - startY) * step / 8 }],
        });
        await page.waitForTimeout(16);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
}

async function expectUntruncatedText(locator: Locator, fontSize: string | null = '16px') {
    const dimensions = await locator.evaluate((element) => ({
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
        fontSize: getComputedStyle(element).fontSize,
    }));
    expect(dimensions.width).toBeGreaterThan(0);
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
    if (fontSize) expect(dimensions.fontSize).toBe(fontSize);
}

async function touchToEnd(page: Page, scrollRegion: Locator, finalRow: Locator) {
    await finalRow.waitFor({ state: 'attached' });
    const box = await scrollRegion.boundingBox();
    const initialRowBox = await finalRow.boundingBox();
    if (!box || !initialRowBox) throw new Error('New Session list has no visible geometry');
    expect(initialRowBox.y).toBeGreaterThan(box.y + box.height);
    const outerScrollBefore = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
    const startY = Math.min(box.y + box.height - 12, 800);
    const endY = Math.max(box.y + 12, 40);
    expect(startY - endY).toBeGreaterThan(60);
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const atEnd = await scrollRegion.evaluate((element) => (
            element.scrollTop + element.clientHeight >= element.scrollHeight - 2
        ));
        if (atEnd) {
            const finalBox = await finalRow.boundingBox();
            if (!finalBox) throw new Error('Final New Session row has no geometry');
            expect(finalBox.y).toBeGreaterThanOrEqual(box.y - 1);
            expect(finalBox.y + finalBox.height).toBeLessThanOrEqual(box.y + box.height + 1);
            await expect(page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).resolves.toBe(outerScrollBefore);
            return;
        }
        await swipeUp(page, box.x + box.width / 2, startY, endY);
    }
    throw new Error('Touch gestures did not reach the final New Session list row');
}

async function tapVisibleRow(page: Page, row: Locator) {
    const box = await row.boundingBox();
    if (!box) throw new Error('New Session row has no visible geometry');
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    // Coordinate taps cannot silently scroll an offscreen row into view.
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

describe('Side chats browser interaction', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            entryPoints: [resolve(here, '__testdata__/sideChatHeader.browser.fixture.tsx')],
            outfile: resolve(appRoot, 'fixture-output/side-chat.js'),
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
            sourcemap: 'linked',
            define: {
                __DEV__: 'false',
                'process.env.EXPO_OS': '"web"',
                'process.env.NODE_ENV': '"test"',
            },
            jsx: 'automatic',
            loader: { '.png': 'dataurl' },
            plugins: [fixturePlugin],
        });
        // Keep debug maps available without transferring/parsing them as part
        // of every document. Reuse response bytes across the isolated pages.
        const script = Buffer.from(bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.contents);
        const scriptMap = Buffer.from(bundle.outputFiles.find((file) => file.path.endsWith('.js.map'))!.contents);
        const cssFile = bundle.outputFiles.find((file) => file.path.endsWith('.css'));
        const css = cssFile ? Buffer.from(cssFile.contents) : Buffer.alloc(0);
        const cssMapFile = bundle.outputFiles.find((file) => file.path.endsWith('.css.map'));
        const cssMap = cssMapFile ? Buffer.from(cssMapFile.contents) : null;
        const serviceWorker = readFileSync(resolve(appRoot, 'public/workspace-live-sw.js'));
        const html = Buffer.from('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>html,body,#root{height:100%;margin:0}</style><main id="root"></main><script>globalThis.global=globalThis;if((globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.accountProject||globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.contextWindow || globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.commanderContext)){const s=document.createElement("style");s.textContent="@font-face{font-family:ionicons;src:url(/fonts/Ionicons.ttf)}@font-face{font-family:octicons;src:url(/fonts/Octicons.ttf)}@font-face{font-family:SpaceGrotesk-Regular;src:url(/fonts/SpaceGrotesk-Regular.ttf)}@font-face{font-family:SpaceGrotesk-SemiBold;src:url(/fonts/SpaceGrotesk-SemiBold.ttf)}@font-face{font-family:JetBrainsMono-Regular;src:url(/fonts/JetBrainsMono-Regular.ttf)}@font-face{font-family:JetBrainsMono-SemiBold;src:url(/fonts/JetBrainsMono-SemiBold.ttf)}";document.head.append(s);}</script><script src="/side-chat.js"></script>');
        server = createServer((_request, response) => {
            if (_request.url === '/fonts/Ionicons.ttf' || _request.url === '/fonts/Octicons.ttf') {
                response.setHeader('content-type', 'font/ttf');
                response.end(readFileSync(resolve(appRoot, '../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts', _request.url.slice('/fonts/'.length))));
                return;
            }
            if (/^\/fonts\/(SpaceGrotesk-(Regular|SemiBold)|JetBrainsMono-(Regular|SemiBold))\.ttf$/.test(_request.url ?? '')) {
                response.setHeader('content-type', 'font/ttf');
                response.end(readFileSync(resolve(appRoot, 'sources/assets', _request.url!.slice(1))));
                return;
            }
            if (_request.url === '/side-chat.js') {
                response.setHeader('content-type', 'text/javascript; charset=utf-8');
                response.end(script);
                return;
            }
            if (_request.url === '/side-chat.js.map' || (_request.url === '/side-chat.css.map' && cssMap)) {
                response.setHeader('content-type', 'application/json; charset=utf-8');
                response.end(_request.url === '/side-chat.js.map' ? scriptMap : cssMap);
                return;
            }
            if (_request.url === '/fixture.css') {
                response.setHeader('content-type', 'text/css; charset=utf-8');
                response.end(css);
                return;
            }
            if (_request.url === '/workspace-live-sw.js') {
                response.setHeader('content-type', 'text/javascript; charset=utf-8');
                response.setHeader('service-worker-allowed', '/');
                response.end(serviceWorker);
                return;
            }
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(html);
        });
        await new Promise<void>((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('browser fixture did not bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        try {
            browser = await chromium.launch({
                ...(executablePath ? { executablePath } : { channel: 'chrome' }),
                headless: true,
                args: process.platform === 'linux' ? ['--no-sandbox'] : [],
            });
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new Error(
                'Side chat browser tests require an installed Google Chrome. '
                + 'Set HAPPYHERD_BROWSER_EXECUTABLE to override browser discovery. '
                + detail,
            );
        }
    }, 30_000);

    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
    }, 30_000);

    it.each([1440, 390].flatMap(width => ['light', 'dark'].flatMap(theme => [false, true].map(populated => ({ width, theme, populated })))) )('shows Commander context at the top of SessionView (populated: $populated) at $width px in $theme mode', async ({ width, theme, populated }) => {
        const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } });
        page.setDefaultTimeout(5_000);
        await page.addInitScript((populated) => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { commanderContext: true, commanderContextPopulated: populated };
            (globalThis as any).__HAPPYHERD_ROUTE_PUSH__ = (href: string) => { (window as any).__COMMANDER_ROUTE__ = href; };
        }, populated);
        await page.goto(origin + '?theme=' + theme);
        const host = page.getByTestId('foreground-session');
        const row = host.getByTestId('commander-context-row');
        await row.waitFor({ state: 'visible' });
        expect(await row.count()).toBe(1);
        expect(await row.getByTestId('commander-context-file').count()).toBe(4);
        const rowBox = (await row.boundingBox())!;
        expect(rowBox.y).toBeGreaterThanOrEqual(64);
        const nextBox = (await host.getByText(populated ? 'Visible browser context' : 'No messages yet', { exact: true }).boundingBox())!;
        expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(nextBox.y);
        for (const chip of await row.getByTestId('commander-context-file').all()) {
            const box = (await chip.boundingBox())!;
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(width);
        }
        await page.evaluate(() => document.fonts.ready);
        const evidence = process.env.HAPPYHERD_COMMANDER_CONTEXT_SCREENSHOT_DIR;
        if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: resolve(evidence, `commander-context-${populated ? 'session' : 'empty'}-${width}-${theme}.png`) }); }
        await row.getByRole('link', { name: 'View Athena in Commanders' }).click();
        expect(await page.evaluate(() => (window as any).__COMMANDER_ROUTE__)).toBe('/commanders');
        await page.reload();
        await row.waitFor({ state: 'visible' });
        expect(await row.getByTestId('commander-context-file').count()).toBe(4);
        await page.close();
    });

    it.each([1440, 390].flatMap((width) => ['light', 'dark'].flatMap((theme) =>
        (['completed', 'failed', 'cancelled'] as const).map((status) => ({ width, theme, status })),
    )))('keeps a background child Running then shows its true $status outcome through Side chats at $width px in $theme mode', async ({ width, theme, status }) => {
        const fixture = subagentLifecycleFixture(Date.now() - 5_000);
        const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } });
        page.setDefaultTimeout(5_000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const screenshotDirectory = process.env.HAPPYHERD_SUBAGENT_SCREENSHOT_DIR?.trim();
        await page.addInitScript((messages) => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { subagentLifecycle: messages };
        }, replaySubagentRecords(fixture.running).reverse());
        const foreground = page.getByTestId('foreground-session');
        const header = foreground.getByTestId('tool-card-header').filter({ hasText: 'Background review' });
        const card = header.locator('..');
        const openSideChats = async () => {
            await foreground.getByRole('button', { name: 'Open side chats (2)', exact: true }).click();
            await header.waitFor({ state: 'visible' });
        };
        const assertOutcome = async (outcome: string) => {
            await expect.poll(() => header.innerText()).toContain(`Background review ${outcome}`);
            const statusText = header.getByText(`Background review ${outcome}`, { exact: true });
            await statusText.waitFor({ state: 'visible' });
            await expectUntruncatedText(statusText, null);
            await card.getByText(outcome.toUpperCase(), { exact: true }).waitFor({ state: 'visible' });
            expect(await card.getByText('3 events', { exact: true }).isVisible()).toBe(true);
            const sibling = foreground.getByTestId('tool-card-header').filter({ hasText: 'Other child' });
            expect(await sibling.innerText()).toContain('Other child running');
            if (outcome !== 'completed') expect(await card.getByText('COMPLETED', { exact: true }).count()).toBe(0);
        };
        const assertActivity = async () => {
            await card.getByRole('button', { name: 'Expand sub-agent activity', exact: true }).click();
            await card.getByText('Still working after the parent turn', { exact: true }).waitFor({ state: 'visible' });
            expect(await card.getByText('Inspect child source', { exact: true }).isVisible()).toBe(true);
        };
        try {
            await page.goto(origin + '?theme=' + theme);
            await openSideChats();
            await assertOutcome('running');
            await assertActivity();
            if (screenshotDirectory && status === 'completed') {
                mkdirSync(screenshotDirectory, { recursive: true });
                await page.screenshot({ path: resolve(screenshotDirectory, `subagent-running-${theme}-${width}.png`) });
            }
            // Close/reopen via the production panel gesture, preserving the running child.
            await (width === 390
                ? foreground.getByTestId('files-sidebar-hide')
                : foreground.getByRole('button', { name: 'Collapse side chats', exact: true })).click();
            await openSideChats();
            await assertOutcome('running');
            const finalMessages = replaySubagentRecords([...fixture.running, fixture.terminal(status)]).reverse();
            await page.evaluate((messages) => (globalThis as any).__APPLY_SUBAGENT_MESSAGES__(messages), finalMessages);
            await assertOutcome(status);
            await assertActivity();
            if (screenshotDirectory) {
                mkdirSync(screenshotDirectory, { recursive: true });
                await card.screenshot({ path: resolve(screenshotDirectory, `subagent-${status}-${theme}-${width}.png`) });
            }
            await page.reload();
            await openSideChats();
            await assertOutcome(status);
            await assertActivity();
            expect(await page.evaluate(() => (globalThis as any).__SIDE_CHAT_CREATE_COUNT__ ?? 0)).toBe(0);
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    }, 25_000);

    it.each([1440, 390].flatMap((width) => ['light', 'dark'].flatMap((theme) =>
        (['claude', 'codex'] as const).map((provider) => ({ width, theme, provider })),
    )))('Context window switch → header menu → full $provider trace at $width px in $theme mode', async ({ width, theme, provider }) => {
        const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 900 : 844 } });
        page.setDefaultTimeout(5_000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript((provider) => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { contextWindow: { provider } };
        }, provider);
        const reply = contextWindowReply(provider);
        await page.route('**/fixture-context-window', (route) => route.fulfill({ json: reply }));
        const screenshotDirectory = process.env.HAPPYHERD_CONTEXT_WINDOW_SCREENSHOT_DIR?.trim();
        const capture = async (phase: string) => {
            if (!screenshotDirectory) return;
            mkdirSync(screenshotDirectory, { recursive: true });
            await page.screenshot({ path: resolve(screenshotDirectory, `${provider}-${width}-${theme}-${phase}.png`) });
        };
        try {
            await page.goto(`${origin}/session/parent?theme=${theme}`);
            await page.getByTestId('session-header-menu').click();
            const menu = page.getByTestId('session-actions-menu');
            await menu.waitFor();
            expect(await menu.getByRole('button', { name: /Context window/ }).count()).toBe(0);
            expect(await page.evaluate(() => (globalThis as any).__CONTEXT_WINDOW_RPCS__ ?? [])).toEqual([]);
            // Features is the requested start surface; reopening SessionView reads the saved account setting.
            await page.goto(`${origin}/settings/features?theme=${theme}`);
            const toggle = page.getByRole('switch', { name: 'Context window', exact: true });
            expect(await toggle.isChecked()).toBe(false);
            await toggle.click();
            await expect.poll(() => toggle.isChecked()).toBe(true);
            expect(await page.evaluate(() => localStorage.getItem('context-window-enabled'))).toBe('true');
            await capture('switch');
            await page.goto(`${origin}/session/parent?theme=${theme}`);
            await page.getByTestId('session-header-menu').click();
            await menu.getByRole('button', { name: /Context window/ }).waitFor();
            await capture('entry');
            await menu.getByRole('button', { name: /Context window/ }).click();
            await expect.poll(() => new URL(page.url()).pathname).toBe('/session/parent/context');
            await page.getByText(`${reply.entries.length} recorded entries`, { exact: true }).waitFor();
            expect(await page.getByRole('heading', { name: /^[0-9]+\. / }).allTextContents()).toEqual(reply.entries.map((entry, index) => `${index + 1}. ${entry.kind}`));
            if (provider === 'claude') {
                await page.getByText('Claude Code’s built-in system prompt is not recorded in this transcript.', { exact: true }).waitFor();
                await page.getByText('Claude Code’s built-in tool definitions are not recorded in this transcript.', { exact: true }).waitFor();
            } else {
                await page.getByText(reply.entries[0].content, { exact: true }).waitFor();
            }
            await capture('open');
            for (const entry of reply.entries) {
                const content = page.getByText(entry.content, { exact: true });
                await content.scrollIntoViewIfNeeded();
                expect(await content.textContent()).toBe(entry.content);
                await expectUntruncatedText(content);
            }
            await capture('read-final');
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
            expect(await page.evaluate(() => (globalThis as any).__CONTEXT_WINDOW_RPCS__)).toEqual([{
                machineId: 'machine-1', method: 'session-context-window', request: {
                    provider, directory: '/work/project',
                    ...(provider === 'claude' ? { claudeSessionId: 'claude-parent' } : { codexThreadId: 'thread-parent', codexHome: '/work/provider-state/codex' }),
                },
            }]);
            await page.goBack();
            await page.getByTestId('session-header-menu').click();
            await menu.getByRole('button', { name: /Context window/ }).click();
            await page.getByText(`${reply.entries.length} recorded entries`, { exact: true }).waitFor();
            await page.getByRole('button', { name: 'Refresh', exact: true }).click();
            await expect.poll(() => page.evaluate(() => (globalThis as any).__CONTEXT_WINDOW_RPCS__?.length)).toBe(3);
            expect(errors).toEqual([]);
        } finally { await page.close(); }
    }, 30_000);

    it.each([1440, 390])('Context window direct route stays unread while disabled at %s px', async (width) => {
        const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 900 : 844 } });
        await page.addInitScript(() => { (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { contextWindow: { provider: 'claude' } }; });
        try {
            await page.goto(`${origin}/session/parent/context`);
            await page.getByText('Enable Context window in Settings → Features → Experimental to read this session’s recorded context.', { exact: true }).waitFor();
            expect(await page.getByRole('button', { name: 'Retry', exact: true }).count()).toBe(0);
            expect(await page.evaluate(() => (globalThis as any).__CONTEXT_WINDOW_RPCS__ ?? [])).toEqual([]);
        } finally { await page.close(); }
    });

    it.each([1440, 390].flatMap((width) => ['offline', 'missing', 'unsupported'].map((failure) => ({ width, failure }))))(
        'Context window $failure is visible and retryable at $width px', async ({ width, failure }) => {
            const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 900 : 844 } });
            page.setDefaultTimeout(5_000);
            await page.addInitScript((failure) => {
                (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { contextWindow: { provider: failure === 'unsupported' ? 'dsh' : 'claude', failure } };
                localStorage.setItem('context-window-enabled', 'true');
            }, failure);
            let attempts = 0;
            await page.route('**/fixture-context-window', (route) => {
                attempts++;
                return route.fulfill({ json: attempts === 1 ? { type: 'error', reason: 'missing' } : contextWindowReply('claude') });
            });
            try {
                await page.goto(`${origin}/session/parent`);
                await page.getByTestId('session-header-menu').click();
                await page.getByTestId('session-actions-menu').getByRole('button', { name: /Context window/ }).click();
                const message = failure === 'offline' ? 'The session’s machine is offline or unavailable. Reconnect it and retry.'
                    : failure === 'unsupported' ? 'This provider’s context window is not supported yet.'
                        : 'The provider transcript or session identity is missing on this machine.';
                await page.getByRole('alert').getByText(message, { exact: true }).waitFor();
                await page.getByRole('button', { name: 'Retry', exact: true }).click();
                if (failure === 'missing') {
                    await page.getByText('7 recorded entries', { exact: true }).waitFor();
                    expect(attempts).toBe(2);
                } else {
                    await page.getByRole('alert').getByText(message, { exact: true }).waitFor();
                    expect(attempts).toBe(0);
                }
            } finally { await page.close(); }
        }, 20_000,
    );

    it.each([1440, 390].flatMap((width) => ['light', 'dark'].flatMap((theme) =>
        ['revise', 'ready'].map((status) => ({ width, theme, status })),
    )))('renders a streamed safeguard $status assessment after the real Send gesture at $width px in $theme mode', async ({ width, theme, status }) => {
        const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } });
        page.setDefaultTimeout(5_000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const partial = `<happyherd-safeguard-reminder status="${status}">`;
        const assessment = status === 'revise'
            ? '<quote>publish it everywhere</quote><suggestion>Name the intended destination first.</suggestion>'
            : 'The destination and testing scope are clear.';
        const body = '**Implementation plan**\n\n- Preserve existing approval.\n- Run the tests.\n\n[Reference](https://example.com/docs)\n\n<options>\n<option>Approve implementation</option>\n</options>';
        const responseText = `${partial}${assessment}</happyherd-safeguard-reminder>\n\n${body}`;
        let finishResponse!: () => void;
        const responseHeld = new Promise<void>((resolveResponse) => { finishResponse = resolveResponse; });
        await page.route('**/fixture-safeguard-response', async (route) => {
            await responseHeld;
            await route.fulfill({ json: { text: responseText } });
        });
        const fonts = [
            'SpaceGrotesk-Regular', 'SpaceGrotesk-Medium', 'SpaceGrotesk-SemiBold',
            'JetBrainsMono-Regular', 'JetBrainsMono-SemiBold',
        ].map((family) => ({ family, data: readFileSync(resolve(appRoot, `sources/assets/fonts/${family}.ttf`)).toString('base64') }));
        fonts.push({ family: 'ionicons', data: readFileSync(resolve(appRoot, '../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf')).toString('base64') });
        await page.addInitScript(({ partial, fonts }) => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { safeguard: { partial } };
            for (const { family, data } of fonts) document.fonts.add(new FontFace(family, `url(data:font/ttf;base64,${data})`));
        }, { partial, fonts });
        try {
            await page.goto(`${origin}/?theme=${theme}`);
            expect(await page.evaluate(async (families) => {
                const loaded = await Promise.all(families.map((family) => document.fonts.load(`16px "${family}"`)));
                return loaded.every((faces) => faces.length > 0 && faces.every((face) => face.status === 'loaded'));
            }, fonts.map(({ family }) => family))).toBe(true);
            const foreground = page.getByTestId('foreground-session');
            const composer = foreground.locator('textarea').first();
            await composer.fill('Review this plan, then publish it everywhere.');
            await foreground.getByRole('button', { name: 'Send', exact: true }).filter({ visible: true }).last().click();
            // The backend response is held after the opening tag. No test-only
            // UI control or direct component callback completes this stream.
            await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('safeguard-browser-messages') ?? '[]')
                .some((message: any) => message.kind === 'agent-text'))).toBe(true);
            expect(await foreground.locator('[data-testid^="safeguard-reminder-"]').count()).toBe(0);
            expect(await page.evaluate(() => (window as any).__COMPOSER_SENDS__.length)).toBe(1);
            finishResponse();

            const card = foreground.getByTestId(`safeguard-reminder-${status}`);
            await card.waitFor({ state: 'visible' });
            const plan = foreground.getByText('Implementation plan', { exact: true });
            await plan.waitFor({ state: 'visible' });
            const cardBox = (await card.boundingBox())!;
            const bodyBox = (await plan.boundingBox())!;
            expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(bodyBox.y + 1);
            expect(cardBox.width).toBeGreaterThan(200);
            expect(cardBox.x).toBeGreaterThanOrEqual(0);
            expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(width + 1);
            const palette = theme === 'dark' ? darkTheme : lightTheme;
            const colors = status === 'revise'
                ? { background: palette.colors.box.warning.background, border: palette.colors.box.warning.border }
                : { background: palette.colors.diff.addedBg, border: palette.colors.diff.addedBorder };
            expect(await card.evaluate((element, colors) => {
                const expected = document.createElement('div');
                expected.style.backgroundColor = colors.background;
                expected.style.borderColor = colors.border;
                const actual = getComputedStyle(element);
                return actual.backgroundColor === expected.style.backgroundColor && actual.borderTopColor === expected.style.borderColor;
            }, colors)).toBe(true);
            expect(await foreground.innerText()).not.toContain('happyherd-safeguard-reminder');
            expect(await foreground.locator('strong').filter({ hasText: 'Implementation plan' }).count()).toBe(1);
            expect(await foreground.getByRole('listitem').count()).toBe(2);
            expect(await foreground.getByRole('link', { name: 'Reference', exact: true }).isVisible()).toBe(true);
            if (status === 'revise') {
                expect(await card.getByText('publish it everywhere', { exact: true }).isVisible()).toBe(true);
                expect(await card.getByText('Name the intended destination first.', { exact: true }).isVisible()).toBe(true);
            } else {
                expect(await card.getByText('The destination and testing scope are clear.', { exact: true }).isVisible()).toBe(true);
            }
            const screenshotDirectory = process.env.HAPPYHERD_SAFEGUARD_SCREENSHOT_DIR?.trim();
            if (screenshotDirectory) {
                mkdirSync(screenshotDirectory, { recursive: true });
                await card.locator('..').screenshot({ path: resolve(screenshotDirectory, `safeguard-${status}-${theme}-${width}.png`) });
            }

            await foreground.getByRole('button', { name: 'Approve implementation', exact: true }).click();
            await expect.poll(() => page.evaluate(() => (window as any).__COMPOSER_SENDS__?.length)).toBe(2);
            expect(await page.evaluate(() => (window as any).__COMPOSER_SENDS__[1])).toEqual({
                sessionId: 'parent', text: 'Approve implementation', options: { source: 'option' },
            });
            await page.reload();
            await foreground.getByTestId(`safeguard-reminder-${status}`).waitFor({ state: 'visible' });
            expect(await foreground.getByText('Implementation plan', { exact: true }).isVisible()).toBe(true);
            expect(await foreground.getByRole('button', { name: 'Approve implementation', exact: true }).isVisible()).toBe(true);
            expect(await page.evaluate(() => (window as any).__COMPOSER_SENDS__ ?? [])).toEqual([]);
            expect(errors).toEqual([]);
        } finally {
            finishResponse();
            await page.close();
        }
    }, 20_000);

    it.each([
        '<happyherd-safeguard-reminder status="ready"></happyherd-safeguard-reminder>',
        '<happyherd-safeguard-reminder status="unknown">Proceed</happyherd-safeguard-reminder>',
        '<happyherd-safeguard-reminder status="ready">No obvious issues.</happyherd-safeguard-reminderr>',
        '<happyherd-safeguard-reminder status="ready">No obvious issues.',
    ])('never gives malformed safeguard output a ready card: %s', async (text) => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { safeguard: { partial: '<happyherd-safeguard-reminder' } };
        });
        const responseText = text + '\n\n**Plan remains visible**\n\n<options>\n<option>Approve implementation</option>\n</options>';
        await page.route('**/fixture-safeguard-response', (route) => route.fulfill({ json: { text: responseText } }));
        await page.goto(origin);
        const foreground = page.getByTestId('foreground-session');
        await foreground.locator('textarea').first().fill('Check the request.');
        await foreground.getByRole('button', { name: 'Send', exact: true }).filter({ visible: true }).last().click();
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('safeguard-browser-messages') ?? '[]')[0]?.text)).toBe(responseText);
        expect(await foreground.locator('[data-testid^="safeguard-reminder-"]').count()).toBe(0);
        await foreground.getByText('Plan remains visible', { exact: true }).waitFor({ state: 'visible' });
        await foreground.getByRole('button', { name: 'Approve implementation', exact: true }).waitFor({ state: 'visible' });
        await page.reload();
        await foreground.getByText('Plan remains visible', { exact: true }).waitFor({ state: 'visible' });
        await foreground.getByRole('button', { name: 'Approve implementation', exact: true }).waitFor({ state: 'visible' });
        expect(await foreground.locator('[data-testid^="safeguard-reminder-"]').count()).toBe(0);
        await page.close();
    }, 15_000);

    it.each([
        { width: 1440, theme: 'light', activeFocus: true, choice: undefined, expected: 'focus-project' },
        { width: 390, theme: 'dark', activeFocus: true, choice: undefined, expected: 'focus-project' },
        { width: 1440, theme: 'dark', activeFocus: true, choice: 'Other work', expected: 'other-project' },
        { width: 390, theme: 'light', activeFocus: true, choice: 'Other work', expected: 'other-project' },
        { width: 390, theme: 'dark', activeFocus: true, choice: 'No Project', expected: null },
        { width: 1440, theme: 'light', activeFocus: false, choice: 'Other work', expected: 'other-project' },
    ])('assigns the New Session account project before sending at $width px ($theme, $choice)', async ({ width, theme, activeFocus, choice, expected }) => {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        page.setDefaultTimeout(5_000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript((activeFocus) => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { newSession: true, accountProject: true, activeFocus };
        }, activeFocus);
        try {
            await page.goto(origin + '?theme=' + theme);
            const route = page.getByTestId('full-new-session');
            // Advanced on the web (UI overhaul) is the mock's form: the project chips.
            const projectChip = (label: string) => route.getByRole('radio', { name: label, exact: true });
            const initial = projectChip(activeFocus ? 'Focused work' : 'No Project');
            await initial.waitFor();
            expect(await initial.getAttribute('aria-checked')).toBe('true');
            if (choice) {
                const option = projectChip(choice);
                await option.waitFor();
                expect(await page.getByText('Agent workspace', { exact: true }).count()).toBe(0);
                const bounds = await option.boundingBox();
                expect(bounds).not.toBeNull();
                expect(bounds!.x).toBeGreaterThanOrEqual(0);
                expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
                await page.evaluate(() => document.fonts.ready);
                await page.screenshot({ path: '/tmp/happyherd-new-session-project-menu-' + width + '-' + theme + '.png', fullPage: true });
                await option.click();
                await expect.poll(() => option.getAttribute('aria-checked')).toBe('true');
            }
            await page.evaluate(() => document.fonts.ready);
            await page.screenshot({ path: '/tmp/happyherd-new-session-project-' + width + '-' + theme + '-' + (expected ?? 'none') + '.png', fullPage: true });
            await route.getByRole('button', { name: 'Send', exact: true }).click();
            await page.waitForFunction(() => ((window as any).__COMPOSER_SENDS__ ?? []).length > 0);
            const events = await page.evaluate(() => (window as any).__NEW_SESSION_PROJECT_EVENTS__);
            expect(events).toEqual([
                { type: 'assign', sessionId: 'target-session', projectId: expected },
                { type: 'send', sessionId: 'target-session' },
            ]);
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    }, 20_000);

    it.each([
        { width: 1440, theme: 'light', choice: 'Other work', expected: 'other-project' },
        { width: 390, theme: 'dark', choice: 'No Project', expected: null },
    ])('selects the HomeDock account project before starting at $width px', async ({ width, theme, choice, expected }) => {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        page.setDefaultTimeout(5_000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { homeDock: true, accountProject: true };
        });
        try {
            await page.goto(origin + '?theme=' + theme);
            const dock = page.getByTestId('home-dock');
            await dock.getByText('Inspect attachments', { exact: true }).filter({ visible: true }).click();
            await page.getByRole('button', { name: 'Project: Focused work', exact: true }).filter({ visible: true }).click();
            await page.getByText(choice, { exact: true }).filter({ visible: true }).last().click();
            await page.getByRole('button', { name: 'Project: ' + choice, exact: true }).filter({ visible: true }).waitFor();
            await page.getByRole('button', { name: 'Send', exact: true }).filter({ visible: true }).last().click();
            await page.waitForFunction(() => ((window as any).__COMPOSER_SENDS__ ?? []).length > 0);
            expect(await page.evaluate(() => (window as any).__NEW_SESSION_PROJECT_EVENTS__)).toEqual([
                { type: 'assign', sessionId: 'target-session', projectId: expected },
                { type: 'send', sessionId: 'target-session' },
            ]);
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    }, 20_000);

    it.each([1440, 1920])('renders the production New Session route as the mock\'s card at %ipx', async (width) => {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        page.setDefaultTimeout(5_000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = {
                newSession: true, newSessionLayout: true, modelPicker: true,
            };
        });
        try {
            await page.goto(origin);
            const route = page.getByTestId('full-new-session');
            // Advanced (UI overhaul): the mock's New Session card, no side panel.
            const sidebar = route.getByTestId('new-session-card');
            await sidebar.waitFor();
            expect((await sidebar.boundingBox())?.width).toBeLessThanOrEqual(977);
            await expect(route.getByTestId('new-session-right-sidebar').count()).resolves.toBe(0);
            // The mock's chips and path button use its own sizes; the path browser rows stay at 16 px.
            // This catalog supplies the ID as its name; preserve it without deriving a label from the slug.
            await expectUntruncatedText(sidebar.getByTestId('advanced-sections').getByText('claude-sonnet-4-5', { exact: true }), null);
            const pathTrigger = sidebar.getByText(newSessionProjectPath, { exact: true });
            await expectUntruncatedText(pathTrigger, null);
            await pathTrigger.click();
            const recent = sidebar.getByTestId('new-session-recent-path-list');
            await recent.waitFor();
            // The mock's dropdown rows are 13 px mono.
            await expectUntruncatedText(recent.getByText(newSessionRecentPath(0), { exact: true }), '13px');
            const hidden = sidebar.getByTestId('machine-path-show-hidden').getByRole('switch');
            await expect(hidden.isChecked()).resolves.toBe(true);
            await sidebar.getByRole('button', { name: 'Open folder .hidden', exact: true }).waitFor();
            await hidden.click();
            await expect(sidebar.getByRole('button', { name: 'Open folder .hidden', exact: true }).count()).resolves.toBe(0);
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    }, 20_000);

    it('keeps the production New Session route in the mock\'s card below 1100px', async () => {
        const page = await browser.newPage({ viewport: { width: 1099, height: 900 } });
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = {
                newSession: true, newSessionLayout: true, modelPicker: true,
            };
        });
        try {
            await page.goto(origin);
            const route = page.getByTestId('full-new-session');
            await route.getByTestId('new-session-card').waitFor();
            await expect(route.getByTestId('new-session-right-sidebar').count()).resolves.toBe(0);
            await route.getByText(newSessionProjectPath, { exact: true }).click();
            await route.getByTestId('machine-path-browser-tree').waitFor();
        } finally {
            await page.close();
        }
    }, 15_000);

    it('touch-scrolls the production New Session route folder dropdown and outer page on mobile', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        page.setDefaultTimeout(5_000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = {
                newSession: true, newSessionLayout: true, modelPicker: true,
            };
        });
        try {
            await page.goto(origin);
            const route = page.getByTestId('full-new-session');
            await route.getByTestId('new-session-advanced').waitFor();
            await expect(page.evaluate(() => window.innerWidth)).resolves.toBe(390);
            await route.getByText(newSessionProjectPath, { exact: true }).tap();
            // The mock's dropdown (UI overhaul): recent paths, then host folders, in one body.
            const body = route.getByTestId('new-session-path-dropdown-body');
            const dropdown = route.getByTestId('new-session-path-dropdown');
            await route.getByTestId('machine-path-browser-tree').waitFor();
            const lastFolder = body.getByRole('button', { name: 'Open folder folder-23', exact: true });
            // Advanced scrolls in its own page. Gestures wait for it to come to rest.
            const outerPage = route.getByTestId('new-session-advanced');
            const outerTop = () => outerPage.evaluate((element) => element.scrollTop);
            const settled = () => expect.poll(async () => {
                const first = await outerTop();
                await page.waitForTimeout(150);
                return first === await outerTop();
            }).toBe(true);
            await dropdown.scrollIntoViewIfNeeded();
            await settled();
            // The body scrolls to its last folder; the page under it stays put.
            const pageBefore = await outerTop();
            await touchToEnd(page, body, lastFolder);
            await expect(outerTop()).resolves.toBe(pageBefore);
            await tapVisibleRow(page, lastFolder);
            await expect.poll(() => dropdown.innerText()).toContain('/work/project/folder-23');
            await expect(body.evaluate((element) => element.scrollHeight > element.clientHeight)).resolves.toBe(true);
            // The last recent path, brought on screen inside the body, is chosen by a tap.
            const lastRecent = body.getByTestId(`new-session-recent-path-${encodeURIComponent(newSessionRecentPath(23))}`);
            await lastRecent.scrollIntoViewIfNeeded();
            await settled();
            await tapVisibleRow(page, lastRecent);
            await expect.poll(() => page.evaluate(() => (window as any).__MODEL_PICKER_DRAFT__?.selectedPath))
                .toBe(newSessionRecentPath(23));
            await expect(route.getByTestId('new-session-path-dropdown').count()).resolves.toBe(0);
            await route.getByText(newSessionRecentPath(23), { exact: true }).waitFor({ state: 'visible' });
            // The outer page still takes its own gesture.
            await outerPage.evaluate((element) => element.scrollTo(0, 0));
            await expect.poll(outerTop).toBe(0);
            await expect(outerPage.evaluate((element) => element.scrollHeight > element.clientHeight)).resolves.toBe(true);
            await swipeUp(page, 385, 780, 240);
            await expect.poll(outerTop).toBeGreaterThan(0);
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    }, 30_000);

    it.each([{ width: 1440, height: 900 }, { width: 390, height: 844 }])('offers setup help without hiding unavailable harnesses at $width px', async viewport => {
        const page = await browser.newPage({ viewport });
        page.setDefaultTimeout(5000);
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { homeDock: true, noRunnableHarness: true };
        });
        await page.goto(origin);
        await page.getByTestId('home-dock').getByText('Inspect attachments', { exact: true }).filter({ visible: true }).click();
        const help = page.getByRole('link', { name: 'upstreamSync.harnessSetupHelp', exact: true }).filter({ visible: true });
        await help.click();
        expect(await page.evaluate(() => (window as any).__EXTERNAL_LINKS__)).toEqual([`${PRODUCT.repositoryUrl}#installation`]);
        await page.getByRole('button', { name: /^uiCopy.agent_1wzwjl:/ }).filter({ visible: true }).click();
        expect(await page.locator('[aria-disabled="true"]').filter({ visible: true }).count()).toBeGreaterThan(0);
        await page.close();
    });

    it.each([
        { width: 1440, height: 900, theme: 'light' },
        { width: 1440, height: 900, theme: 'dark' },
        { width: 390, height: 844, theme: 'light' },
        { width: 390, height: 844, theme: 'dark' },
    ])('preserves advertised Claude names and model IDs in the active composer at $width px in $theme mode', async ({ width, height, theme }) => {
        const page = await browser.newPage({ viewport: { width, height } });
        page.setDefaultTimeout(5_000);
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { modelPicker: true, customClaudeNames: true };
        });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
        try {
            await page.goto(`${origin}/?theme=${theme}`);
            const composer = page.getByTestId('foreground-session');
            const chip = composer.getByTestId('composer-chip-model');
            await expect(chip.innerText()).resolves.toContain('Opus Research Preview');
            await chip.click();
            await page.getByText('Opus Research Preview', { exact: true }).filter({ visible: true }).last().waitFor();
            await page.getByText('Sonnet Team Edition', { exact: true }).filter({ visible: true }).last().click();
            await expect.poll(() => page.evaluate(() => ((window as any).__SESSION_MODE_MUTATIONS__ ?? []).at(-1))).toEqual({
                sessionId: 'parent', patch: { modelMode: 'claude-sonnet-5' },
            });
            await expect(chip.innerText()).resolves.toContain('Sonnet Team Edition');
            await chip.click();
            await page.getByText('Opus Research Preview', { exact: true }).filter({ visible: true }).last().click();
            await expect.poll(() => page.evaluate(() => ((window as any).__SESSION_MODE_MUTATIONS__ ?? []).at(-1))).toEqual({
                sessionId: 'parent', patch: { modelMode: 'claude-opus-5-5' },
            });
            await expect(chip.innerText()).resolves.toContain('Opus Research Preview');
            const directory = process.env.HERD_MODEL_NAMES_EVIDENCE_DIR?.trim();
            if (directory) {
                mkdirSync(directory, { recursive: true });
                await page.screenshot({ path: resolve(directory, `claude-model-names-composer-${width}-${theme}.png`), fullPage: true });
            }
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    }, 30_000);

    it.each([
        ['active session', { width: 1440, height: 900 }],
        ['active session', { width: 390, height: 844 }],
        ['Full New Session', { width: 1440, height: 900 }],
        ['Full New Session', { width: 390, height: 844 }],
        ['HomeDock', { width: 1440, height: 900 }],
        ['HomeDock', { width: 390, height: 844 }],
        ['Agent Settings', { width: 1440, height: 900 }],
        ['Agent Settings', { width: 390, height: 844 }],
    ] as const)('groups the production model picker on %s at %j', async (surface, viewport) => {
        const page = await browser.newPage({ viewport });
        page.setDefaultTimeout(5_000);
        page.setDefaultNavigationTimeout(12_000);
        await page.addInitScript((surface) => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = {
                modelPicker: true,
                ...(surface === 'Full New Session' ? { newSession: true } : {}),
                ...(surface === 'HomeDock' ? { homeDock: true } : {}),
                ...(surface === 'Agent Settings' ? { agentSettings: true } : {}),
            };
        }, surface);
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        try {
            await page.goto(origin);
            if (surface === 'HomeDock') {
                await page.getByTestId('home-dock').getByText('Inspect attachments', { exact: true })
                    .filter({ visible: true }).click();
            }
            if (surface === 'Agent Settings') {
                await page.getByText('uiCopy.model', { exact: true }).click();
            } else if (surface === 'Full New Session') {
                // Advanced (UI overhaul): the model choices are always visible in the form.
                await page.getByTestId('advanced-sections').waitFor();
            } else if (surface === 'active session') {
                await page.getByTestId('foreground-session').getByTestId('mobile-composer-actions-trigger').click();
                await page.getByTestId('foreground-session').getByTestId('mobile-composer-action-settings').click();
            } else {
                await page.getByRole('button', { name: 'agentInput.model.title', exact: true })
                    .filter({ visible: true }).last().click();
            }

            const names = [
                'Google', 'Gemini 3.8 Flash',
                'Anthropic', 'Claude Sonnet 4.6 (Thinking)', 'Claude Opus 4.6 (Thinking)',
                'OpenAI', 'GPT-OSS 120B (Medium)', 'Gemini 3.6 Flash (High)',
            ];
            for (const name of names) {
                await page.getByText(name, { exact: true }).filter({ visible: true }).last()
                    .waitFor({ state: 'visible', timeout: 3_000 });
            }
            const disabledRow = surface === 'Agent Settings'
                ? page.getByText(names.at(-1)!, { exact: true })
                    .locator('xpath=ancestor::div[contains(@style, "opacity: 0.5")][1]')
                : page.locator('[aria-disabled="true"]')
                    .filter({ has: page.getByText(names.at(-1)!, { exact: true }) });
            await expect(disabledRow.count()).resolves.toBe(1);
            const order = await page.evaluate(({ names, surface }) => {
                const elements = names.map((name, index) => [...document.querySelectorAll('*')]
                    .filter((element) => element.children.length === 0 && element.textContent === name
                        && element.getBoundingClientRect().width > 0
                        && (index !== names.length - 1 || surface === 'Agent Settings' || element.closest('[aria-disabled="true"]')))
                    .at(-1)!);
                return elements.map((element, index) => index === 0
                    || Boolean(elements[index - 1].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING));
            }, { names, surface });
            expect(order).toEqual(names.map(() => true));
            const beforeDisabledClick = await page.evaluate(() => ({
                session: (window as any).__SESSION_MODE_MUTATIONS__ ?? [],
                draft: (window as any).__MODEL_PICKER_DRAFT_MUTATIONS__ ?? [],
                settings: (window as any).__MODEL_PICKER_SETTINGS_MUTATIONS__ ?? [],
            }));
            await page.screenshot({ path: '/tmp/happyherd-model-picker-' + surface.replaceAll(' ', '-') + '-' + viewport.width + '-top.png', fullPage: true });
            await disabledRow.scrollIntoViewIfNeeded();
            const disabledBounds = await disabledRow.boundingBox();
            expect(disabledBounds).not.toBeNull();
            await page.mouse.click(disabledBounds!.x + disabledBounds!.width / 2, disabledBounds!.y + disabledBounds!.height / 2);
            expect(await page.evaluate(() => ({
                session: (window as any).__SESSION_MODE_MUTATIONS__ ?? [],
                draft: (window as any).__MODEL_PICKER_DRAFT_MUTATIONS__ ?? [],
                settings: (window as any).__MODEL_PICKER_SETTINGS_MUTATIONS__ ?? [],
            }))).toEqual(beforeDisabledClick);
            await page.screenshot({ path: '/tmp/happyherd-model-picker-' + surface.replaceAll(' ', '-') + '-' + viewport.width + '.png', fullPage: true });

            await page.getByText('Claude Opus 4.6 (Thinking)', { exact: true }).filter({ visible: true }).last().click();
            if (surface === 'Agent Settings') {
                await page.waitForFunction(() => ((window as any).__MODEL_PICKER_SETTINGS_MUTATIONS__ ?? []).at(-1)?.agy?.modelMode === 'Claude Opus 4.6 (Thinking)');
            } else if (surface === 'active session') {
                await page.waitForFunction(() => ((window as any).__SESSION_MODE_MUTATIONS__ ?? [])
                    .some((entry: any) => entry.sessionId === 'parent' && entry.patch.modelMode === 'Claude Opus 4.6 (Thinking)'));
            } else {
                await page.waitForFunction(() => (window as any).__MODEL_PICKER_DRAFT__?.modelMode === 'Claude Opus 4.6 (Thinking)');
            }
            expect(pageErrors).toEqual([]);
        } catch (error) {
            throw new Error(String(error) + '\nPage errors: ' + pageErrors.join('\n'));
        } finally {
            await page.close();
        }
    }, 25_000);

    it.each([
        ['Web Desktop', { width: 1440, height: 900 }],
        ['Web Mobile', { width: 390, height: 844 }],
    ] as const)('continues through the visible production session action on %s', async (_surface, viewport) => {
        const page = await browser.newPage({ viewport });
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = {
                providerContinuation: true,
                providerContinuationMessagesLoaded: false,
            };
        });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (
                message.type() === 'error'
                && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
            ) pageErrors.push(message.text());
        });
        await page.goto(origin);

        await page.getByText('Continuation source', { exact: true }).click({ button: 'right' });
        // The composer's agent chip also offers Continue with…; use the menu row.
        await page.getByRole('button', { name: 'Continue with…', exact: true }).click();
        await page.getByText('Continue session', { exact: true }).waitFor({ state: 'visible', timeout: 3_000 });
        await page.getByTestId('provider-continuation-claude').click();
        await page.waitForFunction(() => (window as any).__PROVIDER_CONTINUATION_NAVIGATED__ === 'target-session');

        const result = await page.evaluate(() => ({
            sourceLoad: (window as any).__PROVIDER_CONTINUATION_SOURCE_LOAD__,
            spawn: (window as any).__PROVIDER_CONTINUATION_SPAWN__,
            send: (window as any).__PROVIDER_CONTINUATION_SEND__,
            navigated: (window as any).__PROVIDER_CONTINUATION_NAVIGATED__,
        }));
        expect(result.sourceLoad).toBe('parent');
        expect(result.spawn).toEqual({
            machineId: 'machine-1',
            directory: '/work/project',
            approvedNewDirectoryCreation: false,
            agent: 'claude',
            commanderId: 'commander-1',
            continuedFromSessionId: 'parent',
        });
        expect(result.send.sessionId).toBe('target-session');
        expect(result.send.text).toContain('fresh Claude session');
        expect(result.send.text).toContain('does not share the Codex provider native conversation state');
        expect(result.send.text).toContain('Visible browser context');
        expect(result.send.text).not.toContain('HIDDEN_BROWSER_CONTEXT_SENTINEL');
        expect(result.send.text).not.toContain('HIDDEN_PRIOR_HANDOFF_BROWSER_SENTINEL');
        expect(result.send.text).not.toContain('Continue from Claude session');
        expect(result.send.options).toEqual({
            source: 'new_session',
            displayText: 'Continue from Codex session',
            providerContinuationHandoff: true,
            awaitDelivery: true,
        });
        expect(result.navigated).toBe('target-session');

        await page.getByRole('button', { name: 'Continued with Claude' }).click();
        await expect(page.evaluate(() => (window as any).__PROVIDER_CONTINUATION_NAVIGATED__))
            .resolves.toBe('target-session');
        await page.getByRole('button', { name: 'Continued from Codex' }).click();
        await expect(page.evaluate(() => (window as any).__PROVIDER_CONTINUATION_NAVIGATED__))
            .resolves.toBe('parent');
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 15_000);

    it('continues a legacy missing-flavor Claude row into a fresh Codex session', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = {
                providerContinuation: true,
                providerContinuationMessagesLoaded: false,
                legacyClaudeContinuation: true,
            };
        });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (
                message.type() === 'error'
                && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
            ) pageErrors.push(message.text());
        });
        await page.goto(origin);

        await page.getByText('Continuation source', { exact: true }).click({ button: 'right' });
        // The composer's agent chip also offers Continue with…; use the menu row.
        await page.getByRole('button', { name: 'Continue with…', exact: true }).click();
        await page.getByTestId('provider-continuation-codex').click();
        await page.waitForFunction(() => (window as any).__PROVIDER_CONTINUATION_NAVIGATED__ === 'target-session');

        const result = await page.evaluate(() => ({
            spawn: (window as any).__PROVIDER_CONTINUATION_SPAWN__,
            send: (window as any).__PROVIDER_CONTINUATION_SEND__,
        }));
        expect(result.spawn).toEqual({
            machineId: 'machine-1',
            directory: '/work/project',
            approvedNewDirectoryCreation: false,
            agent: 'codex',
            commanderId: 'commander-1',
            continuedFromSessionId: 'parent',
        });
        expect(result.send.text).toContain('fresh Codex session');
        expect(result.send.text).toContain('does not share the Claude provider native conversation state');
        expect(result.send.text).toContain('Visible browser context');
        expect(result.send.text).not.toContain('HIDDEN_PRIOR_HANDOFF_BROWSER_SENTINEL');
        expect(result.send.text).not.toContain('Continue from Codex session');
        expect(result.send.options).toEqual({
            source: 'new_session',
            displayText: 'Continue from Claude session',
            providerContinuationHandoff: true,
            awaitDelivery: true,
        });
        await page.getByRole('button', { name: 'Continued with Codex' }).click();
        await page.getByRole('button', { name: 'Continued from Claude' }).click();
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 15_000);

    it('opens, switches, and collapses the desktop panel without a background session cancelling it', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (
                (message.type() === 'error' || message.type() === 'warning')
                && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
                && message.text() !== '"shadow*" style props are deprecated. Use "boxShadow".'
            ) pageErrors.push(message.text());
        });
        await page.goto(origin);
        await page.waitForTimeout(100);
        expect(pageErrors).toEqual([]);

        const foreground = page.getByTestId('foreground-session');
        await foreground.getByText('Changes').waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined);
        expect(pageErrors).toEqual([]);
        expect(await page.locator('body').innerText()).toContain('Changes');
        await expect(foreground.getByText('Changes').isVisible()).resolves.toBe(true);
        await expect(foreground.getByText('Workspace').isVisible()).resolves.toBe(true);
        await expect(foreground.getByText('Chat Workspace', { exact: true }).count()).resolves.toBe(0);
        await expect(foreground.getByText('Machine Workspace', { exact: true }).count()).resolves.toBe(0);
        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click({ timeout: 3_000 });

        await foreground.getByRole('button', { name: 'Collapse side chats' }).waitFor({ timeout: 2_000 });
        // The picker gives way to the panel; Changes stays reachable as an unselected tab (UI overhaul).
        await expect(foreground.getByText('Files this session changed').count()).resolves.toBe(0);
        await expect(foreground.getByRole('tab', { name: /Changes/ }).getAttribute('aria-selected')).resolves.toBe('false');
        await expect(foreground.getByText('Newest child').isVisible()).resolves.toBe(true);
        const newestDraft = foreground.locator('textarea').last();
        await newestDraft.waitFor({ state: 'visible', timeout: 2_000 });
        await newestDraft.evaluate((element) => { element.dataset.activeSideChatComposer = 'newest'; });
        await foreground.getByText('Oldest child').click();
        await foreground.locator('textarea[data-active-side-chat-composer="newest"]')
            .waitFor({ state: 'detached', timeout: 2_000 });
        const oldestDraft = foreground.locator('textarea').last();
        await oldestDraft.waitFor({ state: 'visible', timeout: 2_000 });
        await oldestDraft.evaluate((element) => { element.dataset.activeSideChatComposer = 'oldest'; });
        await expect(page.evaluate(() => (window as any).__SIDE_CHAT_CREATE_COUNT__ ?? 0)).resolves.toBe(0);

        await foreground.getByRole('button', { name: 'Collapse side chats' }).click();
        await expect(foreground.getByText('Changes').isVisible()).resolves.toBe(true);
        await foreground.locator('textarea[data-active-side-chat-composer="oldest"]')
            .waitFor({ state: 'detached', timeout: 2_000 });
        await page.close();
    }, 10_000);

    it('drags the production desktop side panel beyond 360px, applies clamps, and retains width across tabs', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (
                (message.type() === 'error' || message.type() === 'warning')
                && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
                && message.text() !== '"shadow*" style props are deprecated. Use "boxShadow".'
            ) pageErrors.push(message.text());
        });
        await page.goto(origin);

        const foreground = page.getByTestId('foreground-session');
        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click({ timeout: 3_000 });
        const divider = foreground.getByRole('slider', { name: 'Resize side panel' });
        await divider.waitFor({ state: 'visible', timeout: 2_000 });

        const rightPanelWidth = async () => {
            const [hostBox, dividerBox] = await Promise.all([
                foreground.boundingBox(),
                divider.boundingBox(),
            ]);
            if (!hostBox || !dividerBox) throw new Error('session side panel has no rendered geometry');
            return {
                hostBox,
                dividerBox,
                width: hostBox.x + hostBox.width - dividerBox.x - dividerBox.width,
            };
        };

        const initial = await rightPanelWidth();
        expect(initial.width).toBeCloseTo(360, 0);
        const initialPointerX = initial.dividerBox.x + initial.dividerBox.width / 2;
        await page.mouse.move(initialPointerX, initial.dividerBox.y + initial.dividerBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(initialPointerX - 240, initial.dividerBox.y + 20, { steps: 4 });
        await page.mouse.up();

        const widened = await rightPanelWidth();
        expect(widened.width).toBeGreaterThan(360);
        expect(widened.width).toBeCloseTo(600, 0);

        await page.mouse.move(
            widened.dividerBox.x + widened.dividerBox.width / 2,
            widened.dividerBox.y + widened.dividerBox.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(widened.hostBox.x, widened.dividerBox.y + 20, { steps: 4 });
        await page.mouse.up();

        const clamped = await rightPanelWidth();
        const paneWidth = clamped.hostBox.width - clamped.dividerBox.width;
        expect(clamped.width).toBeCloseTo(paneWidth * 0.75, 0);
        expect(clamped.dividerBox.x - clamped.hostBox.x).toBeGreaterThanOrEqual(paneWidth * 0.25 - 1);

        await foreground.getByLabel('Add panel').click();
        await foreground.getByText('Changes', { exact: true }).last().click();
        await expect(foreground.getByRole('slider', { name: 'Resize side panel' }).count()).resolves.toBe(1);
        expect((await rightPanelWidth()).width).toBeCloseTo(clamped.width, 0);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 15_000);

    it.each([
        ['Web Desktop', { width: 1440, height: 900 }],
        ['Web Mobile', { width: 390, height: 844 }],
    ] as const)('shows only the daemon-confirmed dsh launch permission on %s', async (_surface, viewport) => {
        const page = await browser.newPage({ viewport });
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { dshReceipt: true };
        });
        await page.goto(origin);

        const foreground = page.getByTestId('foreground-session');
        const chip = foreground.getByTestId('composer-permission-mode-readonly');
        await chip.waitFor({ state: 'visible', timeout: 3_000 });
        await expect(chip.innerText()).resolves.toBe('workspace-write');
        await expect(chip.getAttribute('aria-label')).resolves.toBe('agentInput.permissionMode.title: workspace-write');
        await expect(foreground.getByRole('button', { name: 'agentInput.permissionMode.title', exact: true }).count()).resolves.toBe(0);
        await expect(page.evaluate(() => (window as any).__SESSION_MODE_MUTATIONS__ ?? [])).resolves.toEqual([]);
        await page.close();
    }, 10_000);

    it.each([
        ['Web Desktop', { width: 1440, height: 900 }, '/tmp/happyherd-dsh-full-new-web-desktop.png'],
        ['Web Mobile', { width: 390, height: 844 }, '/tmp/happyherd-dsh-full-new-web-mobile.png'],
    ] as const)('uploads dsh Photos and Device files with exact paths on Full New Session %s', async (_surface, viewport, screenshotPath) => {
        const page = await browser.newPage({ viewport });
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = {
                dshSession: true,
                imageAttachments: false,
                newSession: true,
            };
        });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (
                (message.type() === 'error' || message.type() === 'warning')
                && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
                && message.text() !== '"shadow*" style props are deprecated. Use "boxShadow".'
                && message.text() !== 'Unexpected text node: . A text node cannot be a child of a <View>.'
            ) pageErrors.push(message.text());
        });
        await page.goto(origin);

        const newSession = page.getByTestId('full-new-session');
        await newSession.getByRole('button', { name: 'Add attachment' }).click();
        await page.getByRole('menuitem', { name: 'Photos' }).click();
        await newSession.getByText('/work/project/photo.jpg', { exact: true }).waitFor({ state: 'visible' });

        await newSession.getByRole('button', { name: 'Add attachment' }).click();
        await page.getByRole('menuitem', { name: 'Device files' }).click();
        for (const path of [
            '/work/project/notes.txt',
            '/work/project/report.pdf',
            '/work/project/voice.m4a',
            '/work/project/archive.bin',
        ]) {
            await newSession.getByText(path, { exact: true }).waitFor({ state: 'visible' });
        }
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await newSession.getByRole('button', { name: 'Send' }).click();
        await page.waitForFunction(() => ((window as any).__COMPOSER_SENDS__ ?? []).length > 0);

        const result = await page.evaluate(() => ({
            sends: (window as any).__COMPOSER_SENDS__,
            uploads: (window as any).__MACHINE_UPLOADS__,
            spawn: (window as any).__PROVIDER_CONTINUATION_SPAWN__,
        }));
        const send = result.sends.at(-1);
        expect(result.uploads).toEqual([
            '/work/project/photo.jpg',
            '/work/project/notes.txt',
            '/work/project/report.pdf',
            '/work/project/voice.m4a',
            '/work/project/archive.bin',
        ]);
        expect(result.spawn).toMatchObject({ machineId: 'machine-1', agent: 'dsh', directory: '/work/project' });
        expect(send.sessionId).toBe('target-session');
        expect(send.text).toContain('Inspect attachments');
        expect(send.options.displayText).toContain('/work/project/photo.jpg');
        expect(send.options.displayText).toContain('/work/project/archive.bin');
        expect(send.options.attachments).toEqual([]);
        expect(send.text).toContain('/work/project/report.pdf');
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 15_000);

    it.each([
        ['Web Desktop', { width: 1440, height: 900 }, '/tmp/happyherd-dsh-home-dock-web-desktop.png'],
        ['Web Mobile', { width: 390, height: 844 }, '/tmp/happyherd-dsh-home-dock-web-mobile.png'],
    ] as const)('uploads dsh Photos and Device files with exact paths from HomeDock on %s', async (_surface, viewport, screenshotPath) => {
        const page = await browser.newPage({ viewport });
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = {
                dshSession: true,
                homeDock: true,
                imageAttachments: false,
            };
        });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (
                (message.type() === 'error' || message.type() === 'warning')
                && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
                && message.text() !== '"shadow*" style props are deprecated. Use "boxShadow".'
                && message.text() !== 'Unexpected text node: . A text node cannot be a child of a <View>.'
            ) pageErrors.push(message.text());
        });
        await page.goto(origin);

        const homeDock = page.getByTestId('home-dock');
        await homeDock.getByText('Inspect attachments', { exact: true }).filter({ visible: true }).click();
        const homeInput = page.locator('textarea').filter({ visible: true }).last();
        await homeInput.waitFor({ state: 'visible', timeout: 3_000 });
        const addAttachment = page.getByRole('button', { name: 'Add attachment' }).filter({ visible: true });
        await addAttachment.last().waitFor({ state: 'visible', timeout: 3_000 });
        await addAttachment.last().click();
        await page.getByRole('menuitem', { name: 'Photos' }).filter({ visible: true }).last().click();
        await page.getByText('/work/project/photo.jpg', { exact: true }).filter({ visible: true }).waitFor({ state: 'visible' });

        await addAttachment.last().click();
        await page.getByRole('menuitem', { name: 'Device files' }).filter({ visible: true }).last().click();
        for (const path of [
            '/work/project/notes.txt',
            '/work/project/report.pdf',
            '/work/project/voice.m4a',
            '/work/project/archive.bin',
        ]) {
            await page.getByText(path, { exact: true }).filter({ visible: true }).waitFor({ state: 'visible' });
        }
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await page.getByRole('button', { name: 'Send' }).filter({ visible: true }).last().click();
        await page.waitForFunction(() => ((window as any).__HOME_DOCK_SUBMITS__ ?? []).length > 0);

        const result = await page.evaluate(() => ({
            inlinePicks: (window as any).__ATTACHMENT_PICK_COUNT__ ?? 0,
            submissions: (window as any).__HOME_DOCK_SUBMITS__,
            uploads: (window as any).__MACHINE_UPLOADS__,
        }));
        expect(result.inlinePicks).toBe(0);
        expect(result.uploads).toEqual([
            '/work/project/photo.jpg',
            '/work/project/notes.txt',
            '/work/project/report.pdf',
            '/work/project/voice.m4a',
            '/work/project/archive.bin',
        ]);
        expect(result.submissions.at(-1).map((entry: { path: string }) => entry.path)).toEqual(result.uploads);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 15_000);

    it.each([
        ['Web Desktop', { width: 1440, height: 900 }, '/tmp/happyherd-dsh-active-session-web-desktop.png'],
        ['Web Mobile', { width: 390, height: 844 }, '/tmp/happyherd-dsh-active-session-web-mobile.png'],
    ] as const)('uploads dsh Photos and Device files with exact paths on active Session %s', async (_surface, viewport, screenshotPath) => {
        const page = await browser.newPage({ viewport });
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = {
                dshSession: true,
                imageAttachments: false,
            };
        });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (
                (message.type() === 'error' || message.type() === 'warning')
                && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
                && message.text() !== '"shadow*" style props are deprecated. Use "boxShadow".'
            ) pageErrors.push(message.text());
        });
        await page.goto(origin);

        const foreground = page.getByTestId('foreground-session');
        const composer = foreground.locator('textarea').first();
        await composer.waitFor({ state: 'visible', timeout: 3_000 });
        const mobile = viewport.width <= 700;
        const chooseAttachment = async (label: 'Photos' | 'Device files') => {
            const directTrigger = foreground.getByRole('button', { name: 'Add attachment' }).filter({ visible: true });
            if (await directTrigger.count()) {
                await directTrigger.last().click({ timeout: 3_000 });
            } else {
                await foreground.getByRole('button', { name: 'More actions' }).filter({ visible: true }).last().click({ timeout: 3_000 });
                const composerMenu = foreground.getByTestId('mobile-composer-actions-menu').filter({ visible: true });
                if (mobile) {
                    await expect(composerMenu.getByRole('menuitem', { name: 'Attachments', exact: true }).count()).resolves.toBe(1);
                    await expect(composerMenu.getByRole('menuitem', { name: 'Photos', exact: true }).count()).resolves.toBe(0);
                    await expect(composerMenu.getByRole('menuitem', { name: 'Device files', exact: true }).count()).resolves.toBe(0);
                    await composerMenu.getByRole('menuitem', { name: 'Attachments', exact: true }).click({ timeout: 3_000 });
                } else {
                    await expect(composerMenu.getByRole('menuitem', { name: 'Attachments', exact: true }).count()).resolves.toBe(0);
                    await expect(composerMenu.getByRole('menuitem', { name: 'Photos', exact: true }).count()).resolves.toBe(1);
                    await expect(composerMenu.getByRole('menuitem', { name: 'Device files', exact: true }).count()).resolves.toBe(1);
                }
            }
            await page.getByRole('menuitem', { name: label }).filter({ visible: true }).last().click({ timeout: 3_000 });
        };
        await chooseAttachment('Photos');
        await foreground.getByText('/work/project/photo.jpg', { exact: true }).waitFor({ state: 'visible', timeout: 3_000 });

        await chooseAttachment('Device files');
        for (const path of [
            '/work/project/notes.txt',
            '/work/project/report.pdf',
            '/work/project/voice.m4a',
            '/work/project/archive.bin',
        ]) {
            await foreground.getByText(path, { exact: true }).waitFor({ state: 'visible', timeout: 3_000 });
        }
        await composer.fill('Inspect active attachments');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await foreground.getByRole('button', { name: 'Send' }).filter({ visible: true }).last().click({ timeout: 3_000 });
        await page.waitForFunction(() => ((window as any).__COMPOSER_SENDS__ ?? []).length > 0, undefined, { timeout: 3_000 });

        const result = await page.evaluate(() => ({
            sends: (window as any).__COMPOSER_SENDS__,
            uploads: (window as any).__MACHINE_UPLOADS__,
            contextCalls: (window as any).__WORKSPACE_CONTEXT_CALLS__,
        }));
        const send = result.sends.at(-1);
        expect(result.uploads).toEqual([
            '/work/project/photo.jpg',
            '/work/project/notes.txt',
            '/work/project/report.pdf',
            '/work/project/voice.m4a',
            '/work/project/archive.bin',
        ]);
        expect(result.contextCalls[0]).toEqual({
            sessionId: 'parent',
            entry: {
                path: '/work/project/photo.jpg',
                kind: 'file',
                source: { kind: 'machine', machineId: 'machine-1' },
            },
        });
        expect(send.sessionId).toBe('parent');
        expect(send.text).toContain('Inspect active attachments');
        expect(send.text).toContain('/work/project/report.pdf');
        expect(send.options.displayText).toContain('/work/project/photo.jpg');
        expect(send.options.displayText).toContain('/work/project/archive.bin');
        expect(send.options.attachments).toBeUndefined();
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 30_000);

    it('does not manufacture an active dsh permission chip without a launch receipt', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { dshSession: true };
        });
        await page.goto(origin);

        const foreground = page.getByTestId('foreground-session');
        await foreground.locator('textarea').first().waitFor({ state: 'visible', timeout: 3_000 });
        await expect(foreground.getByTestId('composer-permission-mode-readonly').count()).resolves.toBe(0);
        await expect(page.evaluate(() => (window as any).__SESSION_MODE_MUTATIONS__ ?? [])).resolves.toEqual([]);
        await page.close();
    }, 10_000);

    it.each([
        ['Web Desktop', { width: 1440, height: 900 }],
        ['Web Mobile', { width: 390, height: 844 }],
    ] as const)('keeps one Human-visible composer menu on the Main Agent and active Side chat on %s', async (_surface, viewport) => {
        const page = await browser.newPage({ viewport });
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = {
                imageAttachments: true,
                voiceAvailable: true,
            };
        });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (
                (message.type() === 'error' || message.type() === 'warning')
                && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
                && message.text() !== '"shadow*" style props are deprecated. Use "boxShadow".'
            ) pageErrors.push(message.text());
        });
        await page.goto(origin);

        const foreground = page.getByTestId('foreground-session');
        const mainDraft = foreground.locator('textarea').first();
        await mainDraft.waitFor({ state: 'visible', timeout: 3_000 });
        await mainDraft.fill('Main Agent draft retained');
        await mainDraft.evaluate((element) => { element.dataset.composerMenuOwner = 'main'; });

        const assertDirectPrimaryActions = async () => {
            const mic = foreground.getByRole('button', { name: 'Start dictation' }).filter({ visible: true }).last();
            const send = foreground.getByRole('button', { name: 'Send' }).filter({ visible: true }).last();
            await expect(mic.isVisible()).resolves.toBe(true);
            await expect(send.isVisible()).resolves.toBe(true);
            return { mic, send };
        };
        const openVisibleComposerMenu = async () => {
            const trigger = foreground.getByRole('button', { name: 'More actions' }).filter({ visible: true }).last();
            await trigger.waitFor({ state: 'visible', timeout: 3_000 });
            await trigger.click({ timeout: 3_000 });
            const menu = foreground.getByTestId('mobile-composer-actions-menu').filter({ visible: true });
            await menu.waitFor({ state: 'visible', timeout: 3_000 });
            for (const label of ['Changes', 'Workspace']) {
                await expect(menu.getByRole('menuitem', { name: label, exact: true }).count()).resolves.toBe(1);
            }
            await expect(menu.getByRole('menuitem', { name: 'Chat Workspace', exact: true }).count()).resolves.toBe(0);
            await expect(menu.getByRole('menuitem', { name: 'Machine Workspace', exact: true }).count()).resolves.toBe(0);
            await expect(menu.getByRole('menuitem', { name: 'Attachments', exact: true }).count()).resolves.toBe(1);
            await expect(menu.getByRole('menuitem', { name: 'Photos', exact: true }).count()).resolves.toBe(0);
            await expect(menu.getByRole('menuitem', { name: 'Device files', exact: true }).count()).resolves.toBe(0);
            return menu;
        };

        let primaryActions = await assertDirectPrimaryActions();
        let menu = await openVisibleComposerMenu();
        await menu.getByRole('menuitem', { name: 'Attachments', exact: true }).click({ timeout: 3_000 });
        await expect(page.evaluate(() => (window as any).__ATTACHMENT_PICK_COUNT__ ?? 0)).resolves.toBe(1);
        await expect(foreground.locator('textarea[data-composer-menu-owner="main"]').inputValue())
            .resolves.toBe('Main Agent draft retained');
        await primaryActions.mic.click({ timeout: 3_000 });
        await expect(page.evaluate(() => (window as any).__DICTATION_TOGGLE_COUNT__ ?? 0)).resolves.toBe(1);
        await primaryActions.send.click({ timeout: 3_000 });
        await page.waitForFunction(() => (window as any).__COMPOSER_SENDS__?.some((entry: any) => (
            entry.sessionId === 'parent' && entry.text === 'Main Agent draft retained'
        )));

        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click({ timeout: 3_000 });
        await foreground.getByText('Newest child', { exact: true }).waitFor({ state: 'visible', timeout: 3_000 });
        const sideChatDraft = foreground.locator('textarea').filter({ visible: true }).last();
        await sideChatDraft.fill('Side chat draft retained');
        await sideChatDraft.evaluate((element) => { element.dataset.composerMenuOwner = 'side-chat'; });

        primaryActions = await assertDirectPrimaryActions();
        menu = await openVisibleComposerMenu();
        await menu.getByRole('menuitem', { name: 'Attachments', exact: true }).click({ timeout: 3_000 });
        await expect(page.evaluate(() => (window as any).__ATTACHMENT_PICK_COUNT__ ?? 0)).resolves.toBe(2);
        await expect(foreground.locator('textarea[data-composer-menu-owner="side-chat"]').inputValue())
            .resolves.toBe('Side chat draft retained');
        await primaryActions.mic.click({ timeout: 3_000 });
        await expect(page.evaluate(() => (window as any).__DICTATION_TOGGLE_COUNT__ ?? 0)).resolves.toBe(2);
        await primaryActions.send.click({ timeout: 3_000 });
        await page.waitForFunction(() => (window as any).__COMPOSER_SENDS__?.some((entry: any) => (
            entry.sessionId === 'child-newest' && entry.text === 'Side chat draft retained'
        )));

        expect(pageErrors).toEqual([]);
        await page.close();
    }, 20_000);

    it('keeps Changes and one canonical Workspace entry visible on desktop', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { machineWorkspaceEnabled: false };
        });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (
                (message.type() === 'error' || message.type() === 'warning')
                && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
                && message.text() !== '"shadow*" style props are deprecated. Use "boxShadow".'
            ) pageErrors.push(message.text());
        });
        await page.goto(origin);

        const foreground = page.getByTestId('foreground-session');
        for (const label of ['Changes', 'Workspace']) {
            await expect(foreground.getByText(label, { exact: true }).isVisible()).resolves.toBe(true);
        }
        await expect(foreground.getByText('Chat Workspace', { exact: true }).count()).resolves.toBe(0);
        await expect(foreground.getByText('Machine Workspace', { exact: true }).count()).resolves.toBe(0);

        await foreground.getByText('Changes', { exact: true }).click();
        await foreground.getByText('mobile-change.ts', { exact: true }).waitFor({ state: 'visible', timeout: 3_000 });

        await page.reload();
        await foreground.getByText('Workspace', { exact: true }).click();
        const workspace = foreground.getByTestId('desktop-file-workspace');
        await workspace.waitFor({ state: 'visible', timeout: 3_000 });
        await expect.poll(() => workspace.getByPlaceholder('Path').inputValue(), { timeout: 3_000 }).toBe('/work/project');
        await expect(workspace.getByText('Upload', { exact: true }).isVisible()).resolves.toBe(true);
        await workspace.getByText('machine-file.md', { exact: true }).click();
        await foreground.getByRole('tab', { name: 'Open file machine-file.md' }).waitFor({ state: 'visible', timeout: 3_000 });
        await expect(foreground.getByTestId('workspace-link-side-panel').count()).resolves.toBe(0);
        await expect(foreground.getByTestId('workspace-link-panel').count()).resolves.toBe(0);

        expect(pageErrors).toEqual([]);
        await page.close();
    }, 30_000);

    it.each([
        ['parent', 1440, 900], ['child-newest', 1440, 900],
        ['parent', 390, 844], ['child-newest', 390, 844],
    ] as const)('deletes files and folders through the actual %s Workspace host at width %s', async (owner, width, height) => {
        const page = await browser.newPage({ viewport: { width, height } });
        try {
            page.setDefaultTimeout(5_000);
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.addInitScript(() => { (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { workspaceDelete: true }; });
            await page.goto(origin);
            const foreground = page.getByTestId('foreground-session');
            const child = owner === 'child-newest';
            if (child) await foreground.getByRole('button', { name: 'Open side chats (2)' }).click();
            const actions = foreground.getByRole('button', { name: 'More actions' }).filter({ visible: true });
            await (child ? actions.last() : actions.first()).click();
            await foreground.getByTestId('mobile-composer-action-workspace').filter({ visible: true }).click();
            const workspace = foreground.getByTestId('desktop-file-workspace');
            const machineId = child ? 'machine-newest' : 'machine-1';
            const directory = child ? '/work/child-newest' : '/work/project';
            const evidence = process.env.HAPPYHERD_WORKSPACE_DELETE_EVIDENCE_DIR;
            const capture = async (phase: string) => {
                if (!evidence) return;
                mkdirSync(evidence, { recursive: true });
                await page.screenshot({ path: resolve(evidence, `${owner}-${width}-${phase}.png`), fullPage: true });
            };
            await workspace.getByLabel('Upload', { exact: true }).waitFor({ state: 'visible' });
            await capture('initial');
            await workspace.getByRole('button', { name: 'Delete reports', exact: true }).click();
            const modal = page.getByRole('dialog');
            await modal.getByText('Delete folder?', { exact: true }).waitFor({ state: 'visible' });
            await expect(modal.getByText('Delete folder?', { exact: true }).isVisible()).resolves.toBe(true);
            await expect(modal.getByText(`Are you sure you want to permanently remove ${directory}/reports and all its contents? This action cannot be undone.`, { exact: true }).isVisible()).resolves.toBe(true);
            await expect.poll(() => modal.getByText('Delete folder?', { exact: true }).evaluate((element) => {
                for (let current: Element | null = element; current; current = current.parentElement) {
                    if (Number(getComputedStyle(current).opacity) < 0.99) return false;
                }
                return true;
            })).toBe(true);
            await capture('confirmation');
            await modal.getByText('Cancel', { exact: true }).click();
            await modal.waitFor({ state: 'detached' });
            expect(await page.evaluate(() => (window as any).__MACHINE_DELETE_CALLS__ ?? [])).toEqual([]);
            await expect(workspace.getByRole('button', { name: 'Delete reports', exact: true }).isVisible()).resolves.toBe(true);

            await workspace.getByRole('button', { name: 'Delete notes.md', exact: true }).click();
            await modal.getByText('Delete', { exact: true }).click();
            await workspace.getByRole('button', { name: 'Delete notes.md', exact: true }).waitFor({ state: 'detached' });
            await workspace.getByRole('button', { name: 'Delete reports', exact: true }).click();
            await modal.getByText('Delete', { exact: true }).click();
            await workspace.getByRole('button', { name: 'Delete reports', exact: true }).waitFor({ state: 'detached' });
            expect(await page.evaluate(() => (window as any).__MACHINE_DELETE_CALLS__)).toEqual([
                { machineId, path: `${directory}/notes.md` },
                { machineId, path: `${directory}/reports`, recursive: true },
            ]);
            await expect(workspace.getByLabel('Upload', { exact: true }).isVisible()).resolves.toBe(true);
            await expect(workspace.getByLabel('New folder', { exact: true }).isVisible()).resolves.toBe(true);
            await capture('deleted');
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    }, 20_000);

    it('keeps Main and Side chat reviews separate for the same machine and file', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        page.setDefaultTimeout(3_000);
        await page.addInitScript(() => { (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { workspaceRetention: true, deferWorkspaceFeedback: true }; });
        await page.goto(origin, { timeout: 15_000 });
        const foreground = page.getByTestId('foreground-session');
        const workspace = foreground.getByTestId('desktop-file-workspace');
        const openWorkspace = async (child: boolean) => {
            if (child) await foreground.getByRole('button', { name: 'Open side chats (2)' }).click();
            const actions = foreground.getByRole('button', { name: 'More actions' }).filter({ visible: true });
            await (child ? actions.last() : actions.first()).click();
            await foreground.getByTestId('mobile-composer-action-workspace').filter({ visible: true }).click();
            await workspace.getByRole('button', { name: 'machine-file.md', exact: true }).filter({ visible: true }).click();
        };
        const pin = async (text: string) => {
            await workspace.getByRole('button', { name: 'Comment on line 1', exact: true }).filter({ visible: true }).click();
            await workspace.getByRole('textbox', { name: 'Write a comment' }).filter({ visible: true }).fill(text);
            await workspace.getByRole('button', { name: 'Pin comment', exact: true }).filter({ visible: true }).click();
        };
        await openWorkspace(false);
        await pin('Main comment');
        await workspace.getByPlaceholder('Share file feedback').filter({ visible: true }).fill('Main footer draft');
        await openWorkspace(true);
        await expect(workspace.getByText('Main comment', { exact: true }).filter({ visible: true }).count()).resolves.toBe(0);
        await expect(workspace.getByPlaceholder('Share file feedback').filter({ visible: true }).inputValue()).resolves.toBe('');
        await pin('Side comment');
        await workspace.getByPlaceholder('Share file feedback').filter({ visible: true }).fill('Side footer draft');
        await openWorkspace(false);
        await expect(workspace.getByText('Main comment', { exact: true }).filter({ visible: true }).count()).resolves.toBe(1);
        await expect(workspace.getByPlaceholder('Share file feedback').filter({ visible: true }).inputValue()).resolves.toBe('Main footer draft');
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(workspace.getByText('Main comment', { exact: true }).filter({ visible: true }).count()).resolves.toBe(1);
        await expect(workspace.getByText('Side comment', { exact: true }).filter({ visible: true }).count()).resolves.toBe(0);
        await page.setViewportSize({ width: 1440, height: 900 });
        await workspace.getByRole('button', { name: 'Send 1 comments', exact: true }).filter({ visible: true }).click();
        await openWorkspace(true);
        await page.evaluate(() => (window as any).__RESOLVE_WORKSPACE_FEEDBACK__());
        await expect(workspace.getByText('Side comment', { exact: true }).filter({ visible: true }).count()).resolves.toBe(1);
        await expect(workspace.getByPlaceholder('Share file feedback').filter({ visible: true }).inputValue()).resolves.toBe('Side footer draft');
        await workspace.getByRole('button', { name: 'Send 1 comments', exact: true }).filter({ visible: true }).click();
        const sends = await page.evaluate(() => (window as any).__COMPOSER_SENDS__ ?? []);
        expect(sends).toHaveLength(2);
        expect(sends[0].sessionId).toBe('parent');
        expect(sends[0].text).toContain('Main comment');
        expect(sends[1].sessionId).toBe('child-newest');
        expect(sends[1].text).toContain('Side comment');
        await page.close();
    }, 20_000);

    it('does not let a slow reply probe replace a newer file chosen from Workspace', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        page.setDefaultTimeout(3_000);
        await page.addInitScript(() => { (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { workspaceRetention: true, deferSamePathProbe: true }; });
        await page.goto(origin, { timeout: 15_000 });
        const foreground = page.getByTestId('foreground-session');
        await foreground.getByText('Slow file', { exact: true }).first().click();
        await page.waitForFunction(() => !!(window as any).__RESOLVE_SAME_PATH_PROBE__);
        await foreground.getByRole('button', { name: 'More actions' }).filter({ visible: true }).first().click();
        await foreground.getByTestId('mobile-composer-action-workspace').filter({ visible: true }).click();
        const workspace = foreground.getByTestId('desktop-file-workspace');
        await workspace.getByRole('button', { name: 'machine-file.md', exact: true }).filter({ visible: true }).click();
        const newerPanel = workspace.getByTestId('desktop-file-panel:/work/project/machine-file.md');
        await newerPanel.waitFor({ state: 'visible' });
        await page.evaluate(() => (window as any).__RESOLVE_SAME_PATH_PROBE__());
        await expect(newerPanel.isVisible()).resolves.toBe(true);
        await expect(workspace.getByRole('tab', { name: 'Open file session-note.md' }).count()).resolves.toBe(0);
        await page.close();
    }, 20_000);

    it('does not let a completed folder creation cancel a newer reply link', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        page.setDefaultTimeout(3_000);
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = {
                workspaceRetention: true, deferSamePathProbe: true, deferCreateDirectory: true,
            };
        });
        await page.goto(origin, { timeout: 15_000 });
        const foreground = page.getByTestId('foreground-session');
        await foreground.getByRole('button', { name: 'More actions' }).filter({ visible: true }).first().click();
        await foreground.getByTestId('mobile-composer-action-workspace').filter({ visible: true }).click();
        const workspace = foreground.getByTestId('desktop-file-workspace');
        await workspace.getByLabel('New folder', { exact: true }).click();
        await page.getByPlaceholder('Folder name').fill('reports');
        await page.getByText('Create', { exact: true }).click();
        await page.waitForFunction(() => !!(window as any).__RESOLVE_CREATE_DIRECTORY__);
        await expect(page.evaluate(() => (window as any).__MACHINE_CREATE_DIRECTORY_CALL__)).resolves.toEqual({
            machineId: 'machine-1', directory: '/work/project', directoryName: 'reports',
        });
        await foreground.getByText('Slow file', { exact: true }).first().click();
        await page.waitForFunction(() => !!(window as any).__RESOLVE_SAME_PATH_PROBE__);
        await page.evaluate(() => (window as any).__RESOLVE_CREATE_DIRECTORY__());
        await expect.poll(() => workspace.getByPlaceholder('Path').inputValue()).toBe('/work/project/reports');
        await page.evaluate(() => (window as any).__RESOLVE_SAME_PATH_PROBE__());
        await workspace.getByTestId('desktop-file-panel:/work/project/session-note.md').waitFor({ state: 'visible' });
        await expect(workspace.getByRole('tab', { name: 'Open file session-note.md' }).count()).resolves.toBe(1);
        await page.close();
    }, 20_000);

    it.each([
        ['directory', '/work/project/reports', /^reports$/, /^report\.md$/],
        ['machine', '/work/child-newest', /^SideEC2$/, /^child-newest-machine-file\.md$/],
    ] as const)('keeps newer picker %s navigation while its directory request and an older reply probe are pending', async (_gesture, targetPath, buttonName, fileName) => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        page.setDefaultTimeout(3_000);
        await page.addInitScript((deferDirectoryPath) => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = {
                workspaceRetention: true, deferSamePathProbe: true, deferDirectoryPath,
            };
        }, targetPath);
        await page.goto(origin, { timeout: 15_000 });
        const foreground = page.getByTestId('foreground-session');
        await foreground.getByRole('button', { name: 'More actions' }).filter({ visible: true }).first().click();
        await foreground.getByTestId('mobile-composer-action-workspace').filter({ visible: true }).click();
        const workspace = foreground.getByTestId('desktop-file-workspace');
        const pathInput = workspace.getByPlaceholder('Path');
        await expect.poll(() => pathInput.inputValue()).toBe('/work/project');
        await pathInput.evaluate((element) => { element.dataset.retainedPickerPath = 'mounted'; });
        await foreground.getByText('Slow file', { exact: true }).first().click();
        await page.waitForFunction(() => !!(window as any).__RESOLVE_SAME_PATH_PROBE__);
        await workspace.getByRole('button', { name: buttonName }).click();
        await page.waitForFunction(() => !!(window as any).__RESOLVE_BROWSER_DIRECTORY__);
        if (_gesture === 'directory') {
            await expect(pathInput.inputValue()).resolves.toBe(targetPath);
        }
        await page.evaluate(async () => {
            (window as any).__RESOLVE_SAME_PATH_PROBE__();
            await new Promise(requestAnimationFrame);
            await new Promise(requestAnimationFrame);
        });
        await expect(pathInput.isVisible()).resolves.toBe(true);
        await expect(pathInput.getAttribute('data-retained-picker-path')).resolves.toBe('mounted');
        if (_gesture === 'directory') {
            await expect(pathInput.inputValue()).resolves.toBe(targetPath);
        }
        await expect(workspace.getByRole('tab', { name: 'Open file session-note.md' }).count()).resolves.toBe(0);
        await page.evaluate(() => (window as any).__RESOLVE_BROWSER_DIRECTORY__());
        await workspace.getByRole('button', { name: fileName }).waitFor({ state: 'visible' });
        await expect(pathInput.inputValue()).resolves.toBe(targetPath);
        await page.close();
    }, 20_000);

    it('does not let a slow reply probe collapse a newly opened Side chat', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        page.setDefaultTimeout(3_000);
        await page.addInitScript(() => { (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { workspaceRetention: true, deferSamePathProbe: true }; });
        await page.goto(origin, { timeout: 15_000 });
        const foreground = page.getByTestId('foreground-session');
        await foreground.getByText('Slow file', { exact: true }).first().click();
        await page.waitForFunction(() => !!(window as any).__RESOLVE_SAME_PATH_PROBE__);
        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click();
        await foreground.getByText('Newest child', { exact: true }).waitFor({ state: 'visible' });
        await page.evaluate(() => (window as any).__RESOLVE_SAME_PATH_PROBE__());
        await expect(foreground.getByText('Newest child', { exact: true }).isVisible()).resolves.toBe(true);
        await expect(foreground.getByRole('tab', { name: 'Open file session-note.md' }).count()).resolves.toBe(0);
        await page.close();
    }, 20_000);

    it.each([
        ['desktop', { width: 1440, height: 900 }],
        ['mobile', { width: 390, height: 844 }],
    ] as const)('returns to the reply-linked directory after viewing a file on %s', async (_surface, viewport) => {
        const page = await browser.newPage({ viewport });
        page.setDefaultTimeout(3_000);
        await page.addInitScript(() => { (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { workspaceRetention: true }; });
        await page.goto(origin, { timeout: 15_000 });
        const foreground = page.getByTestId('foreground-session');
        await foreground.getByText('Browse reports', { exact: true }).first().click();
        const workspace = foreground.getByTestId('desktop-file-workspace');
        await expect.poll(() => workspace.getByPlaceholder('Path').filter({ visible: true }).inputValue()).toBe('/work/reports');
        await workspace.getByRole('button', { name: 'report.md', exact: true }).filter({ visible: true }).click();
        // Phones carry the full Workspace in their right sheet, so the same control returns to the folder.
        await workspace.getByLabel('Workspace', { exact: true }).filter({ visible: true }).click();
        await expect(workspace.getByPlaceholder('Path').filter({ visible: true }).inputValue()).resolves.toBe('/work/reports');
        await expect(workspace.getByRole('button', { name: 'report.md', exact: true }).filter({ visible: true }).isVisible()).resolves.toBe(true);
        await page.close();
    }, 20_000);

    it('opens the right-panel Workspace at the active Side chat machine and cwd and targets its context', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (
                (message.type() === 'error' || message.type() === 'warning')
                && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
                && message.text() !== '"shadow*" style props are deprecated. Use "boxShadow".'
            ) pageErrors.push(message.text());
        });
        await page.goto(origin);

        const foreground = page.getByTestId('foreground-session');
        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click({ timeout: 3_000 });
        await foreground.getByText('Newest child', { exact: true }).waitFor({ state: 'visible', timeout: 3_000 });
        await foreground.getByLabel('Add panel').click({ timeout: 3_000 });
        await foreground.getByText('Workspace', { exact: true }).filter({ visible: true }).click({ timeout: 3_000 });

        const workspace = foreground.getByTestId('desktop-file-workspace');
        await workspace.waitFor({ state: 'visible', timeout: 3_000 });
        await expect.poll(() => workspace.getByPlaceholder('Path').inputValue(), { timeout: 3_000 }).toBe('/work/child-newest');
        await workspace.getByLabel('Attach child-newest-machine-file.md to next message').click({ timeout: 3_000 });
        await expect(page.evaluate(() => (window as any).__WORKSPACE_CONTEXT_CALLS__ ?? [])).resolves.toEqual([{
            sessionId: 'child-newest',
            entry: {
                path: '/work/child-newest/child-newest-machine-file.md',
                kind: 'file',
                source: { kind: 'machine', machineId: 'machine-newest' },
            },
        }]);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 15_000);

    it('dismisses an expanded desktop Side chat before revealing its requested workspace', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (
                (message.type() === 'error' || message.type() === 'warning')
                && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
                && message.text() !== '"shadow*" style props are deprecated. Use "boxShadow".'
            ) pageErrors.push(message.text());
        });
        await page.goto(origin);

        const foreground = page.getByTestId('foreground-session');
        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click({ timeout: 3_000 });
        await foreground.getByLabel('Expand side chat').click({ timeout: 3_000 });
        const modal = page.getByTestId('fixture-global-modal');
        await modal.waitFor({ state: 'visible', timeout: 3_000 });
        await modal.getByRole('button', { name: 'Open Side chat outside file' }).click({ timeout: 3_000 });

        await modal.waitFor({ state: 'detached', timeout: 3_000 });
        await foreground.getByTestId('desktop-file-workspace').waitFor({ state: 'visible', timeout: 3_000 });
        await foreground.getByRole('tab', { name: 'Open file side-notes.md' }).waitFor({ state: 'visible', timeout: 3_000 });
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 15_000);

    it('expands the real session workspace to 75 percent without losing mounted chat or file state', async () => {
        // The docked split starts at 1,100 px; below it the Workspace is an overlay sheet (UI overhaul).
        const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
        await page.addInitScript(() => {
            (window as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { zenMode: true };
        });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (
                (message.type() === 'error' || message.type() === 'warning')
                && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
                && message.text() !== '"shadow*" style props are deprecated. Use "boxShadow".'
            ) {
                pageErrors.push(message.text());
            }
        });
        await page.goto(origin);

        const foreground = page.getByTestId('foreground-session');
        await page.waitForTimeout(100);
        expect(pageErrors).toEqual([]);
        const composerDraft = foreground.locator('textarea').first();
        await composerDraft.waitFor({ state: 'visible', timeout: 3_000 });
        await foreground.evaluate((root) => {
            const scroll = Array.from(root.querySelectorAll<HTMLElement>('div')).find((element) => (
                getComputedStyle(element).overflowY === 'auto'
                && element.scrollHeight > element.clientHeight
                && element.textContent?.includes('Fixture chat line')
            ));
            if (!scroll) throw new Error('real ChatList scroll container was not rendered');
            scroll.dataset.retentionChatScroll = 'mounted';
        });
        const chatScroll = foreground.locator('[data-retention-chat-scroll="mounted"]');
        await chatScroll.waitFor({ state: 'visible', timeout: 3_000 });
        // Zen mode keeps the right panel mounted but gives it no width.
        await expect(foreground.getByTestId('desktop-right-panel-host')
            .evaluate((element) => element.getBoundingClientRect().width)).resolves.toBe(0);
        await composerDraft.fill('main draft survives first open');
        await composerDraft.evaluate((element) => { element.dataset.retentionComposer = 'main'; });

        const workspaceLink = foreground.getByRole('button', { name: 'Open Main Agent outside file' }).first();
        await workspaceLink.click();
        await expect(page.evaluate(() => (window as any).__FILE_TREE_COUNT__ ?? 0)).resolves.toBe(1);
        const workspace = foreground.getByTestId('desktop-file-workspace');
        const fileTab = foreground.getByRole('tab', { name: 'Open file main-notes.md' });
        const host = foreground.getByTestId('desktop-file-workspace-host');
        const divider = foreground.getByTestId('desktop-file-workspace-divider');
        const split = foreground.getByTestId('desktop-file-workspace-split');
        await workspace.waitFor({ state: 'visible', timeout: 3_000 });
        await fileTab.waitFor({ state: 'visible', timeout: 3_000 });
        await workspace.getByRole('button', { name: 'Edit', exact: true }).click();
        const editor = workspace.locator('textarea.code-editor-textarea');
        await editor.waitFor({ state: 'visible', timeout: 3_000 });

        await editor.evaluate((element) => { element.dataset.retentionFileEditor = 'mounted'; });
        const unsavedValue = Array.from({ length: 80 }, (_, index) => `unsaved line ${index}`).join('\n');
        await editor.fill(unsavedValue);
        await editor.evaluate((element) => {
            let scroll: HTMLElement | null = element.parentElement;
            while (scroll && getComputedStyle(scroll).overflowY !== 'auto') scroll = scroll.parentElement;
            if (!scroll) throw new Error('real CodeEditor scroll container was not rendered');
            scroll.dataset.retentionFileScroll = 'mounted';
            scroll.scrollTop = 120;
        });
        const editorScroll = workspace.locator('[data-retention-file-scroll="mounted"]');
        await chatScroll.evaluate((element) => { element.scrollTop = 120; });
        const initialEditorScrollTop = await editorScroll.evaluate((element) => element.scrollTop);
        const initialChatScrollTop = await chatScroll.evaluate((element) => element.scrollTop);
        expect(initialEditorScrollTop).toBeGreaterThan(0);
        expect(initialChatScrollTop).toBeGreaterThan(0);

        const initialHostBox = await host.boundingBox();
        const initialDividerBox = await divider.boundingBox();
        if (!initialHostBox || !initialDividerBox) {
            throw new Error('canonical file workspace split has no measurable layout');
        }
        await expect(foreground.getByTestId('workspace-link-side-panel').count()).resolves.toBe(0);
        await expect(foreground.getByTestId('workspace-link-panel').count()).resolves.toBe(0);
        await expect(foreground.locator('textarea[data-retention-composer="main"]').isVisible()).resolves.toBe(true);
        await expect(composerDraft.inputValue()).resolves.toBe('main draft survives first open');

        await workspaceLink.click();
        await expect(foreground.getByRole('tab', { name: 'Open file main-notes.md' }).count()).resolves.toBe(1);

        await page.mouse.move(
            initialDividerBox.x + initialDividerBox.width / 2,
            initialDividerBox.y + initialDividerBox.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
            initialDividerBox.x - 2_000,
            initialDividerBox.y + initialDividerBox.height / 2,
            { steps: 12 },
        );
        await page.mouse.up();

        const resizedHostBox = await host.boundingBox();
        const resizedSplitBox = await split.boundingBox();
        const resizedDividerBox = await divider.boundingBox();
        if (!resizedHostBox || !resizedSplitBox || !resizedDividerBox) {
            throw new Error('resized workspace link host has no layout');
        }
        const resizedPaneWidth = resizedSplitBox.width - resizedDividerBox.width;
        const resizedChatWidth = resizedPaneWidth - resizedHostBox.width;
        expect(resizedHostBox.width / resizedPaneWidth).toBeCloseTo(0.75, 2);
        expect(resizedChatWidth / resizedPaneWidth).toBeCloseTo(0.25, 2);
        expect(resizedHostBox.width).toBeGreaterThan(initialHostBox.width + 100);
        await expect(foreground.locator('textarea[data-retention-composer="main"]').isVisible()).resolves.toBe(true);
        await expect(composerDraft.inputValue()).resolves.toBe('main draft survives first open');
        await expect(chatScroll.evaluate((element) => element.scrollTop)).resolves.toBe(initialChatScrollTop);
        await expect(editor.getAttribute('data-retention-file-editor')).resolves.toBe('mounted');
        await expect(editor.inputValue()).resolves.toBe(unsavedValue);
        await expect(editorScroll.evaluate((element) => element.scrollTop)).resolves.toBe(initialEditorScrollTop);

        // On a phone the same Workspace becomes the right sheet, leaving a 16 px strip of the chat.
        await page.setViewportSize({ width: 390, height: 844 });
        await foreground.getByTestId('desktop-file-workspace-divider').waitFor({ state: 'detached', timeout: 3_000 });
        await host.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
        const narrowHostBox = await host.boundingBox();
        const narrowForegroundBox = await foreground.boundingBox();
        if (!narrowHostBox || !narrowForegroundBox) throw new Error('phone Workspace sheet has no layout');
        expect(Math.abs(narrowHostBox.x - (narrowForegroundBox.x + 16))).toBeLessThan(2);
        expect(Math.abs(narrowHostBox.width - (narrowForegroundBox.width - 16))).toBeLessThan(2);
        expect(Math.abs(narrowHostBox.height - narrowForegroundBox.height)).toBeLessThan(2);
        await expect(foreground.getByRole('tab', { name: 'Open file main-notes.md' }).count()).resolves.toBe(1);
        await expect(workspace.isVisible()).resolves.toBe(true);
        await expect(foreground.locator('textarea[data-retention-composer="main"]').isVisible()).resolves.toBe(true);
        await expect(composerDraft.inputValue()).resolves.toBe('main draft survives first open');
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);

    it('slides the Workspace and the right panel over the chat below 1100px and keeps every draft mounted', async () => {
        const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (
                (message.type() === 'error' || message.type() === 'warning')
                && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
                && message.text() !== '"shadow*" style props are deprecated. Use "boxShadow".'
            ) pageErrors.push(message.text());
        });
        await page.goto(origin);

        const foreground = page.getByTestId('foreground-session');
        const composerDraft = foreground.locator('textarea').first();
        await composerDraft.waitFor({ state: 'visible', timeout: 3_000 });
        await composerDraft.fill('main draft survives the overlay');
        await composerDraft.evaluate((element) => { element.dataset.overlayComposer = 'main'; });
        await foreground.evaluate((root) => {
            const scroll = Array.from(root.querySelectorAll<HTMLElement>('div')).find((element) => (
                getComputedStyle(element).overflowY === 'auto'
                && element.scrollHeight > element.clientHeight
                && element.textContent?.includes('Fixture chat line')
            ));
            if (!scroll) throw new Error('real ChatList scroll container was not rendered');
            scroll.dataset.overlayChatScroll = 'mounted';
            scroll.scrollTop = 120;
        });
        const chatScroll = foreground.locator('[data-overlay-chat-scroll="mounted"]');
        const chatScrollTop = await chatScroll.evaluate((element) => element.scrollTop);
        expect(chatScrollTop).toBeGreaterThan(0);

        // The Workspace opens as a sheet over the chat: no divider, a scrim beside it.
        await foreground.getByRole('button', { name: 'Open Main Agent outside file' }).first().click();
        const workspace = foreground.getByTestId('desktop-file-workspace');
        const host = foreground.getByTestId('desktop-file-workspace-host');
        const scrim = foreground.getByTestId('desktop-panel-overlay-scrim');
        await workspace.waitFor({ state: 'visible', timeout: 3_000 });
        await scrim.waitFor({ state: 'visible', timeout: 3_000 });
        await expect(foreground.getByTestId('desktop-file-workspace-divider').count()).resolves.toBe(0);
        const [hostBox, foregroundBox] = await Promise.all([host.boundingBox(), foreground.boundingBox()]);
        if (!hostBox || !foregroundBox) throw new Error('overlay sheet has no layout');
        expect(Math.abs(hostBox.x + hostBox.width - (foregroundBox.x + foregroundBox.width))).toBeLessThan(2);
        expect(hostBox.width).toBeLessThan(foregroundBox.width - 40);

        await workspace.getByRole('button', { name: 'Edit', exact: true }).click();
        const editor = workspace.locator('textarea.code-editor-textarea');
        await editor.waitFor({ state: 'visible', timeout: 3_000 });
        const unsavedValue = Array.from({ length: 60 }, (_, index) => `overlay draft line ${index}`).join('\n');
        await editor.fill(unsavedValue);
        await editor.evaluate((element) => { element.dataset.overlayEditor = 'mounted'; });

        // The scrim closes the sheet; nothing unmounts.
        const scrimBox = await scrim.boundingBox();
        if (!scrimBox) throw new Error('overlay scrim has no layout');
        await page.mouse.click(scrimBox.x + 24, scrimBox.y + scrimBox.height / 2);
        await scrim.waitFor({ state: 'detached', timeout: 3_000 });
        await expect(host.isVisible()).resolves.toBe(false);
        await expect(foreground.locator('textarea[data-overlay-editor="mounted"]').count()).resolves.toBe(1);
        await expect(foreground.locator('textarea[data-overlay-composer="main"]').inputValue())
            .resolves.toBe('main draft survives the overlay');
        await expect(chatScroll.evaluate((element) => element.scrollTop)).resolves.toBe(chatScrollTop);

        // Reopening shows the same editor with its unsaved text.
        await foreground.getByRole('button', { name: 'Open Main Agent outside file' }).first().click();
        await scrim.waitFor({ state: 'visible', timeout: 3_000 });
        await expect(editor.getAttribute('data-overlay-editor')).resolves.toBe('mounted');
        await expect(editor.inputValue()).resolves.toBe(unsavedValue);

        // Escape closes it too once focus leaves the editor.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('Escape');
        await scrim.waitFor({ state: 'detached', timeout: 3_000 });
        await expect(editor.inputValue()).resolves.toBe(unsavedValue);

        // Side chats use the same sheet; Hide panel keeps the child composer mounted.
        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click();
        await scrim.waitFor({ state: 'visible', timeout: 3_000 });
        await foreground.getByText('Newest child', { exact: true }).waitFor({ state: 'visible', timeout: 3_000 });
        const childDraft = foreground.locator('textarea').filter({ visible: true }).last();
        await childDraft.fill('side chat draft survives');
        await childDraft.evaluate((element) => { element.dataset.overlayComposer = 'child'; });
        await foreground.getByTestId('files-sidebar-hide').click();
        await scrim.waitFor({ state: 'detached', timeout: 3_000 });
        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click();
        await scrim.waitFor({ state: 'visible', timeout: 3_000 });
        await expect(foreground.locator('textarea[data-overlay-composer="child"]').inputValue())
            .resolves.toBe('side chat draft survives');
        await expect(foreground.locator('textarea[data-overlay-composer="main"]').inputValue())
            .resolves.toBe('main draft survives the overlay');
        await expect(foreground.locator('textarea[data-overlay-editor="mounted"]').inputValue()).resolves.toBe(unsavedValue);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 20_000);

    it('opens a same-session link directly in the phone Workspace sheet', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (
                (message.type() === 'error' || message.type() === 'warning')
                && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
                && message.text() !== '"shadow*" style props are deprecated. Use "boxShadow".'
            ) pageErrors.push(message.text());
        });
        await page.goto(origin);

        const foreground = page.getByTestId('foreground-session');
        const composerDraft = foreground.locator('textarea').first();
        await composerDraft.waitFor({ state: 'visible', timeout: 3_000 });
        await composerDraft.fill('mobile draft survives first open');
        await composerDraft.evaluate((element) => { element.dataset.retentionComposer = 'mobile-main'; });
        await foreground.getByRole('button', { name: 'Open Main Agent outside file' }).first().click();

        const workspace = foreground.getByTestId('desktop-file-workspace');
        await workspace.waitFor({ state: 'visible', timeout: 3_000 });
        // The right sheet over a 16 px strip of the chat, not a full-screen view.
        await foreground.getByTestId('desktop-panel-overlay-scrim').waitFor({ state: 'visible', timeout: 3_000 });
        const host = foreground.getByTestId('desktop-file-workspace-host');
        await host.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
        await expect(host.boundingBox().then((box) => Math.round(box!.x))).resolves.toBe(16);
        await expect(foreground.getByText('main-notes.md').filter({ visible: true }).first().isVisible()).resolves.toBe(true);
        await expect(foreground.getByTestId('desktop-file-workspace-divider').count()).resolves.toBe(0);
        await expect(foreground.getByTestId('workspace-link-side-panel').count()).resolves.toBe(0);
        await expect(foreground.getByTestId('workspace-link-panel').count()).resolves.toBe(0);
        await expect(foreground.locator('textarea[data-retention-composer="mobile-main"]').isVisible()).resolves.toBe(true);
        await expect(composerDraft.inputValue()).resolves.toBe('mobile draft survives first open');
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);

    it.each([
        ['Web Desktop', 'Main Agent', { width: 1440, height: 900 }, 'Open Main Agent outside file', 'parent', '/outside/main-notes.md', 27, 9],
        ['Web Desktop', 'Side chat', { width: 1440, height: 900 }, 'Open Side chat outside file', 'child-newest', '/outside/side-notes.md', 41, 6],
        ['Web Mobile', 'Main Agent', { width: 390, height: 844 }, 'Open Main Agent outside file', 'parent', '/outside/main-notes.md', 27, 9],
        ['Web Mobile', 'Side chat', { width: 390, height: 844 }, 'Open Side chat outside file', 'child-newest', '/outside/side-notes.md', 41, 6],
    ] as const)(
        'uses machine transport for an outside-cwd %s %s reply link',
        async (surface, owner, viewport, linkLabel, originSessionId, absolutePath, line, column) => {
            const page = await browser.newPage({ viewport });
            const pageErrors: string[] = [];
            page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
            page.on('console', (message) => {
                if (
                    (message.type() === 'error' || message.type() === 'warning')
                    && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
                    && message.text() !== '"shadow*" style props are deprecated. Use "boxShadow".'
                ) pageErrors.push(message.text());
            });
            await page.goto(origin);

            const foreground = page.getByTestId('foreground-session');
            if (owner === 'Side chat') {
                await foreground.getByRole('button', { name: 'Open side chats (2)' }).click({ timeout: 3_000 });
                await foreground.getByText('Newest child', { exact: true }).waitFor({ state: 'visible', timeout: 3_000 });
            }
            const link = foreground.getByRole('button', { name: linkLabel }).filter({ visible: true });
            await (owner === 'Side chat' ? link.last() : link.first()).click({ timeout: 3_000 });

            const workspace = foreground.getByTestId('desktop-file-workspace');
            await workspace.waitFor({ state: 'visible', timeout: 3_000 });
            await page.waitForFunction(({ path }) => (
                (window as any).__MACHINE_READ_CALLS__?.some((entry: any) => (
                    entry.machineId === 'machine-1' && entry.path === path
                ))
            ), { path: absolutePath });
            const transportCalls = await page.evaluate((path) => ({
                machineReads: (window as any).__MACHINE_READ_CALLS__ ?? [],
                sessionReads: (window as any).__SESSION_READ_CALLS__ ?? [],
                path,
            }), absolutePath);
            expect(transportCalls.machineReads).toContainEqual({ machineId: 'machine-1', path: absolutePath });
            expect(transportCalls.sessionReads.some((entry: any) => entry.path === absolutePath)).toBe(false);
            await expect(workspace.getByRole('button', { name: 'Preview', exact: true }).filter({ visible: true }).isVisible())
                .resolves.toBe(true);

            await workspace.getByRole('button', { name: 'Edit', exact: true }).filter({ visible: true }).click();
            const editor = workspace.locator('textarea.code-editor-textarea').filter({ visible: true });
            await editor.waitFor({ state: 'visible', timeout: 3_000 });
            const editedContent = `Edited through ${surface} ${owner}`;
            await editor.fill(editedContent);
            await workspace.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).click();
            await page.waitForFunction(({ path }) => (
                (window as any).__MACHINE_WRITE_CALLS__?.some((entry: any) => entry.path === path)
            ), { path: absolutePath });
            const writeCalls = await page.evaluate(() => ({
                machine: (window as any).__MACHINE_WRITE_CALLS__ ?? [],
                session: (window as any).__SESSION_WRITE_CALLS__ ?? [],
            }));
            expect(writeCalls.machine.some((entry: any) => (
                entry.machineId === 'machine-1'
                && entry.path === absolutePath
                && atob(entry.content) === editedContent
            ))).toBe(true);
            expect(writeCalls.session.some((entry: any) => entry.path === absolutePath)).toBe(false);

            const feedback = `Feedback from ${surface} ${owner}`;
            const feedbackInput = workspace.getByPlaceholder('Share file feedback').filter({ visible: true });
            await feedbackInput.fill(feedback);
            await workspace.getByRole('button', { name: 'Send', exact: true }).filter({ visible: true }).click();
            await page.waitForFunction(({ sessionId, path }) => (
                (window as any).__COMPOSER_SENDS__?.some((entry: any) => (
                    entry.sessionId === sessionId && entry.text.includes(`Absolute path: ${path}`)
                ))
            ), { sessionId: originSessionId, path: absolutePath });
            const feedbackSend = await page.evaluate(({ sessionId, path }) => (
                (window as any).__COMPOSER_SENDS__.find((entry: any) => (
                    entry.sessionId === sessionId && entry.text.includes(`Absolute path: ${path}`)
                ))
            ), { sessionId: originSessionId, path: absolutePath });
            expect(feedbackSend.text).toContain(`Line: ${line}`);
            expect(feedbackSend.text).toContain(`Column: ${column}`);
            expect(feedbackSend.text).toContain(feedback);

            if (surface === 'Web Desktop') {
                await workspace.getByRole('button', { name: 'Delete', exact: true }).filter({ visible: true }).click();
                await page.waitForFunction(({ path }) => (
                    (window as any).__MACHINE_DELETE_CALLS__?.some((entry: any) => entry.path === path)
                ), { path: absolutePath });
                const deleteCalls = await page.evaluate(() => ({
                    machine: (window as any).__MACHINE_DELETE_CALLS__ ?? [],
                    session: (window as any).__SESSION_DELETE_CALLS__ ?? [],
                }));
                expect(deleteCalls.machine).toContainEqual({ machineId: 'machine-1', path: absolutePath });
                expect(deleteCalls.session.some((entry: any) => entry.path === absolutePath)).toBe(false);
            }

            expect(pageErrors).toEqual([]);
            await page.close();
        },
        20_000,
    );

    it('opens Changes and the unified Main Agent Workspace from the Web Mobile composer menu', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = {
                machineWorkspaceEnabled: false,
                realtimeStatus: 'connected',
                zenMode: true,
            };
        });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (
                (message.type() === 'error' || message.type() === 'warning')
                && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
                && message.text() !== '"shadow*" style props are deprecated. Use "boxShadow".'
            ) pageErrors.push(message.text());
        });
        await page.goto(origin);

        const foreground = page.getByTestId('foreground-session');
        const voiceStatus = foreground.getByTestId('voice-status-bar');
        await voiceStatus.waitFor({ state: 'visible', timeout: 3_000 });
        await expect(foreground.getByTestId('mobile-session-workspace-access').count()).resolves.toBe(0);

        const composerDraft = foreground.locator('textarea').first();
        const actionTrigger = foreground.getByTestId('mobile-composer-actions-trigger');
        await composerDraft.waitFor({ state: 'visible', timeout: 3_000 });
        await composerDraft.fill('main draft survives workspace return');
        await composerDraft.evaluate((element) => { element.dataset.retentionComposer = 'main'; });
        await expect(actionTrigger.count()).resolves.toBe(1);
        await expect(actionTrigger.isVisible()).resolves.toBe(true);

        const assertMainComposerRetained = async () => {
            const retainedDraft = foreground.locator('textarea[data-retention-composer="main"]');
            await retainedDraft.waitFor({ state: 'visible', timeout: 3_000 });
            await expect(retainedDraft.inputValue()).resolves.toBe('main draft survives workspace return');
            await expect(foreground.getByTestId('mobile-session-workspace-access').count()).resolves.toBe(0);
        };
        const openMainAction = async (key: string) => {
            await actionTrigger.click({ timeout: 3_000 });
            const menu = foreground.getByTestId('mobile-composer-actions-menu');
            await menu.waitFor({ state: 'visible', timeout: 3_000 });
            for (const label of ['Changes', 'Workspace']) {
                await expect(menu.getByRole('menuitem', { name: label, exact: true }).isVisible()).resolves.toBe(true);
            }
            await expect(menu.getByRole('menuitem', { name: 'Chat Workspace', exact: true }).count()).resolves.toBe(0);
            await expect(menu.getByRole('menuitem', { name: 'Machine Workspace', exact: true }).count()).resolves.toBe(0);
            await menu.getByTestId(`mobile-composer-action-${key}`).click({ timeout: 3_000 });
        };

        await openMainAction('changes');
        await foreground.getByRole('button', { name: '/work/project/mobile-change.ts', exact: true })
            .waitFor({ state: 'visible', timeout: 3_000 });
        const voiceBox = await voiceStatus.boundingBox();
        const changesBox = await foreground.getByTestId('mobile-changes-workspace-overlay').boundingBox();
        if (!voiceBox || !changesBox) throw new Error('voice status or Changes workspace has no rendered layout');
        expect(changesBox.y).toBeGreaterThanOrEqual(voiceBox.y + voiceBox.height);
        await page.mouse.click(20, 32);
        await foreground.getByTestId('mobile-changes-workspace-overlay').waitFor({ state: 'detached', timeout: 3_000 });
        await assertMainComposerRetained();

        // The Workspace opens in the phone's right sheet, over a 16 px strip of the chat.
        await openMainAction('workspace');
        const sheetWorkspace = page.getByTestId('desktop-file-workspace').filter({ visible: true });
        await sheetWorkspace.waitFor({ state: 'visible', timeout: 3_000 });
        const scrim = foreground.getByTestId('desktop-panel-overlay-scrim');
        await scrim.waitFor({ state: 'visible', timeout: 3_000 });
        await expect(sheetWorkspace.getByPlaceholder('Path').inputValue()).resolves.toBe('/work/project');
        await page.getByText('MainEC2').filter({ visible: true }).waitFor({ state: 'visible', timeout: 3_000 });
        await expect(page.getByText('Upload', { exact: true }).filter({ visible: true }).isVisible())
            .resolves.toBe(true);
        const machineFile = page.getByText('machine-file.md').filter({ visible: true });
        await machineFile.waitFor({ state: 'visible', timeout: 3_000 });
        await page.mouse.click(8, 420);
        await scrim.waitFor({ state: 'detached', timeout: 3_000 });
        await assertMainComposerRetained();
        await expect(page.getByTestId('desktop-file-workspace-divider').count()).resolves.toBe(0);

        expect(pageErrors).toEqual([]);
        await page.close();
    }, 30_000);

    it('keeps Side chat workspace actions on the active child without remounting its composer', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = {
                machineWorkspaceEnabled: false,
                zenMode: true,
            };
        });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (
                (message.type() === 'error' || message.type() === 'warning')
                && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
                && message.text() !== '"shadow*" style props are deprecated. Use "boxShadow".'
            ) pageErrors.push(message.text());
        });
        await page.goto(origin);

        const foreground = page.getByTestId('foreground-session');
        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click({ timeout: 3_000 });
        await expect(foreground.getByTestId('mobile-session-workspace-access').count()).resolves.toBe(0);

        await foreground.getByText('Oldest child', { exact: true }).click();
        await foreground.getByText('Newest child', { exact: true }).click();
        const newestDraft = foreground.locator('textarea').last();
        const newestActionTrigger = foreground.getByTestId('mobile-composer-actions-trigger').last();
        await newestDraft.waitFor({ state: 'visible', timeout: 3_000 });
        await newestDraft.fill('child draft survives workspace return');
        await newestDraft.evaluate((element) => { element.dataset.retentionComposer = 'child-newest'; });
        await expect(newestActionTrigger.isVisible()).resolves.toBe(true);
        const assertNewestComposerRetained = async () => {
            const retainedDraft = foreground.locator('textarea[data-retention-composer="child-newest"]');
            await retainedDraft.waitFor({ state: 'visible', timeout: 3_000 });
            await expect(retainedDraft.inputValue()).resolves.toBe('child draft survives workspace return');
            await expect(foreground.getByTestId('mobile-session-workspace-access').count()).resolves.toBe(0);
        };
        const openNewestAction = async (key: string) => {
            await newestActionTrigger.click({ timeout: 3_000 });
            const menu = foreground.getByTestId('mobile-composer-actions-menu');
            await menu.waitFor({ state: 'visible', timeout: 3_000 });
            for (const label of ['Changes', 'Workspace']) {
                await expect(menu.getByRole('menuitem', { name: label, exact: true }).isVisible()).resolves.toBe(true);
            }
            await expect(menu.getByRole('menuitem', { name: 'Chat Workspace', exact: true }).count()).resolves.toBe(0);
            await expect(menu.getByRole('menuitem', { name: 'Machine Workspace', exact: true }).count()).resolves.toBe(0);
            await menu.getByTestId(`mobile-composer-action-${key}`).click({ timeout: 3_000 });
        };

        await openNewestAction('changes');
        await foreground.getByRole('button', { name: '/work/child-newest-change.ts', exact: true })
            .waitFor({ state: 'visible', timeout: 3_000 });
        await expect(foreground.getByRole('button', { name: '/work/project/mobile-change.ts', exact: true }).count()).resolves.toBe(0);
        await page.mouse.click(20, 32);
        await foreground.getByTestId('mobile-changes-workspace-overlay').waitFor({ state: 'detached', timeout: 3_000 });
        await assertNewestComposerRetained();

        // The child's Workspace opens in the phone's right sheet; the strip beside it closes it.
        await openNewestAction('workspace');
        const scrim = foreground.getByTestId('desktop-panel-overlay-scrim');
        await scrim.waitFor({ state: 'visible', timeout: 3_000 });
        await expect(page.getByTestId('desktop-file-workspace').filter({ visible: true })
            .getByPlaceholder('Path').inputValue()).resolves.toBe('/work/child-newest');
        await page.getByText('child-newest-machine-file.md', { exact: true }).filter({ visible: true })
            .waitFor({ state: 'visible', timeout: 3_000 });
        await page.mouse.click(8, 420);
        await scrim.waitFor({ state: 'detached', timeout: 3_000 });
        await assertNewestComposerRetained();

        await foreground.getByText('Oldest child', { exact: true }).click();
        const oldestDraft = foreground.locator('textarea').last();
        await oldestDraft.waitFor({ state: 'visible', timeout: 3_000 });
        await oldestDraft.fill('oldest child draft survives workspace return');
        await oldestDraft.evaluate((element) => { element.dataset.retentionComposer = 'child-oldest'; });
        await foreground.getByTestId('mobile-composer-actions-trigger').last().click({ timeout: 3_000 });
        await foreground.getByTestId('mobile-composer-actions-menu')
            .getByTestId('mobile-composer-action-changes').click({ timeout: 3_000 });
        await foreground.getByRole('button', { name: '/work/child-oldest-change.ts', exact: true })
            .waitFor({ state: 'visible', timeout: 3_000 });
        await expect(foreground.getByRole('button', { name: '/work/child-newest-change.ts', exact: true }).count()).resolves.toBe(0);
        await page.mouse.click(20, 32);
        await foreground.getByTestId('mobile-changes-workspace-overlay').waitFor({ state: 'detached', timeout: 3_000 });
        const retainedOldestDraft = foreground.locator('textarea[data-retention-composer="child-oldest"]');
        await expect(retainedOldestDraft.inputValue()).resolves.toBe('oldest child draft survives workspace return');

        expect(pageErrors).toEqual([]);
        await page.close();
    }, 30_000);

    it('opens the same children in the phone sheet, switches between them, and closes it', async () => {
        const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (
                (message.type() === 'error' || message.type() === 'warning')
                && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
            ) pageErrors.push(message.text());
        });
        await page.goto(origin);

        const foreground = page.getByTestId('foreground-session');
        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click({ timeout: 3_000 });
        const scrim = foreground.getByTestId('desktop-panel-overlay-scrim');
        await scrim.waitFor({ state: 'visible', timeout: 2_000 });
        await expect(foreground.getByText('Newest child').isVisible()).resolves.toBe(true);
        // A sheet, not a docked panel: nothing to resize.
        await expect(foreground.getByRole('slider', { name: 'Resize side panel' }).count()).resolves.toBe(0);
        const newestDraft = foreground.locator('textarea').filter({ visible: true }).last();
        await newestDraft.waitFor({ state: 'visible', timeout: 2_000 });
        await newestDraft.fill('newest child draft');
        await foreground.getByText('Oldest child').click();
        const oldestDraft = foreground.locator('textarea').filter({ visible: true }).last();
        await oldestDraft.waitFor({ state: 'visible', timeout: 2_000 });
        await expect(oldestDraft.inputValue()).resolves.toBe('');
        await expect(page.evaluate(() => (window as any).__SIDE_CHAT_CREATE_COUNT__ ?? 0)).resolves.toBe(0);

        await foreground.getByTestId('files-sidebar-hide').click();
        await scrim.waitFor({ state: 'detached', timeout: 2_000 });
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);
    it.each([
        ['parent', 'localhost', 1440, 900],
        ['parent', '127.0.0.1', 1440, 900],
        ['parent', '[::1]', 1440, 900],
        ['child-newest', 'localhost', 1440, 900],
        ['child-newest', '127.0.0.1', 1440, 900],
        ['child-newest', '[::1]', 1440, 900],
        ['parent', 'localhost', 390, 844],
        ['parent', '127.0.0.1', 390, 844],
        ['parent', '[::1]', 390, 844],
        ['child-newest', 'localhost', 390, 844],
        ['child-newest', '127.0.0.1', 390, 844],
        ['child-newest', '[::1]', 390, 844],
    ] as const)('opens a real agent chat link in the owning Workspace (%s, %s, %s)', async (owner, host, width, height) => {
        const context = await browser.newContext({ viewport: { width, height } });
        const page = await context.newPage();
        const url = `http://${host}:8766/validation-map.html`;
        const expectedMachine = owner === 'parent' ? 'machine-1' : 'machine-newest';
        const errors: string[] = [];
        const browserLoopbackRequests: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
            if (new URL(request.url()).port === '8766') browserLoopbackRequests.push(request.url());
        });
        await page.addInitScript((url) => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { localhostLinks: true, localhostUrl: url };
        }, url);
        try {
            await page.goto(origin);
            const foreground = page.getByTestId('foreground-session');
            if (owner !== 'parent') {
                await foreground.getByRole('button', { name: 'Open side chats (2)' }).click();
                await foreground.getByText('Newest child', { exact: true }).waitFor();
            }
            const link = foreground.getByRole('link', { name: `Hosted page ${owner}`, exact: true });
            await link.waitFor();
            const draft = foreground.locator('textarea').filter({ visible: true }).last();
            await draft.fill('Retain the chat draft');
            await draft.evaluate((element) => { element.dataset.localhostDraft = 'keep'; });
            // The ordinary external branch remains separate.
            await foreground.getByRole('link', { name: 'External reference', exact: true })
                .filter({ visible: true }).last().click();
            expect(await page.evaluate(() => (window as any).__EXTERNAL_LINKS__)).toEqual(['https://example.com/docs']);
            await link.click();
            const panel = foreground.getByTestId(`desktop-file-panel:${url}`);
            await panel.frameLocator('iframe').getByRole('button', { name: `Live from ${expectedMachine}` })
                .waitFor({ timeout: 15_000 });
            const calls = await page.evaluate(() => (window as any).__LOCALHOST_LINK_RPCS__ ?? []);
            expect(calls.some((call: any) => call.url === url)).toBe(true);
            expect(calls.some((call: any) => new URL(call.url).pathname === '/state')).toBe(true);
            expect(calls.every((call: any) => call.machineId === expectedMachine && call.method === 'workspace-live-fetch')).toBe(true);
            expect(browserLoopbackRequests).toEqual([]);
            expect(await page.evaluate(() => (window as any).__EXTERNAL_LINKS__)).toEqual(['https://example.com/docs']);
            expect(await foreground.locator('iframe').count()).toBe(1);
            expect(await foreground.getByTestId('desktop-file-workspace-divider').count()).toBe(width >= 900 ? 1 : 0);
            if (owner !== 'parent') {
                // The Workspace replaces the Side chat panel, docked or in the phone's
                // sheet. Reopening the child must hydrate its draft through the real useDraft.
                if (width < 1100) {
                    // Phones: the strip beside the Workspace sheet leads back to the chat first.
                    await page.mouse.click(8, height / 2);
                    await foreground.getByTestId('desktop-panel-overlay-scrim').waitFor({ state: 'detached' });
                }
                await foreground.getByRole('button', { name: 'Open side chats (2)' }).click();
                await foreground.getByRole('link', { name: `Hosted page ${owner}`, exact: true }).waitFor();
                expect(await foreground.locator('textarea').filter({ visible: true }).last().inputValue())
                    .toBe('Retain the chat draft');
            } else {
                expect(await foreground.locator('textarea[data-localhost-draft="keep"]').inputValue())
                    .toBe('Retain the chat draft');
            }
            expect(errors).toEqual([]);
        } finally {
            await context.close();
        }
    }, 30_000);

    it.each([
        { label: 'Web Desktop', width: 1440, height: 900, mobile: false },
        { label: 'Web tablet', width: 1024, height: 1366, mobile: false },
        { label: 'Web Mobile', width: 390, height: 844, mobile: true },
    ])('opens Session Info Changes twice in the retained Workspace on $label', async ({ width, height, mobile }) => {
        const context = await browser.newContext({
            viewport: { width, height },
            ...(mobile ? { isMobile: true, hasTouch: true } : {}),
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { sessionInfoJourney: true };
        });
        try {
            await page.goto(origin);
            const foreground = page.getByTestId('foreground-session');
            const composer = foreground.locator('textarea').first();
            await composer.fill('Retain this draft through Info');
            await composer.evaluate((element) => { element.dataset.infoRetention = 'same-composer'; });

            await foreground.getByText('parent', { exact: true }).first().click();
            const info = page.getByTestId('session-info-route');
            await info.getByText('Quick Actions', { exact: true }).waitFor();
            const changes = info.getByText('Changes', { exact: true });
            await changes.waitFor();
            const quickActionsBox = await info.getByText('Quick Actions', { exact: true }).boundingBox();
            const changesBox = await changes.boundingBox();
            if (!quickActionsBox || !changesBox) throw new Error('Session Info actions have no visible geometry');
            expect(changesBox.y).toBeGreaterThan(quickActionsBox.y);
            // The mock's title row names the session once from 900 px up, above Quick Actions;
            // narrower layouts leave the name to the Stack header.
            const wide = width >= 900;
            await expect(info.getByText('parent', { exact: true }).count()).resolves.toBe(wide ? 1 : 0);
            if (wide) {
                const titleBox = await info.getByTestId('session-info-header')
                    .getByText('parent', { exact: true }).boundingBox();
                if (!titleBox) throw new Error('Session Info title row has no visible geometry');
                expect(quickActionsBox.y).toBeGreaterThan(titleBox.y);
            }

            await changes.click();
            await foreground.getByTestId('mobile-changes-workspace-overlay').waitFor({ state: 'visible' });
            await expect.poll(() => page.evaluate(() => (window as any).__INFO_CONSUMED_REQUESTS__?.length ?? 0)).toBe(1);
            await expect(foreground.locator('textarea[data-info-retention="same-composer"]').count()).resolves.toBe(1);
            await expect(foreground.locator('textarea[data-info-retention="same-composer"]').inputValue())
                .resolves.toBe('Retain this draft through Info');
            await expect(foreground.getAttribute('data-route-key')).resolves.toBe('session-parent-key');

            await foreground.getByText('parent', { exact: true }).first().click();
            await info.getByText('Changes', { exact: true }).waitFor();
            await info.getByText('Changes', { exact: true }).click();
            await expect.poll(() => page.evaluate(() => (window as any).__INFO_CONSUMED_REQUESTS__?.length ?? 0)).toBe(2);
            const consumedRequests = await page.evaluate(() => (window as any).__INFO_CONSUMED_REQUESTS__ ?? []);
            expect(new Set(consumedRequests).size).toBe(2);
            await expect(foreground.locator('textarea[data-info-retention="same-composer"]').inputValue())
                .resolves.toBe('Retain this draft through Info');
            const routeActions = await page.evaluate(() => (window as any).__INFO_NAV_ACTIONS__ ?? []);
            expect(routeActions.filter((action: any) => action.type === 'SET_PARAMS'))
                .toEqual(expect.arrayContaining([expect.objectContaining({ source: 'session-parent-key' })]));
            expect(routeActions.filter((action: any) => action.type === 'POP').every(
                (action: any) => action.payload?.count === 1,
            )).toBe(true);
            expect(errors).toEqual([]);
        } finally {
            await context.close();
        }
    }, 20_000);

    it('shows Info Changes above a retained dirty editor after narrowing to compact Web', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { sessionInfoJourney: true };
        });
        try {
            await page.goto(origin);
            const foreground = page.getByTestId('foreground-session');
            await foreground.getByRole('button', { name: 'Open Main Agent outside file' }).first().click();
            const workspace = foreground.getByTestId('desktop-file-workspace');
            await workspace.waitFor({ state: 'visible' });
            await workspace.getByRole('button', { name: 'Edit', exact: true }).click();
            const editor = workspace.locator('textarea.code-editor-textarea');
            await editor.waitFor({ state: 'visible' });
            const dirtyValue = 'Unsaved editor state retained through Info and Changes';
            await editor.fill(dirtyValue);
            await editor.evaluate((element) => { element.dataset.infoDirtyEditor = 'mounted'; });

            await foreground.getByText('parent', { exact: true }).first().click();
            const info = page.getByTestId('session-info-route');
            await info.getByText('Changes', { exact: true }).waitFor();
            await page.setViewportSize({ width: 390, height: 844 });
            await info.getByText('Changes', { exact: true }).click();

            const changesOverlay = foreground.getByTestId('mobile-changes-workspace-overlay');
            await changesOverlay.waitFor({ state: 'visible' });
            await expect(workspace.isVisible()).resolves.toBe(false);
            await expect(editor.count()).resolves.toBe(1);
            await expect(editor.inputValue()).resolves.toBe(dirtyValue);
            await expect(changesOverlay.evaluate((element) => {
                const rect = element.getBoundingClientRect();
                const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                return Boolean(hit?.closest('[data-testid="mobile-changes-workspace-overlay"]'));
            })).resolves.toBe(true);

            await changesOverlay
                .locator('..')
                .locator('[data-icon="arrow-back"]')
                .first()
                .locator('..')
                .click();
            await changesOverlay.waitFor({ state: 'detached' });
            await workspace.waitFor({ state: 'visible' });
            await expect(editor.getAttribute('data-info-dirty-editor')).resolves.toBe('mounted');
            await expect(editor.inputValue()).resolves.toBe(dirtyValue);
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    }, 20_000);

    it.each([
        { label: 'Web Desktop', width: 1440, height: 900, mobile: false },
        { label: 'Web Mobile', width: 390, height: 844, mobile: true },
    ])('keeps bot Info archive visible and retryable after owner failure on $label', async ({ width, height, mobile }) => {
        const context = await browser.newContext({
            viewport: { width, height },
            ...(mobile ? { isMobile: true, hasTouch: true } : {}),
        });
        const page = await context.newPage();
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = {
                sessionInfoJourney: true,
                botLifecycle: true,
                botArchiveResults: [false, false],
            };
        });
        try {
            await page.goto(origin);
            const foreground = page.getByTestId('foreground-session');
            await foreground.getByText('parent', { exact: true }).first().click();
            const info = page.getByTestId('session-info-route');
            await info.getByText('Archive Session', { exact: true }).waitFor();
            await expect(info.getByText('Delete Session', { exact: true }).count()).resolves.toBe(0);

            await info.getByText('Archive Session', { exact: true }).click();
            const alert = page.getByRole('alert');
            await alert.getByText('Error: Connect the owning machine to archive this bot session.', { exact: true }).waitFor();
            await expect.poll(() => page.evaluate(() => (window as any).__SESSION_KILL_CALLS__?.length ?? 0)).toBe(1);
            await alert.getByRole('button', { name: 'OK', exact: true }).click();
            await info.getByText('Archive Session', { exact: true }).click();
            await alert.getByText('Error: Connect the owning machine to archive this bot session.', { exact: true }).waitFor();
            await expect.poll(() => page.evaluate(() => (window as any).__SESSION_KILL_CALLS__?.length ?? 0)).toBe(2);

            expect(await page.evaluate(() => (window as any).__SESSION_KILL_CALLS__)).toEqual(['parent', 'parent']);
            expect(await page.evaluate(() => (window as any).__WORKTREE_CLEANUP_CALLS__ ?? [])).toEqual([]);
            expect(await page.evaluate(() => (window as any).__SESSION_ARCHIVE_CALLS__ ?? [])).toEqual([]);
            expect(await page.evaluate(() => (window as any).__INFO_BACK_COUNT__ ?? 0)).toBe(0);
            await expect(info.isVisible()).resolves.toBe(true);
        } finally {
            await context.close();
        }
    }, 15_000);

    it('treats a successful bot Info archive as machine acceptance without a local archive fallback', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = {
                sessionInfoJourney: true,
                botLifecycle: true,
                botArchiveResults: [true],
            };
        });
        try {
            await page.goto(origin);
            const foreground = page.getByTestId('foreground-session');
            await foreground.getByText('parent', { exact: true }).first().click();
            await page.getByTestId('session-info-route').getByText('Archive Session', { exact: true }).click();

            await expect.poll(() => page.evaluate(() => (window as any).__INFO_BACK_COUNT__ ?? 0)).toBe(2);
            expect(await page.evaluate(() => (window as any).__SESSION_KILL_CALLS__)).toEqual(['parent']);
            expect(await page.evaluate(() => (window as any).__WORKTREE_CLEANUP_CALLS__ ?? [])).toEqual([]);
            expect(await page.evaluate(() => (window as any).__SESSION_ARCHIVE_CALLS__ ?? [])).toEqual([]);
            await expect(foreground.getAttribute('data-route-key')).resolves.toBe('session-parent-key');
            await expect(foreground.getByText('parent', { exact: true }).first().isVisible()).resolves.toBe(true);
        } finally {
            await page.close();
        }
    }, 15_000);

    it('keeps the shared bot action menu retryable without cleanup or server fallback', async () => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = {
                botActionMenu: true,
                botLifecycle: true,
                botArchiveResults: [false, false],
            };
        });
        try {
            await page.goto(origin);
            const row = page.getByTestId('bot-action-menu');
            await row.getByText('Bot assistant', { exact: true }).click({ button: 'right' });
            await page.getByRole('button', { name: 'Archive', exact: true }).click();
            const alert = page.getByRole('alert');
            await alert.getByText('Error: Connect the owning machine to archive this bot session.', { exact: true }).waitFor();
            await alert.getByRole('button', { name: 'OK', exact: true }).click();

            await row.getByText('Bot assistant', { exact: true }).click({ button: 'right' });
            await page.getByRole('button', { name: 'Archive', exact: true }).click();
            await alert.getByText('Error: Connect the owning machine to archive this bot session.', { exact: true }).waitFor();
            await expect.poll(() => page.evaluate(() => (window as any).__SESSION_KILL_CALLS__?.length ?? 0)).toBe(2);
            expect(await page.evaluate(() => (window as any).__SESSION_KILL_CALLS__)).toEqual(['parent', 'parent']);
            expect(await page.evaluate(() => (window as any).__WORKTREE_CLEANUP_CALLS__ ?? [])).toEqual([]);
            expect(await page.evaluate(() => (window as any).__SESSION_ARCHIVE_CALLS__ ?? [])).toEqual([]);
            await expect(row.getAttribute('data-session-id')).resolves.toBe('parent');
            await expect(row.getByText('Bot assistant', { exact: true }).isVisible()).resolves.toBe(true);
        } finally {
            await page.close();
        }
    }, 15_000);

    it('waits for synced lifecycle state after the shared bot action accepts Archive', async () => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.addInitScript(() => {
            (globalThis as any).__HAPPYHERD_FIXTURE_OPTIONS__ = {
                botActionMenu: true,
                botLifecycle: true,
                botArchiveResults: [true],
            };
        });
        try {
            await page.goto(origin);
            const row = page.getByTestId('bot-action-menu');
            await row.getByText('Bot assistant', { exact: true }).click({ button: 'right' });
            await page.getByRole('button', { name: 'Archive', exact: true }).click();
            await expect.poll(() => page.evaluate(() => (window as any).__SESSION_KILL_CALLS__?.length ?? 0)).toBe(1);

            await expect(row.getByText('Bot assistant', { exact: true }).isVisible()).resolves.toBe(true);
            await expect(page.getByTestId('bot-archive-synced').count()).resolves.toBe(0);
            await page.evaluate(() => (window as any).__APPLY_BOT_ARCHIVE_SYNC__());
            const synced = page.getByTestId('bot-archive-synced');
            await synced.waitFor();
            await expect(synced.getAttribute('data-session-id')).resolves.toBe('parent');
            expect(await page.evaluate(() => (window as any).__WORKTREE_CLEANUP_CALLS__ ?? [])).toEqual([]);
            expect(await page.evaluate(() => (window as any).__SESSION_ARCHIVE_CALLS__ ?? [])).toEqual([]);
            await expect(page.getByRole('alert').count()).resolves.toBe(0);
        } finally {
            await page.close();
        }
    }, 15_000);

});
