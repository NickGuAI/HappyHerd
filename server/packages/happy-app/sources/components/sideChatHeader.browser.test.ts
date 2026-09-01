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
    'react-native': `
        import React from 'react';
        import { Animated } from 'react-native-web';
        export * from 'react-native-web';
        export const TurboModuleRegistry = { get: () => null };
        export const useAnimatedValue = (initialValue) => React.useRef(new Animated.Value(initialValue)).current;
    `,
    'react-native-unistyles': `
        const theme = {
            dark: false,
            colors: {
                text: '#111', textSecondary: '#666', divider: '#ddd', surface: '#f5f5f5',
                textLink: '#06c', textDestructive: '#c22', warningCritical: '#c22',
                surfaceHigh: '#eee', surfaceHighest: '#e8e8e8', surfacePressed: '#ddd', surfacePressedOverlay: 'transparent',
                surfaceSelected: '#e5e5e5', groupped: { background: '#fff' },
                input: { background: '#f0f0f0', placeholder: '#999', text: '#111' },
                header: { background: '#fff', tint: '#111' },
                modal: { border: '#ddd' },
                glass: {
                    backgroundStrong: '#fff', backgroundSubtle: '#f8f8f8', border: '#ddd', divider: '#ddd',
                    overlay: '#fff', overlayTint: '#fff',
                },
                shadow: { color: '#000', opacity: 0.1 },
                button: { primary: { tint: '#fff', background: '#111', disabled: '#aaa' }, secondary: { tint: '#666' } },
                success: '#0a0', gitAddedText: '#0a0', gitRemovedText: '#c22',
                box: {
                    error: { background: '#fee', border: '#d44', text: '#900' },
                    warning: { background: '#fff8dd', border: '#b70', text: '#742' },
                },
                radio: { active: '#111', inactive: '#aaa', dot: '#fff' }, warning: '#b70',
                status: { error: '#c22' },
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
    'react-native-svg': `
        import React from 'react';
        const Svg = (props) => React.createElement('svg', props, props.children);
        export const Circle = (props) => React.createElement('circle', props, props.children);
        export default Svg;
    `,
    'react-native-safe-area-context': `export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });`,
    'expo-router': `
        export const useRouter = () => ({ push() {}, back() {}, dismissTo() {} });
        export const useLocalSearchParams = () => ({});
        export const Stack = { Screen: () => null };
    `,
    'react-native-reanimated': `
        import React from 'react';
        import { ScrollView, View } from 'react-native';
        export default { ScrollView, View };
        export const useSharedValue = (value) => ({ value });
        export const useAnimatedStyle = (factory) => factory();
        export const withRepeat = (value) => value;
        export const withTiming = (value) => value;
        export const Easing = { out: (value) => value, cubic: 'cubic' };
    `,
    'expo-linear-gradient': `import { View } from 'react-native'; export const LinearGradient = View;`,
    'expo-image': `import { View } from 'react-native'; export const Image = View;`,
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
        const makeSession = (id, createdAt, metadata = {}, active = true) => ({
            id, seq: 0, createdAt, updatedAt: createdAt, active, activeAt: createdAt,
            presence: active ? 'online' : 'offline',
            metadata: { host: 'fixture', path: '/work/project', summary: { text: id }, ...metadata },
        });
        const sessions = {
            parent: makeSession('parent', 1, legacyClaudeContinuation
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
        const settings = {
            diffStyle: 'unified',
            expImageUpload: fixtureOptions.imageAttachments === true,
            machineWorkspace: fixtureOptions.machineWorkspaceEnabled ?? true,
            recentMachinePaths: [],
            favoriteMachinePaths: [],
        };
        const machines = [
            { id: 'machine-1', active: true, metadata: { displayName: 'MainEC2', host: 'fixture', homeDir: '/work/project', platform: 'linux', supportsFileDelete: true, cliAvailability: { claude: true, codex: true } } },
            { id: 'machine-newest', active: true, metadata: { displayName: 'SideEC2', host: 'fixture-side', homeDir: '/work/child-newest', platform: 'linux', supportsFileDelete: true, cliAvailability: { claude: true, codex: true } } },
        ];
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
            sessions,
            machines: Object.fromEntries(machines.map((machine) => [machine.id, machine])),
            purchases: { entitlements: {} },
            currentViewingSessionId: null,
            pathProjectFiles,
            applyLocalSettings(update) { Object.assign(localSettings, update); emit(); },
            applyGitStatusFiles() {},
            applyProjectFiles(pathKey, result) { pathProjectFiles[pathKey] = result; emit(); },
            getSessionPathKey: (sessionId) => sessionId,
            setCurrentViewingSession() {},
        });
        export const storage = Object.assign(() => undefined, { getState });
        export const useIsDataReady = () => true;
        export const useLocalSetting = (key) => React.useSyncExternalStore(subscribe, () => localSettings[key], () => localSettings[key]);
        export const useMachine = (id) => machines.find((machine) => machine.id === id) ?? null;
        export const useAllMachines = () => machines;
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
        let messagesLoaded = fixtureOptions.providerContinuationMessagesLoaded !== false;
        export const __loadProviderContinuationMessages = () => {
            messagesLoaded = true;
            return messages;
        };
        export const useSessionMessages = () => ({
            hasMoreOlder: false,
            isLoaded: messagesLoaded,
            isLoadingOlder: false,
            messages: messagesLoaded ? messages : [],
        });
        export const useSessionPendingCommunications = () => [];
        export const useSessionProjectFiles = (sessionId) => React.useSyncExternalStore(
            subscribe,
            () => pathProjectFiles[sessionId] ?? null,
            () => pathProjectFiles[sessionId] ?? null,
        );
        export const useSessionUsage = () => null;
        export const useSetting = (key) => key === 'sessionStatusBarDisplay' ? 'hidden' : settings[key];
        export const useSettingMutable = (key) => {
            const value = React.useSyncExternalStore(subscribe, () => settings[key], () => settings[key]);
            const setValue = React.useCallback((next) => {
                settings[key] = next;
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
        export const t = (key, params) => ({
            'sideChat.panelTitle': 'Side chats',
            'sideChat.openCount': 'Open side chats (' + (params?.count ?? '') + ')',
            'sideChat.collapse': 'Collapse side chats',
            'sideChat.newChat': 'New side chat',
            'sideChat.tabLabel': 'Side chat ' + ((params?.index ?? 0) + 1),
            'sideChat.close': 'Close side chat',
            'sideChat.expand': 'Expand side chat',
            'files.changes': 'Changes',
            'files.addPanel': 'Add panel',
            'files.resizeWorkspace': 'Resize file workspace',
            'files.openFileTab': 'Open file ' + (params?.name ?? ''),
            'files.closeFileTab': 'Close file ' + (params?.name ?? ''),
            'files.openExistingFile': 'Open existing file',
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
    '@/sync/sync': `
        import { __loadProviderContinuationMessages } from '@/sync/storage';
        export const sync = {
            onSessionVisible() {},
            ensureSessionMessagesLoaded: async (sessionId) => {
                window.__PROVIDER_CONTINUATION_SOURCE_LOAD__ = sessionId;
                return __loadProviderContinuationMessages();
            },
            refreshSessions: () => new Promise(() => {}),
            sendMessage: async (sessionId, text, options) => {
                window.__PROVIDER_CONTINUATION_SEND__ = { sessionId, text, options };
                window.__COMPOSER_SENDS__ = [...(window.__COMPOSER_SENDS__ ?? []), { sessionId, text, options }];
                return { localId: 'handoff-message' };
            },
            applySettings() {},
        };
    `,
    '@/modal': `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        export const Modal = {
            alert() {},
            confirm: async () => true,
            prompt() {},
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
    '@/components/EmptyMessages': `export const EmptyMessages = () => null;`,
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
        export const getAdvertisedDefaultOptionKey = () => undefined;
        export const getRigCurrentModelOptionKey = () => undefined;
        export const getSessionAvailableModels = () => [];
        export const getSessionAvailablePermissionModes = () => [];
        export const getSessionEffortLevelsForModel = () => [];
        export const resolveCurrentOption = () => null;
    `,
    '@/components/autocomplete/suggestions': `export const getSuggestions = () => [];`,
    '@/components/diff/PierreDiffView': `export const prefetchPierreDiff = () => {}; export const PierreDiffView = () => null;`,
    '@/hooks/useDraft': `export const useDraft = () => ({ clearDraft() {} });`,
    '@/hooks/useImagePicker': `export const useImagePicker = () => ({
        addImages() {}, clearImages() {}, removeImage() {}, selectedImages: [],
        pickImages() { window.__ATTACHMENT_PICK_COUNT__ = (window.__ATTACHMENT_PICK_COUNT__ ?? 0) + 1; },
    });`,
    '@/hooks/useMachineFileUpload': `export const useMachineFileUpload = () => ({ canCancel: false, canRetry: false, cancel() {}, pickAndUpload() {}, reset() {}, retry() {}, state: { phase: 'idle' } });`,
    '@/hooks/useVoiceDictation': `export const useVoiceDictation = () => ({
        canRetry: false, cancel() {}, error: null, phase: 'idle', retry() {},
        toggle() { window.__DICTATION_TOGGLE_COUNT__ = (window.__DICTATION_TOGGLE_COUNT__ ?? 0) + 1; },
    });`,
    '@/hooks/useVoiceInputAvailability': `export const useVoiceInputAvailability = () => {
        const available = globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.voiceAvailable === true;
        return { available, configured: available, enabled: available, loading: false };
    };`,
    '@/hooks/useWorktreeCleanup': `export const maybeCleanupWorktree = async () => {};`,
    '@/hooks/useNavigateToSession': `export const useNavigateToSession = () => (sessionId) => { window.__PROVIDER_CONTINUATION_NAVIGATED__ = sessionId; };`,
    '@/components/DuplicateSheet': `export const DuplicateSheet = () => null;`,
    '@/components/ShortcutHints': `export const SessionShortcutHintBadge = () => null;`,
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
        export const machineControlHeartbeat = async () => {};
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
            if (path === '/work/project' || path === '/work/child-oldest' || path === '/work/child-newest') {
                const fileName = path === '/work/project'
                    ? 'machine-file.md'
                    : path.split('/').pop() + '-machine-file.md';
                return {
                    success: true,
                    tree: {
                        type: 'directory', name: path.split('/').pop(), path,
                        children: [{ type: 'file', name: fileName, path: path + '/' + fileName, size: 12 }],
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
        export const machineCreateDirectory = async () => ({ success: false, error: 'not used' });
        export const machineDeleteFile = async (machineId, path) => {
            window.__MACHINE_DELETE_CALLS__ = [...(window.__MACHINE_DELETE_CALLS__ ?? []), { machineId, path }];
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
        export const sessionSetAgentModes = async () => {};
        export const sessionKill = async () => {};
        export const sessionArchive = async () => {};
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
    '@/sync/attachmentSupport': `export const supportsImageAttachmentsForFlavor = () => globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.imageAttachments === true;`,
    '@/sync/agentDefaults': `
        export const getAgentDefaultOverrideValue = () => undefined;
        export const resolveAgentDefaultConfig = () => ({ modelMode: undefined, permissionMode: undefined });
        export const resolveAgentDefaultEffortLevel = () => undefined;
        export const setAgentDefaultOverride = (value) => value;
    `,
    '@/sync/rig': `
        export const getRigGitSummary = () => null; export const getRigReasoningSelection = () => undefined;
        export const getProviderIconKind = () => 'codex'; export const usesControlledSessionUi = () => false;
        export const isRigMetadata = () => false; export const isRigModelSelectionEnabled = () => false;
        export const isRigPermissionSelectionEnabled = () => false; export const isRigReasoningSelectionEnabled = () => false;
        export const rigCanAbort = () => false; export const rigCanBrowseFiles = () => true;
        export const rigCanReadFiles = () => false;
        export const rigCanUseAttachments = () => globalThis.__HAPPYHERD_FIXTURE_OPTIONS__?.imageAttachments === true;
        export const rigCanUseShell = () => true;
        export const rigCanWriteFiles = () => true; export const sessionCanDeleteFiles = () => true;
    `,
    '@/sync/workspaceContext': `
        const entriesBySession = new Map();
        const entriesFor = (sessionId) => {
            if (!entriesBySession.has(sessionId)) entriesBySession.set(sessionId, []);
            return entriesBySession.get(sessionId);
        };
        export const MAX_WORKSPACE_CONTEXT_ITEMS = 8; export const addWorkspaceContextFile = () => true;
        export const addWorkspaceContextEntry = (sessionId, entry) => {
            entriesBySession.set(sessionId, [...entriesFor(sessionId), entry]);
            window.__WORKSPACE_CONTEXT_CALLS__ = [...(window.__WORKSPACE_CONTEXT_CALLS__ ?? []), { sessionId, entry }];
            return true;
        };
        export const buildWorkspaceContextMessage = async (_id, text) => ({ displayText: text, promptText: text });
        export const workspaceContextEntryKey = (entry) => JSON.stringify(entry.source.kind === 'machine'
            ? ['machine', entry.source.machineId, entry.path]
            : ['session', entry.path]);
        export const clearWorkspaceContextFiles = (sessionId) => entriesBySession.set(sessionId, []);
        export const getWorkspaceContextEntries = (sessionId) => entriesFor(sessionId);
        export const removeWorkspaceContextEntry = (sessionId, entryOrPath) => {
            entriesBySession.set(sessionId, entriesFor(sessionId).filter((entry) => (
                typeof entryOrPath === 'string'
                    ? entry.path !== entryOrPath
                    : workspaceContextEntryKey(entry) !== workspaceContextEntryKey(entryOrPath)
            )));
        }; export const subscribeWorkspaceContext = () => () => {};
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
        export const formatPathRelativeToHome = (path) => path; export const getResumeCommandBlock = () => null;
        export const getSessionAvatarId = (session) => session.id; export const getSessionName = (session) => session.metadata?.summary?.text ?? session.id;
        export const useSessionStatus = (session) => ({ isConnected: session.active, isPulsing: false, state: session.active ? 'waiting' : 'disconnected', statusColor: '#111', statusDotColor: '#111', statusText: session.active ? 'online' : 'offline' });
    `,
    '@/utils/versionUtils': `export const MINIMUM_CLI_VERSION = '0.0.0'; export const isVersionSupported = () => true;`,
    '@/utils/heartbeatCommand': `export const HEARTBEAT_COMMAND = { dispatch: async () => ({ handled: false }) };`,
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
            sourcemap: 'inline',
            define: {
                __DEV__: 'false',
                'process.env.EXPO_OS': '"web"',
                'process.env.NODE_ENV': '"test"',
            },
            jsx: 'automatic',
            loader: { '.png': 'dataurl' },
            plugins: [fixturePlugin],
        });
        const script = bundle.outputFiles[0].text;
        server = createServer((_request, response) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(`<style>html,body,#root{height:100%;margin:0}</style><main id="root"></main><script>globalThis.global=globalThis;${script}</script>`);
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
        await page.getByRole('button', { name: 'Continue with…' }).click();
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
        await page.getByRole('button', { name: 'Continue with…' }).click();
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
        await expect(foreground.getByText('Changes').isVisible()).resolves.toBe(false);
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
        await expect(workspace.getByPlaceholder('Path').inputValue()).resolves.toBe('/work/project');
        await expect(workspace.getByText('Upload', { exact: true }).isVisible()).resolves.toBe(true);
        await workspace.getByText('machine-file.md', { exact: true }).click();
        await foreground.getByRole('tab', { name: 'Open file machine-file.md' }).waitFor({ state: 'visible', timeout: 3_000 });
        await expect(foreground.getByTestId('workspace-link-side-panel').count()).resolves.toBe(0);
        await expect(foreground.getByTestId('workspace-link-panel').count()).resolves.toBe(0);

        expect(pageErrors).toEqual([]);
        await page.close();
    }, 30_000);

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
        await expect(workspace.getByPlaceholder('Path').inputValue()).resolves.toBe('/work/child-newest');
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
        await expect(foreground.getByText('Changes').count()).resolves.toBe(0);
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

        await page.setViewportSize({ width: 390, height: 844 });
        await foreground.getByTestId('desktop-file-workspace-divider').waitFor({ state: 'detached', timeout: 3_000 });
        const narrowHostBox = await host.boundingBox();
        const narrowForegroundBox = await foreground.boundingBox();
        if (!narrowHostBox || !narrowForegroundBox) throw new Error('fullscreen workspace link has no layout');
        expect(Math.abs(narrowHostBox.width - narrowForegroundBox.width)).toBeLessThan(2);
        expect(Math.abs(narrowHostBox.height - narrowForegroundBox.height)).toBeLessThan(2);
        await expect(foreground.getByRole('tab', { name: 'Open file main-notes.md' }).count()).resolves.toBe(0);
        await expect(workspace.isVisible()).resolves.toBe(true);
        await expect(foreground.locator('textarea[data-retention-composer="main"]').isVisible()).resolves.toBe(true);
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
        await foreground.getByTestId('desktop-file-workspace-fullscreen-header').waitFor({ state: 'visible' });
        await expect(foreground.getByText('main-notes.md').isVisible()).resolves.toBe(true);
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
        await foreground.getByText('mobile-change.ts').waitFor({ state: 'visible', timeout: 3_000 });
        const voiceBox = await voiceStatus.boundingBox();
        const changesBox = await foreground.getByTestId('mobile-changes-workspace-overlay').boundingBox();
        if (!voiceBox || !changesBox) throw new Error('voice status or Changes workspace has no rendered layout');
        expect(changesBox.y).toBeGreaterThanOrEqual(voiceBox.y + voiceBox.height);
        await page.mouse.click(20, 32);
        await foreground.getByTestId('mobile-changes-workspace-overlay').waitFor({ state: 'detached', timeout: 3_000 });
        await assertMainComposerRetained();

        await openMainAction('workspace');
        const compactWorkspace = page.getByTestId('desktop-file-workspace').filter({ visible: true });
        await compactWorkspace.waitFor({ state: 'visible', timeout: 3_000 });
        await expect(page.getByTestId('desktop-file-workspace-fullscreen-header').filter({ visible: true }).getByText('Workspace').isVisible())
            .resolves.toBe(true);
        await expect(compactWorkspace.getByPlaceholder('Path').inputValue()).resolves.toBe('/work/project');
        await page.getByText('MainEC2').filter({ visible: true }).waitFor({ state: 'visible', timeout: 3_000 });
        await expect(page.getByText('Upload', { exact: true }).filter({ visible: true }).isVisible())
            .resolves.toBe(true);
        const machineFile = page.getByText('machine-file.md').filter({ visible: true });
        await machineFile.waitFor({ state: 'visible', timeout: 3_000 });
        await page.getByTestId('desktop-file-workspace-picker-close').filter({ visible: true }).click();
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
        await foreground.getByText('/work/child-newest-change.ts', { exact: true })
            .waitFor({ state: 'visible', timeout: 3_000 });
        await expect(foreground.getByText('/work/project/mobile-change.ts', { exact: true }).count()).resolves.toBe(0);
        await page.mouse.click(20, 32);
        await foreground.getByTestId('mobile-changes-workspace-overlay').waitFor({ state: 'detached', timeout: 3_000 });
        await assertNewestComposerRetained();

        await openNewestAction('workspace');
        await page.getByTestId('desktop-file-workspace-fullscreen-header').filter({ visible: true })
            .getByText('Workspace', { exact: true }).waitFor({ state: 'visible', timeout: 3_000 });
        await expect(page.getByTestId('desktop-file-workspace').filter({ visible: true })
            .getByPlaceholder('Path').inputValue()).resolves.toBe('/work/child-newest');
        await page.getByText('child-newest-machine-file.md', { exact: true }).filter({ visible: true })
            .waitFor({ state: 'visible', timeout: 3_000 });
        await page.getByTestId('desktop-file-workspace-picker-close').filter({ visible: true }).click();
        await assertNewestComposerRetained();

        await foreground.getByText('Oldest child', { exact: true }).click();
        const oldestDraft = foreground.locator('textarea').last();
        await oldestDraft.waitFor({ state: 'visible', timeout: 3_000 });
        await oldestDraft.fill('oldest child draft survives workspace return');
        await oldestDraft.evaluate((element) => { element.dataset.retentionComposer = 'child-oldest'; });
        await foreground.getByTestId('mobile-composer-actions-trigger').last().click({ timeout: 3_000 });
        await foreground.getByTestId('mobile-composer-actions-menu')
            .getByTestId('mobile-composer-action-changes').click({ timeout: 3_000 });
        await foreground.getByText('/work/child-oldest-change.ts', { exact: true })
            .waitFor({ state: 'visible', timeout: 3_000 });
        await expect(foreground.getByText('/work/child-newest-change.ts', { exact: true }).count()).resolves.toBe(0);
        await page.mouse.click(20, 32);
        await foreground.getByTestId('mobile-changes-workspace-overlay').waitFor({ state: 'detached', timeout: 3_000 });
        const retainedOldestDraft = foreground.locator('textarea[data-retention-composer="child-oldest"]');
        await expect(retainedOldestDraft.inputValue()).resolves.toBe('oldest child draft survives workspace return');

        expect(pageErrors).toEqual([]);
        await page.close();
    }, 30_000);

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
        const newestDraft = foreground.locator('textarea').last();
        await newestDraft.waitFor({ state: 'visible', timeout: 2_000 });
        await newestDraft.evaluate((element) => { element.dataset.fullscreenSideChatComposer = 'newest'; });
        await foreground.getByText('Oldest child').click();
        await foreground.locator('textarea[data-fullscreen-side-chat-composer="newest"]')
            .waitFor({ state: 'detached', timeout: 2_000 });
        const oldestDraft = foreground.locator('textarea').last();
        await oldestDraft.waitFor({ state: 'visible', timeout: 2_000 });
        await oldestDraft.evaluate((element) => { element.dataset.fullscreenSideChatComposer = 'oldest'; });
        await expect(page.evaluate(() => (window as any).__SIDE_CHAT_CREATE_COUNT__ ?? 0)).resolves.toBe(0);

        await foreground.getByRole('button', { name: 'Collapse side chats' }).last().click();
        await foreground.locator('textarea[data-fullscreen-side-chat-composer="oldest"]')
            .waitFor({ state: 'detached', timeout: 2_000 });
        expect(pageErrors).toEqual([]);
        await page.close();
    }, 10_000);
});
