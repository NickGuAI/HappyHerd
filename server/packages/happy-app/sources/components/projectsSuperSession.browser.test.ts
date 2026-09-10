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

const virtualModules: Record<string, string> = {
    'react-native': `
        import * as ReactNativeWeb from 'react-native-web';
        export * from 'react-native-web';
        export const Platform = {
            ...ReactNativeWeb.Platform,
            OS: 'web',
            select: (options) => options.web ?? options.default,
        };
    `,
    'react-native-unistyles': `
        const theme = {
            dark: false,
            colors: {
                switch: { track: { active: '#2868c7', inactive: '#999' }, thumb: { active: '#fff' } }, header: { tint: '#181818' }, input: { background: '#eee', text: '#181818', placeholder: '#777' }, divider: '#dedede', surface: '#fff', surfaceHigh: '#f3f3f3', surfaceHighest: '#eee',
                surfacePressed: '#ececec', surfacePressedOverlay: '#ececec', surfaceSelected: '#e8eef9',
                surfaceRipple: '#ececec', text: '#181818', textSecondary: '#676767', textDestructive: '#c22',
                textLink: '#2868c7', groupped: { background: '#f7f7f7', chevron: '#777', sectionTitle: '#666' },
                glass: { border: '#ddd', divider: '#ddd' }, shadow: { color: '#000', opacity: 0.08 },
                permission: { bypass: '#e98200' }, radio: { active: '#2868c7' },
                status: { connected: '#238636', default: '#8c8c8c', disconnected: '#8c8c8c', error: '#c22' },
            },
        };
        export const StyleSheet = {
            create: (factory) => typeof factory === 'function' ? factory(theme, {}) : factory,
            hairlineWidth: 1,
        };
        export const useUnistyles = () => ({ theme });
        export const UnistylesRuntime = { setAdaptiveThemes() {}, setTheme() {}, setRootViewBackgroundColor() {} };
    `,
    '@expo/vector-icons': `
        import React from 'react';
        const Icon = ({ name }) => React.createElement('span', { 'data-icon': name, 'aria-hidden': true }, '•');
        Icon.glyphMap = {};
        export const Ionicons = Icon; export const MaterialCommunityIcons = Icon;
    `,
    'react-native-safe-area-context': `export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });`,
    'react-native-gesture-handler': `
        import React from 'react';
        export const Swipeable = React.forwardRef(({ children }, _ref) => children);
    `,
    'react-native-reanimated': `export const useReducedMotion = () => false;`,
    'expo-clipboard': `export const setStringAsync = async () => {};`,
    'expo-router': `
        import React from 'react';
        const initialScreen = new URLSearchParams(window.location.search).get('screen');
        let pathname = initialScreen === 'assignment' ? '/session/ordinary-session/project' : initialScreen === 'appearance' ? '/settings/appearance' : initialScreen === 'detail' ? '/projects/' + (new URLSearchParams(window.location.search).get('project') ?? 'project-alpha') : '/';
        const history = ['/'];
        const listeners = new Set();
        const emit = () => listeners.forEach((listener) => listener());
        const record = (path) => {
            window.__ROUTER_CALLS__ = [...(window.__ROUTER_CALLS__ ?? []), path];
            history.push(pathname);
            pathname = path;
            emit();
        };
        const router = {
            navigate: record,
            push: record,
            back() { window.__ROUTER_BACK_COUNT__ = (window.__ROUTER_BACK_COUNT__ ?? 0) + 1; pathname = history.pop() ?? '/'; emit(); },
        };
        export const useRouter = () => router;
        export const usePathname = () => React.useSyncExternalStore(
            (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
            () => pathname,
            () => pathname,
        );
        export const useLocalSearchParams = () => ({ id: pathname.split('/')[2] ?? '' });
        export const Stack = { Screen: () => null };
        export const routerFixture = router;
    `,
    '@/sync/storage': `
        import React from 'react';
        const row = (id, name, lastActivityAt, projectName, overrides = {}) => ({
            id, name, subtitle: '', avatarId: id, flavor: 'codex', clientId: null,
            identityLine: 'Codex', providerKind: 'codex', modelName: null, activitySummary: null,
            gitChangedFiles: null, gitCountsExact: true, gitDeletions: null, gitInsertions: null,
            state: 'waiting', createdAt: id === 'super-session' ? 1 : 2, lastActivityAt,
            updateSequence: lastActivityAt, hasDraft: false, active: true, archived: false,
            machineId: 'machine-1', daemonLabel: 'Main machine', daemonShortId: 'machine-1',
            machineName: 'Main machine', botId: null, botUsername: null,
            commanderId: id === 'super-session' ? 'assistant' : null,
            commanderName: id === 'super-session' ? 'HappyHerd' : null,
            machineOffline: false, path: id === 'super-session' ? '/assistant' : '/work/current',
            homeDir: '/work', completedTodosCount: 0, totalTodosCount: 0, hasUnread: false,
            projectId: id === 'ordinary-session' ? 'project-alpha' : null,
            projectName, workspaceId: null, workspaceName: null, ...overrides,
        });
        const superRow = row('super-session', 'Persistent assistant source title', 1, 'Assistant', {
            botId: 'assistant-bot', botUsername: 'assistant', machineName: 'Main machine',
        });
        const ordinaryRow = row('ordinary-session', 'Newest ordinary session', 999, 'Project Alpha');
        const botAlpha = row('bot-alpha', 'Build assistant', 800, null, {
            avatarId: 'machine-a:bot:build-a', botId: 'build-a', botUsername: 'builder-a',
            machineId: 'machine-a', machineName: 'Alpha machine', daemonLabel: 'Alpha machine',
            daemonShortId: 'machine-a', projectId: 'project-alpha', projectName: 'Project Alpha',
        });
        const botBeta = row('bot-beta', 'Build assistant', 700, null, {
            avatarId: 'machine-b:bot:build-b', botId: 'build-b', botUsername: 'builder-b',
            machineId: 'machine-b', machineName: 'Beta machine', daemonLabel: 'Beta machine',
            daemonShortId: 'machine-b',
        });
        const archivedBot = row('bot-archived', 'Retired assistant', 100, null, {
            active: false, archived: true, avatarId: 'machine-b:bot:retired', botId: 'retired',
            botUsername: 'retired', machineId: 'machine-b', machineName: 'Beta machine',
            daemonLabel: 'Beta machine', daemonShortId: 'machine-b', state: 'disconnected',
        });
        let projects = {
            'project-alpha': {
                id: 'project-alpha', externalId: 'external-alpha', name: 'Project Alpha', kind: 'personal',
                metadataVersion: 1, avatar: null, createdAt: 1, updatedAt: 1,
            },
            'empty-project': {
                id: 'empty-project', externalId: 'external-empty', name: 'Roadmap', kind: 'personal',
                metadataVersion: 1, avatar: null, createdAt: 2, updatedAt: 2,
            },
        };
        let sessions;
        const richProjects = new URLSearchParams(window.location.search).get('scenario') === 'projects';
        let extraRows = [];
        if (richProjects) {
            projects = { ...projects,
                'project-duplicate': { ...projects['project-alpha'], id: 'project-duplicate', externalId: 'duplicate' },
                'archive-only': { ...projects['project-alpha'], id: 'archive-only', externalId: 'archive', name: 'Historical project' },
            };
            superRow.projectId = 'project-alpha';
            superRow.projectName = 'Project Alpha';
            archivedBot.projectId = 'archive-only';
            extraRows = [
                row('remote-session', 'Remote project session', 900, 'Project Alpha', { machineId: 'machine-b', machineName: 'Beta machine', path: '/remote/checkout', projectId: 'project-alpha' }),
                row('duplicate-session', 'Same workspace different project', 850, 'Project Alpha', { projectId: 'project-duplicate' }),
                row('unassigned-session', 'Unassigned work', 750, null),
            ];
        }
        const superState = new URLSearchParams(window.location.search).get('super-state');
        if (superState) {
            superRow.active = false;
            superRow.archived = superState === 'archived';
            superRow.state = 'disconnected';
            archivedBot.projectId = 'project-alpha';
        }
        const rows = [superRow, ordinaryRow, botAlpha, botBeta, archivedBot, ...extraRows];
        sessions = Object.fromEntries(rows.map((item) => [item.id, {
            id: item.id, seq: item.updateSequence, createdAt: item.createdAt, updatedAt: item.lastActivityAt,
            active: item.active, activeAt: item.lastActivityAt, archived: item.archived, projectId: item.projectId,
            presence: 'online', metadata: { path: item.path, machineId: item.machineId, summary: { text: item.name },
                isSuperSession: item.id === 'super-session', homeDir: '/work' },
        }]));
        let sessionList = Object.values(sessions);
        const settings = {
            hideInactiveSessions: true,
            sessionListGrouping: localStorage.getItem('fixture-grouping') ?? new URLSearchParams(window.location.search).get('grouping') ?? 'flat',
            userMessageBubbleColor: 'blue', sessionStatusBarDisplay: 'above', avatarStyle: 'brutalist', preferredLanguage: 'en',
            machineWorkspace: true,
            commanderProfilePictures: true,
        };
        const listeners = new Set();
        const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
        const emit = () => listeners.forEach((listener) => listener());
        let listData = [];
        const rebuild = () => {
            const currentRows = rows.map((item) => ({ ...item, projectId: sessions[item.id].projectId,
                projectName: projects[sessions[item.id].projectId]?.name ?? null }));
            const ordinary = currentRows.filter((item) => !item.botId && !item.archived && item.id !== 'super-session');
            listData = [
                { type: 'active-sessions', sessions: ordinary },
                { type: 'super-session', session: currentRows.find((item) => item.id === 'super-session') },
                { type: 'bots', sessions: currentRows.filter((item) => item.botId && !item.archived && item.id !== 'super-session') },
                { type: 'header', title: 'Today' },
                ...currentRows.filter((item) => item.archived && item.id !== 'super-session').map((session) => ({ type: 'session', session })),
            ];
        };
        let projectsLoaded = new URLSearchParams(window.location.search).get('catalog') !== 'delayed';
        if (!projectsLoaded) {
            const catalog = projects;
            projects = {};
            fetch('/fixture-catalog').then((response) => response.json()).then((response) => {
                projects = response.empty ? {} : catalog;
                projectsLoaded = true;
                rebuild();
                emit();
            });
        }
        rebuild();
        export const storage = { getState: () => ({ sessions, projects }) };
        export const useSessionListViewData = () => React.useSyncExternalStore(subscribe, () => listData, () => listData);
        export const useSetting = (key) => React.useSyncExternalStore(subscribe, () => settings[key], () => settings[key]);
        export const useSettingMutable = (key) => [
            React.useSyncExternalStore(subscribe, () => settings[key], () => settings[key]),
            (value) => { settings[key] = value; if (key === 'sessionListGrouping') localStorage.setItem('fixture-grouping', value); emit(); },
        ];
        export const useLocalSettingMutable = useSettingMutable;
        export const useFriendRequests = () => [];
        export const useSocketStatus = () => ({ status: 'connected' });
        export const useSessionGitStatus = () => null;
        export const useAllMachines = () => [
            { id: 'machine-1', active: true, metadata: { displayName: 'Main machine' } },
            { id: 'machine-a', active: true, metadata: { displayName: 'Alpha machine' } },
            { id: 'machine-b', active: true, metadata: { displayName: 'Beta machine' } },
        ];
        export const useRealtimeStatus = () => 'disconnected';
        export const useProjectsLoaded = () => React.useSyncExternalStore(subscribe, () => projectsLoaded, () => projectsLoaded);
        export const useProjects = () => React.useSyncExternalStore(subscribe, () => projects, () => projects);
        export const useAllSessions = () => React.useSyncExternalStore(subscribe, () => sessionList, () => sessionList);
        export const useSession = (id) => React.useSyncExternalStore(
            subscribe, () => sessions[id] ?? null, () => sessions[id] ?? null,
        );
        export const __createProject = (name) => {
            const id = 'created-project';
            projects = { ...projects, [id]: {
                id, externalId: 'external-created', name, kind: 'personal', metadataVersion: 1,
                avatar: null, createdAt: 3, updatedAt: 3,
            } };
            rebuild();
            emit();
            return projects[id];
        };
        export const __renameProject = (id, name) => {
            projects = { ...projects, [id]: { ...projects[id], name, metadataVersion: projects[id].metadataVersion + 1 } };
            rebuild();
            emit();
            return projects[id];
        };
        export const __assignProject = (sessionId, projectId) => {
            sessions = { ...sessions, [sessionId]: { ...sessions[sessionId], projectId } };
            sessionList = Object.values(sessions);
            rebuild();
            emit();
        };
    `,
    '@/sync/sync': `
        import { __assignProject, __createProject, __renameProject } from '@/sync/storage';
        export const sync = {
            async createProject(name) {
                window.__PROJECT_CREATE_CALLS__ = [...(window.__PROJECT_CREATE_CALLS__ ?? []), name];
                return __createProject(name);
            },
            async renameProject(id, name) {
                window.__PROJECT_RENAME_CALLS__ = [...(window.__PROJECT_RENAME_CALLS__ ?? []), { id, name }];
                return __renameProject(id, name);
            },
            async assignSessionProject(sessionId, projectId) {
                window.__PROJECT_ASSIGN_CALLS__ = [...(window.__PROJECT_ASSIGN_CALLS__ ?? []), { sessionId, projectId }];
                __assignProject(sessionId, projectId);
            },
        };
    `,
    '@/text': `
        export const getLanguageNativeName = () => 'English';
        export const resolveSupportedLanguage = () => 'en';
        export const t = (key, params) => ({
            'sidebar.newSession': 'New Session', 'sidebar.projects': 'Projects',
            'sidebar.showArchived': 'Show Archived', 'sidebar.hideArchived': 'Hide Archived',
            'workspace.title': 'Workspace', 'happyHerd.automations.title': 'Automations',
            'settings.title': 'Settings', 'status.unknown': 'Unknown',
            'superSession.pinned': 'Super Session (Pinned)',
            'sessions.bots': 'Bots', 'machine.machineId': 'Machine ID',
            'happyHerd.sessionStatusAvatar.actionRequired': 'Action required',
            'happyHerd.sessionStatusAvatar.unread': 'Unread',
            'happyHerd.sessionStatusAvatar.thinking': 'Thinking',
            'happyHerd.sessionStatusAvatar.waiting': 'Waiting',
            'happyHerd.sessionStatusAvatar.disconnected': 'Disconnected',
            'happyHerd.sessionStatusAvatar.idle': 'Idle',
            'projects.create': 'Create Project', 'projects.createTitle': 'Create New Project',
            'projects.createPrompt': 'Enter project name', 'projects.renameTitle': 'Rename Project',
            'projects.renamePrompt': 'Enter a new name for ' + (params?.name ?? ''),
            'projects.emptyDescription': 'Projects persist across your devices and are independent of machines or working directories. Create one to organize your sessions.',
            'projects.project': 'Project',
            'projects.sessionCount': (params?.count ?? 0) + ((params?.count ?? 0) === 1 ? ' session' : ' sessions'),
            'projects.rename': 'Rename project', 'projects.sessionsEmpty': 'No sessions in this project yet', 'projects.notFound': 'Project not found',
            'sessionsFilter.groupingTitle': 'Grouping', 'sessionsFilter.flatList': 'Flat List',
            'sessionsFilter.groupByWorkspace': 'By workspace', 'sessionsFilter.groupByProject': 'By project',
            'sessionsFilter.noProject': 'No project', 'projects.noProject': 'No project',
            'common.rename': 'Rename', 'common.error': 'Error',
            'happyHerd.automations.unknownError': 'Something went wrong',
        }[key] ?? key);
    `,
    '@/modal': `
        export const Modal = {
            alert() {},
            async prompt(_title, message, options) {
                return window.prompt(message, options?.defaultValue ?? '');
            },
        };
    `,
    '@/constants/Typography': `export const Typography = { default: () => ({}) };`,
    '@/components/StyledText': `export { Text } from 'react-native';`,
    '@/components/layout': `export const layout = { maxWidth: 800 };`,
    '@/components/BubblePressable': `import { Pressable } from 'react-native'; export const BubblePressable = Pressable;`,
    '@/components/SessionActionsPopover': `export const SessionActionsPopover = () => null; export const SessionActionsAnchor = ({ children }) => children;`,
    '@/components/ShortcutHints': `
        export const SessionShortcutHintBadge = () => null;
        export const ShortcutHintBadge = () => null;
        export const useShortcutHints = () => ({ visible: false });
    `,
    '@/components/RigGitLineChanges': `export const RigGitLineChanges = () => null;`,
    '@/sync/rig': `export const getProviderIconKind = (kind) => ['claude', 'codex', 'grok'].includes(kind) ? kind : 'generic';`,
    '@/utils/avatarHarness': `export const resolveAvatarHarness = (flavor) => flavor === 'codex' ? 'codex' : null;`,
    '@/components/CommanderSessionAvatar': `
        import React from 'react';
        export const CommanderSessionAvatar = ({ commanderName }) => React.createElement('span', { 'data-commander': commanderName }, commanderName?.slice(0, 1));
    `,
    '@/components/HarnessBadgeIcon': `
        import React from 'react';
        export const HarnessBadgeIcon = ({ harness }) => React.createElement('span', { 'data-harness': harness, 'aria-hidden': true });
    `,
    '@/components/ProviderIcon': `
        import React from 'react';
        export const ProviderIcon = ({ kind }) => React.createElement('span', { 'data-provider': kind, 'aria-hidden': true });
    `,
    '@/components/StatusDot': `
        import React from 'react';
        export const StatusDot = () => null;
        export const StatusPulse = ({ isPulsing }) => React.createElement('span', { 'data-status-pulse': isPulsing ? 'true' : 'false', 'aria-hidden': true });
    `,
    '@/hooks/useSessionQuickActions': `export const useSessionActionAlert = () => () => {};`,
    '@/hooks/useHappyAction': `export const useHappyAction = (action) => [false, action];`,
    '@/sync/ops': `export const sessionKill = async () => ({ success: true }); export const machineBash = async () => ({ exitCode: 0 });`,
    '@/utils/errors': `export class HappyError extends Error {}`,
    '@/track': `export const trackSessionSwitched = () => {}; export const trackFriendsSearch = () => {};`,
    '@/utils/requestReview': `export const requestReview = () => {};`,
    '@/components/UpdateBanner': `export const UpdateBanner = () => null;`,
    '@/components/VoiceAssistantStatusBar': `export const VoiceAssistantStatusBar = () => null;`,
    '@/components/EmptySessionsTablet': `export const EmptySessionsTablet = () => null;`,
    '@/components/EmptyMainScreen': `export const EmptyMainScreen = () => null;`,
    '@/components/InboxView': `export const InboxView = () => null;`,
    '@/components/HomeDock': `export const HomeDock = () => null; export const MOBILE_HOME_DOCK_CONTENT_INSET = 128;`,
    '@/components/SettingsViewWrapper': `export const SettingsViewWrapper = () => null;`,
    '@/components/TabBar': `export const TabBar = () => null;`,
    '@/components/HeaderLogo': `export const HeaderLogo = () => null;`,
    '@/components/navigation/Header': `
        import React from 'react';
        export const Header = ({ title, headerLeft, headerRight }) => React.createElement('header',
            { style: { display: 'flex', minHeight: 48, justifyContent: 'space-between' } }, headerLeft?.(), title, headerRight?.());
    `,
    '@/components/NativeSettingsMenu': `export const NativeSettingsMenu = () => null;`,
    '@/components/MobileGlass': `import React from 'react'; export const MobileGlassSurface = ({ children }) => children;`,
    '@/components/AnimatedOverlay': `export const AnimatedCollapsible = ({ children, expanded }) => expanded ? children : null;`,
    '@/components/Avatar': `export const Avatar = () => null;`,
    '@/components/AvatarBrutalist': `export const AvatarBrutalist = () => null;`,
    '@/components/AvatarSkia': `export const AvatarSkia = () => null;`,
    '@/components/AvatarGradient': `export const AvatarGradient = () => null;`,
    '@/sync/serverConfig': `export const isUsingCustomServer = () => false;`,
    '@/hooks/useNewSessionDraft': `export const useNewSessionDraft = () => ({}); useNewSessionDraft.getState = () => ({ attachments: [] });`,
    '@/hooks/useStartSessionFromDraft': `export const useStartSessionFromDraft = () => ({ isStarting: false, startSession: async () => false, cancelStart() {} });`,
    '@/theme': `export const darkTheme = {}; export const lightTheme = {};`,
    'expo-localization': `export const getLocales = () => [{ languageTag: 'en-US' }];`,
    'expo-system-ui': `export const setBackgroundColorAsync = async () => {};`,
    '@/utils/responsive': `
        export const useHeaderHeight = () => 0;
        export const useIsTablet = () => window.innerWidth >= 768;
        export const getDeviceType = () => window.innerWidth >= 768 ? 'tablet' : 'phone';
    `,
};

