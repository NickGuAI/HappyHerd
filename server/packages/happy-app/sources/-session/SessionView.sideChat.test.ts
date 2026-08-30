import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '@/sync/storageTypes';

const mocks = vi.hoisted(() => ({
    width: 1280,
    platform: 'web',
    fileDiffsSidebarEnabled: true,
    revision: 0,
    sessions: {} as Record<string, Session>,
    localSettings: {
        acknowledgedCliVersions: {} as Record<string, string>,
        sidebarPanelActive: null as 'changes' | 'allFiles' | 'sideChat' | null,
        sidebarPanelsOpen: [] as Array<'changes' | 'allFiles' | 'sideChat'>,
        zenMode: false,
    },
    listeners: new Set<() => void>(),
    emptyArray: [] as unknown[],
    emptyObject: {} as Record<string, unknown>,
    closeSideChatSession: vi.fn(),
    machineCreateSideChat: vi.fn(),
    resumeSession: vi.fn(),
    sessionArchive: vi.fn(),
    sessionKill: vi.fn(),
    sessionVisible: vi.fn(),
    sendMessage: vi.fn(),
    startRealtimeSession: vi.fn(),
    voiceAvailable: false,
    voiceCanRetry: false,
    voiceCancel: vi.fn(),
    voiceError: null as string | null,
    voiceOnTranscript: null as null | ((text: string) => void),
    voicePhase: 'idle' as 'idle' | 'recording' | 'transcribing' | 'error',
    voiceRetry: vi.fn(),
    voiceToggle: vi.fn(),
    composerText: {} as Record<string, string>,
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    const Platform = {
        get OS() {
            return mocks.platform;
        },
        select(values: Record<string, unknown>) {
            return values[mocks.platform] ?? values.default;
        },
    };
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Platform,
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        Text: host('Text'),
        TextInput: host('TextInput'),
        View: host('View'),
        useWindowDimensions: () => ({ width: mocks.width, height: 900 }),
    };
});

vi.mock('react-native-reanimated', async () => {
    const ReactModule = await import('react');
    const AnimatedView = (props: any) => ReactModule.createElement('AnimatedView', props, props.children);
    return {
        default: { View: AnimatedView },
        Easing: { cubic: () => undefined, out: (value: unknown) => value },
        useAnimatedStyle: (factory: () => unknown) => factory(),
        useSharedValue: (value: unknown) => ({ value }),
        withTiming: (value: unknown) => value,
    };
});

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock('react-native-unistyles', () => {
    const theme = {
        dark: false,
        colors: {
            agentEventText: '#555',
            divider: '#ddd',
            glass: { overlayTint: '#fff' },
            groupped: { background: '#fff' },
            input: { placeholder: '#999' },
            shadow: { color: '#000', opacity: 0.1 },
            surface: '#f5f5f5',
            surfaceHigh: '#eee',
            surfacePressed: '#ddd',
            surfaceSelected: '#e5e5e5',
            text: '#111',
            textLink: '#06c',
            textSecondary: '#666',
            button: { primary: { background: '#111', tint: '#fff' } },
        },
    };
    return {
        StyleSheet: {
            absoluteFillObject: {},
            hairlineWidth: 1,
            create: (factory: any) => typeof factory === 'function' ? factory(theme) : factory,
        },
        useUnistyles: () => ({ theme }),
    };
});

vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    const icon = (name: string) => (props: any) => ReactModule.createElement(name, props);
    const Octicons = icon('Octicons') as any;
    Octicons.glyphMap = {};
    return { Ionicons: icon('Ionicons'), Octicons };
});

vi.mock('expo-router', () => ({
    useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));

vi.mock('expo-linear-gradient', async () => {
    const ReactModule = await import('react');
    return { LinearGradient: (props: any) => ReactModule.createElement('LinearGradient', props, props.children) };
});

vi.mock('@/components/AgentContentView', async () => {
    const ReactModule = await import('react');
    return {
        AgentContentView: (props: any) => ReactModule.createElement(
            'AgentContentView',
            props,
            props.content,
            props.placeholder,
            props.input,
        ),
    };
});

vi.mock('@/components/AgentInput', async () => {
    const ReactModule = await import('react');
    const AgentInput = ReactModule.forwardRef((props: any, ref: any) => {
        if (!(props.sessionId in mocks.composerText)) {
            mocks.composerText[props.sessionId] = props.initialValue ?? '';
        }
        ReactModule.useImperativeHandle(ref, () => ({
            focus: vi.fn(),
            getText: () => mocks.composerText[props.sessionId] ?? '',
            setTextAndSelection: (text: string) => {
                mocks.composerText[props.sessionId] = text;
                props.onChangeText?.(text);
            },
        }));
        return ReactModule.createElement('AgentInput', props);
    });
    return { AgentInput };
});

vi.mock('@/components/ChatHeaderView', async () => {
    const ReactModule = await import('react');
    return {
        ChatHeaderView: (props: any) => ReactModule.createElement('ChatHeaderView', props, props.rightSlot),
    };
});

vi.mock('@/components/Deferred', () => ({ Deferred: ({ children }: any) => children }));

vi.mock('@/components/AnimatedOverlay', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        AnimatedClickAwayBackdrop: host('AnimatedClickAwayBackdrop'),
        AnimatedFade: ({ children, visible }: any) => visible ? children : null,
        AnimatedPopup: host('AnimatedPopup'),
        LocalBlurHalo: host('LocalBlurHalo'),
    };
});

