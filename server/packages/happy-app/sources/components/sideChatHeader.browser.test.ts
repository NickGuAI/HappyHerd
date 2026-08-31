import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');

const virtualModules: Record<string, string> = {
    'react-native-unistyles': `
        const theme = {
            dark: false,
            colors: {
                text: '#111', textSecondary: '#666', divider: '#ddd', surface: '#f5f5f5',
                textLink: '#06c', surfaceHigh: '#eee', surfaceSelected: '#e5e5e5', groupped: { background: '#fff' },
                input: { placeholder: '#999' },
                header: { background: '#fff', tint: '#111' }, glass: { backgroundStrong: '#fff' }, shadow: { color: '#000', opacity: 0.1 },
                button: { primary: { tint: '#fff', background: '#111' } },
            },
        };
        export const StyleSheet = {
            hairlineWidth: 1,
            absoluteFillObject: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
            create: (factory) => typeof factory === 'function' ? factory(theme) : factory,
        };
        export const useUnistyles = () => ({ theme });
    `,
    '@expo/vector-icons': `
        import React from 'react';
        const Icon = ({ name }) => React.createElement('span', { 'data-icon': name });
        Icon.glyphMap = {};
        export const Ionicons = Icon;
        export const Octicons = Icon;
    `,
    'react-native-safe-area-context': `export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });`,
    'expo-router': `export const useRouter = () => ({ push() {}, back() {}, dismissTo() {} });`,
    'react-native-reanimated': `
        import React from 'react';
        import { View } from 'react-native';
        export default { View };
        export const useSharedValue = (value) => ({ value });
        export const useAnimatedStyle = (factory) => factory();
        export const withTiming = (value) => value;
        export const Easing = { out: (value) => value, cubic: 'cubic' };
    `,
    'expo-linear-gradient': `import { View } from 'react-native'; export const LinearGradient = View;`,
    '@/sync/storage': `
        import React from 'react';
        import { selectSideChatSessions } from '@/sync/sideChatSessions';
        const makeSession = (id, createdAt, metadata = {}, active = true) => ({
            id, seq: 0, createdAt, updatedAt: createdAt, active, activeAt: createdAt,
            presence: active ? 'online' : 'offline',
            metadata: { host: 'fixture', path: '/work/project', summary: { text: id }, ...metadata },
        });
        const sessions = {
            parent: makeSession('parent', 1, { machineId: 'machine-1', flavor: 'codex', codexThreadId: 'thread-parent' }),
            background: makeSession('background', 2, { machineId: 'machine-1', flavor: 'codex', codexThreadId: 'thread-background' }),
            oldest: makeSession('child-oldest', 10, { isSideChat: true, parentSessionId: 'parent', summary: { text: 'Oldest child' } }),
            newest: makeSession('child-newest', 20, { isSideChat: true, parentSessionId: 'parent', summary: { text: 'Newest child' } }),
            other: makeSession('other-child', 30, { isSideChat: true, parentSessionId: 'other-parent' }),
        };
        const sideChatSnapshots = {
            parent: selectSideChatSessions(sessions, 'parent'),
            background: selectSideChatSessions(sessions, 'background'),
            'other-parent': selectSideChatSessions(sessions, 'other-parent'),
        };
        const fixtureOptions = globalThis.__HAPPYHERD_FIXTURE_OPTIONS__ ?? {};
        const localSettings = {
            acknowledgedCliVersions: {},
            sidebarPanelsOpen: [],
            sidebarPanelActive: null,
            sidebarSideChatSessionId: null,
            zenMode: fixtureOptions.zenMode ?? false,
        };
        const listeners = new Set();
        const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
        const emit = () => listeners.forEach((listener) => listener());
        const getState = () => ({
            localSettings,
            sessions,
            purchases: { entitlements: {} },
            currentViewingSessionId: null,
            pathProjectFiles: {},
            applyLocalSettings(update) { Object.assign(localSettings, update); emit(); },
            applyGitStatusFiles() {}, applyProjectFiles() {}, getSessionPathKey: () => null, setCurrentViewingSession() {},
        });
        export const storage = Object.assign(() => undefined, { getState });
        export const useIsDataReady = () => true;
        export const useLocalSetting = (key) => React.useSyncExternalStore(subscribe, () => localSettings[key], () => localSettings[key]);
        export const useMachine = (id) => id === 'machine-1' ? { id, active: true } : null;
        export const useRealtimeStatus = () => 'disconnected';
        export const useSession = (id) => React.useSyncExternalStore(subscribe, () => sessions[id] ?? null, () => sessions[id] ?? null);
        export const useSessionGitStatus = () => null;
        export const useSessionGitStatusFiles = () => null;
        export const useSessionMessages = () => ({ hasMoreOlder: false, isLoaded: true, isLoadingOlder: false, messages: [] });
        export const useSessionPendingCommunications = () => [];
        export const useSessionProjectFiles = () => null;
        export const useSessionUsage = () => null;
        export const useSetting = (key) => key === 'fileDiffsSidebar'
            ? (fixtureOptions.fileDiffsSidebarEnabled ?? false)
            : key === 'sessionStatusBarDisplay' ? 'hidden' : undefined;
        export const useSettingMutable = () => [{}, () => {}];
        export const useSideChatSessions = (parentId) => React.useSyncExternalStore(
            subscribe,
            () => sideChatSnapshots[parentId] ?? [],
            () => sideChatSnapshots[parentId] ?? [],
        );
    `,
    '@/sync/gitStatusFiles': `export const getGitStatusFiles = async () => null;`,
    '@/sync/projectFiles': `export const getProjectFiles = async () => null;`,
    '@/components/FileIcon': `import React from 'react'; export const FileIcon = () => React.createElement('span');`,
    '@/text': `
        export const t = (key, params) => ({
            'sideChat.panelTitle': 'Side chats',
            'sideChat.openCount': 'Open side chats (' + (params?.count ?? '') + ')',
            'sideChat.collapse': 'Collapse side chats',
            'sideChat.newChat': 'New side chat',
            'sideChat.tabLabel': 'Side chat ' + ((params?.index ?? 0) + 1),
            'sideChat.close': 'Close side chat',
            'sideChat.expand': 'Expand side chat',
            'files.changes': 'Changes',
            'files.allFiles': 'All Files',
            'files.addPanel': 'Add panel',
            'files.resizeWorkspace': 'Resize file workspace',
            'files.openFileTab': 'Open file ' + (params?.name ?? ''),
            'files.closeFileTab': 'Close file ' + (params?.name ?? ''),
            'files.openExistingFile': 'Open existing file',
        }[key] ?? key);
    `,
    '@/keyboard/shortcuts': `
        export const SIDEBAR_PICKER_SHORTCUTS = { changes: {}, allFiles: {}, newSideChat: {} };
        export const formatShortcutChord = () => '';
        export const getPreferredShortcutModifier = () => 'meta';
        export const matchesShortcutChord = () => false;
    `,
    '@/components/AnimatedOverlay': `
        import { View } from 'react-native';
        export const AnimatedClickAwayBackdrop = View;
        export const AnimatedFade = ({ children, visible }) => visible ? children : null;
        export const AnimatedPopup = View;
        export const LocalBlurHalo = View;
    `,
    '@/components/MobileGlass': `import { View } from 'react-native'; export const MobileGlassSurface = View; export const MobileGlassBackdrop = () => null;`,
    '@/components/BubblePressable': `import { Pressable } from 'react-native'; export const BubblePressable = Pressable;`,
    '@/components/navigation/MobileHeaderScrim': `
        export const MobileHeaderScrim = () => null;
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
    '@/sync/sync': `export const sync = { onSessionVisible() {}, refreshSessions() {}, sendMessage: async () => {} };`,
    '@/modal': `export const Modal = { alert() {}, confirm: async () => true, prompt() {}, show() {} };`,
    '@/components/AgentContentView': `
        import React from 'react';
        import { WorkspaceLinkPressContext } from '@/-session/workspaceLinkNavigation';
        export const AgentContentView = (props) => {
            const openWorkspaceLink = React.useContext(WorkspaceLinkPressContext);
            return React.createElement(
                React.Fragment,
                null,
                props.content,
                props.placeholder,
                props.input,
                React.createElement('button', {
                    type: 'button',
                    'aria-label': 'Open same-session workspace link',
                    onClick: () => openWorkspaceLink?.({
                        pathname: '/workspace',
                        params: {
                            mode: 'link',
                            originSessionId: 'parent',
                            machineId: 'machine-1',
                            absolutePath: '/work/project/notes.md',
                        },
                    }),
                }, 'Open workspace link'),
            );
        };
    `,
    '@/components/AgentInput': `
        import React from 'react';
        let mountCounter = 0;
        export const AgentInput = React.forwardRef((props, ref) => {
            const mountId = React.useRef('composer-' + (++mountCounter)).current;
            const [draft, setDraft] = React.useState('');
            React.useImperativeHandle(ref, () => ({
                focus() {},
                getText: () => draft,
                setTextAndSelection(text) { setDraft(text); },
            }), [draft]);
            return React.createElement('div', {
                'data-testid': 'session-composer',
                'data-session-id': props.sessionId,
                'data-mount-id': mountId,
            }, props.sessionId, React.createElement('input', {
                'data-testid': 'session-composer-draft',
                value: draft,
                onChange: (event) => {
                    setDraft(event.currentTarget.value);
                    props.onChangeText?.(event.currentTarget.value);
                },
            }));
        });
    `,
    '@/components/AgentGoalBar': `export const AgentGoalBar = () => null;`,
    '@/components/AgentQuestionBanner': `export const AgentQuestionBanner = () => null;`,
    '@/components/ChatList': `export const ChatList = () => null;`,
    '@/components/QueuedMessagesPanel': `export const QueuedMessagesPanel = () => null;`,
    '@/components/MachineFileUploadStatus': `export const MachineFileUploadStatus = () => null;`,
    '@/components/Deferred': `export const Deferred = ({ children }) => children;`,
    '@/components/EmptyMessages': `export const EmptyMessages = () => null;`,
    '@/components/SessionStatusBar': `export const SessionStatusBar = () => null;`,
    '@/components/Avatar': `export const Avatar = () => null;`,
    '@/components/VoiceAssistantStatusBar': `export const VoiceAssistantStatusBar = () => null; export const VOICE_PILL_TOTAL_HEIGHT = 0;`,
    '@/components/AllFilesDiffView': `export const AllFilesDiffView = () => null;`,
    '@/components/FileViewPanel': `export const FileViewPanel = () => null;`,
    '@/components/RigActivityBar': `export const RigActivityBar = () => null;`,
    '@/components/agentGoalStatus': `export const resolveVisibleAgentGoalStatus = () => null;`,
    '@/components/modelModeOptions': `
        export const getAdvertisedDefaultOptionKey = () => undefined;
        export const getRigCurrentModelOptionKey = () => undefined;
        export const getSessionAvailableModels = () => [];
        export const getSessionAvailablePermissionModes = () => [];
        export const getSessionEffortLevelsForModel = () => [];
        export const resolveCurrentOption = () => null;
    `,
    '@/components/autocomplete/suggestions': `export const getSuggestions = () => [];`,
    '@/components/diff/PierreDiffView': `export const prefetchPierreDiff = () => {};`,
    '@/hooks/useDraft': `export const useDraft = () => ({ clearDraft() {} });`,
    '@/hooks/useImagePicker': `export const useImagePicker = () => ({ addImages() {}, clearImages() {}, pickImages() {}, removeImage() {}, selectedImages: [] });`,
    '@/hooks/useMachineFileUpload': `export const useMachineFileUpload = () => ({ canCancel: false, canRetry: false, cancel() {}, pickAndUpload() {}, retry() {}, state: { phase: 'idle' } });`,
    '@/hooks/useVoiceDictation': `export const useVoiceDictation = () => ({ canRetry: false, cancel() {}, error: null, phase: 'idle', retry() {}, toggle() {} });`,
    '@/hooks/useVoiceInputAvailability': `export const useVoiceInputAvailability = () => ({ available: false, configured: false, enabled: false, loading: false });`,
    '@/hooks/useSessionQuickActions': `export const useSessionQuickActions = (session) => ({ canResume: !session.active, resumeSession() {}, resumeSessionWithQueuedTurn() {}, resumingSession: false });`,
    '@/sync/gitStatusSync': `export const gitStatusSync = { getSync: () => ({ invalidate() {} }) };`,
    '@/sync/ops': `
        export const machineControlHeartbeat = async () => {};
        export const machineCreateSideChat = async () => {
            window.__SIDE_CHAT_CREATE_COUNT__ = (window.__SIDE_CHAT_CREATE_COUNT__ ?? 0) + 1;
            return { success: false, phases: [] };
        };
        export const machineGetDirectoryTree = async (_machineId, path) => {
            window.__FILE_TREE_COUNT__ = (window.__FILE_TREE_COUNT__ ?? 0) + 1;
            return {
                success: true,
                tree: { type: 'file', name: path.split('/').pop() || path, path },
            };
        };
        export const machineStopSession = async () => {};
        export const sessionAbort = async () => {};
        export const sessionCancelCommunication = async () => {};
        export const sessionGoalAction = async () => {};
        export const sessionSetAgentModes = async () => {};
        export const sessionKill = async () => {};
        export const sessionArchive = async () => {};
    `,
    '@/sync/sideChatLifecycle': `export const closeSideChatSession = async () => {}; export const resolveSideChatCloseReconciliation = () => ({ error: null, restoreTab: false });`,
    '@/sync/attachmentSupport': `export const supportsImageAttachmentsForFlavor = () => false;`,
    '@/sync/agentDefaults': `
        export const getAgentDefaultOverrideValue = () => undefined;
        export const resolveAgentDefaultConfig = () => ({ modelMode: undefined, permissionMode: undefined });
        export const resolveAgentDefaultEffortLevel = () => undefined;
        export const setAgentDefaultOverride = (value) => value;
    `,
    '@/sync/rig': `
        export const getRigGitSummary = () => null; export const getRigReasoningSelection = () => undefined;
        export const isRigMetadata = () => false; export const isRigModelSelectionEnabled = () => false;
        export const isRigPermissionSelectionEnabled = () => false; export const isRigReasoningSelectionEnabled = () => false;
        export const rigCanAbort = () => false; export const rigCanBrowseFiles = () => true;
        export const rigCanReadFiles = () => false; export const rigCanUseAttachments = () => false; export const rigCanUseShell = () => true;
    `,
    '@/sync/workspaceContext': `
        const entries = [];
        export const MAX_WORKSPACE_CONTEXT_ITEMS = 8; export const addWorkspaceContextFile = () => true;
        export const buildWorkspaceContextMessage = async (_id, text) => ({ displayText: text, promptText: text });
        export const clearWorkspaceContextFiles = () => {}; export const getWorkspaceContextEntries = () => entries;
        export const removeWorkspaceContextEntry = () => {}; export const subscribeWorkspaceContext = () => () => {};
    `,
    '@/sync/queueProjection': `export const projectSessionQueue = () => ({ items: [] });`,
    '@/sync/grokPermissionModeTransition': `export const transitionGrokPermissionModeAndCommit = async () => {};`,
    '@/utils/sessionStatusBar': `export const resolveStatusBarGitBranch = () => null;`,
    '@/utils/rigGitLineChanges': `export const visibleRigGitLineChanges = () => null;`,
    '@/utils/sessionUtils': `
        export const formatPathRelativeToHome = (path) => path; export const getResumeCommandBlock = () => null;
        export const getSessionAvatarId = (session) => session.id; export const getSessionName = (session) => session.metadata?.summary?.text ?? session.id;
        export const useSessionStatus = (session) => ({ isConnected: session.active, isPulsing: false, state: session.active ? 'waiting' : 'disconnected', statusColor: '#111', statusDotColor: '#111', statusText: session.active ? 'online' : 'offline' });
    `,
    '@/utils/versionUtils': `export const MINIMUM_CLI_VERSION = '0.0.0'; export const isVersionSupported = () => true;`,
    '@/utils/machineWorkspace': `export const buildWorkspaceAttachmentParams = () => null;`,
    '@/utils/heartbeatCommand': `export const HEARTBEAT_COMMAND = { dispatch: async () => ({ handled: false }) };`,
    '@/utils/sessionContinuation': `export const deliverSessionTurn = async () => {};`,
    '@/-session/sessionOverlayNav': `export const useOverlayNav = { getState: () => ({ publish() {}, reset() {} }) };`,
    '@/-session/agentGoalActionHandler': `export const performAgentGoalAction = async () => {};`,
    '@/-session/workspaceLinkNavigation': `
        import React from 'react'; export const WorkspaceLinkPressContext = React.createContext(undefined);
    `,
    'expo-clipboard': `export const setStringAsync = async () => {};`,
};

const fixturePlugin: Plugin = {
    name: 'side-chat-browser-fixture',
    setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in virtualModules) return { path: args.path, namespace: 'fixture-stub' };
            if (args.path === './MobileGlass') return { path: '@/components/MobileGlass', namespace: 'fixture-stub' };
            if (args.path === './BubblePressable') return { path: '@/components/BubblePressable', namespace: 'fixture-stub' };
            if (args.path === './navigation/MobileHeaderScrim') return { path: '@/components/navigation/MobileHeaderScrim', namespace: 'fixture-stub' };
            if (args.path === './AnimatedOverlay') return { path: '@/components/AnimatedOverlay', namespace: 'fixture-stub' };
            if (args.path === './workspaceLinkNavigation') return { path: '@/-session/workspaceLinkNavigation', namespace: 'fixture-stub' };
            if (args.path === './agentGoalActionHandler') return { path: '@/-session/agentGoalActionHandler', namespace: 'fixture-stub' };
            if (args.path.startsWith('@/')) {
                const sourcePath = resolve(appRoot, 'sources', args.path.slice(2));
                const path = [sourcePath, `${sourcePath}.ts`, `${sourcePath}.tsx`].find(existsSync);
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

describe('Side chats browser interaction', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const bundle = await build({
            entryPoints: [resolve(here, '__testdata__/sideChatHeader.browser.fixture.tsx')],
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
            jsx: 'automatic',
            alias: { 'react-native': 'react-native-web' },
            plugins: [fixturePlugin],
        });
        const script = bundle.outputFiles[0].text;
        server = createServer((_request, response) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<style>html,body,#root{height:100%;margin:0}</style><main id="root"></main><script>${script}</script>`);
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

    it('opens, switches, and collapses the desktop panel without a background session cancelling it', async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.addInitScript(() => {
            (window as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { fileDiffsSidebarEnabled: true };
        });
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
        await foreground.getByText('Changes').waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined);
        expect(pageErrors).toEqual([]);
        expect(await page.locator('body').innerText()).toContain('Changes');
        await expect(foreground.getByText('Changes').isVisible()).resolves.toBe(true);
        await expect(foreground.getByText('All Files').isVisible()).resolves.toBe(true);
        await foreground.getByRole('button', { name: 'Open side chats (2)' }).click({ timeout: 3_000 });

        await foreground.getByRole('button', { name: 'Collapse side chats' }).waitFor({ timeout: 2_000 });
        await expect(foreground.getByText('Changes').isVisible()).resolves.toBe(false);
        await expect(foreground.getByText('Newest child').isVisible()).resolves.toBe(true);
        await expect(foreground.locator('[data-testid="session-composer"][data-session-id="child-newest"]').textContent({ timeout: 2_000 }))
            .resolves.toBe('child-newest');
        await foreground.getByText('Oldest child').click();
        await expect(foreground.locator('[data-testid="session-composer"][data-session-id="child-oldest"]').textContent({ timeout: 2_000 }))
            .resolves.toBe('child-oldest');
        await expect(page.evaluate(() => (window as any).__SIDE_CHAT_CREATE_COUNT__ ?? 0)).resolves.toBe(0);

        await foreground.getByRole('button', { name: 'Collapse side chats' }).click();
        await expect(foreground.getByText('Changes').isVisible()).resolves.toBe(true);
        await expect(foreground.locator('[data-testid="session-composer"][data-session-id^="child-"]').count())
            .resolves.toBe(0);
        await page.close();
    }, 10_000);

    it('opens a same-session link in the 900px canonical split during Zen mode and resizes it', async () => {
        const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
        await page.addInitScript(() => {
            (window as any).__HAPPYHERD_FIXTURE_OPTIONS__ = { zenMode: true };
        });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        page.on('console', (message) => {
            if (
                (message.type() === 'error' || message.type() === 'warning')
                && message.text() !== 'props.pointerEvents is deprecated. Use style.pointerEvents'
            ) {
                pageErrors.push(message.text());
            }
        });
        await page.goto(origin);

        const foreground = page.getByTestId('foreground-session');
        const composer = foreground.locator('[data-testid="session-composer"][data-session-id="parent"]');
        const composerDraft = composer.getByTestId('session-composer-draft');
        await composer.waitFor({ state: 'visible', timeout: 3_000 });
        await expect(foreground.getByText('Changes').count()).resolves.toBe(0);
        await composerDraft.fill('main draft survives first open');
        const composerMountId = await composer.getAttribute('data-mount-id');
        if (!composerMountId) throw new Error('Main Agent composer has no mount identity');

        const workspaceLink = foreground.getByRole('button', { name: 'Open same-session workspace link' });
        await workspaceLink.click();
        await expect(page.evaluate(() => (window as any).__FILE_TREE_COUNT__ ?? 0)).resolves.toBe(1);
        const workspace = foreground.getByTestId('desktop-file-workspace');
        const fileTab = foreground.getByRole('tab', { name: 'Open file notes.md' });
        const host = foreground.getByTestId('desktop-file-workspace-host');
        const divider = foreground.getByTestId('desktop-file-workspace-divider');
        await workspace.waitFor({ state: 'visible', timeout: 3_000 });
        await fileTab.waitFor({ state: 'visible', timeout: 3_000 });

        const initialHostBox = await host.boundingBox();
        const initialDividerBox = await divider.boundingBox();
        if (!initialHostBox || !initialDividerBox) {
            throw new Error('canonical file workspace split has no measurable layout');
        }
        await expect(foreground.getByTestId('workspace-link-side-panel').count()).resolves.toBe(0);
        await expect(foreground.getByTestId('workspace-link-panel').count()).resolves.toBe(0);
        await expect(composer.getAttribute('data-mount-id')).resolves.toBe(composerMountId);
        await expect(composerDraft.inputValue()).resolves.toBe('main draft survives first open');

        await workspaceLink.click();
        await expect(foreground.getByRole('tab', { name: 'Open file notes.md' }).count()).resolves.toBe(1);

        await page.mouse.move(
            initialDividerBox.x + initialDividerBox.width / 2,
            initialDividerBox.y + initialDividerBox.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
            initialDividerBox.x + 140,
            initialDividerBox.y + initialDividerBox.height / 2,
            { steps: 8 },
        );
        await page.mouse.up();

        const resizedHostBox = await host.boundingBox();
        if (!resizedHostBox) throw new Error('resized workspace link host has no layout');
        expect(resizedHostBox.width).toBeLessThan(initialHostBox.width - 100);
        await expect(composer.isVisible()).resolves.toBe(true);
        await expect(composer.getAttribute('data-mount-id')).resolves.toBe(composerMountId);
        await expect(composerDraft.inputValue()).resolves.toBe('main draft survives first open');

        await page.setViewportSize({ width: 390, height: 844 });
        await foreground.getByTestId('desktop-file-workspace-divider').waitFor({ state: 'detached', timeout: 3_000 });
        const narrowHostBox = await host.boundingBox();
        const narrowForegroundBox = await foreground.boundingBox();
        if (!narrowHostBox || !narrowForegroundBox) throw new Error('fullscreen workspace link has no layout');
        expect(Math.abs(narrowHostBox.width - narrowForegroundBox.width)).toBeLessThan(2);
        expect(Math.abs(narrowHostBox.height - narrowForegroundBox.height)).toBeLessThan(2);
        await expect(foreground.getByRole('tab', { name: 'Open file notes.md' }).count()).resolves.toBe(0);
        await expect(workspace.isVisible()).resolves.toBe(true);
        await expect(composer.getAttribute('data-mount-id')).resolves.toBe(composerMountId);
        await expect(composerDraft.inputValue()).resolves.toBe('main draft survives first open');
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);

    it('opens a same-session link directly in the compact mobile workspace', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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
        const composer = foreground.locator('[data-testid="session-composer"][data-session-id="parent"]');
        const composerDraft = composer.getByTestId('session-composer-draft');
        await composer.waitFor({ state: 'visible', timeout: 3_000 });
        await composerDraft.fill('mobile draft survives first open');
        const composerMountId = await composer.getAttribute('data-mount-id');
        if (!composerMountId) throw new Error('Main Agent composer has no mount identity');
        await foreground.getByRole('button', { name: 'Open same-session workspace link' }).click();

        const workspace = foreground.getByTestId('desktop-file-workspace');
        await workspace.waitFor({ state: 'visible', timeout: 3_000 });
        await foreground.getByTestId('desktop-file-workspace-fullscreen-header').waitFor({ state: 'visible' });
        await expect(foreground.getByText('notes.md').isVisible()).resolves.toBe(true);
        await expect(foreground.getByTestId('desktop-file-workspace-divider').count()).resolves.toBe(0);
        await expect(foreground.getByTestId('workspace-link-side-panel').count()).resolves.toBe(0);
        await expect(foreground.getByTestId('workspace-link-panel').count()).resolves.toBe(0);
        await expect(composer.getAttribute('data-mount-id')).resolves.toBe(composerMountId);
        await expect(composerDraft.inputValue()).resolves.toBe('mobile draft survives first open');
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);

    it('opens the same newest child in the narrow full-screen host and collapses it', async () => {
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
        await expect(foreground.getByText('Newest child').isVisible()).resolves.toBe(true);
        await expect(foreground.locator('[data-testid="session-composer"][data-session-id="child-newest"]').textContent({ timeout: 2_000 }))
            .resolves.toBe('child-newest');
        await foreground.getByText('Oldest child').click();
        await expect(foreground.locator('[data-testid="session-composer"][data-session-id="child-oldest"]').textContent({ timeout: 2_000 }))
            .resolves.toBe('child-oldest');
        await expect(page.evaluate(() => (window as any).__SIDE_CHAT_CREATE_COUNT__ ?? 0)).resolves.toBe(0);

        await foreground.getByRole('button', { name: 'Collapse side chats' }).last().click();
        await expect(foreground.locator('[data-testid="session-composer"][data-session-id^="child-"]').count())
            .resolves.toBe(0);
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);
});
