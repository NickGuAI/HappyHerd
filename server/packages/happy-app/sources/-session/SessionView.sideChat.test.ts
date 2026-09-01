import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '@/sync/storageTypes';

const mocks = vi.hoisted(() => ({
    width: 1280,
    height: 900,
    platform: 'web',
    landscape: false,
    realtimeStatus: 'disconnected' as 'connected' | 'disconnected',
    canAbort: false,
    canBrowseFiles: true,
    canUseShell: true,
    isRig: false,
    revision: 0,
    sessions: {} as Record<string, Session>,
    localSettings: {
        acknowledgedCliVersions: {} as Record<string, string>,
        navigationSidebarCollapsed: false,
        sidebarPanelActive: null as 'changes' | 'allFiles' | 'sideChat' | null,
        sidebarPanelsOpen: [] as Array<'changes' | 'allFiles' | 'sideChat'>,
        sidebarSideChatSessionId: null as string | null,
        zenMode: false,
    },
    listeners: new Set<() => void>(),
    emptyArray: [] as unknown[],
    emptyObject: {} as Record<string, unknown>,
    closeSideChatSession: vi.fn(),
    buildWorkspaceContextMessage: vi.fn(),
    heartbeatDispatch: vi.fn(),
    modalConfirm: vi.fn(),
    modalShow: vi.fn(),
    machineCreateSideChat: vi.fn(),
    machineGetDirectoryTree: vi.fn(),
    routerBack: vi.fn(),
    routerDismissTo: vi.fn(),
    routerPush: vi.fn(),
    resumeSession: vi.fn(),
    resumeSessionWithQueuedTurn: vi.fn(),
    sessionArchive: vi.fn(),
    sessionAbort: vi.fn(),
    sessionKill: vi.fn(),
    sessionSetAgentModes: vi.fn(),
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
    const subscribeToWidth = (listener: () => void) => {
        mocks.listeners.add(listener);
        return () => mocks.listeners.delete(listener);
    };
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
        useWindowDimensions: () => ({
            width: ReactModule.useSyncExternalStore(
                subscribeToWidth,
                () => mocks.width,
                () => mocks.width,
            ),
            height: mocks.height,
        }),
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
    useRouter: () => ({
        back: mocks.routerBack,
        dismissTo: mocks.routerDismissTo,
        push: mocks.routerPush,
    }),
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
    const { WorkspaceLinkPressContext } = await import('@/-session/workspaceLinkNavigation');
    return {
        EmptyMessages: (props: any) => ReactModule.createElement('EmptyMessages', {
            ...props,
            onWorkspaceLinkPress: ReactModule.useContext(WorkspaceLinkPressContext),
        }),
    };
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
        VOICE_PILL_TOTAL_HEIGHT: 40,
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
vi.mock('@/app/(app)/workspace/index', async () => {
    const ReactModule = await import('react');
    return { MachineWorkspaceBrowser: (props: any) => ReactModule.createElement('MachineWorkspaceBrowser', props) };
});
vi.mock('@/components/DesktopFileWorkspace', async () => {
    const ReactModule = await import('react');
    const displayPath = (identity: string | null) => {
        if (!identity) return identity;
        try {
            const parsed = JSON.parse(identity);
            return Array.isArray(parsed) && typeof parsed[1] === 'string' ? parsed[1] : identity;
        } catch {
            return identity;
        }
    };
    return {
        DesktopFileWorkspace: (props: any) => {
            const identityFor = (path: string) => props.paths.find((candidate: string) => displayPath(candidate) === path) ?? path;
            return ReactModule.createElement(
                'DesktopFileWorkspace',
                {
                    ...props,
                    paths: props.paths.map(displayPath),
                    activePath: displayPath(props.activePath),
                    dirtyPaths: new Set([...props.dirtyPaths].map(displayPath)),
                    onSelect: (path: string) => props.onSelect(identityFor(path)),
                    onRequestClose: (path: string) => props.onRequestClose(identityFor(path)),
                    onFileDeleted: (path: string) => props.onFileDeleted(identityFor(path)),
                    onDirtyChange: (path: string, dirty: boolean) => props.onDirtyChange(identityFor(path), dirty),
                },
                props.picker,
                props.machinePicker,
            );
        },
        DesktopFileWorkspaceSplit: (props: any) => ReactModule.createElement(
            'DesktopFileWorkspaceSplit',
            props,
            props.children,
            ReactModule.createElement('DesktopFileWorkspaceSlot', {
                visible: props.workspaceVisible,
                fullscreen: props.workspaceFullscreen,
            }, props.workspace),
            props.workspaceVisible || props.workspaceFullscreen ? null : props.fallback,
        ),
    };
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
        resumeSessionWithQueuedTurn: mocks.resumeSessionWithQueuedTurn,
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
        confirm: mocks.modalConfirm,
        prompt: vi.fn(),
        show: mocks.modalShow,
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
    machineGetDirectoryTree: mocks.machineGetDirectoryTree,
    machineStopSession: vi.fn(),
    sessionAbort: mocks.sessionAbort,
    sessionArchive: mocks.sessionArchive,
    sessionCancelCommunication: vi.fn(),
    sessionGoalAction: vi.fn(),
    sessionKill: mocks.sessionKill,
    sessionSetAgentModes: mocks.sessionSetAgentModes,
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
        useRealtimeStatus: () => mocks.realtimeStatus,
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
        useProviderContinuationSessions: () => [],
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
    isRigMetadata: () => mocks.isRig,
    isRigModelSelectionEnabled: () => false,
    isRigPermissionSelectionEnabled: () => false,
    isRigReasoningSelectionEnabled: () => false,
    rigCanAbort: () => mocks.canAbort,
    rigCanBrowseFiles: () => mocks.canBrowseFiles,
    rigCanReadFiles: () => false,
    rigCanUseAttachments: () => false,
    rigCanUseShell: () => mocks.canUseShell,
}));
vi.mock('@/sync/workspaceContext', () => ({
    MAX_WORKSPACE_CONTEXT_ITEMS: 8,
    addWorkspaceContextFile: () => true,
    buildWorkspaceContextMessage: mocks.buildWorkspaceContextMessage,
    clearWorkspaceContextFiles: vi.fn(),
    getWorkspaceContextEntries: () => mocks.emptyArray,
    removeWorkspaceContextEntry: vi.fn(),
    subscribeWorkspaceContext: () => () => undefined,
}));
vi.mock('@/sync/queueProjection', () => ({ projectSessionQueue: () => ({ items: mocks.emptyArray }) }));

vi.mock('@/utils/platform', () => ({ isRunningOnMac: () => false }));
vi.mock('@/utils/responsive', async () => {
    const {
        calculateDeviceDimensions,
        determineDeviceType,
    } = await vi.importActual<typeof import('@/utils/deviceCalculations')>('@/utils/deviceCalculations');

    const productionDeviceType = () => determineDeviceType({
        diagonalInches: calculateDeviceDimensions({
            widthPoints: mocks.width,
            heightPoints: mocks.height,
            pointsPerInch: mocks.platform === 'ios' ? 163 : 160,
        }).diagonalInches,
        platform: mocks.platform,
        isPad: false,
    });

    return {
        useDeviceType: productionDeviceType,
        useHeaderHeight: () => 48,
        useIsLandscape: () => mocks.landscape,
        useIsTablet: () => productionDeviceType() === 'tablet',
    };
});
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
vi.mock('@/utils/heartbeatCommand', () => ({ HEARTBEAT_COMMAND: { dispatch: mocks.heartbeatDispatch } }));

vi.mock('@/-session/sessionOverlayNav', () => ({
    useOverlayNav: { getState: () => ({ publish: vi.fn(), reset: vi.fn() }) },
}));
vi.mock('@/-session/agentGoalActionHandler', () => ({ performAgentGoalAction: vi.fn() }));
vi.mock('@/-session/workspaceLinkNavigation', async () => {
    const ReactModule = await import('react');
    const WorkspaceLinkPressContext = ReactModule.createContext(undefined);
    return {
        WorkspaceLinkPressContext,
        useWorkspaceLinkPress: () => ReactModule.useContext(WorkspaceLinkPressContext),
        useWorkspaceLinkDismissGuard: () => {
            const sendingRef = ReactModule.useRef(false);
            const dirtyRef = ReactModule.useRef(false);
            const onSendingChange = ReactModule.useCallback((sending: boolean) => {
                sendingRef.current = sending;
            }, []);
            const onDirtyChange = ReactModule.useCallback((dirty: boolean) => {
                dirtyRef.current = dirty;
            }, []);
            const guardDismiss = ReactModule.useCallback((action: () => void) => action(), []);
            const reset = ReactModule.useCallback(() => {
                sendingRef.current = false;
                dirtyRef.current = false;
            }, []);
            return {
                onSendingChange,
                onDirtyChange,
                guardDismiss,
                reset,
                sendingRef,
                dirtyRef,
            };
        },
    };
});
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
        if (key === 'files.changes') return 'Changes';
        if (key === 'files.allFiles') return 'Chat Workspace';
        if (key === 'workspace.title') return 'Machine Workspace';
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
        oldest: makeSession('oldest', 10, {
            isSideChat: true,
            machineId: 'machine-oldest',
            parentSessionId: 'parent',
            path: '/srv/side-chats/oldest',
        }),
        stopped: makeSession('stopped', 20, {
            isSideChat: true,
            machineId: 'machine-stopped',
            parentSessionId: 'parent',
            path: '/srv/side-chats/stopped',
        }, false),
        newest: makeSession('newest', 30, {
            isSideChat: true,
            machineId: 'machine-newest',
            parentSessionId: 'parent',
            path: '/srv/side-chats/newest',
        }),
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
    mocks.height = 900;
    mocks.platform = 'web';
    mocks.landscape = false;
    mocks.realtimeStatus = 'disconnected';
    mocks.canAbort = false;
    mocks.canBrowseFiles = true;
    mocks.canUseShell = true;
    mocks.isRig = false;
    mocks.localSettings.acknowledgedCliVersions = {};
    mocks.localSettings.navigationSidebarCollapsed = false;
    mocks.localSettings.sidebarPanelActive = null;
    mocks.localSettings.sidebarPanelsOpen = [];
    mocks.localSettings.sidebarSideChatSessionId = null;
    mocks.localSettings.zenMode = false;
    mocks.closeSideChatSession.mockReset();
    mocks.buildWorkspaceContextMessage.mockReset();
    mocks.buildWorkspaceContextMessage.mockImplementation(async (_sessionId: string, text: string) => ({
        displayText: text,
        promptText: text,
    }));
    mocks.heartbeatDispatch.mockReset();
    mocks.heartbeatDispatch.mockResolvedValue({ handled: false });
    mocks.modalConfirm.mockReset();
    mocks.modalConfirm.mockResolvedValue(true);
    mocks.modalShow.mockReset();
    mocks.machineCreateSideChat.mockReset();
    mocks.machineGetDirectoryTree.mockReset();
    mocks.machineGetDirectoryTree.mockImplementation(async (_machineId: string, path: string) => ({
        success: true,
        tree: { type: 'file', name: path.split('/').pop() || path, path },
    }));
    mocks.routerBack.mockReset();
    mocks.routerDismissTo.mockReset();
    mocks.routerPush.mockReset();
    mocks.resumeSession.mockReset();
    mocks.resumeSessionWithQueuedTurn.mockReset();
    mocks.sessionArchive.mockReset();
    mocks.sessionAbort.mockReset();
    mocks.sessionKill.mockReset();
    mocks.sessionSetAgentModes.mockReset();
    mocks.sessionVisible.mockReset();
    mocks.sendMessage.mockReset();
    mocks.sendMessage.mockResolvedValue(undefined);
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

function chatHeader(renderer: ReactTestRenderer) {
    return renderer.root.findByType('ChatHeaderView' as any);
}

function landscapeBackButton(renderer: ReactTestRenderer) {
    return pressables(renderer).find((node: any) => (
        node.findAllByType('Ionicons' as any).some((icon: any) => (
            icon.props.name === 'arrow-back' || icon.props.name === 'chevron-back'
        ))
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

function composerForSession(renderer: ReactTestRenderer, sessionId: string) {
    const composer = renderer.root.findAllByType('AgentInput' as any).find((node: any) => (
        node.props.sessionId === sessionId
    ));
    expect(composer, `missing composer for ${sessionId}`).toBeDefined();
    return composer!;
}

function expectExactParentTabs(renderer: ReactTestRenderer) {
    const labels = textValues(renderer);
    expect(labels).toEqual(expect.arrayContaining(['oldest', 'stopped', 'newest']));
    expect(labels).not.toContain('archived');
    expect(labels).not.toContain('otherChild');
}

async function openAndCloseSideChatFileWorkspace(renderer: ReactTestRenderer) {
    const emptyMessages = renderer.root.findAllByType('EmptyMessages' as any).find((node: any) => (
        typeof node.props.onWorkspaceLinkPress === 'function'
    ));
    const sideChatFilePath = '/srv/side-chats/newest/note.md';

    await act(async () => {
        emptyMessages?.props.onWorkspaceLinkPress({
            pathname: '/workspace',
            params: {
                mode: 'link',
                originSessionId: 'newest',
                machineId: 'machine-newest',
                absolutePath: sideChatFilePath,
            },
        });
        await Promise.resolve();
    });

    const workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
    expect(workspace.props).toMatchObject({
        sessionId: 'newest',
        paths: [sideChatFilePath],
    });
    act(() => workspace.props.onRequestClose(sideChatFilePath));
    expect(renderer.root.findAllByType('DesktopFileWorkspace' as any)).toHaveLength(0);

    return desktopSideChatHosts(renderer)[0];
}

describe('SessionView mobile back navigation', () => {
    it('dismisses the portrait narrow-Web session directly to the session list', () => {
        mocks.width = 390;
        mocks.height = 844;
        const renderer = renderParent();

        act(() => chatHeader(renderer).props.onBackPress());

        expect(mocks.routerDismissTo).toHaveBeenCalledOnce();
        expect(mocks.routerDismissTo).toHaveBeenCalledWith('/');
        expect(mocks.routerBack).not.toHaveBeenCalled();
    });

    it('dismisses the landscape narrow-Web session directly to the session list', () => {
        mocks.width = 844;
        mocks.height = 390;
        mocks.landscape = true;
        const renderer = renderParent();
        const backButton = landscapeBackButton(renderer);

        expect(backButton).toBeDefined();
        act(() => backButton?.props.onPress());

        expect(mocks.routerDismissTo).toHaveBeenCalledOnce();
        expect(mocks.routerDismissTo).toHaveBeenCalledWith('/');
        expect(mocks.routerBack).not.toHaveBeenCalled();
    });

    it.each([
        { orientation: 'portrait', width: 390, height: 844, landscape: false },
        { orientation: 'landscape', width: 844, height: 390, landscape: true },
    ])('keeps native $orientation navigation on router.back()', ({ width, height, landscape }) => {
        mocks.width = width;
        mocks.height = height;
        mocks.platform = 'ios';
        mocks.landscape = landscape;
        const renderer = renderParent();

        if (landscape) {
            const backButton = landscapeBackButton(renderer);
            expect(backButton).toBeDefined();
            act(() => backButton?.props.onPress());
        } else {
            act(() => chatHeader(renderer).props.onBackPress());
        }

        expect(mocks.routerBack).toHaveBeenCalledOnce();
        expect(mocks.routerDismissTo).not.toHaveBeenCalled();
    });

    it.each([
        { label: 'production-phone at the desktop boundary', width: 1100, height: 800 },
        { label: 'wide short desktop', width: 1440, height: 600 },
    ])('keeps Web Desktop navigation on router.back() for $label', ({ width, height }) => {
        mocks.width = width;
        mocks.height = height;
        const renderer = renderParent();

        act(() => chatHeader(renderer).props.onBackPress());

        expect(mocks.routerBack).toHaveBeenCalledOnce();
        expect(mocks.routerDismissTo).not.toHaveBeenCalled();
    });
});

describe('SessionView Web composer workspace access', () => {
    it('removes the fixed top strip and routes the Main Agent composer actions to its canonical workspaces', () => {
        mocks.width = 390;
        mocks.height = 844;
        const renderer = renderParent();

        expect(renderer.root.findAll((node: any) => (
            node.type === 'View' && node.props.testID === 'mobile-session-workspace-access'
        ))).toHaveLength(0);
        const mainComposer = composerForSession(renderer, 'parent');
        expect(mainComposer.props.showWebActionMenu).toBe(true);
        const workspaceActions = mainComposer.props.webWorkspaceActions;
        expect(workspaceActions).toEqual(expect.objectContaining({
            onOpenChanges: expect.any(Function),
            onOpenChatWorkspace: expect.any(Function),
            onOpenMachineWorkspace: expect.any(Function),
        }));

        act(() => workspaceActions.onOpenChanges());
        expect(renderer.root.findAllByType('AllFilesDiffView' as any)).toHaveLength(1);
        act(() => chatHeader(renderer).props.onBackPress());
        expect(renderer.root.findAllByType('AllFilesDiffView' as any)).toHaveLength(0);
        expect(mocks.routerDismissTo).not.toHaveBeenCalled();

        act(() => workspaceActions.onOpenChatWorkspace());
        let split = renderer.root.findByType('DesktopFileWorkspaceSplit' as any);
        let workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(split.props.workspaceFullscreen).toBe(true);
        expect(workspace.props).toMatchObject({ compact: true, pickerOpen: true, machinePickerOpen: false });
        act(() => workspace.props.onClosePicker());

        act(() => workspaceActions.onOpenMachineWorkspace());
        split = renderer.root.findByType('DesktopFileWorkspaceSplit' as any);
        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(split.props.workspaceFullscreen).toBe(true);
        expect(workspace.props).toMatchObject({ compact: true, pickerOpen: false, machinePickerOpen: true });
        expect(renderer.root.findByType('MachineWorkspaceBrowser' as any).props).toMatchObject({
            initialMachineId: 'machine-1',
            initialPath: '/srv/project',
        });
        act(() => workspace.props.onClosePicker());

        expect(renderer.root.findAll((node: any) => (
            node.type === 'View' && node.props.testID === 'mobile-session-workspace-access'
        ))).toHaveLength(0);
        expect(renderedComposerSessions(renderer)).toEqual(['parent']);
    });

    it('routes Web Desktop Main Agent actions through the same consolidated composer menu', () => {
        mocks.width = 1280;
        const renderer = renderParent();

        expect(renderer.root.findAll((node: any) => (
            node.type === 'View' && node.props.testID === 'mobile-session-workspace-access'
        ))).toHaveLength(0);
        const composer = composerForSession(renderer, 'parent');
        expect(composer.props.showWebActionMenu).toBe(true);
        expect(composer.props.webWorkspaceActions).toEqual(expect.objectContaining({
            onOpenChanges: expect.any(Function),
            onOpenChatWorkspace: expect.any(Function),
            onOpenMachineWorkspace: expect.any(Function),
        }));
    });

    it('keeps the consolidated Web Mobile menu when the provider cannot browse files or use a shell', () => {
        mocks.width = 390;
        mocks.height = 844;
        mocks.canBrowseFiles = false;
        mocks.canUseShell = false;
        const renderer = renderParent();
        const composer = composerForSession(renderer, 'parent');

        expect(composer.props.showWebActionMenu).toBe(true);
        expect(composer.props.webWorkspaceActions).toBeUndefined();
    });

    it.each([
        ['Web Desktop', 1280],
        ['Web Mobile', 390],
    ] as const)('updates Machine Workspace from the newly active Side chat machine and cwd on %s', (_surface, width) => {
        mocks.width = width;
        mocks.height = 844;
        const renderer = renderParent();

        pressByLabel(renderer, 'Open side chats (3)');
        const newestComposer = composerForSession(renderer, 'newest');
        expect(newestComposer.props.showWebActionMenu).toBe(true);
        const newestActions = newestComposer.props.webWorkspaceActions;
        expect(newestActions).toBeDefined();
        act(() => newestActions.onOpenMachineWorkspace());
        expect(renderer.root.findByType('MachineWorkspaceBrowser' as any).props).toMatchObject({
            initialMachineId: 'machine-newest',
            initialPath: '/srv/side-chats/newest',
        });

        act(() => renderer.root.findByType('DesktopFileWorkspace' as any).props.onClosePicker());
        if (width >= 900) pressByLabel(renderer, 'Open side chats (3)');
        pressTab(renderer, 'oldest');
        const oldestComposer = composerForSession(renderer, 'oldest');
        expect(oldestComposer.props.showWebActionMenu).toBe(true);
        const oldestActions = oldestComposer.props.webWorkspaceActions;
        expect(oldestActions).toBeDefined();
        act(() => oldestActions.onOpenMachineWorkspace());
        expect(renderer.root.findByType('MachineWorkspaceBrowser' as any).props).toMatchObject({
            initialMachineId: 'machine-oldest',
            initialPath: '/srv/side-chats/oldest',
        });

        expect(renderer.root.findAll((node: any) => (
            node.type === 'View' && node.props.testID === 'mobile-session-workspace-access'
        ))).toHaveLength(0);
    });

    it('keeps the active Side chat workspace actions and links when its conversation expands into the global modal', async () => {
        mocks.width = 390;
        mocks.height = 844;
        const renderer = renderParent();

        pressByLabel(renderer, 'Open side chats (3)');
        pressByLabel(renderer, 'sideChat.expand');

        expect(mocks.modalShow).toHaveBeenCalledOnce();
        const modalRequest = mocks.modalShow.mock.calls[0]?.[0] as {
            component: React.ComponentType<any>;
            props: Record<string, unknown>;
        };
        expect(modalRequest.props).toEqual(expect.objectContaining({
            sessionId: 'newest',
            workspaceController: expect.objectContaining({
                openChanges: expect.any(Function),
                openChatWorkspace: expect.any(Function),
                openMachineWorkspace: expect.any(Function),
                openWorkspaceLink: expect.any(Function),
            }),
        }));

        const closeFirstModal = vi.fn();
        let modalRenderer!: ReactTestRenderer;
        const FirstModalHost = () => {
            const [open, setOpen] = React.useState(true);
            if (!open) return null;
            return React.createElement(modalRequest.component, {
                ...modalRequest.props,
                onClose: () => {
                    closeFirstModal();
                    setOpen(false);
                },
            });
        };
        act(() => {
            modalRenderer = create(React.createElement(FirstModalHost));
        });
        const modalWorkspaceActions = composerForSession(modalRenderer, 'newest').props.webWorkspaceActions;
        expect(modalWorkspaceActions).toEqual(expect.objectContaining({
            onOpenChanges: expect.any(Function),
            onOpenChatWorkspace: expect.any(Function),
            onOpenMachineWorkspace: expect.any(Function),
        }));

        act(() => modalWorkspaceActions.onOpenMachineWorkspace());
        expect(closeFirstModal).toHaveBeenCalledOnce();
        expect(renderedComposerSessions(modalRenderer)).toEqual([]);
        expect(renderer.root.findByType('MachineWorkspaceBrowser' as any).props).toMatchObject({
            initialMachineId: 'machine-newest',
            initialPath: '/srv/side-chats/newest',
        });

        const closeLinkModal = vi.fn();
        let linkModalRenderer!: ReactTestRenderer;
        const LinkModalHost = () => {
            const [open, setOpen] = React.useState(true);
            if (!open) return null;
            return React.createElement(modalRequest.component, {
                ...modalRequest.props,
                onClose: () => {
                    closeLinkModal();
                    setOpen(false);
                },
            });
        };
        act(() => {
            linkModalRenderer = create(React.createElement(LinkModalHost));
        });
        const modalEmptyMessages = linkModalRenderer.root.findByType('EmptyMessages' as any);
        await act(async () => {
            modalEmptyMessages.props.onWorkspaceLinkPress({
                pathname: '/workspace',
                params: {
                    mode: 'link',
                    originSessionId: 'newest',
                    machineId: 'machine-newest',
                    absolutePath: '/srv/side-chats/newest/note.md',
                },
            });
            await Promise.resolve();
        });
        expect(closeLinkModal).toHaveBeenCalledOnce();
        expect(renderedComposerSessions(linkModalRenderer)).toEqual([]);
        expect(mocks.routerPush).not.toHaveBeenCalled();
        expect(renderer.root.findByType('DesktopFileWorkspace' as any).props.paths)
            .toEqual(['/srv/side-chats/newest/note.md']);
    });

    it('provides the session workspace controller to the desktop Side chat panel', () => {
        mocks.width = 1280;
        mocks.height = 900;
        const renderer = renderParent();

        pressByLabel(renderer, 'Open side chats (3)');
        pressByLabel(renderer, 'sideChat.expand');

        expect(mocks.modalShow).toHaveBeenCalledOnce();
        expect(mocks.modalShow.mock.calls[0]?.[0]?.props?.workspaceController).toEqual(expect.objectContaining({
            openChanges: expect.any(Function),
            openChatWorkspace: expect.any(Function),
            openMachineWorkspace: expect.any(Function),
            openWorkspaceLink: expect.any(Function),
        }));
    });

    it('keeps the Changes workspace below the active voice status bar', () => {
        mocks.width = 390;
        mocks.height = 844;
        mocks.realtimeStatus = 'connected';
        const renderer = renderParent();

        expect(renderer.root.findAllByType('VoiceAssistantStatusBar' as any)).toHaveLength(1);
        act(() => composerForSession(renderer, 'parent').props.webWorkspaceActions.onOpenChanges());
        const overlay = renderer.root.findByProps({ testID: 'mobile-changes-workspace-overlay' });
        expect(overlay.props.style).toMatchObject({ top: 88 });
    });
});

describe('SessionView side-chat integration', () => {
    it.each([
        { label: 'Grok', flavor: 'grok', permissionMode: 'bypassPermissions', clearsPermission: false },
        { label: 'Antigravity', flavor: 'agy', permissionMode: 'bypassPermissions', clearsPermission: false },
        { label: 'retired Gemini', flavor: 'gemini', permissionMode: 'yolo', clearsPermission: false },
        { label: 'Happy/Rig', flavor: 'rig', permissionMode: 'native-mode', clearsPermission: false, isRig: true },
        { label: 'Claude', flavor: 'claude', permissionMode: 'bypassPermissions', clearsPermission: true },
        { label: 'legacy null-flavor Claude', flavor: null, permissionMode: 'bypassPermissions', clearsPermission: true },
        { label: 'Codex', flavor: 'codex', permissionMode: 'yolo', clearsPermission: true },
    ] as const)('$label abort keeps only provider-persistent permission state', ({ flavor, permissionMode, clearsPermission, isRig = false }) => {
        mocks.canAbort = true;
        mocks.isRig = isRig;
        mocks.sessions.parent.metadata!.flavor = flavor;
        mocks.sessions.parent.permissionMode = permissionMode;
        const renderer = renderParent();
        const composer = renderer.root.findAllByType('AgentInput' as any).find((node: any) => (
            node.props.sessionId === 'parent'
        ));

        expect(composer?.props.onAbort).toEqual(expect.any(Function));
        act(() => composer?.props.onAbort());

        expect(mocks.sessionAbort).toHaveBeenCalledWith('parent');
        if (clearsPermission) {
            expect(mocks.sessionSetAgentModes).toHaveBeenCalledWith('parent', { permissionMode: null });
        } else {
            expect(mocks.sessionSetAgentModes).not.toHaveBeenCalled();
        }
    });

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

    it('preserves a transcript that arrives while the draft snapshot is being delivered', async () => {
        mocks.voiceAvailable = true;
        mocks.sessions.parent.draft = 'Send this draft';
        let acceptDelivery!: () => void;
        mocks.sendMessage.mockImplementation(() => new Promise<void>((resolve) => {
            acceptDelivery = resolve;
        }));
        const renderer = renderParent();
        const composer = renderer.root.findAllByType('AgentInput' as any).find((node: any) => (
            node.props.sessionId === 'parent'
        ));

        let sendPromise!: Promise<void>;
        await act(async () => {
            sendPromise = composer?.props.onSend();
            await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledOnce());
        });

        act(() => mocks.voiceOnTranscript?.('late transcript'));
        expect(mocks.composerText.parent).toBe('Send this draft late transcript');

        await act(async () => {
            acceptDelivery();
            await sendPromise;
        });

        expect(mocks.sendMessage).toHaveBeenCalledWith(
            'parent',
            'Send this draft',
            expect.objectContaining({ source: 'chat' }),
        );
        expect(mocks.composerText.parent).toBe('late transcript');
        expect(mocks.startRealtimeSession).not.toHaveBeenCalled();
    });

    it('preserves a transcript that arrives while a heartbeat command is being handled', async () => {
        mocks.voiceAvailable = true;
        mocks.sessions.parent.draft = '/heartbeat status';
        let acceptHeartbeat!: () => void;
        mocks.heartbeatDispatch.mockImplementation(() => new Promise((resolve) => {
            acceptHeartbeat = () => resolve({
                handled: true,
                clearComposer: true,
                message: 'Heartbeat status',
            });
        }));
        const renderer = renderParent();
        const composer = renderer.root.findAllByType('AgentInput' as any).find((node: any) => (
            node.props.sessionId === 'parent'
        ));

        let sendPromise!: Promise<void>;
        await act(async () => {
            sendPromise = composer?.props.onSend();
            await vi.waitFor(() => expect(mocks.heartbeatDispatch).toHaveBeenCalledOnce());
        });

        act(() => mocks.voiceOnTranscript?.('late transcript'));
        expect(mocks.composerText.parent).toBe('/heartbeat status late transcript');

        await act(async () => {
            acceptHeartbeat();
            await sendPromise;
        });

        expect(mocks.heartbeatDispatch).toHaveBeenCalledWith(expect.objectContaining({
            text: '/heartbeat status',
        }));
        expect(mocks.composerText.parent).toBe('late transcript');
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

    it('does not expose the retired composer workspace shortcut', () => {
        const renderer = renderParent();
        const composer = renderer.root.findAllByType('AgentInput' as any).find((node: any) => node.props.sessionId === 'parent');

        expect(composer?.props.onFileViewerPress).toBeUndefined();
    });

    it('opens and focuses same-session file links in the canonical deduplicated workspace', async () => {
        mocks.width = 1000;
        mocks.localSettings.zenMode = true;
        const renderer = renderParent();
        const initialComposer = renderer.root.findAllByType('AgentInput' as any).find((node: any) => (
            node.props.sessionId === 'parent'
        ));
        const emptyMessages = renderer.root.findAllByType('EmptyMessages' as any).find((node: any) => (
            typeof node.props.onWorkspaceLinkPress === 'function'
        ));
        const route = {
            pathname: '/workspace',
            params: {
                mode: 'link',
                originSessionId: 'parent',
                machineId: 'machine-1',
                absolutePath: '/work/report.md',
                line: '7',
                column: '2',
            },
        };

        expect(emptyMessages).toBeDefined();
        await act(async () => {
            emptyMessages?.props.onWorkspaceLinkPress(route);
            await Promise.resolve();
        });

        let split = renderer.root.findByType('DesktopFileWorkspaceSplit' as any);
        let workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(split.props.workspaceVisible).toBe(true);
        expect(split.props.workspaceFullscreen).toBe(false);
        expect(workspace.props.paths).toEqual(['/work/report.md']);
        expect(workspace.props.activePath).toBe('/work/report.md');
        expect(workspace.props.references[JSON.stringify(['machine-1', '/work/report.md'])])
            .toMatchObject({ machineId: 'machine-1', line: 7, column: 2 });
        expect(renderer.root.findAll((node: any) => node.props.testID === 'workspace-link-side-panel')).toHaveLength(0);
        expect(renderedComposerSessions(renderer)).toEqual(['parent']);

        const secondRoute = {
            ...route,
            params: { ...route.params, absolutePath: '/work/other.md' },
        };
        await act(async () => {
            emptyMessages?.props.onWorkspaceLinkPress(secondRoute);
            await Promise.resolve();
        });
        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(workspace.props.paths).toEqual(['/work/report.md', '/work/other.md']);
        expect(workspace.props.activePath).toBe('/work/other.md');

        await act(async () => {
            emptyMessages?.props.onWorkspaceLinkPress(route);
            await Promise.resolve();
        });
        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(workspace.props.paths).toEqual(['/work/report.md', '/work/other.md']);
        expect(workspace.props.activePath).toBe('/work/report.md');
        expect(mocks.routerPush).not.toHaveBeenCalled();
        expect(renderer.root.findAllByType('AgentInput' as any).find((node: any) => (
            node.props.sessionId === 'parent'
        ))).toBe(initialComposer);

        mocks.width = 390;
        act(() => {
            for (const listener of mocks.listeners) listener();
        });

        split = renderer.root.findByType('DesktopFileWorkspaceSplit' as any);
        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(split.props.workspaceVisible).toBe(false);
        expect(split.props.workspaceFullscreen).toBe(true);
        expect(workspace.props.compact).toBe(true);
        expect(workspace.props.paths).toEqual(['/work/report.md', '/work/other.md']);
        expect(workspace.props.activePath).toBe('/work/report.md');
        expect(renderedComposerSessions(renderer)).toEqual(['parent']);
    });

    it('ignores stale same-session file probes when a newer link resolves first', async () => {
        let resolveFirst!: (value: any) => void;
        let resolveSecond!: (value: any) => void;
        mocks.machineGetDirectoryTree
            .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
            .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
        const renderer = renderParent();
        const emptyMessages = renderer.root.findAllByType('EmptyMessages' as any).find((node: any) => (
            typeof node.props.onWorkspaceLinkPress === 'function'
        ));
        const route = (absolutePath: string) => ({
            pathname: '/workspace',
            params: {
                mode: 'link',
                originSessionId: 'parent',
                machineId: 'machine-1',
                absolutePath,
            },
        });

        act(() => {
            emptyMessages?.props.onWorkspaceLinkPress(route('/work/first.md'));
            emptyMessages?.props.onWorkspaceLinkPress(route('/work/second.md'));
        });
        await act(async () => {
            resolveSecond({
                success: true,
                tree: { type: 'file', name: 'second.md', path: '/work/second.md' },
            });
            await Promise.resolve();
        });
        let workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(workspace.props.paths).toEqual(['/work/second.md']);
        expect(workspace.props.activePath).toBe('/work/second.md');

        await act(async () => {
            resolveFirst({
                success: true,
                tree: { type: 'file', name: 'first.md', path: '/work/first.md' },
            });
            await Promise.resolve();
        });
        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(workspace.props.paths).toEqual(['/work/second.md']);
        expect(workspace.props.activePath).toBe('/work/second.md');
        expect(mocks.routerPush).not.toHaveBeenCalled();
    });

    it('ignores a same-session file probe after the SessionView changes sessions', async () => {
        let resolveProbe!: (value: any) => void;
        mocks.machineGetDirectoryTree.mockImplementationOnce(() => new Promise((resolve) => {
            resolveProbe = resolve;
        }));
        const renderer = renderParent();
        const emptyMessages = renderer.root.findAllByType('EmptyMessages' as any).find((node: any) => (
            typeof node.props.onWorkspaceLinkPress === 'function'
        ));

        act(() => emptyMessages?.props.onWorkspaceLinkPress({
            pathname: '/workspace',
            params: {
                mode: 'link',
                originSessionId: 'parent',
                machineId: 'machine-1',
                absolutePath: '/work/old-session.md',
            },
        }));
        act(() => renderer.update(React.createElement(SessionView, { id: 'ordinary' })));
        await act(async () => {
            resolveProbe({
                success: true,
                tree: { type: 'file', name: 'old-session.md', path: '/work/old-session.md' },
            });
            await Promise.resolve();
        });

        expect(renderer.root.findAllByType('DesktopFileWorkspace' as any)).toHaveLength(0);
        expect(mocks.routerPush).not.toHaveBeenCalled();
    });

    it('lets explicit Main Agent and Side chat targets win while unrelated-session links retain the Viewer route', async () => {
        const renderer = renderParent();
        const emptyMessages = renderer.root.findAllByType('EmptyMessages' as any).find((node: any) => (
            typeof node.props.onWorkspaceLinkPress === 'function'
        ));
        const directoryRoute = {
            pathname: '/workspace',
            params: {
                mode: 'link',
                originSessionId: 'parent',
                machineId: 'machine-1',
                absolutePath: '/work/reports',
            },
        };
        mocks.machineGetDirectoryTree.mockResolvedValueOnce({
            success: true,
            tree: { type: 'directory', name: 'reports', path: '/work/reports', children: [] },
        });

        await act(async () => {
            emptyMessages?.props.onWorkspaceLinkPress(directoryRoute);
            await Promise.resolve();
        });
        expect(mocks.routerPush).not.toHaveBeenCalled();
        const directoryWorkspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(directoryWorkspace.props.paths).toEqual([]);
        expect(directoryWorkspace.props.machinePickerOpen).toBe(true);
        expect(renderer.root.findByType('MachineWorkspaceBrowser' as any).props).toMatchObject({
            initialMachineId: 'machine-1',
            initialPath: '/work/reports',
        });

        act(() => directoryWorkspace.props.onClosePicker());
        expect(renderer.root.findAllByType('DesktopFileWorkspace' as any)).toHaveLength(0);

        const sideChatRoute = {
            ...directoryRoute,
            params: {
                ...directoryRoute.params,
                originSessionId: 'newest',
                machineId: 'machine-newest',
                absolutePath: '/srv/side-chats/newest/note.md',
            },
        };
        await act(async () => {
            emptyMessages?.props.onWorkspaceLinkPress(sideChatRoute);
            await Promise.resolve();
        });
        expect(mocks.routerPush).not.toHaveBeenCalled();
        expect(renderer.root.findByType('DesktopFileWorkspace' as any).props.paths)
            .toEqual(['/srv/side-chats/newest/note.md']);

        const crossSessionRoute = {
            ...directoryRoute,
            params: { ...directoryRoute.params, originSessionId: 'ordinary', absolutePath: '/work/other.md' },
        };
        act(() => emptyMessages?.props.onWorkspaceLinkPress(crossSessionRoute));
        expect(mocks.routerPush).toHaveBeenLastCalledWith(crossSessionRoute);

        const locatedFileRoute = {
            ...directoryRoute,
            params: { ...directoryRoute.params, absolutePath: '/work/report.md', line: '12' },
        };
        await act(async () => {
            emptyMessages?.props.onWorkspaceLinkPress(locatedFileRoute);
            await Promise.resolve();
        });
        expect(mocks.routerPush).toHaveBeenCalledWith(crossSessionRoute);
        expect(mocks.machineGetDirectoryTree).toHaveBeenCalledTimes(3);
    });

    it('rebinds desktop Main Changes after closing a Side chat file workspace', async () => {
        const renderer = renderParent();
        const sidebar = await openAndCloseSideChatFileWorkspace(renderer);

        act(() => sidebar?.props.onOpenPanel('changes'));
        act(() => desktopSideChatHosts(renderer)[0]?.props.onFilePress({
            status: 'modified',
            fullPath: '/srv/project/main-change.ts',
        }));

        expect(renderer.root.findByType('AllFilesDiffView' as any).props.sessionId).toBe('parent');
    });

    it('rebinds desktop Main Chat Workspace after closing a Side chat file workspace', async () => {
        const renderer = renderParent();
        const sidebar = await openAndCloseSideChatFileWorkspace(renderer);
        const mainFilePath = '/srv/project/main.ts';

        act(() => sidebar?.props.onOpenPanel('allFiles'));
        act(() => desktopSideChatHosts(renderer)[0]?.props.onAllFilesFilePress(mainFilePath));

        const workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(workspace.props.sessionId).toBe('parent');
        expect(workspace.props.references[JSON.stringify(['machine-1', mainFilePath])])
            .toMatchObject({ machineId: 'machine-1', source: 'session' });
    });

    it('rebinds desktop Main Machine Workspace after closing a Side chat file workspace', async () => {
        const renderer = renderParent();
        const sidebar = await openAndCloseSideChatFileWorkspace(renderer);

        act(() => sidebar?.props.onOpenMachineWorkspace());

        expect(renderer.root.findByType('MachineWorkspaceBrowser' as any).props).toMatchObject({
            initialMachineId: 'machine-1',
            initialPath: '/srv/project',
        });
    });

    it('opens a first same-session file link directly in the compact mobile workspace', async () => {
        mocks.width = 390;
        const renderer = renderParent();
        const emptyMessages = renderer.root.findAllByType('EmptyMessages' as any).find((node: any) => (
            typeof node.props.onWorkspaceLinkPress === 'function'
        ));

        await act(async () => {
            emptyMessages?.props.onWorkspaceLinkPress({
                pathname: '/workspace',
                params: {
                    mode: 'link',
                    originSessionId: 'parent',
                    machineId: 'machine-1',
                    absolutePath: '/work/mobile.md',
                },
            });
            await Promise.resolve();
        });

        const split = renderer.root.findByType('DesktopFileWorkspaceSplit' as any);
        const workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(split.props.workspaceVisible).toBe(false);
        expect(split.props.workspaceFullscreen).toBe(true);
        expect(workspace.props.compact).toBe(true);
        expect(workspace.props.paths).toEqual(['/work/mobile.md']);
        expect(workspace.props.activePath).toBe('/work/mobile.md');
        expect(mocks.routerPush).not.toHaveBeenCalled();
        expect(renderer.root.findAll((node: any) => node.props.testID === 'workspace-link-side-panel')).toHaveLength(0);
        expect(renderedComposerSessions(renderer)).toEqual(['parent']);
    });

    it('shows and closes a zero-tab Machine Workspace picker full-screen on compact Web', async () => {
        mocks.width = 390;
        const renderer = renderParent();
        const emptyMessages = renderer.root.findAllByType('EmptyMessages' as any).find((node: any) => (
            typeof node.props.onWorkspaceLinkPress === 'function'
        ));
        mocks.machineGetDirectoryTree.mockResolvedValueOnce({
            success: true,
            tree: { type: 'directory', name: 'reports', path: '/work/reports', children: [] },
        });

        await act(async () => {
            emptyMessages?.props.onWorkspaceLinkPress({
                pathname: '/workspace',
                params: {
                    mode: 'link',
                    originSessionId: 'parent',
                    machineId: 'machine-1',
                    absolutePath: '/work/reports',
                },
            });
            await Promise.resolve();
        });

        const split = renderer.root.findByType('DesktopFileWorkspaceSplit' as any);
        const workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(split.props.workspaceVisible).toBe(false);
        expect(split.props.workspaceFullscreen).toBe(true);
        expect(workspace.props).toMatchObject({ paths: [], compact: true, machinePickerOpen: true });

        act(() => workspace.props.onClosePicker());
        expect(renderer.root.findAllByType('DesktopFileWorkspace' as any)).toHaveLength(0);
        expect(renderedComposerSessions(renderer)).toEqual(['parent']);
    });

    it('keeps the Main Agent composer mounted while desktop file tabs open, dedupe, focus, and close', async () => {
        const renderer = renderParent();
        const initialSidebar = desktopSideChatHosts(renderer)[0];

        expect(initialSidebar).toBeDefined();
        act(() => initialSidebar?.props.onAllFilesFilePress('/work/a.ts'));

        let workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(workspace.props.paths).toEqual(['/work/a.ts']);
        expect(workspace.props.activePath).toBe('/work/a.ts');
        expect(renderedComposerSessions(renderer)).toEqual(['parent']);

        act(() => workspace.props.onOpenPicker());
        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(workspace.props.pickerOpen).toBe(true);
        act(() => workspace.props.picker.props.onFilePress('/work/b.md'));

        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(workspace.props.paths).toEqual(['/work/a.ts', '/work/b.md']);
        expect(workspace.props.activePath).toBe('/work/b.md');

        act(() => workspace.props.onOpenPicker());
        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        act(() => workspace.props.picker.props.onFilePress('/work/a.ts'));

        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(workspace.props.paths).toEqual(['/work/a.ts', '/work/b.md']);
        expect(workspace.props.activePath).toBe('/work/a.ts');

        act(() => workspace.props.onDirtyChange('/work/a.ts', true));
        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(workspace.props.dirtyPaths.has('/work/a.ts')).toBe(true);

        mocks.modalConfirm.mockResolvedValueOnce(false);
        await act(async () => {
            workspace.props.onRequestClose('/work/a.ts');
            await Promise.resolve();
        });
        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(workspace.props.paths).toEqual(['/work/a.ts', '/work/b.md']);

        mocks.modalConfirm.mockResolvedValueOnce(true);
        await act(async () => {
            workspace.props.onRequestClose('/work/a.ts');
            await Promise.resolve();
        });
        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(workspace.props.paths).toEqual(['/work/b.md']);
        expect(workspace.props.activePath).toBe('/work/b.md');
        expect(renderedComposerSessions(renderer)).toEqual(['parent']);

        act(() => workspace.props.onRequestClose('/work/b.md'));
        expect(renderer.root.findAllByType('DesktopFileWorkspace' as any)).toHaveLength(0);
        expect(renderedComposerSessions(renderer)).toEqual(['parent']);
        expect(desktopSideChatHosts(renderer)).toHaveLength(1);
    });

    it('removes a deleted desktop file and selects its deterministic neighbor without a discard prompt', () => {
        const renderer = renderParent();
        const initialSidebar = desktopSideChatHosts(renderer)[0];

        act(() => initialSidebar?.props.onAllFilesFilePress('/work/a.ts'));
        let workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        act(() => workspace.props.onOpenPicker());
        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        act(() => workspace.props.picker.props.onFilePress('/work/b.md'));
        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        act(() => workspace.props.onDirtyChange('/work/b.md', true));

        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        act(() => workspace.props.onFileDeleted('/work/b.md'));

        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(workspace.props.paths).toEqual(['/work/a.ts']);
        expect(workspace.props.activePath).toBe('/work/a.ts');
        expect(workspace.props.dirtyPaths.has('/work/b.md')).toBe(false);
        expect(mocks.modalConfirm).not.toHaveBeenCalled();
        expect(renderedComposerSessions(renderer)).toEqual(['parent']);
    });

    it('keeps the desktop workspace header free of the removed Changes action', () => {
        const renderer = renderParent();
        const initialSidebar = desktopSideChatHosts(renderer)[0];

        act(() => initialSidebar?.props.onAllFilesFilePress('/work/a.ts'));
        const split = renderer.root.findByType('DesktopFileWorkspaceSplit' as any);
        const workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(split.props.workspaceVisible).toBe(true);
        expect(workspace.props.paths).toEqual(['/work/a.ts']);
        expect(workspace.props.onOpenChanges).toBeUndefined();
    });

    it('opens desktop Machine Workspace at the owning Main Agent machine and cwd before sharing its selection', () => {
        const renderer = renderParent();
        act(() => desktopSideChatHosts(renderer)[0]?.props.onOpenMachineWorkspace());

        const machineWorkspace = renderer.root.findByType('MachineWorkspaceBrowser' as any);
        expect(machineWorkspace.props).toMatchObject({
            initialMachineId: 'machine-1',
            initialPath: '/srv/project',
        });
        act(() => machineWorkspace.props.onFilePress({ machineId: 'machine-2', path: '/work/remote.md' }));

        const workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(workspace.props.paths).toEqual(['/work/remote.md']);
        expect(workspace.props.references[JSON.stringify(['machine-2', '/work/remote.md'])])
            .toMatchObject({ machineId: 'machine-2', source: 'machine' });
        expect(mocks.routerPush).not.toHaveBeenCalled();
    });

    it('returns from stacked Changes and All Files panels to the selected desktop tab', () => {
        const renderer = renderParent();
        const initialSidebar = desktopSideChatHosts(renderer)[0];

        act(() => initialSidebar?.props.onAllFilesFilePress('/work/a.ts'));
        act(() => {
            mocks.localSettings.sidebarPanelsOpen = ['changes', 'allFiles'];
            mocks.localSettings.sidebarPanelActive = 'allFiles';
            for (const listener of mocks.listeners) listener();
        });
        expect(renderer.root.findByType('DesktopFileWorkspaceSplit' as any).props.workspaceVisible).toBe(false);

        act(() => desktopSideChatHosts(renderer)[0]?.props.onAllFilesFilePress('/work/b.md'));
        const split = renderer.root.findByType('DesktopFileWorkspaceSplit' as any);
        const workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(split.props.workspaceVisible).toBe(true);
        expect(workspace.props.paths).toEqual(['/work/a.ts', '/work/b.md']);
        expect(workspace.props.activePath).toBe('/work/b.md');
        expect(mocks.localSettings.sidebarPanelsOpen).toEqual([]);
        expect(mocks.localSettings.sidebarPanelActive).toBeNull();
    });

    it('restores the canonical file workspace when Zen hides an active file sidebar panel', () => {
        const renderer = renderParent();
        const initialSidebar = desktopSideChatHosts(renderer)[0];

        act(() => initialSidebar?.props.onAllFilesFilePress('/work/a.ts'));
        act(() => {
            mocks.localSettings.sidebarPanelsOpen = ['allFiles'];
            mocks.localSettings.sidebarPanelActive = 'allFiles';
            for (const listener of mocks.listeners) listener();
        });
        expect(renderer.root.findByType('DesktopFileWorkspaceSplit' as any).props.workspaceVisible).toBe(false);

        act(() => {
            mocks.localSettings.zenMode = true;
            for (const listener of mocks.listeners) listener();
        });
        const split = renderer.root.findByType('DesktopFileWorkspaceSplit' as any);
        const workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(split.props.workspaceVisible).toBe(true);
        expect(workspace.props.paths).toEqual(['/work/a.ts']);
        expect(workspace.props.activePath).toBe('/work/a.ts');
        expect(renderedComposerSessions(renderer)).toEqual(['parent']);
    });

    it('presents the active desktop file full-width on narrow layouts and restores tabs without state loss', () => {
        const renderer = renderParent();
        const initialSidebar = desktopSideChatHosts(renderer)[0];

        act(() => initialSidebar?.props.onAllFilesFilePress('/work/a.ts'));
        let split = renderer.root.findByType('DesktopFileWorkspaceSplit' as any);
        let workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(split.props.workspaceVisible).toBe(true);
        expect(workspace.props.paths).toEqual(['/work/a.ts']);

        mocks.width = 390;
        act(() => {
            mocks.localSettings.sidebarPanelsOpen = ['allFiles'];
            mocks.localSettings.sidebarPanelActive = 'allFiles';
            for (const listener of mocks.listeners) listener();
        });
        split = renderer.root.findByType('DesktopFileWorkspaceSplit' as any);
        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(split.props.workspaceVisible).toBe(false);
        expect(split.props.workspaceFullscreen).toBe(true);
        expect(workspace.props.compact).toBe(true);
        expect(workspace.props.paths).toEqual(['/work/a.ts']);
        expect(renderedComposerSessions(renderer)).toEqual(['parent']);

        mocks.width = 1280;
        act(() => {
            mocks.localSettings.sidebarPanelsOpen = [];
            mocks.localSettings.sidebarPanelActive = null;
            for (const listener of mocks.listeners) listener();
        });
        split = renderer.root.findByType('DesktopFileWorkspaceSplit' as any);
        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(split.props.workspaceVisible).toBe(true);
        expect(split.props.workspaceFullscreen).toBe(false);
        expect(workspace.props.compact).toBe(false);
        expect(workspace.props.paths).toEqual(['/work/a.ts']);
        expect(workspace.props.activePath).toBe('/work/a.ts');
    });

    it('moves an open desktop Side chat to the narrow full-screen host before restoring the active file', () => {
        const renderer = renderParent();
        const initialSidebar = desktopSideChatHosts(renderer)[0];

        act(() => initialSidebar?.props.onAllFilesFilePress('/work/a.ts'));
        pressByLabel(renderer, 'Open side chats (3)');
        expect(desktopSideChatHosts(renderer)[0]?.props.activePanel).toBe('sideChat');

        mocks.width = 390;
        act(() => {
            for (const listener of mocks.listeners) listener();
        });

        let split = renderer.root.findByType('DesktopFileWorkspaceSplit' as any);
        let workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(fullscreenSideChatHosts(renderer)).toHaveLength(1);
        expect(split.props.workspaceVisible).toBe(false);
        expect(split.props.workspaceFullscreen).toBe(false);
        expect(workspace.props.paths).toEqual(['/work/a.ts']);

        act(() => fullscreenSideChatHosts(renderer)[0]?.props.onCollapse());
        split = renderer.root.findByType('DesktopFileWorkspaceSplit' as any);
        workspace = renderer.root.findByType('DesktopFileWorkspace' as any);
        expect(fullscreenSideChatHosts(renderer)).toHaveLength(0);
        expect(split.props.workspaceFullscreen).toBe(true);
        expect(workspace.props.compact).toBe(true);
        expect(workspace.props.paths).toEqual(['/work/a.ts']);
        expect(workspace.props.activePath).toBe('/work/a.ts');
    });

    it('opens the exact-parent side chats in the desktop right panel and renders the selected child', () => {
        const renderer = renderParent();

        const [initialSidebar] = desktopSideChatHosts(renderer);
        expect(initialSidebar).toBeDefined();
        expect(initialSidebar.props.openPanels).not.toContain('sideChat');
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

    it.each([
        { surface: 'desktop right panel', width: 1200 },
        { surface: 'mobile full screen', width: 700 },
    ])('keeps configured dictation available in the $surface Side chat composer', ({ width }) => {
        mocks.width = width;
        mocks.voiceAvailable = true;
        const renderer = renderParent();

        pressByLabel(renderer, 'Open side chats (3)');
        const childComposer = renderer.root.findAllByType('AgentInput' as any).find((node: any) => (
            node.props.sessionId === 'newest'
        ));

        expect(childComposer?.props.onMicPress).toBe(mocks.voiceToggle);
        act(() => childComposer?.props.onMicPress());
        expect(mocks.voiceToggle).toHaveBeenCalledOnce();
        expect(mocks.startRealtimeSession).not.toHaveBeenCalled();
    });

    it.each([
        { surface: 'Web Desktop', width: 1200 },
        { surface: 'Web Mobile', width: 700 },
    ])('keeps configured dictation available in disconnected Main Agent and Side chat composers on $surface', ({ width }) => {
        mocks.width = width;
        mocks.voiceAvailable = true;
        mocks.sessions.parent.active = false;
        const renderer = renderParent();

        const mainComposer = renderer.root.findAllByType('AgentInput' as any).find((node: any) => (
            node.props.sessionId === 'parent'
        ));
        expect(mainComposer?.props.onMicPress).toBe(mocks.voiceToggle);

        pressByLabel(renderer, 'Open side chats (3)');
        pressTab(renderer, 'stopped');
        const sideChatComposer = renderer.root.findAllByType('AgentInput' as any).find((node: any) => (
            node.props.sessionId === 'stopped'
        ));
        expect(sideChatComposer?.props.onMicPress).toBe(mocks.voiceToggle);

        act(() => mainComposer?.props.onMicPress());
        act(() => sideChatComposer?.props.onMicPress());
        expect(mocks.voiceToggle).toHaveBeenCalledTimes(2);
        expect(mocks.startRealtimeSession).not.toHaveBeenCalled();
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