vi.mock('@/components/MobileGlass', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        MobileGlassBackdrop: host('MobileGlassBackdrop'),
        MobileGlassSurface: host('MobileGlassSurface'),
    };
});

vi.mock('@/components/AgentGoalBar', async () => {
    const ReactModule = await import('react');
    return { AgentGoalBar: (props: any) => ReactModule.createElement('AgentGoalBar', props) };
});
vi.mock('@/components/AgentQuestionBanner', async () => {
    const ReactModule = await import('react');
    return { AgentQuestionBanner: (props: any) => ReactModule.createElement('AgentQuestionBanner', props) };
});
vi.mock('@/components/ChatList', async () => {
    const ReactModule = await import('react');
    return { ChatList: (props: any) => ReactModule.createElement('ChatList', props) };
});
vi.mock('@/components/QueuedMessagesPanel', async () => {
    const ReactModule = await import('react');
    return { QueuedMessagesPanel: (props: any) => ReactModule.createElement('QueuedMessagesPanel', props) };
});
vi.mock('@/components/MachineFileUploadStatus', async () => {
    const ReactModule = await import('react');
    return { MachineFileUploadStatus: (props: any) => ReactModule.createElement('MachineFileUploadStatus', props) };
});
vi.mock('@/components/EmptyMessages', async () => {
    const ReactModule = await import('react');
    return { EmptyMessages: (props: any) => ReactModule.createElement('EmptyMessages', props) };
});
vi.mock('@/components/SessionStatusBar', async () => {
    const ReactModule = await import('react');
    return { SessionStatusBar: (props: any) => ReactModule.createElement('SessionStatusBar', props) };
});
vi.mock('@/components/Avatar', async () => {
    const ReactModule = await import('react');
    return { Avatar: (props: any) => ReactModule.createElement('Avatar', props) };
});
vi.mock('@/components/VoiceAssistantStatusBar', async () => {
    const ReactModule = await import('react');
    return {
        VOICE_PILL_TOTAL_HEIGHT: 0,
        VoiceAssistantStatusBar: (props: any) => ReactModule.createElement('VoiceAssistantStatusBar', props),
    };
});
vi.mock('@/components/AllFilesDiffView', async () => {
    const ReactModule = await import('react');
    return { AllFilesDiffView: (props: any) => ReactModule.createElement('AllFilesDiffView', props) };
});
vi.mock('@/components/FileViewPanel', async () => {
    const ReactModule = await import('react');
    return { FileViewPanel: (props: any) => ReactModule.createElement('FileViewPanel', props) };
});
vi.mock('@/components/WorkspaceLinkSidePanel', async () => {
    const ReactModule = await import('react');
    return { WorkspaceLinkSidePanel: (props: any) => ReactModule.createElement('WorkspaceLinkSidePanel', props) };
});
vi.mock('@/components/RigActivityBar', async () => {
    const ReactModule = await import('react');
    return { RigActivityBar: (props: any) => ReactModule.createElement('RigActivityBar', props) };
});
vi.mock('@/components/FileIcon', async () => {
    const ReactModule = await import('react');
    return { FileIcon: (props: any) => ReactModule.createElement('FileIcon', props) };
});

vi.mock('@/components/agentGoalStatus', () => ({ resolveVisibleAgentGoalStatus: () => null }));
vi.mock('@/components/layout', () => ({ layout: { maxWidth: 840 } }));
vi.mock('@/components/modelModeOptions', () => ({
    getAdvertisedDefaultOptionKey: () => undefined,
    getRigCurrentModelOptionKey: () => undefined,
    getSessionAvailableModels: () => mocks.emptyArray,
    getSessionAvailablePermissionModes: () => mocks.emptyArray,
    getSessionEffortLevelsForModel: () => mocks.emptyArray,
    resolveCurrentOption: () => null,
}));
vi.mock('@/components/autocomplete/suggestions', () => ({ getSuggestions: () => mocks.emptyArray }));
vi.mock('@/components/diff/PierreDiffView', () => ({ prefetchPierreDiff: vi.fn() }));