const fixturePlugin: Plugin = {
    name: 'projects-super-session-browser-fixture',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, (args) => {
            if (args.path.startsWith('react-native-unistyles/components/native/')) {
                return { path: resolve(appRoot, '../../node_modules/react-native-unistyles/lib/module/components/native', `${args.path.split('/').at(-1)}.js`) };
            }
            if (args.path === 'react-native-unistyles' && /components\/Sidebar(View|NavigationButton)\.tsx$/.test(args.importer)) {
                return { path: 'sidebar-production-styles', namespace: 'fixture-stub' };
            }

            const relativeStubs: Record<string, string> = {
                './EmptySessionsTablet': '@/components/EmptySessionsTablet',
                './EmptyMainScreen': '@/components/EmptyMainScreen',
                './InboxView': '@/components/InboxView',
                './HomeDock': '@/components/HomeDock',
                './SettingsViewWrapper': '@/components/SettingsViewWrapper',
                './TabBar': '@/components/TabBar',
                './HeaderLogo': '@/components/HeaderLogo',
                './navigation/Header': '@/components/navigation/Header',
                './NativeSettingsMenu': '@/components/NativeSettingsMenu',
                './Avatar': '@/components/Avatar',
                './UpdateBanner': '@/components/UpdateBanner',
                './SessionActionsPopover': '@/components/SessionActionsPopover',
                './ShortcutHints': '@/components/ShortcutHints',
                './RigGitLineChanges': '@/components/RigGitLineChanges',
                './CommanderSessionAvatar': '@/components/CommanderSessionAvatar',
                './HarnessBadgeIcon': '@/components/HarnessBadgeIcon',
                './ProviderIcon': '@/components/ProviderIcon',
                './StatusDot': '@/components/StatusDot',
                './VoiceAssistantStatusBar': '@/components/VoiceAssistantStatusBar',
                './BubblePressable': '@/components/BubblePressable',
            };
            if (args.path in relativeStubs) {
                const replacement = relativeStubs[args.path];
                return { path: replacement, namespace: 'fixture-stub' };
            }
            if (args.path in virtualModules) return { path: args.path, namespace: 'fixture-stub' };
            if (args.path.startsWith('@/')) {
                const sourcePath = resolve(appRoot, 'sources', args.path.slice(2));
                const path = [sourcePath, `${sourcePath}.ts`, `${sourcePath}.tsx`].find(existsSync);
                if (!path) throw new Error(`missing fixture source: ${args.path}`);
                return { path };
            }
            return null;
        });
        bundle.onLoad({ filter: /.*/, namespace: 'fixture-stub' }, (args) => ({
            contents: args.path === 'sidebar-production-styles'
                ? virtualModules['react-native-unistyles'].split('export const StyleSheet =')[0]
                    + `
                        import { StyleSheet, useUnistyles } from ${JSON.stringify(resolve(appRoot, '../../node_modules/react-native-unistyles/lib/module/index.js'))};
                        StyleSheet.configure({ themes: { fixture: theme }, settings: { initialTheme: 'fixture' } });
                        export { StyleSheet, useUnistyles };
                    `
                : virtualModules[args.path],
            loader: 'tsx',
            resolveDir: appRoot,
        }));
        bundle.onLoad({ filter: /components\/Sidebar(View|NavigationButton)\.tsx$/ }, (args) => {
            // Use the same Babel component wrappers as the shipped Web layout.
            // Unistyles disables this transform under Vitest's NODE_ENV=test.
            const previousNodeEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            let transformed;
            try {
                const caller = { name: 'metro', platform: 'web', supportsStaticESM: true };
                transformed = transformSync(readFileSync(args.path, 'utf8'), {
                    filename: args.path, configFile: false, babelrc: false, caller,
                    presets: [['babel-preset-expo', { jsxRuntime: 'automatic' }]],
                    plugins: [['react-native-unistyles/plugin', { root: 'sources' }]],
                });
            } finally {
                process.env.NODE_ENV = previousNodeEnv;
            }
            if (!transformed?.code) throw new Error('Sidebar production style transform failed');
            return { contents: transformed.code, loader: 'js', resolveDir: dirname(args.path) };
        });
    },
};