vi.mock('@/constants/Typography', () => ({
    Typography: {
        default: () => ({}),
        mono: () => ({}),
    },
}));

vi.mock('@/hooks/useDraft', () => ({ useDraft: () => ({ clearDraft: vi.fn() }) }));
vi.mock('@/hooks/useImagePicker', () => ({
    useImagePicker: () => ({
        addImages: vi.fn(),
        clearImages: vi.fn(),
        pickImages: vi.fn(),
        removeImage: vi.fn(),
        selectedImages: mocks.emptyArray,
    }),
}));
vi.mock('@/hooks/useMachineFileUpload', () => ({
    useMachineFileUpload: () => ({
        canCancel: false,
        canRetry: false,
        cancel: vi.fn(),
        pickAndUpload: vi.fn(),
        retry: vi.fn(),
        state: { phase: 'idle' },
    }),
}));
vi.mock('@/hooks/useHappyAction', () => ({ useHappyAction: () => [false, vi.fn()] }));
vi.mock('@/hooks/useSessionQuickActions', () => ({
    useSessionQuickActions: (session: Session) => ({
        canResume: !session.active,
        resumeSession: () => mocks.resumeSession(session.id),
        resumingSession: false,
    }),
}));
vi.mock('@/hooks/useVoiceInputAvailability', () => ({
    useVoiceInputAvailability: () => ({
        available: mocks.voiceAvailable,
        configured: mocks.voiceAvailable,
        enabled: mocks.voiceAvailable,
        loading: false,
    }),
}));
vi.mock('@/hooks/useVoiceDictation', () => ({
    useVoiceDictation: (onTranscript: (text: string) => void) => {
        mocks.voiceOnTranscript = onTranscript;
        return {
            canRetry: mocks.voiceCanRetry,
            cancel: mocks.voiceCancel,
            error: mocks.voiceError,
            phase: mocks.voicePhase,
            retry: mocks.voiceRetry,
            toggle: mocks.voiceToggle,
        };
    },
}));

vi.mock('@/modal', () => ({
    Modal: {
        alert: vi.fn(),
        confirm: vi.fn(async () => true),
        prompt: vi.fn(),
        show: vi.fn(),
    },
}));

vi.mock('@/realtime/hooks/voiceHooks', () => ({ voiceHooks: { onVoiceStarted: vi.fn(), onVoiceStopped: vi.fn() } }));
vi.mock('@/realtime/RealtimeSession', () => ({
    getCurrentVoiceConversationId: () => null,
    getCurrentVoiceSessionDurationSeconds: () => undefined,
    startRealtimeSession: mocks.startRealtimeSession,
    stopRealtimeSession: vi.fn(),
}));

vi.mock('@/sync/gitStatusSync', () => ({
    gitStatusSync: { getSync: () => ({ invalidate: vi.fn() }) },
}));
vi.mock('@/sync/gitStatusFiles', () => ({ getGitStatusFiles: vi.fn(async () => null) }));
vi.mock('@/sync/projectFiles', () => ({ getProjectFiles: vi.fn(async () => ({ files: [] })) }));

vi.mock('@/sync/ops', () => ({
    machineControlHeartbeat: vi.fn(),
    machineCreateSideChat: mocks.machineCreateSideChat,
    machineStopSession: vi.fn(),
    sessionAbort: vi.fn(),
    sessionArchive: mocks.sessionArchive,
    sessionCancelCommunication: vi.fn(),
    sessionGoalAction: vi.fn(),
    sessionKill: mocks.sessionKill,
    sessionSetAgentModes: vi.fn(),
}));

vi.mock('@/sync/sideChatLifecycle', () => ({
    closeSideChatSession: mocks.closeSideChatSession,
    resolveSideChatCloseReconciliation: () => ({ error: null, restoreTab: false }),
}));

vi.mock('@/sync/storage', async () => {
    const ReactModule = await import('react');
    const { selectSideChatSessions } = await import('@/sync/sideChatSessions');
    const subscribe = (listener: () => void) => {
        mocks.listeners.add(listener);
        return () => mocks.listeners.delete(listener);
    };
    const getState = () => ({
        applyGitStatusFiles: vi.fn(),
        applyLocalSettings: (update: Partial<typeof mocks.localSettings>) => {
            Object.assign(mocks.localSettings, update);
            for (const listener of mocks.listeners) listener();
        },
        applyProjectFiles: vi.fn(),
        currentViewingSessionId: null,
        getSessionPathKey: () => null,
        localSettings: mocks.localSettings,
        pathProjectFiles: {},
        purchases: { entitlements: {} },
        sessions: mocks.sessions,
        setCurrentViewingSession: vi.fn(),
    });
    const storage = Object.assign(() => undefined, { getState });
    return {
        storage,
        useIsDataReady: () => true,
        useLocalSetting: (key: keyof typeof mocks.localSettings) => ReactModule.useSyncExternalStore(
            subscribe,
            () => mocks.localSettings[key],
            () => mocks.localSettings[key],
        ),
        useMachine: (id: string) => id === 'machine-1' ? { id, active: true } : null,
        useRealtimeStatus: () => 'disconnected',
        useSession: (id: string) => ReactModule.useSyncExternalStore(
            subscribe,
            () => mocks.sessions[id] ?? null,
            () => mocks.sessions[id] ?? null,
        ),
        useSessionGitStatus: () => null,
        useSessionGitStatusFiles: () => null,
        useSessionMessages: () => ({
            hasMoreOlder: false,
            isLoaded: true,
            isLoadingOlder: false,
            messages: mocks.emptyArray,
        }),
        useSessionPendingCommunications: () => mocks.emptyArray,
        useSessionProjectFiles: () => null,
        useSessionUsage: () => null,
        useSetting: (key: string) => key === 'sessionStatusBarDisplay'
            ? 'hidden'
            : key === 'fileDiffsSidebar'
                ? mocks.fileDiffsSidebarEnabled
                : undefined,
        useSettingMutable: () => [mocks.emptyObject, vi.fn()],
        useSideChatSessions: (parentSessionId: string | null) => {
            const revision = ReactModule.useSyncExternalStore(
                subscribe,
                () => mocks.revision,
                () => mocks.revision,
            );
            return ReactModule.useMemo(
                () => selectSideChatSessions(mocks.sessions, parentSessionId),
                [parentSessionId, revision],
            );
        },
    };
});

vi.mock('@/sync/sync', () => ({
    sync: {
        onSessionVisible: mocks.sessionVisible,
        refreshSessions: vi.fn(),
        sendMessage: mocks.sendMessage,
    },
}));
vi.mock('@/sync/attachmentSupport', () => ({ supportsImageAttachmentsForFlavor: () => false }));
vi.mock('@/sync/persistence', () => ({
    getVoiceMessageCount: () => 0,
    getVoiceOnboardingPromptLoadCount: () => 0,
}));
vi.mock('@/sync/agentDefaults', () => ({
    getAgentDefaultOverrideValue: () => undefined,
    resolveAgentDefaultConfig: () => ({ modelMode: undefined, permissionMode: undefined }),
    resolveAgentDefaultEffortLevel: () => undefined,
    setAgentDefaultOverride: (value: unknown) => value,
}));
vi.mock('@/sync/rig', () => ({
    getRigGitSummary: () => null,
    getRigReasoningSelection: () => undefined,
    isRigMetadata: () => false,
    isRigModelSelectionEnabled: () => false,
    isRigPermissionSelectionEnabled: () => false,
    isRigReasoningSelectionEnabled: () => false,
    rigCanAbort: () => false,
    rigCanBrowseFiles: () => true,
    rigCanReadFiles: () => false,
    rigCanUseAttachments: () => false,
    rigCanUseShell: () => true,
}));
vi.mock('@/sync/workspaceContext', () => ({
    MAX_WORKSPACE_CONTEXT_ITEMS: 8,
    addWorkspaceContextFile: () => true,
    buildWorkspaceContextMessage: vi.fn(),
    clearWorkspaceContextFiles: vi.fn(),
    getWorkspaceContextEntries: () => mocks.emptyArray,
    removeWorkspaceContextEntry: vi.fn(),
    subscribeWorkspaceContext: () => () => undefined,
}));
vi.mock('@/sync/queueProjection', () => ({ projectSessionQueue: () => ({ items: mocks.emptyArray }) }));