describe('Projects and Super Session production UI gestures', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            stdin: {
                contents: `
                    import React from 'react';
                    import { createRoot } from 'react-dom/client';
                    import { usePathname, routerFixture } from 'expo-router';
                    import { useSession } from '@/sync/storage';
                    import { SidebarView } from '@/components/SidebarView';
                    import { SessionsList } from '@/components/SessionsList';
                    import { MainView } from '@/components/MainView';
                    import AppearanceScreen from '@/app/(app)/settings/appearance';
                    import ProjectDetailScreen from '@/app/(app)/projects/[id]';
                    import ProjectsScreen from '@/app/(app)/projects/index';
                    import SessionProjectScreen from '@/app/(app)/session/[id]/project';

                    function SessionDestination({ id }) {
                        const session = useSession(id);
                        return React.createElement('article', { 'data-testid': 'opened-session' },
                            React.createElement('h1', null, session?.metadata?.summary?.text ?? id));
                    }
                    function Fixture() {
                        const pathname = usePathname();
                        const query = new URLSearchParams(window.location.search);
                        let content;
                        if (pathname === '/projects') content = React.createElement(ProjectsScreen);
                        else if (pathname.startsWith('/projects/')) content = React.createElement(ProjectDetailScreen);
                        else if (pathname.endsWith('/project')) content = React.createElement(SessionProjectScreen);
                        else if (pathname === '/settings/appearance') content = React.createElement(AppearanceScreen);
                        else if (pathname.startsWith('/session/')) content = React.createElement(SessionDestination, { id: pathname.split('/')[2] });
                        else if (pathname !== '/') content = React.createElement('h1', null, pathname);
                        else if (query.has('search')) content = React.createElement(SessionsList, { searchQuery: query.get('search'), bottomContentInset: 12 });
                        else content = query.get('mobile') === '1'
                            ? React.createElement(MainView, { variant: 'phone' })
                            : React.createElement('aside', { 'data-testid': 'desktop-sidebar', style: { width: 'min(390px, 100vw)', height: '100%', display: 'flex' } }, React.createElement(SidebarView));
                        // This replaces Expo's stack host only. All project/list
                        // actions under test originate in production components.
                        return React.createElement('div', { style: { height: '100%', display: 'flex', flexDirection: 'column' } },
                            pathname !== '/' && React.createElement('button', { onClick: routerFixture.back, style: { minHeight: 40, flexShrink: 0 } }, 'Back'),
                            content);
                    }
                    createRoot(document.getElementById('root')).render(React.createElement(Fixture));
                `,
                loader: 'tsx',
                resolveDir: appRoot,
            },
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
            sourcemap: 'inline',
            define: {
                __DEV__: 'false',
                'process.env.EXPO_OS': '"web"',
                'process.env.NODE_ENV': '"test"',
            },
            jsx: 'automatic',
            plugins: [fixturePlugin],
        });
        const script = bundle.outputFiles[0].text;
        server = createServer((_request, response) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<style>html,body,#root{height:100%;margin:0;font-family:Arial,sans-serif}*{box-sizing:border-box}</style><main id="root"></main><script>globalThis.global=globalThis;${script.replaceAll('</script', '<\\/script')}</script>`);
        });
        await new Promise<void>((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('browser fixture did not bind');
        origin = `http://127.0.0.1:${address.port}`;
        const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser = await chromium.launch({
            ...(executablePath ? { executablePath } : { channel: 'chrome' }),
            headless: true,
            args: process.platform === 'linux' ? ['--no-sandbox'] : [],
        });
    }, 30_000);

    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
    }, 30_000);

    const surfaces = [
        { name: 'desktop', query: '', viewport: { width: 1440, height: 900 } },
        { name: 'mobile', query: 'mobile=1&', viewport: { width: 390, height: 844 } },
    ] as const;

    async function openPage(surface: typeof surfaces[number], query = '') {
        const page = await browser.newPage({ viewport: surface.viewport });
        page.setDefaultTimeout(3_000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
        await page.goto(`${origin}/?${surface.query}${query}`);
        return { page, errors };
    }

    async function screenshot(page: Page, name: string) {
        const directory = process.env.HAPPYHERD_PROJECTS_EVIDENCE_DIR?.trim();
        if (!directory) return;
        mkdirSync(resolve(directory), { recursive: true });
        await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true });
    }

    async function openProjects(page: Page) {
        await page.getByLabel('Projects', { exact: true }).click();
        await page.getByText('Create Project', { exact: true }).waitFor();
    }

    for (const surface of surfaces) {
        it(`keeps one pinned session first and opens the same stable ID repeatedly on ${surface.name}`, async () => {
            const { page, errors } = await openPage(surface);
            const pinned = page.getByText('Super Session (Pinned)', { exact: true });
            await pinned.waitFor();
            expect(await pinned.count()).toBe(1);
            const [pinnedBox, ordinaryBox] = await Promise.all([
                pinned.boundingBox(), page.getByText('Newest ordinary session', { exact: true }).boundingBox(),
            ]);
            expect(pinnedBox!.y).toBeLessThan(ordinaryBox!.y);
            await screenshot(page, `super-session-${surface.name}`);
            for (let index = 0; index < 2; index += 1) {
                await pinned.click();
                await page.getByTestId('opened-session').getByText('Persistent assistant source title').waitFor();
                await page.getByRole('button', { name: 'Back', exact: true }).click();
            }
            expect(await page.evaluate(() => (window as any).__ROUTER_CALLS__)).toEqual([
                '/session/super-session', '/session/super-session',
            ]);
            expect(errors).toEqual([]);
            await page.close();
        }, 15_000);

        it(`navigates project rows to assigned sessions, opens a session, and retains membership through Rename on ${surface.name}`, async () => {
            const { page, errors } = await openPage(surface, 'scenario=projects');
            await openProjects(page);
            const duplicateNames = page.getByText('Project Alpha', { exact: true });
            expect(await duplicateNames.count()).toBe(2);
            await duplicateNames.first().click();
            await page.getByTestId('project-detail-screen').waitFor();
            expect(await page.getByTestId('project-session-row-super-session').count()).toBe(1);
            for (const id of ['ordinary-session', 'remote-session', 'bot-alpha']) {
                await page.getByTestId(`project-session-row-${id}`).waitFor();
            }
            expect(await page.getByText('Same workspace different project', { exact: true }).count()).toBe(0);
            expect(await page.getByText('Unassigned work', { exact: true }).count()).toBe(0);
            const before = await page.locator('[data-testid^="project-session-row-"]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid')));
            expect(before[0]).toBe('project-session-row-super-session');
            await page.getByText('Remote project session', { exact: true }).click();
            await page.getByTestId('opened-session').getByText('Remote project session').waitFor();
            await page.getByRole('button', { name: 'Back', exact: true }).click();
            page.once('dialog', (dialog) => dialog.accept('Renamed Alpha'));
            await page.getByText('Rename project', { exact: true }).click();
            expect(await page.evaluate(() => (window as any).__PROJECT_RENAME_CALLS__)).toEqual([
                { id: 'project-alpha', name: 'Renamed Alpha' },
            ]);
            expect(await page.locator('[data-testid^="project-session-row-"]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid')))).toEqual(before);
            await screenshot(page, `project-detail-${surface.name}`);
            await page.getByRole('button', { name: 'Back', exact: true }).click();
            await page.getByText('Renamed Alpha', { exact: true }).waitFor();
            await page.getByText('Project Alpha', { exact: true }).click();
            await page.getByText('Same workspace different project', { exact: true }).waitFor();
            expect(await page.getByText('Remote project session', { exact: true }).count()).toBe(0);
            expect(await page.locator('[data-testid^="project-session-row-"]').count()).toBe(1);
            expect(errors).toEqual([]);
            await page.close();
        }, 15_000);

        it(`supports empty and archive-only projects without changing global archive visibility on ${surface.name}`, async () => {
            const { page, errors } = await openPage(surface, 'scenario=projects');
            await openProjects(page);
            await page.getByText('Roadmap', { exact: true }).click();
            await page.getByText('No sessions in this project yet', { exact: true }).waitFor();
            await page.getByRole('button', { name: 'Back', exact: true }).click();
            await page.getByText('Historical project', { exact: true }).click();
            expect(await page.getByText('Retired assistant', { exact: true }).count()).toBe(0);
            await page.getByTestId('project-archive-toggle').click();
            await page.getByText('Retired assistant', { exact: true }).waitFor();
            await page.getByTestId('project-session-row-bot-archived').waitFor();
            await page.getByRole('button', { name: 'Back', exact: true }).click();
            await page.getByRole('button', { name: 'Back', exact: true }).click();
            expect(await page.getByText('Retired assistant', { exact: true }).count()).toBe(0);
            expect(errors).toEqual([]);
            await page.close();
        }, 15_000);

        it(`selects all three real Appearance view choices, retains the preference, and separates project IDs from workspaces on ${surface.name}`, async () => {
            const { page, errors } = await openPage(surface, 'scenario=projects&screen=appearance');
            const grouping = page.getByRole('combobox', { name: 'Grouping', exact: true });
            await grouping.waitFor();
            expect(await grouping.locator('option').allTextContents()).toEqual(['Flat List', 'By workspace', 'By project']);
            for (const value of ['personal-project', 'project', 'flat']) {
                await grouping.selectOption(value);
                await page.reload();
                expect(await grouping.inputValue()).toBe(value);
                await page.getByRole('button', { name: 'Back', exact: true }).click();
                const pinned = page.getByText('Super Session (Pinned)', { exact: true });
                await pinned.waitFor();
                expect(await pinned.count()).toBe(1);
                await page.getByText('Remote project session', { exact: true }).waitFor();
                await page.getByText('Same workspace different project', { exact: true }).waitFor();
                const [pinnedBox, ordinaryBox] = await Promise.all([
                    pinned.boundingBox(), page.getByText('Newest ordinary session', { exact: true }).boundingBox(),
                ]);
                expect(pinnedBox!.y).toBeLessThan(ordinaryBox!.y);
                if (value === 'personal-project') {
                    const projectHeaders = page.getByRole('heading', { name: 'Project Alpha', exact: true });
                    expect(await projectHeaders.count()).toBe(2);
                    const alphaGroup = projectHeaders.first().locator('..').locator('..');
                    const [botsBox, projectBox] = await Promise.all([
                        page.getByRole('heading', { name: 'Bots', exact: true }).boundingBox(),
                        projectHeaders.first().boundingBox(),
                    ]);
                    expect(pinnedBox!.y).toBeLessThan(botsBox!.y);
                    expect(botsBox!.y).toBeLessThan(projectBox!.y);
                    await alphaGroup.getByText('Newest ordinary session', { exact: true }).waitFor();
                    await alphaGroup.getByText('Remote project session', { exact: true }).waitFor();
                    expect(await alphaGroup.getByText('Same workspace different project', { exact: true }).count()).toBe(0);
                    await projectHeaders.nth(1).locator('..').locator('..').getByText('Same workspace different project', { exact: true }).waitFor();
                    await page.getByRole('heading', { name: 'No project', exact: true }).locator('..').locator('..').getByText('Unassigned work', { exact: true }).waitFor();
                } else if (value === 'project') {
                    expect(await page.getByRole('heading', { name: 'Project Alpha', exact: true }).count()).toBe(0);
                    const workspace = page.getByText('current', { exact: true }).first().locator('..').locator('..').locator('..');
                    await workspace.getByText('Newest ordinary session', { exact: true }).waitFor();
                    await workspace.getByText('Same workspace different project', { exact: true }).waitFor();
                    expect(await workspace.getByText('Remote project session', { exact: true }).count()).toBe(0);
                    await page.getByText('checkout', { exact: true }).first().waitFor();
                }
                const archive = page.getByRole('button', { name: 'Show Archived', exact: true }).last();
                await archive.click();
                await page.getByText('Retired assistant', { exact: true }).waitFor();
                await screenshot(page, `grouping-${value}-${surface.name}`);
                await page.goto(`${origin}/?${surface.query}scenario=projects&screen=appearance`);
            }
            expect(errors).toEqual([]);
            await page.close();
        }, 15_000);

        it(`waits for a delayed project catalog before resolving a direct detail route on ${surface.name}`, async () => {
            for (const missing of [false, true]) {
                const page = await browser.newPage({ viewport: surface.viewport });
                page.setDefaultTimeout(3_000);
                let releaseCatalog!: () => void;
                const responseReady = new Promise<void>((resolveReady) => { releaseCatalog = resolveReady; });
                await page.route('**/fixture-catalog', async (route) => {
                    await responseReady;
                    await route.fulfill({ json: { empty: missing } });
                });
                await page.goto(`${origin}/?${surface.query}scenario=projects&screen=detail&catalog=delayed&project=${missing ? 'missing-project' : 'project-alpha'}`);
                await page.getByTestId('project-detail-loading').waitFor();
                expect(await page.getByText('Project not found', { exact: true }).count()).toBe(0);
                releaseCatalog();
                if (missing) await page.getByText('Project not found', { exact: true }).waitFor();
                else await page.getByTestId('project-session-row-ordinary-session').waitFor();
                expect(await page.getByTestId('project-detail-loading').count()).toBe(0);
                await page.close();
            }
        }, 15_000);

        it(`retains bot names, machine identities, status avatars, and archive access on ${surface.name}`, async () => {
            const { page, errors } = await openPage(surface);
            expect(await page.getByText('Build assistant', { exact: true }).count()).toBe(2);
            await page.getByText('@builder-a · Alpha machine', { exact: true }).waitFor();
            await page.getByText('@builder-b · Beta machine', { exact: true }).waitFor();
            expect(await page.getByRole('img', { name: /Build assistant, Machine ID: machine-[ab], Waiting/ }).count()).toBe(2);
            expect(await page.locator('[data-icon="hardware-chip-outline"]').count()).toBe(3);
            expect(await page.locator('[data-harness="codex"]').count()).toBeGreaterThanOrEqual(3);
            expect(await page.locator('[data-status-pulse="false"]').count()).toBeGreaterThanOrEqual(3);
            const bots = page.getByText('Build assistant', { exact: true });
            const [pinnedBox, ordinaryBox, firstBotBox, secondBotBox] = await Promise.all([
                page.getByText('Super Session (Pinned)', { exact: true }).boundingBox(),
                page.getByText('Newest ordinary session', { exact: true }).boundingBox(),
                bots.nth(0).boundingBox(), bots.nth(1).boundingBox(),
            ]);
            expect(pinnedBox!.y).toBeLessThan(ordinaryBox!.y);
            expect(ordinaryBox!.y).toBeLessThan(firstBotBox!.y);
            expect(firstBotBox!.y).toBeLessThan(secondBotBox!.y);
            for (let index = 0; index < 2; index += 1) {
                await bots.first().click();
                await page.getByTestId('opened-session').getByText('Build assistant', { exact: true }).waitFor();
                await page.getByRole('button', { name: 'Back', exact: true }).click();
            }
            expect(await page.evaluate(() => (window as any).__ROUTER_CALLS__)).toEqual([
                '/session/bot-alpha', '/session/bot-alpha',
            ]);
            await page.getByRole('button', { name: 'Show Archived', exact: true }).last().click();
            await page.getByRole('img', { name: /Retired assistant, Machine ID: machine-b, Disconnected/ }).waitFor();
            expect(await page.locator('[data-icon="hardware-chip-outline"]').count()).toBe(4);
            expect(errors).toEqual([]);
            await page.close();
        }, 15_000);
    }

    it('lays out three accessible equal-width icon destinations above New Session and Archive', async () => {
        const { page, errors } = await openPage(surfaces[0]);
        const labels = ['Workspace', 'Projects', 'Automations'];
        const icons = labels.map((name) => page.getByRole('button', { name, exact: true }));
        const boxes = await Promise.all(icons.map((icon) => icon.boundingBox()));
        for (let index = 0; index < icons.length; index += 1) {
            expect(boxes[index]).not.toBeNull();
            expect(boxes[index]!.height).toBe(40);
            expect(boxes[index]!.y).toBe(boxes[0]!.y);
            expect(Math.abs(boxes[index]!.width - boxes[0]!.width)).toBeLessThan(1);
            expect((await icons[index].innerText()).trim()).toBe('•');
            expect(await icons[index].getAttribute('title')).toBe(labels[index]);
            if (index) expect(boxes[index]!.x).toBeGreaterThan(boxes[index - 1]!.x);
        }
        const newButton = page.getByRole('button', { name: 'New Session', exact: true });
        const archive = page.getByRole('button', { name: 'Show Archived', exact: true }).first();
        const [newBox, archiveBox, pinnedBox] = await Promise.all([
            newButton.boundingBox(), archive.boundingBox(), page.getByText('Super Session (Pinned)', { exact: true }).boundingBox(),
        ]);
        expect(newBox!.y).toBeGreaterThanOrEqual(boxes[0]!.y + boxes[0]!.height);
        expect(newBox!.y).toBe(archiveBox!.y);
        expect(newBox!.width).toBeGreaterThan(archiveBox!.width * 4);
        expect(archiveBox!.x).toBeGreaterThan(newBox!.x);
        expect(pinnedBox!.y).toBeGreaterThan(newBox!.y + newBox!.height);
        await screenshot(page, 'compact-sidebar-navigation');
        for (const [name, destination] of [['Workspace', '/workspace'], ['Projects', '/projects'], ['Automations', '/automations'], ['New Session', '/new']]) {
            await page.getByRole('button', { name, exact: true }).click();
            expect((await page.evaluate(() => (window as any).__ROUTER_CALLS__)).at(-1)).toBe(destination);
            await page.getByRole('button', { name: 'Back', exact: true }).click();
        }
        expect(errors).toEqual([]);
        await page.close();
    }, 15_000);

    it('keeps bot identity search and project assignment on their production components', async () => {
        const { page, errors } = await openPage(surfaces[1], 'search=builder-b');
        for (const grouping of ['flat', 'project', 'personal-project']) {
            await page.goto(`${origin}/?mobile=1&grouping=${grouping}&search=builder-b`);
            expect(await page.getByText('Build assistant', { exact: true }).count()).toBe(1);
            await page.getByText('@builder-b · Beta machine', { exact: true }).waitFor();
            expect(await page.getByText('@builder-a · Alpha machine', { exact: true }).count()).toBe(0);
        }
        await page.goto(`${origin}/?screen=assignment`);
        await page.getByText('Roadmap', { exact: true }).click();
        expect(await page.evaluate(() => (window as any).__PROJECT_ASSIGN_CALLS__)).toEqual([
            { sessionId: 'ordinary-session', projectId: 'empty-project' },
        ]);
        expect(errors).toEqual([]);
        await page.close();
    }, 15_000);

    it('keeps an archived or inactive assigned Super Session pinned above the project archive', async () => {
        for (const surface of surfaces) {
            for (const state of ['archived', 'inactive']) {
                const { page, errors } = await openPage(surface, `scenario=projects&super-state=${state}`);
                await openProjects(page);
                await page.getByText('Project Alpha', { exact: true }).first().click();
                const pinned = page.getByTestId('project-session-row-super-session');
                await pinned.waitFor();
                expect(await pinned.count()).toBe(1);
                const [pinnedBox, ordinaryBox] = await Promise.all([
                    pinned.boundingBox(), page.getByTestId('project-session-row-ordinary-session').boundingBox(),
                ]);
                expect(pinnedBox!.y).toBeLessThan(ordinaryBox!.y);
                expect(await page.getByTestId('project-session-row-bot-archived').count()).toBe(0);
                await page.getByTestId('project-archive-toggle').click();
                await page.getByTestId('project-session-row-bot-archived').waitFor();
                expect(await pinned.count()).toBe(1);
                expect(errors).toEqual([]);
                await page.close();
            }
        }
    }, 30_000);

    it('creates a project through the production dialog and opens its empty session list', async () => {
        const { page, errors } = await openPage(surfaces[0]);
        await openProjects(page);
        page.once('dialog', (dialog) => dialog.accept('Client launch'));
        await page.getByText('Create Project', { exact: true }).click();
        await page.getByText('Client launch', { exact: true }).click();
        await page.getByText('No sessions in this project yet', { exact: true }).waitFor();
        expect(await page.evaluate(() => (window as any).__PROJECT_CREATE_CALLS__)).toEqual(['Client launch']);
        expect(errors).toEqual([]);
        await page.close();
    }, 15_000);
});