vi.mock('@/utils/platform', () => ({ isRunningOnMac: () => false }));
vi.mock('@/utils/responsive', () => ({
    useDeviceType: () => mocks.width < 720 ? 'phone' : 'desktop',
    useHeaderHeight: () => 48,
    useIsLandscape: () => false,
    useIsTablet: () => false,
}));
vi.mock('@/utils/sessionFork', () => ({ getSessionForkSource: () => ({ sessionId: 'parent' }) }));
vi.mock('@/utils/sessionStatusBar', () => ({ resolveStatusBarGitBranch: () => null }));
vi.mock('@/utils/rigGitLineChanges', () => ({ visibleRigGitLineChanges: () => null }));
vi.mock('@/utils/sessionUtils', () => ({
    formatPathRelativeToHome: (path: string) => path,
    getResumeCommandBlock: (session: Session) => session.active
        ? null
        : { copyText: `resume ${session.id}`, lines: [`resume ${session.id}`] },
    getSessionAvatarId: (session: Session) => session.id,
    getSessionName: (session: Session) => session.metadata?.summary?.text ?? session.id,
    useSessionStatus: (session: Session) => ({
        isConnected: session.active,
        isPulsing: false,
        state: session.active ? 'waiting' : 'disconnected',
        statusColor: '#111',
        statusDotColor: '#111',
        statusText: session.active ? 'online' : 'offline',
    }),
}));
vi.mock('@/utils/versionUtils', () => ({ MINIMUM_CLI_VERSION: '0.0.0', isVersionSupported: () => true }));
vi.mock('@/utils/machineWorkspace', () => ({ buildWorkspaceAttachmentParams: () => null }));
vi.mock('@/utils/errors', () => ({ HappyError: class HappyError extends Error {} }));
vi.mock('@/utils/heartbeatCommand', () => ({ HEARTBEAT_COMMAND: { dispatch: vi.fn() } }));

vi.mock('@/-session/sessionOverlayNav', () => ({
    useOverlayNav: { getState: () => ({ publish: vi.fn(), reset: vi.fn() }) },
}));
vi.mock('@/-session/agentGoalActionHandler', () => ({ performAgentGoalAction: vi.fn() }));
vi.mock('@/-session/workspaceLinkNavigation', async () => {
    const ReactModule = await import('react');
    return {
        WorkspaceLinkPressContext: ReactModule.createContext(undefined),
        openWorkspaceLinkFromSession: vi.fn(),
        useWorkspaceLinkDismissGuard: () => ({
            onSendingChange: vi.fn(),
            reset: vi.fn(),
            sendingRef: { current: false },
        }),
    };
});
vi.mock('@/components/WorkspaceLinkViewerModel', () => ({
    resolveActiveWorkspaceLinkPresentation: () => 'route',
    resolveWorkspaceLinkPresentation: () => 'route',
}));

vi.mock('@/keyboard/shortcuts', () => ({
    SIDEBAR_PICKER_SHORTCUTS: {
        allFiles: { key: 'f' },
        changes: { key: 'c' },
    },
    formatShortcutChord: () => '',
    getPreferredShortcutModifier: () => 'meta',
    matchesShortcutChord: () => false,
}));

vi.mock('@/text', () => ({
    t: (key: string, params?: { count?: number; index?: number }) => {
        if (key === 'sideChat.collapse') return 'Collapse side chats';
        if (key === 'sideChat.openCount') return `Open side chats (${params?.count})`;
        if (key === 'sideChat.panelTitle') return 'Side chats';
        if (key === 'sideChat.tabLabel') return `Side chat ${params?.index}`;
        if (key === 'sessionInfo.resumeSession') return 'Resume session';
        return key;
    },
}));
vi.mock('@/track', () => ({ tracking: null }));
vi.mock('@/components/navigation/headerMetrics', () => ({ MOBILE_GLASS_HEADER_HEIGHT: 48 }));

import { SessionView } from './SessionView';
import { filterSessionsForTopLevelLists } from '@/sync/sessionListVisibility';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());

function makeSession(
    id: string,
    createdAt: number,
    metadata: Partial<NonNullable<Session['metadata']>> = {},
    active = true,
): Session {
    return {
        active,
        createdAt,
        id,
        presence: active ? 'online' : 'offline',
        updatedAt: createdAt,
        metadata: {
            host: 'machine-one',
            path: '/srv/project',
            summary: { text: id },
            ...metadata,
        },
    } as Session;
}

function seedSessions() {
    mocks.sessions = {
        parent: makeSession('parent', 1, {
            machineId: 'machine-1',
            flavor: 'codex',
            codexThreadId: 'thread-parent',
        }),
        ordinary: makeSession('ordinary', 2),
        oldest: makeSession('oldest', 10, { isSideChat: true, parentSessionId: 'parent' }),
        stopped: makeSession('stopped', 20, { isSideChat: true, parentSessionId: 'parent' }, false),
        newest: makeSession('newest', 30, { isSideChat: true, parentSessionId: 'parent' }),
        archived: makeSession('archived', 40, {
            isSideChat: true,
            lifecycleState: 'archived',
            parentSessionId: 'parent',
        }),
        otherParent: makeSession('otherParent', 3),
        otherChild: makeSession('otherChild', 50, { isSideChat: true, parentSessionId: 'otherParent' }),
    };
    mocks.revision += 1;
}

beforeEach(() => {
    mocks.listeners.clear();
    mocks.width = 1280;
    mocks.platform = 'web';
    mocks.fileDiffsSidebarEnabled = true;
    mocks.localSettings.acknowledgedCliVersions = {};
    mocks.localSettings.sidebarPanelActive = null;
    mocks.localSettings.sidebarPanelsOpen = [];
    mocks.localSettings.zenMode = false;
    mocks.closeSideChatSession.mockReset();
    mocks.machineCreateSideChat.mockReset();
    mocks.resumeSession.mockReset();
    mocks.sessionArchive.mockReset();
    mocks.sessionKill.mockReset();
    mocks.sessionVisible.mockReset();
    mocks.sendMessage.mockReset();
    mocks.startRealtimeSession.mockReset();
    mocks.voiceAvailable = false;
    mocks.voiceCanRetry = false;
    mocks.voiceCancel.mockReset();
    mocks.voiceError = null;
    mocks.voiceOnTranscript = null;
    mocks.voicePhase = 'idle';
    mocks.voiceRetry.mockReset();
    mocks.voiceToggle.mockReset();
    mocks.composerText = {};
    seedSessions();
});

function renderParent(): ReactTestRenderer {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(React.createElement(SessionView, { id: 'parent' }));
    });
    return renderer;
}

function pressables(renderer: ReactTestRenderer) {
    return renderer.root.findAllByType('Pressable' as any);
}

function desktopSideChatHosts(renderer: ReactTestRenderer) {
    return renderer.root.findAll((node: any) => (
        node.props.sessionId === 'parent'
        && Array.isArray(node.props.openPanels)
        && Array.isArray(node.props.sideChats)
        && typeof node.props.onOpenPanel === 'function'
    ));
}

function fullscreenSideChatHosts(renderer: ReactTestRenderer) {
    return renderer.root.findAll((node: any) => (
        Array.isArray(node.props.sideChats)
        && typeof node.props.onCollapse === 'function'
    ));
}

function textValues(renderer: ReactTestRenderer): unknown[] {
    return renderer.root.findAllByType('Text' as any).map((node: any) => node.props.children);
}

function pressByLabel(renderer: ReactTestRenderer, label: string) {
    const target = pressables(renderer).find((node: any) => node.props.accessibilityLabel === label);
    expect(target, `missing Pressable labelled ${label}`).toBeDefined();
    act(() => target?.props.onPress());
}

function pressTab(renderer: ReactTestRenderer, label: string) {
    const target = pressables(renderer).find((node: any) => (
        !node.props.accessibilityLabel
        && node.findAllByType('Text' as any).some((textNode: any) => textNode.props.children === label)
    ));
    expect(target, `missing tab ${label}`).toBeDefined();
    act(() => target?.props.onPress());
}

function pressByText(renderer: ReactTestRenderer, label: string) {
    const target = pressables(renderer).find((node: any) => (
        node.findAllByType('Text' as any).some((textNode: any) => textNode.props.children === label)
    ));
    expect(target, `missing Pressable containing ${label}`).toBeDefined();
    act(() => target?.props.onPress());
}

function renderedComposerSessions(renderer: ReactTestRenderer): string[] {
    return renderer.root.findAllByType('AgentInput' as any).map((node: any) => node.props.sessionId);
}

function expectExactParentTabs(renderer: ReactTestRenderer) {
    const labels = textValues(renderer);
    expect(labels).toEqual(expect.arrayContaining(['oldest', 'stopped', 'newest']));
    expect(labels).not.toContain('archived');
    expect(labels).not.toContain('otherChild');
}

describe('SessionView side-chat integration', () => {
    it('appends OpenAI dictation to the active draft without sending or starting realtime voice', () => {
        mocks.voiceAvailable = true;
        mocks.sessions.parent.draft = 'Keep this draft';
        let renderer = renderParent();
        let composer = renderer.root.findAllByType('AgentInput' as any).find((node: any) => (
            node.props.sessionId === 'parent'
        ));

        expect(composer?.props.onMicPress).toBe(mocks.voiceToggle);
        expect(composer?.props.dictationPhase).toBe('idle');
        expect(composer?.props.dictationError).toBeNull();
        expect(composer?.props.onDictationCancel).toBe(mocks.voiceCancel);
        act(() => composer?.props.onMicPress());
        expect(mocks.voiceToggle).toHaveBeenCalledOnce();

        const remountComposer = () => {
            act(() => renderer.unmount());
            renderer = renderParent();
            return renderer.root.findAllByType('AgentInput' as any).find((node: any) => (
                node.props.sessionId === 'parent'
            ));
        };

        mocks.voicePhase = 'recording';
        composer = remountComposer();
        expect(composer?.props.dictationPhase).toBe('recording');
        act(() => composer?.props.onDictationCancel());
        expect(mocks.voiceCancel).toHaveBeenCalledOnce();

        mocks.voicePhase = 'transcribing';
        composer = remountComposer();
        expect(composer?.props.dictationPhase).toBe('transcribing');

        mocks.voicePhase = 'error';
        mocks.voiceCanRetry = true;
        mocks.voiceError = 'OpenAI transcription failed';
        composer = remountComposer();
        expect(composer?.props.dictationError).toBe('OpenAI transcription failed');
        act(() => composer?.props.onDictationRetry());
        expect(mocks.voiceRetry).toHaveBeenCalledOnce();

        act(() => mocks.voiceOnTranscript?.('dictated words'));
        expect(mocks.composerText.parent).toBe('Keep this draft dictated words');
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        expect(mocks.startRealtimeSession).not.toHaveBeenCalled();
    });

    it('keeps finish and cancel wired when availability changes during recording', () => {
        mocks.voiceAvailable = false;
        mocks.voicePhase = 'recording';
        mocks.sessions.parent.active = false;

        const renderer = renderParent();
        const composer = renderer.root.findAllByType('AgentInput' as any).find((node: any) => (
            node.props.sessionId === 'parent'
        ));

        expect(composer?.props.dictationPhase).toBe('recording');
        expect(composer?.props.onMicPress).toBe(mocks.voiceToggle);
        expect(composer?.props.onDictationCancel).toBe(mocks.voiceCancel);
        act(() => composer?.props.onMicPress());
        act(() => composer?.props.onDictationCancel());
        expect(mocks.voiceToggle).toHaveBeenCalledOnce();
        expect(mocks.voiceCancel).toHaveBeenCalledOnce();
    });

    it('opens the exact-parent side chats in the desktop right panel and renders the selected child', () => {
        mocks.fileDiffsSidebarEnabled = false;
        const renderer = renderParent();

        expect(desktopSideChatHosts(renderer)).toHaveLength(0);
        expect(fullscreenSideChatHosts(renderer)).toHaveLength(0);
        expect(renderedComposerSessions(renderer)).toEqual(['parent']);

        pressByLabel(renderer, 'Open side chats (3)');

        const [sidebar] = desktopSideChatHosts(renderer);
        expect(sidebar).toBeDefined();
        expect(sidebar.props.sessionId).toBe('parent');
        expect(sidebar.props.openPanels).toEqual(['sideChat']);
        expect(sidebar.props.activePanel).toBe('sideChat');
        expect(sidebar.props.sideChats.map((sideChat: Session) => sideChat.id))
            .toEqual(['oldest', 'stopped', 'newest']);
        expect(sidebar.props.activeSideChatId).toBe('newest');
        expect(fullscreenSideChatHosts(renderer)).toHaveLength(0);
        expectExactParentTabs(renderer);
        expect(textValues(renderer)).toContain('sideChat.newChat');
        expect(renderedComposerSessions(renderer)).toEqual(['parent', 'newest']);

        pressTab(renderer, 'stopped');
        expect(desktopSideChatHosts(renderer)[0]?.props.activeSideChatId).toBe('stopped');
        expect(renderedComposerSessions(renderer)).toEqual(['parent', 'stopped']);
        expect(mocks.sessionVisible).toHaveBeenCalledWith('stopped');
        pressByText(renderer, 'Resume session');
        expect(mocks.resumeSession).toHaveBeenCalledWith('stopped');

        expect(filterSessionsForTopLevelLists(Object.values(mocks.sessions)).map((session) => session.id))
            .toEqual(['parent', 'ordinary', 'otherParent']);

        pressByLabel(renderer, 'Collapse side chats');
        expect(textValues(renderer)).not.toContain('stopped');
        expect(mocks.closeSideChatSession).not.toHaveBeenCalled();
        expect(mocks.sessionArchive).not.toHaveBeenCalled();
        expect(mocks.sessionKill).not.toHaveBeenCalled();
    });

    it('opens the same children in the narrow full-screen host and switches tabs before collapse', () => {
        mocks.width = 700;
        const renderer = renderParent();

        expect(textValues(renderer)).not.toContain('sideChat.newChat');
        pressByLabel(renderer, 'Open side chats (3)');
        expectExactParentTabs(renderer);
        expect(textValues(renderer)).toContain('sideChat.newChat');
        expect(renderedComposerSessions(renderer)).toEqual(expect.arrayContaining(['parent', 'newest']));

        pressTab(renderer, 'oldest');
        expect(renderedComposerSessions(renderer)).toEqual(expect.arrayContaining(['parent', 'oldest']));

        const fullscreenCollapse = pressables(renderer).find((node: any) => (
            node.findAllByType('Octicons' as any).some((icon: any) => icon.props.name === 'chevron-down')
        ));
        expect(fullscreenCollapse).toBeDefined();
        act(() => fullscreenCollapse?.props.onPress());

        expect(renderedComposerSessions(renderer)).toEqual(['parent']);
        expect(mocks.closeSideChatSession).not.toHaveBeenCalled();
        expect(mocks.sessionArchive).not.toHaveBeenCalled();
        expect(mocks.sessionKill).not.toHaveBeenCalled();
    });

    it.each([
        { surface: 'wide right sidebar', width: 1280, trigger: 'text' as const },
        { surface: 'narrow full-screen host', width: 700, trigger: 'label' as const },
    ])('creates with one click and focuses the hydrated child in the $surface', async ({ width, trigger }) => {
        mocks.width = width;
        mocks.sessions = {
            parent: makeSession('parent', 1, {
                machineId: 'machine-1',
                flavor: 'codex',
                codexThreadId: 'thread-parent',
            }),
        };
        mocks.revision += 1;
        mocks.machineCreateSideChat.mockImplementation(async () => {
            mocks.sessions = {
                ...mocks.sessions,
                created: makeSession('created', 50, {
                    isSideChat: true,
                    parentSessionId: 'parent',
                    machineId: 'machine-1',
                    flavor: 'codex',
                    codexThreadId: 'thread-created',
                }),
            };
            mocks.revision += 1;
            for (const listener of mocks.listeners) listener();
            return {
                schemaVersion: 1,
                type: 'side-chat',
                action: 'create',
                success: true,
                parentSessionId: 'parent',
                sessionId: 'created',
                phases: [],
            };
        });
        const renderer = renderParent();

        expect(renderer.root.findAllByType('TextInput' as any)).toHaveLength(0);
        expect(pressables(renderer)
            .some((node: any) => node.props.accessibilityLabel === 'sideChat.create')).toBe(false);

        const createAction = pressables(renderer).find((node: any) => trigger === 'label'
            ? node.props.accessibilityLabel === 'sideChat.newChat'
            : node.findAllByType('Text' as any)
                .some((textNode: any) => textNode.props.children === 'sideChat.newChat'));
        expect(createAction, 'missing one-click New side chat action').toBeDefined();
        await act(async () => {
            await createAction?.props.onPress();
        });

        expect(mocks.machineCreateSideChat).toHaveBeenCalledOnce();
        expect(mocks.machineCreateSideChat).toHaveBeenCalledWith('machine-1', 'parent');
        expect(renderer.root.findAllByType('TextInput' as any)).toHaveLength(0);
        expect(pressables(renderer)
            .some((node: any) => node.props.accessibilityLabel === 'sideChat.create')).toBe(false);
        expect(renderedComposerSessions(renderer)).toEqual(expect.arrayContaining(['parent', 'created']));
        expect(textValues(renderer)).toContain('created');
    });

    it.each([
        { surface: 'wide right sidebar', width: 1280, trigger: 'text' as const },
        { surface: 'narrow full-screen host', width: 700, trigger: 'label' as const },
    ])('preserves the created child focus until delayed hydration reaches the $surface', async ({ width, trigger }) => {
        mocks.width = width;
        mocks.sessions = {
            parent: makeSession('parent', 1, {
                machineId: 'machine-1',
                flavor: 'codex',
                codexThreadId: 'thread-parent',
            }),
        };
        mocks.revision += 1;
        mocks.machineCreateSideChat.mockResolvedValue({
            schemaVersion: 1,
            type: 'side-chat',
            action: 'create',
            success: true,
            parentSessionId: 'parent',
            sessionId: 'created',
            phases: [],
        });
        const renderer = renderParent();
        const createAction = pressables(renderer).find((node: any) => trigger === 'label'
            ? node.props.accessibilityLabel === 'sideChat.newChat'
            : node.findAllByType('Text' as any)
                .some((textNode: any) => textNode.props.children === 'sideChat.newChat'));
        expect(createAction, 'missing one-click New side chat action').toBeDefined();

        await act(async () => {
            await createAction?.props.onPress();
        });
        expect(mocks.machineCreateSideChat).toHaveBeenCalledOnce();
        expect(renderedComposerSessions(renderer)).toEqual(['parent']);

        act(() => {
            mocks.sessions = {
                ...mocks.sessions,
                created: makeSession('created', 50, {
                    isSideChat: true,
                    parentSessionId: 'parent',
                    machineId: 'machine-1',
                    flavor: 'codex',
                    codexThreadId: 'thread-created',
                }),
            };
            mocks.revision += 1;
            for (const listener of mocks.listeners) listener();
        });

        expect(renderedComposerSessions(renderer)).toEqual(expect.arrayContaining(['parent', 'created']));
        expect(textValues(renderer)).toContain('created');
    });
});
