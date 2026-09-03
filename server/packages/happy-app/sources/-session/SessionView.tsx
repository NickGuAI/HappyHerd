import { AgentContentView } from '@/components/AgentContentView';
import { MobileGlassBackdrop } from '@/components/MobileGlass';
import { AgentGoalBar, type AgentGoalAction } from '@/components/AgentGoalBar';
import { AgentQuestionBanner } from '@/components/AgentQuestionBanner';
import { AgentInput } from '@/components/AgentInput';
import { resolveVisibleAgentGoalStatus } from '@/components/agentGoalStatus';
import type { MultiTextInputHandle } from '@/components/MultiTextInput';
import { layout } from '@/components/layout';
import {
    getAdvertisedDefaultOptionKey,
    getRigCurrentModelOptionKey,
    getSessionAvailableModels,
    getSessionAvailablePermissionModes,
    getSessionEffortLevelsForModel,
    resolveCurrentOption,
    EffortLevel,
} from '@/components/modelModeOptions';
import { getSuggestions } from '@/components/autocomplete/suggestions';
import { ChatHeaderView } from '@/components/ChatHeaderView';
import { ChatList } from '@/components/ChatList';
import { QueuedMessagesPanel } from '@/components/QueuedMessagesPanel';
import { MachineFileUploadStatus } from '@/components/MachineFileUploadStatus';
import { ProviderContinuationLinks } from '@/components/ProviderContinuationLinks';
import { Deferred } from '@/components/Deferred';
import { EmptyMessages } from '@/components/EmptyMessages';
import { SessionStatusBar } from '@/components/SessionStatusBar';
import { Avatar } from '@/components/Avatar';
import { VoiceAssistantStatusBar, VOICE_PILL_TOTAL_HEIGHT } from '@/components/VoiceAssistantStatusBar';
import { useDraft } from '@/hooks/useDraft';
import { useImagePicker } from '@/hooks/useImagePicker';
import { useMachineFileUpload } from '@/hooks/useMachineFileUpload';
import { useVoiceDictation } from '@/hooks/useVoiceDictation';
import { Modal } from '@/modal';
import { gitStatusSync } from '@/sync/gitStatusSync';
import { machineControlHeartbeat, machineCreateSideChat, machineGetDirectoryTree, machineStopSession, sessionAbort, sessionCancelCommunication, sessionGoalAction, sessionSetAgentModes, sessionKill, sessionArchive } from '@/sync/ops';
import { closeSideChatSession, resolveSideChatCloseReconciliation } from '@/sync/sideChatLifecycle';
import { storage, useIsDataReady, useLocalSetting, useMachine, useRealtimeStatus, useSessionGitStatus, useSessionMessages, useSessionPendingCommunications, useSessionUsage, useSetting, useSettingMutable, useSideChatSessions } from '@/sync/storage';
import { useSession } from '@/sync/storage';
import { Session } from '@/sync/storageTypes';
import { sync } from '@/sync/sync';
import { supportsImageAttachmentsForFlavor } from '@/sync/attachmentSupport';
import { t } from '@/text';
import { isRunningOnMac } from '@/utils/platform';
import { useDeviceType, useHeaderHeight, useIsLandscape, useIsTablet } from '@/utils/responsive';
import { resolveStatusBarGitBranch } from '@/utils/sessionStatusBar';
import { visibleRigGitLineChanges } from '@/utils/rigGitLineChanges';
import { shouldApplyPhoneWebTypographyFloor } from '@/utils/mobileTypographyFloor';
import { FilesSidebar, SidebarMode } from '@/components/FilesSidebar';
import { DesktopFileWorkspace, DesktopFileWorkspaceSplit } from '@/components/DesktopFileWorkspace';
import {
    closeDesktopFile,
    desktopFileIdentity,
    desktopFilePath,
    EMPTY_DESKTOP_FILE_WORKSPACE,
    isDesktopLocalhostReference,
    openDesktopFile,
    openDesktopLocalhost,
    selectDesktopFile,
} from '@/components/desktopFileWorkspaceModel';
import { SideChatAccessButton, SideChatFullscreen } from '@/components/SideChatPanel';
import {
    resolveActiveSideChatId,
    resolveSideChatSelectionAfterClose,
    resolveSessionSidebarPresentation,
    SIDE_CHAT_SIDEBAR_MIN_WINDOW_WIDTH,
    shouldShowLandscapeSideChatAccess,
} from '@/components/sideChatPresentation';
import { AllFilesDiffView } from '@/components/AllFilesDiffView';
import { FileViewPanel } from '@/components/FileViewPanel';
import { MachineWorkspaceBrowser } from '@/app/(app)/workspace/index';
import { prefetchPierreDiff } from '@/components/diff/PierreDiffView';
import { GitFileStatus } from '@/sync/gitStatusFiles';
import { useOverlayNav } from '@/-session/sessionOverlayNav';
import { formatPathRelativeToHome, getResumeCommandBlock, getSessionAvatarId, getSessionName, useSessionStatus } from '@/utils/sessionUtils';
import { useSessionQuickActions } from '@/hooks/useSessionQuickActions';
import { isVersionSupported, MINIMUM_CLI_VERSION } from '@/utils/versionUtils';
import * as Clipboard from 'expo-clipboard';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { useMemo } from 'react';
import { ActivityIndicator, LayoutChangeEvent, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { ModelMode, PermissionMode } from '@/components/PermissionModeSelector';
import {
    getAgentDefaultOverrideValue,
    resolveAgentDefaultConfig,
    resolveAgentDefaultEffortLevel,
    setAgentDefaultOverride,
} from '@/sync/agentDefaults';
import { performAgentGoalAction } from './agentGoalActionHandler';
import { MOBILE_GLASS_HEADER_HEIGHT } from '@/components/navigation/headerMetrics';
import {
    getRigGitSummary,
    getRigReasoningSelection,
    isRigMetadata,
    isRigModelSelectionEnabled,
    isRigPermissionSelectionEnabled,
    isRigReasoningSelectionEnabled,
    rigCanAbort,
    rigCanBrowseFiles,
    rigCanReadFiles,
    rigCanUseAttachments,
    rigCanUseShell,
} from '@/sync/rig';
import { RigActivityBar } from '@/components/RigActivityBar';
import { useVoiceInputAvailability } from '@/hooks/useVoiceInputAvailability';
import {
    addWorkspaceContextFile,
    buildWorkspaceContextMessage,
    clearWorkspaceContextFiles,
    getWorkspaceContextEntries,
    MAX_WORKSPACE_CONTEXT_ITEMS,
    removeWorkspaceContextEntry,
    subscribeWorkspaceContext,
} from '@/sync/workspaceContext';
import { projectSessionQueue } from '@/sync/queueProjection';
import { transitionGrokPermissionModeAndCommit } from '@/sync/grokPermissionModeTransition';
import {
    WorkspaceLinkPressContext,
} from './workspaceLinkNavigation';
import type { WorkspaceLinkRoute } from '@/utils/markdownWorkspaceLink';
import { AnimatedFade } from '@/components/AnimatedOverlay';
import { HEARTBEAT_COMMAND } from '@/utils/heartbeatCommand';
import { deliverSessionTurn } from '@/utils/sessionContinuation';
import { MobileTypographyFloor } from '@/components/MobileTypographyFloor';

const SESSION_FILE_WORKSPACE_SPLIT_MIN_WINDOW_WIDTH = 900;

export type SessionWorkspaceController = {
    openChanges: (sessionId: string) => void;
    openWorkspace: (session: Session) => void;
    openWorkspaceLink: (route: WorkspaceLinkRoute) => void;
};

export const SessionWorkspaceControllerContext = React.createContext<SessionWorkspaceController | null>(null);

export const SessionView = React.memo((props: { id: string; focusMessageId?: string }) => {
    const sessionId = props.id;
    const router = useRouter();
    const session = useSession(sessionId);
    const sideChatMachineId = session?.metadata?.machineId ?? '';
    const sideChatMachine = useMachine(sideChatMachineId);
    const isDataReady = useIsDataReady();
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    const headerHeight = useHeaderHeight();
    const mobileHeaderHeight = deviceType === 'phone' && Platform.OS !== 'web'
        ? Math.max(headerHeight, MOBILE_GLASS_HEADER_HEIGHT)
        : headerHeight;
    const contentRunsUnderHeader = deviceType === 'phone'
        && Platform.OS !== 'web'
        && !isLandscape;
    const realtimeStatus = useRealtimeStatus();
    const isTablet = useIsTablet();
    const { width: windowWidth } = useWindowDimensions();
    const isWebMobileSessionViewport = Platform.OS === 'web'
        && deviceType === 'phone'
        && windowWidth < SIDE_CHAT_SIDEBAR_MIN_WINDOW_WIDTH;
    const appliesWebPhoneTypographyFloor = shouldApplyPhoneWebTypographyFloor({
        platform: Platform.OS,
        deviceType,
        windowWidth,
        desktopLayoutMinWidth: SIDE_CHAT_SIDEBAR_MIN_WINDOW_WIDTH,
    });
    const zenMode = useLocalSetting('zenMode');
    const [headerBackdropVisible, setHeaderBackdropVisible] = React.useState(false);
    const [focusMessageId, setFocusMessageId] = React.useState<string | undefined>(props.focusMessageId);

    React.useEffect(() => {
        setFocusMessageId(props.focusMessageId);
    }, [props.focusMessageId]);

    React.useEffect(() => {
        setHeaderBackdropVisible(false);
    }, [sessionId]);

    const sidebarPresentation = resolveSessionSidebarPresentation({
        platform: Platform.OS,
        runningOnMac: isRunningOnMac(),
        windowWidth,
        zenMode,
        workspaceLinkPanelOpen: false,
        canUseFilePanels: !session
            || (rigCanBrowseFiles(session.metadata) && rigCanUseShell(session.metadata)),
    });
    const canUseSessionFileWorkspace = isDataReady
        && !!session
        && (Platform.OS === 'web' || isRunningOnMac())
        && rigCanBrowseFiles(session.metadata)
        && rigCanUseShell(session.metadata);
    const canShowSessionFileWorkspaceSplit = canUseSessionFileWorkspace
        && windowWidth >= SESSION_FILE_WORKSPACE_SPLIT_MIN_WINDOW_WIDTH;
    const canShowFileSidebar = sidebarPresentation.fileSidebarAvailable && isDataReady && !!session;
    const canShowSideChatSidebar = sidebarPresentation.sideChatSidebarAvailable && isDataReady && !!session;

    // Match left sidebar width: 30% of window, clamped to 250–360px
    const sidebarWidth = Math.min(Math.max(Math.floor(windowWidth * 0.3), 250), 360);
    const [desktopFileWorkspace, setDesktopFileWorkspace] = React.useState(EMPTY_DESKTOP_FILE_WORKSPACE);
    const [desktopMachinePickerOpen, setDesktopMachinePickerOpen] = React.useState(false);
    const [desktopMachinePickerTarget, setDesktopMachinePickerTarget] = React.useState<{ machineId: string; path: string } | null>(null);
    const [desktopDirtyPaths, setDesktopDirtyPaths] = React.useState<Set<string>>(() => new Set());
    const desktopDirtyPathsRef = React.useRef(desktopDirtyPaths);
    const [desktopFileWorkspaceSessionId, setDesktopFileWorkspaceSessionId] = React.useState(sessionId);
    const desktopFileWorkspaceSession = useSession(desktopFileWorkspaceSessionId);
    const canUseDesktopFileWorkspaceSession = isDataReady
        && !!desktopFileWorkspaceSession
        && (Platform.OS === 'web' || isRunningOnMac())
        && rigCanBrowseFiles(desktopFileWorkspaceSession.metadata)
        && rigCanUseShell(desktopFileWorkspaceSession.metadata);
    const workspaceLinkRequestGeneration = React.useRef(0);

    React.useEffect(() => {
        workspaceLinkRequestGeneration.current += 1;
        setDesktopFileWorkspace(EMPTY_DESKTOP_FILE_WORKSPACE);
        setDesktopMachinePickerOpen(false);
        setDesktopMachinePickerTarget(null);
        const cleanDirtyPaths = new Set<string>();
        desktopDirtyPathsRef.current = cleanDirtyPaths;
        setDesktopDirtyPaths(cleanDirtyPaths);
        setDesktopFileWorkspaceSessionId(sessionId);
        return () => {
            workspaceLinkRequestGeneration.current += 1;
        };
    }, [sessionId]);

    // Sidebar panels are user-managed and persisted in local settings so the
    // layout (which panels are open + which is active) survives reloads and
    // long absences. State is device-local, shared across sessions.
    const sidebarPanelsOpenRaw = useLocalSetting('sidebarPanelsOpen') as Array<SidebarMode | 'allFiles'>;
    const sidebarPanelActiveRaw = useLocalSetting('sidebarPanelActive') as SidebarMode | 'allFiles' | null;
    const sidebarSideChatSessionId = useLocalSetting('sidebarSideChatSessionId');
    // File-panel preferences are device-global, but a Side chat panel belongs
    // to one parent session. React Navigation may retain other SessionViews;
    // they must neither render nor clear the foreground parent's panel.
    const sidebarPanelsOpen = React.useMemo<SidebarMode[]>(() => (
        sidebarPanelsOpenRaw.filter((panel): panel is SidebarMode => (
            panel !== 'allFiles'
            && (panel !== 'sideChat' || sidebarSideChatSessionId === sessionId)
        ))
    ), [sessionId, sidebarPanelsOpenRaw, sidebarSideChatSessionId]);
    // Guard against an inconsistent persisted value: the active panel must be
    // one of the open panels, otherwise fall back to the last opened (or none).
    const sidebarPanelActive = React.useMemo<SidebarMode | null>(() => {
        if (
            sidebarPanelActiveRaw
            && sidebarPanelActiveRaw !== 'allFiles'
            && sidebarPanelsOpen.includes(sidebarPanelActiveRaw)
        ) {
            return sidebarPanelActiveRaw;
        }
        return sidebarPanelsOpen[sidebarPanelsOpen.length - 1] ?? null;
    }, [sidebarPanelActiveRaw, sidebarPanelsOpen]);

    const openSidebarPanel = React.useCallback((panel: SidebarMode) => {
        const cur = storage.getState().localSettings.sidebarPanelsOpen as SidebarMode[];
        const open = cur.includes(panel) ? cur : [...cur, panel];
        storage.getState().applyLocalSettings({
            sidebarPanelsOpen: open,
            sidebarPanelActive: panel,
            ...(panel === 'sideChat' ? { sidebarSideChatSessionId: sessionId } : {}),
        });
    }, [sessionId]);
    const selectSidebarPanel = React.useCallback((panel: SidebarMode) => {
        const state = storage.getState().localSettings;
        const cur = state.sidebarPanelsOpen as SidebarMode[];
        if (panel === 'sideChat' && state.sidebarSideChatSessionId !== sessionId) {
            return;
        }
        if (cur.includes(panel)) {
            storage.getState().applyLocalSettings({ sidebarPanelActive: panel });
        }
    }, [sessionId]);
    const openMainSidebarPanel = React.useCallback((panel: SidebarMode) => {
        if (panel !== 'sideChat') {
            setDesktopFileWorkspaceSessionId(sessionId);
            setDesktopMachinePickerTarget(null);
        }
        openSidebarPanel(panel);
    }, [openSidebarPanel, sessionId]);
    const selectMainSidebarPanel = React.useCallback((panel: SidebarMode) => {
        if (panel !== 'sideChat') {
            setDesktopFileWorkspaceSessionId(sessionId);
            setDesktopMachinePickerTarget(null);
        }
        selectSidebarPanel(panel);
    }, [selectSidebarPanel, sessionId]);
    // Panel removal is always a non-destructive collapse. Side-chat teardown is
    // owned only by each child tab's explicit close action.
    const removeSidebarPanel = React.useCallback((panel: SidebarMode) => {
        const state = storage.getState().localSettings;
        if (panel === 'sideChat' && state.sidebarSideChatSessionId !== sessionId) {
            return;
        }
        const open = (state.sidebarPanelsOpen as SidebarMode[]).filter((p) => p !== panel);
        const active = state.sidebarPanelActive === panel
            ? (open[open.length - 1] ?? null)
            : (state.sidebarPanelActive as SidebarMode | null);
        storage.getState().applyLocalSettings({
            sidebarPanelsOpen: open,
            sidebarPanelActive: active,
            ...(panel === 'sideChat' ? { sidebarSideChatSessionId: null } : {}),
        });
    }, [sessionId]);
    const collapseSidebarPanels = React.useCallback(() => {
        const state = storage.getState().localSettings;
        const ownsSideChat = state.sidebarSideChatSessionId === sessionId;
        const open: SidebarMode[] = ownsSideChat
            ? []
            : (state.sidebarPanelsOpen as SidebarMode[]).filter((panel) => panel === 'sideChat');
        storage.getState().applyLocalSettings({
            sidebarPanelsOpen: open,
            sidebarPanelActive: open.includes(state.sidebarPanelActive as SidebarMode)
                ? state.sidebarPanelActive
                : null,
            ...(ownsSideChat ? { sidebarSideChatSessionId: null } : {}),
        });
    }, [sessionId]);

    // Side chats hydrate into one switchable panel. Focus lives
    // here (not in the panel) so wide and narrow hosts share one selection.
    const rawSideChats = useSideChatSessions(sessionId);
    const [activeSideChatId, setActiveSideChatId] = React.useState<string | null>(null);
    const [creatingSideChat, setCreatingSideChat] = React.useState(false);
    const [pendingSideChatId, setPendingSideChatId] = React.useState<string | null>(null);
    // Optimistically hide a side chat the instant it's closed. The server's
    // /archive only flips active=false (not lifecycleState), so if the CLI is
    // already dead the fallback archive wouldn't drop the tab via
    // useSideChatSessions — this makes the tab disappear immediately regardless.
    const [closedSideChatIds, setClosedSideChatIds] = React.useState<Set<string>>(() => new Set());
    const sideChats = React.useMemo(
        () => rawSideChats.filter((s) => !closedSideChatIds.has(s.id)),
        [rawSideChats, closedSideChatIds],
    );
    const sideChatIds = React.useMemo(() => sideChats.map((item) => item.id), [sideChats]);
    const [sideChatFullscreenOpen, setSideChatFullscreenOpen] = React.useState(false);

    React.useEffect(() => {
        setClosedSideChatIds(new Set());
        setActiveSideChatId(null);
        setPendingSideChatId(null);
        setSideChatFullscreenOpen(false);
    }, [sessionId]);

    // Prune closed ids once the underlying sessions actually leave the store, so
    // the set can't grow without bound.
    React.useEffect(() => {
        setClosedSideChatIds((prev) => {
            if (prev.size === 0) return prev;
            const live = new Set(rawSideChats.map((s) => s.id));
            const next = new Set<string>();
            let changed = false;
            prev.forEach((id) => { if (live.has(id)) next.add(id); else changed = true; });
            return changed ? next : prev;
        });
    }, [rawSideChats]);

    // Hydrated children created from another app or the CLI have no local UI selection. Focus the
    // newest one without creating another, and remove stale empty panel state.
    React.useEffect(() => {
        // Creation receipts arrive before the child is guaranteed to hydrate. Preserve the exact
        // child selection and the open surface until the store catches up through refresh or the
        // normal websocket event.
        if (pendingSideChatId && !sideChatIds.includes(pendingSideChatId)) {
            return;
        }
        if (pendingSideChatId) {
            setPendingSideChatId(null);
        }
        const resolvedId = resolveActiveSideChatId(sideChatIds, activeSideChatId);
        if (resolvedId !== activeSideChatId) {
            setActiveSideChatId(resolvedId);
        }
        if (!resolvedId) {
            setSideChatFullscreenOpen(false);
            if (sidebarPanelsOpen.includes('sideChat')) {
                removeSidebarPanel('sideChat');
            }
        }
    }, [activeSideChatId, pendingSideChatId, removeSidebarPanel, sideChatIds, sidebarPanelsOpen]);

    const canCreateSideChat = React.useMemo(() => {
        if (!session || !sideChatMachineId || !sideChatMachine?.active) return false;
        const flavor = session.metadata?.flavor
            ?? (session.metadata?.claudeSessionId ? 'claude' : null);
        if (flavor === 'codex') return Boolean(session.metadata?.codexThreadId);
        if (flavor === 'claude') return Boolean(session.metadata?.claudeSessionId);
        return false;
    }, [session, sideChatMachine, sideChatMachineId]);

    const sideChatSidebarExpanded = sidebarPresentation.sideChatSurface === 'sidebar'
        && sidebarPanelActive === 'sideChat'
        && sideChats.length > 0;
    const sideChatFullscreenTransitionPending = sidebarPresentation.sideChatSurface === 'fullscreen'
        && sidebarPanelActive === 'sideChat'
        && sidebarPanelsOpen.includes('sideChat')
        && sideChats.length > 0;
    const fileSidebarPanelExpanded = !zenMode
        && canShowFileSidebar
        && sidebarPanelActive === 'changes'
        && sidebarPanelsOpen.includes(sidebarPanelActive);
    const desktopFileWorkspaceActive = desktopFileWorkspace.paths.length > 0
        || desktopMachinePickerOpen;
    const sideChatOwnsFileWorkspace = sideChatFullscreenOpen
        && desktopFileWorkspaceSessionId !== sessionId;
    const desktopFileWorkspaceVisible = canShowSessionFileWorkspaceSplit
        && desktopFileWorkspaceActive
        && !fileSidebarPanelExpanded
        && !sideChatSidebarExpanded
        && !sideChatFullscreenOpen;
    const desktopFileWorkspaceFullscreen = desktopFileWorkspaceActive
        && canUseDesktopFileWorkspaceSession
        && !canShowSessionFileWorkspaceSplit
        && (!sideChatFullscreenOpen || sideChatOwnsFileWorkspace)
        && !sideChatFullscreenTransitionPending;
    const rightWorkspaceVisible = desktopFileWorkspaceVisible;
    const rightWorkspaceFullscreen = desktopFileWorkspaceFullscreen;
    const showSidebar = !zenMode
        && (canShowFileSidebar || sideChatSidebarExpanded);
    const canRenderSidebar = canShowFileSidebar
        || (canShowSideChatSidebar
            && sidebarPanelsOpen.includes('sideChat')
            && sideChats.length > 0);
    const visibleSidebarPanels = React.useMemo(
        () => canShowFileSidebar
            ? sidebarPanelsOpen
            : sidebarPanelsOpen.filter((panel) => panel === 'sideChat'),
        [canShowFileSidebar, sidebarPanelsOpen],
    );
    const visibleSidebarPanelActive = canShowFileSidebar
        ? sidebarPanelActive
        : sidebarPanelActive === 'sideChat' ? 'sideChat' : null;

    // Animate the shared right sidebar width. Web snaps to avoid repeatedly
    // re-measuring the chat tree; native keeps the UI-thread animation.
    const sidebarAnim = useSharedValue(showSidebar ? 1 : 0);
    React.useEffect(() => {
        sidebarAnim.value = withTiming(showSidebar ? 1 : 0, {
            duration: Platform.OS === 'web' ? 0 : 250,
            easing: Easing.out(Easing.cubic),
        });
    }, [showSidebar]);
    const animatedSidebarStyle = useAnimatedStyle(() => ({
        width: sidebarAnim.value * sidebarWidth,
        opacity: sidebarAnim.value,
        overflow: 'hidden' as const,
    }));

    const createSideChat = React.useCallback(async (): Promise<boolean> => {
        if (!canCreateSideChat || !sideChatMachineId || creatingSideChat || pendingSideChatId) return false;
        setCreatingSideChat(true);
        try {
            const receipt = await machineCreateSideChat(sideChatMachineId, sessionId);
            if (!receipt.success || !receipt.sessionId) {
                const detail = receipt.phases.find((phase) => phase.status === 'failed')?.message;
                Modal.alert(
                    t('common.error'),
                    detail ? t('sideChat.createFailedWithDetail', { detail }) : t('sideChat.createFailed'),
                );
                return false;
            }
            setClosedSideChatIds((current) => {
                if (!current.has(receipt.sessionId!)) return current;
                const next = new Set(current);
                next.delete(receipt.sessionId!);
                return next;
            });
            setPendingSideChatId(receipt.sessionId);
            setActiveSideChatId(receipt.sessionId);
            if (sidebarPresentation.sideChatSurface === 'sidebar') {
                setSideChatFullscreenOpen(false);
                openSidebarPanel('sideChat');
            } else {
                removeSidebarPanel('sideChat');
                setSideChatFullscreenOpen(true);
            }
            return true;
        } catch (error) {
            const detail = error instanceof Error ? error.message : t('sideChat.createFailed');
            Modal.alert(t('common.error'), t('sideChat.createFailedWithDetail', { detail }));
            return false;
        } finally {
            setCreatingSideChat(false);
        }
    }, [canCreateSideChat, creatingSideChat, openSidebarPanel, pendingSideChatId, removeSidebarPanel, sessionId, sideChatMachineId, sidebarPresentation.sideChatSurface]);

    const toggleSideChats = React.useCallback(() => {
        const focusId = resolveActiveSideChatId(sideChatIds, activeSideChatId);
        if (!focusId) {
            void createSideChat();
            return;
        }
        setActiveSideChatId(focusId);

        if (sidebarPresentation.sideChatSurface === 'sidebar') {
            setSideChatFullscreenOpen(false);
            if (sideChatSidebarExpanded) {
                removeSidebarPanel('sideChat');
            } else {
                openSidebarPanel('sideChat');
            }
            return;
        }

        removeSidebarPanel('sideChat');
        setSideChatFullscreenOpen((open) => !open);
    }, [activeSideChatId, createSideChat, openSidebarPanel, removeSidebarPanel, sideChatIds, sideChatSidebarExpanded, sidebarPresentation.sideChatSurface]);

    React.useEffect(() => {
        if (sideChatFullscreenTransitionPending) {
            removeSidebarPanel('sideChat');
            setSideChatFullscreenOpen(true);
            return;
        }
        if (
            sideChatFullscreenOpen
            && sidebarPresentation.sideChatSurface === 'sidebar'
            && sideChats.length > 0
        ) {
            setSideChatFullscreenOpen(false);
            openSidebarPanel('sideChat');
        }
    }, [
        openSidebarPanel,
        removeSidebarPanel,
        sideChatFullscreenOpen,
        sideChatFullscreenTransitionPending,
        sideChats.length,
        sidebarPresentation.sideChatSurface,
    ]);

    // Tab close is durable: stop the process and always archive the server
    // session. Panel collapse/removal never calls this path.
    const archiveSideChatSession = React.useCallback((sideChat: Session) => {
        return closeSideChatSession({
            sessionId: sideChat.id,
            machineId: sideChat.metadata?.machineId ?? null,
            active: sideChat.active,
        }, {
            stopOnMachine: machineStopSession,
            stopSession: sessionKill,
            archive: sessionArchive,
            refresh: () => sync.refreshSessions(),
        });
    }, []);

    const closeSideChat = React.useCallback((id: string) => {
        const idx = sideChats.findIndex((s) => s.id === id);
        const target = idx === -1 ? null : sideChats[idx];
        if (!target) return;
        const neighbour = idx !== -1 ? (sideChats[idx - 1] ?? sideChats[idx + 1] ?? null) : null;
        const focusedId = resolveActiveSideChatId(sideChatIds, activeSideChatId);
        const closedFocusedTab = focusedId === id;
        setActiveSideChatId(resolveSideChatSelectionAfterClose(sideChatIds, activeSideChatId, id));
        setClosedSideChatIds((prev) => new Set(prev).add(id));
        if (!neighbour) {
            removeSidebarPanel('sideChat');
            setSideChatFullscreenOpen(false);
        }
        void archiveSideChatSession(target).then((result) => {
            const reconciliation = resolveSideChatCloseReconciliation(result);
            if (reconciliation.restoreTab) {
                setClosedSideChatIds((prev) => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                });
                if (closedFocusedTab) {
                    setActiveSideChatId(id);
                }
                if (sidebarPresentation.sideChatSurface === 'sidebar') {
                    openSidebarPanel('sideChat');
                } else {
                    setSideChatFullscreenOpen(true);
                }
            }
            if (reconciliation.error === 'archive-failed') {
                Modal.alert(t('common.error'), t('sideChat.archiveFailed'));
            } else if (reconciliation.error === 'stop-unconfirmed') {
                Modal.alert(t('common.error'), t('sideChat.stopUnconfirmed', { sessionId: id }));
            }
        });
    }, [activeSideChatId, sideChatIds, sideChats, removeSidebarPanel, archiveSideChatSession, openSidebarPanel, sidebarPresentation.sideChatSurface]);

    // Overlay state is managed as a browser-style history stack so the
    // sidebar's back / forward arrows can navigate between chat ↔ diff ↔ file
    // without a per-overlay close button. Stack + cursor live in one piece
    // of state so functional updates stay coordinated.
    type OverlayEntry =
        | { kind: 'none' }
        | { kind: 'diff'; file?: string }
        | { kind: 'file'; path: string };
    const [overlayHistory, setOverlayHistory] = React.useState<{ stack: OverlayEntry[]; cursor: number }>(
        { stack: [{ kind: 'none' }], cursor: 0 }
    );
    const overlayCurrent = overlayHistory.stack[overlayHistory.cursor] ?? { kind: 'none' };
    const diffViewOpen = overlayCurrent.kind === 'diff';
    const fileViewPath = overlayCurrent.kind === 'file' ? overlayCurrent.path : null;
    const scrollToFile = overlayCurrent.kind === 'diff' ? overlayCurrent.file ?? null : null;
    const [fileViewDirty, setFileViewDirty] = React.useState(false);

    const pushOverlayNow = React.useCallback((entry: OverlayEntry) => {
        setOverlayHistory((prev) => {
            const truncated = prev.stack.slice(0, prev.cursor + 1);
            truncated.push(entry);
            return { stack: truncated, cursor: truncated.length - 1 };
        });
    }, []);

    const withFileDiscardConfirmation = React.useCallback((action: () => void) => {
        if (!fileViewDirty) {
            action();
            return;
        }
        void Modal.confirm(
            t("uiCopy.discardUnsavedChanges"),
            t("uiCopy.yourEditsToValueHaveNotBeenSaved", { value1: fileViewPath?.split('/').pop() || t("uiCopy.thisFile") }),
            { confirmText: 'Discard', destructive: true },
        ).then((confirmed) => {
            if (!confirmed) return;
            setFileViewDirty(false);
            action();
        });
    }, [fileViewDirty, fileViewPath]);

    const handleWorkspaceLinkPress = React.useCallback((route: WorkspaceLinkRoute) => {
        const requestGeneration = ++workspaceLinkRequestGeneration.current;
        withFileDiscardConfirmation(() => {
            if (workspaceLinkRequestGeneration.current !== requestGeneration) return;
            if (
                (
                    route.params.originSessionId !== sessionId
                    && !sideChatIds.includes(route.params.originSessionId)
                )
                || !canUseSessionFileWorkspace
            ) {
                router.push(route);
                return;
            }
            setDesktopFileWorkspaceSessionId(route.params.originSessionId);

            void machineGetDirectoryTree(
                route.params.machineId,
                route.params.absolutePath,
                1,
            ).then((response) => {
                if (workspaceLinkRequestGeneration.current !== requestGeneration) return;
                if (response.success && response.tree?.type === 'directory') {
                    setDesktopMachinePickerTarget({
                        machineId: route.params.machineId,
                        path: route.params.absolutePath,
                    });
                    setDesktopMachinePickerOpen(true);
                    collapseSidebarPanels();
                    return;
                }
                // Keep same-session file and failed-resolution links in the
                // canonical host. FileViewPanel renders its established error
                // state without creating a second viewer header or composer.
                const identity = desktopFileIdentity(route.params.absolutePath, route.params.machineId);
                setDesktopFileWorkspace((current) => {
                    const existingReference = current.references[identity];
                    const preserveDirtySessionEditor = !isDesktopLocalhostReference(existingReference)
                        && existingReference?.source === 'session'
                        && desktopDirtyPathsRef.current.has(identity);
                    return openDesktopFile(
                        current,
                        route.params.absolutePath,
                        {
                            machineId: route.params.machineId,
                            // Explicit reply links already carry an authoritative
                            // machine ID and may point anywhere on that machine.
                            // Keep a dirty session-backed editor mounted until its
                            // existing save/cancel flow resolves the local draft.
                            source: preserveDirtySessionEditor ? 'session' : 'machine',
                            ...(route.params.line === undefined ? {} : { line: Number(route.params.line) }),
                            ...(route.params.column === undefined ? {} : { column: Number(route.params.column) }),
                        },
                    );
                });
                setDesktopMachinePickerOpen(false);
                setDesktopMachinePickerTarget(null);
                collapseSidebarPanels();
            });
        });
    }, [
        canUseSessionFileWorkspace,
        collapseSidebarPanels,
        router,
        sessionId,
        sideChatIds,
        withFileDiscardConfirmation,
    ]);

    const handleSidebarFilePress = React.useCallback((file: GitFileStatus) => {
        if (file.status === 'deleted') return;
        withFileDiscardConfirmation(() => pushOverlayNow({ kind: 'diff', file: file.fullPath }));
    }, [pushOverlayNow, withFileDiscardConfirmation]);

    const handleDesktopFileSelect = React.useCallback((path: string) => {
        setDesktopFileWorkspace((current) => selectDesktopFile(current, path));
        setDesktopMachinePickerOpen(false);
        setDesktopMachinePickerTarget(null);
    }, []);
    const handleDesktopDirtyChange = React.useCallback((path: string, dirty: boolean) => {
        const current = desktopDirtyPathsRef.current;
        if (current.has(path) === dirty) return;
        const next = new Set(current);
        if (dirty) next.add(path);
        else next.delete(path);
        desktopDirtyPathsRef.current = next;
        setDesktopDirtyPaths(next);
    }, []);
    const handleDesktopFileClose = React.useCallback((path: string) => {
        const close = () => {
            setDesktopFileWorkspace((current) => closeDesktopFile(current, path));
            if (desktopFileWorkspace.paths.length === 1 && desktopFileWorkspace.paths[0] === path) {
                setDesktopMachinePickerOpen(false);
                setDesktopMachinePickerTarget(null);
            }
            handleDesktopDirtyChange(path, false);
        };
        if (!desktopDirtyPathsRef.current.has(path)) {
            close();
            return;
        }
        void Modal.confirm(
            t('uiCopy.discardUnsavedChanges'),
            t('uiCopy.yourEditsToValueHaveNotBeenSaved', { value1: path.split(/[/\\]/).pop() || t('uiCopy.thisFile') }),
            { confirmText: t('common.discard'), destructive: true },
        ).then((confirmed) => {
            if (confirmed) close();
        });
    }, [desktopFileWorkspace.paths, handleDesktopDirtyChange]);
    const handleDesktopFileDeleted = React.useCallback((path: string) => {
        setDesktopFileWorkspace((current) => closeDesktopFile(current, path));
        handleDesktopDirtyChange(path, false);
    }, [desktopFileWorkspace.paths, handleDesktopDirtyChange]);
    const handleOverlayFileDeleted = React.useCallback(() => {
        setFileViewDirty(false);
        setHeaderRightSlot(null);
        setOverlayHistory({ stack: [{ kind: 'none' }], cursor: 0 });
    }, []);
    const handleMachineWorkspaceFilePress = React.useCallback(({ machineId, path }: { machineId: string; path: string }) => {
        setDesktopFileWorkspace((current) => openDesktopFile(current, path, {
            machineId,
            source: 'machine',
        }));
        setDesktopMachinePickerOpen(false);
        setDesktopMachinePickerTarget(null);
        collapseSidebarPanels();
    }, [collapseSidebarPanels]);
    const handleMachineWorkspaceLocalhostUrlPress = React.useCallback(({ machineId, url }: { machineId: string; url: string }) => {
        setDesktopFileWorkspace((current) => openDesktopLocalhost(current, machineId, url));
        setDesktopMachinePickerOpen(false);
        setDesktopMachinePickerTarget(null);
        collapseSidebarPanels();
    }, [collapseSidebarPanels]);
    const openChangesForSession = React.useCallback((targetSessionId: string) => {
        setDesktopFileWorkspaceSessionId(targetSessionId);
        setDesktopMachinePickerOpen(false);
        setDesktopMachinePickerTarget(null);
        collapseSidebarPanels();
        pushOverlayNow({ kind: 'diff' });
    }, [collapseSidebarPanels, pushOverlayNow]);
    const openWorkspaceForSession = React.useCallback((targetSession: Session) => {
        setDesktopFileWorkspaceSessionId(targetSession.id);
        collapseSidebarPanels();
        const machineId = targetSession.metadata?.machineId;
        const path = targetSession.metadata?.path || targetSession.metadata?.homeDir || '/';
        setDesktopMachinePickerTarget(machineId ? { machineId, path } : null);
        setDesktopMachinePickerOpen(true);
    }, [collapseSidebarPanels]);
    const sessionWorkspaceController = React.useMemo<SessionWorkspaceController>(() => ({
        openChanges: openChangesForSession,
        openWorkspace: openWorkspaceForSession,
        openWorkspaceLink: handleWorkspaceLinkPress,
    }), [handleWorkspaceLinkPress, openChangesForSession, openWorkspaceForSession]);
    const openWorkspaceFromRightSidebar = React.useCallback(() => {
        const activeSidebarSideChatId = visibleSidebarPanelActive === 'sideChat'
            ? resolveActiveSideChatId(sideChatIds, activeSideChatId)
            : null;
        const targetSession = activeSidebarSideChatId
            ? sideChats.find((candidate) => candidate.id === activeSidebarSideChatId) ?? session
            : session;
        if (targetSession) openWorkspaceForSession(targetSession);
    }, [activeSideChatId, openWorkspaceForSession, session, sideChatIds, sideChats, visibleSidebarPanelActive]);

    // File overlays follow the session's file-panel capabilities. Side chats
    // use their independent full-screen fallback when those are unavailable.
    React.useEffect(() => {
        if (!canShowFileSidebar) {
            setOverlayHistory({ stack: [{ kind: 'none' }], cursor: 0 });
        }
    }, [canShowFileSidebar]);

    // Right-side header content published by the active overlay (diff toggle / save button).
    const [headerRightSlot, setHeaderRightSlot] = React.useState<React.ReactNode>(null);

    // Wire intra-session back / forward into the global SidebarNavigator arrows.
    const canOverlayBack = overlayHistory.cursor > 0;
    const canOverlayForward = overlayHistory.cursor < overlayHistory.stack.length - 1;
    React.useEffect(() => {
        useOverlayNav.getState().publish({
            canBack: canOverlayBack,
            canForward: canOverlayForward,
            back: () => {
                if (!canOverlayBack) return false;
                withFileDiscardConfirmation(() => setOverlayHistory((prev) => (
                    prev.cursor <= 0 ? prev : { ...prev, cursor: prev.cursor - 1 }
                )));
                return true;
            },
            forward: () => {
                if (!canOverlayForward) return false;
                withFileDiscardConfirmation(() => setOverlayHistory((prev) => (
                    prev.cursor >= prev.stack.length - 1 ? prev : { ...prev, cursor: prev.cursor + 1 }
                )));
                return true;
            },
        });
        return () => useOverlayNav.getState().reset();
    }, [canOverlayBack, canOverlayForward, withFileDiscardConfirmation]);

    // Warm Pierre's lazy web chunks while the user is still reading chat.
    React.useEffect(() => {
        prefetchPierreDiff();
    }, []);

    // Compute header props based on session state
    const headerProps = useMemo(() => {
        if (!isDataReady) {
            return { title: '', folderName: undefined, isConnected: false };
        }
        if (!session) {
            return { title: t('errors.sessionDeleted'), folderName: undefined, isConnected: false };
        }
        const isConnected = session.presence === 'online';
        const pathSegments = session.metadata?.path?.split(/[/\\]/).filter(Boolean);
        const folderName = pathSegments?.[pathSegments.length - 1];
        const sessionName = getSessionName(session);
        return {
            title: sessionName,
            folderName,
            isConnected,
        };
    }, [session, isDataReady]);
    const sessionInfoButton = session && deviceType === 'phone' && Platform.OS !== 'web'
        ? (
            <Pressable
                onPress={() => router.push(`/session/${sessionId}/info`)}
                hitSlop={10}
            >
                <Avatar
                    id={getSessionAvatarId(session)}
                    size={28}
                    monochrome={!headerProps.isConnected}
                    flavor={session.metadata?.flavor}
                    clientId={session.metadata?.client?.id}
                    badgeLocation="sessionHeader"
                />
            </Pressable>
        )
        : null;
    const sideChatAccessButton = session
        ? (
            <SideChatAccessButton
                count={sideChats.length}
                expanded={sidebarPresentation.sideChatSurface === 'sidebar'
                    ? sideChatSidebarExpanded
                    : sideChatFullscreenOpen}
                compact={deviceType === 'phone' || windowWidth < 720}
                onPress={toggleSideChats}
            />
        )
        : null;
    const showLandscapeSideChatAccess = shouldShowLandscapeSideChatAccess({
        platform: Platform.OS,
        deviceType,
        isLandscape,
        sideChatCount: sideChats.length,
        canCreateSideChat: Boolean(session),
    });
    const headerRight = sideChatAccessButton || sessionInfoButton
        ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {sideChatAccessButton}
                {sessionInfoButton}
            </View>
        )
        : null;
    const mobileSideChatWorkspaceOpen = sideChatOwnsFileWorkspace
        && (desktopFileWorkspaceActive || diffViewOpen || !!fileViewPath);
    const voiceStatusBarHeight = !isTablet && realtimeStatus !== 'disconnected'
        ? VOICE_PILL_TOTAL_HEIGHT
        : 0;

    const mainContent = (
        <>
            <MobileGlassBackdrop enabled={deviceType === 'phone' && Platform.OS !== 'web'} />
            {/* Status bar shadow for landscape mode */}
            {isLandscape && deviceType === 'phone' && (
                <View style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: safeArea.top,
                    backgroundColor: theme.colors.surface,
                    zIndex: 1000,
                    shadowColor: theme.colors.shadow.color,
                    shadowOffset: {
                        width: 0,
                        height: 2,
                    },
                    shadowOpacity: theme.colors.shadow.opacity,
                    shadowRadius: 3,
                    elevation: 5,
                }} />
            )}
            {showLandscapeSideChatAccess && (
                <View
                    style={{
                        position: 'absolute',
                        top: safeArea.top + 8,
                        right: safeArea.right + 12,
                        zIndex: 1100,
                    }}
                >
                    <SideChatAccessButton
                        count={sideChats.length}
                        expanded={sideChatFullscreenOpen}
                        compact
                        onPress={toggleSideChats}
                    />
                </View>
            )}

            {/* Content based on state */}
            <View
                style={{
                    flex: 1,
                    paddingTop: !(isLandscape && deviceType === 'phone' && Platform.OS !== 'web')
                        ? contentRunsUnderHeader
                            ? 0
                            : safeArea.top
                                + mobileHeaderHeight
                                + voiceStatusBarHeight
                        : 0,
                }}
            >
                {!isDataReady ? (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                ) : !session ? (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <Ionicons name="trash-outline" size={48} color={theme.colors.textSecondary} />
                        <Text style={{ color: theme.colors.text, fontSize: 20, marginTop: 16, fontWeight: '600' }}>{t('errors.sessionDeleted')}</Text>
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 15, marginTop: 8, textAlign: 'center', paddingHorizontal: 32 }}>{t('errors.sessionDeletedDescription')}</Text>
                    </View>
                ) : (
                    <SessionViewLoaded
                        key={sessionId}
                        sessionId={sessionId}
                        session={session}
                        focusMessageId={focusMessageId}
                        onHeaderBackdropVisibilityChange={contentRunsUnderHeader
                            ? setHeaderBackdropVisible
                            : undefined}
                    />
                )}
            </View>

            {/* Render the overlay header after the dynamic list so native blur samples its content. */}
            {!(isLandscape && deviceType === 'phone' && Platform.OS !== 'web') && (
                <View style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 1000
                }}>
                    <ChatHeaderView
                        title={headerProps.title}
                        folderName={headerProps.folderName}
                        isConnected={headerProps.isConnected}
                        backdropVisible={headerBackdropVisible}
                        extraPathSegment={fileViewPath ?? undefined}
                        rightSlot={(diffViewOpen || !!fileViewPath) ? headerRightSlot : headerRight}
                        onTitlePress={session ? () => router.push(`/session/${sessionId}/info`) : undefined}
                        onBackPress={() => {
                            if (isWebMobileSessionViewport && overlayCurrent.kind !== 'none') {
                                withFileDiscardConfirmation(() => setOverlayHistory((current) => (
                                    current.cursor <= 0
                                        ? current
                                        : { ...current, cursor: current.cursor - 1 }
                                )));
                                return;
                            }
                            if (isWebMobileSessionViewport) {
                                router.dismissTo('/');
                                return;
                            }
                            router.back();
                        }}
                    />
                    {/* Voice status bar below header - not on tablet (shown in sidebar) */}
                    {!isTablet && realtimeStatus !== 'disconnected' && (
                        <VoiceAssistantStatusBar variant="full" />
                    )}
                </View>
            )}

            {sideChatFullscreenOpen && sideChats.length > 0 && (
                <View
                    style={{
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        bottom: 0,
                        left: 0,
                        zIndex: mobileSideChatWorkspaceOpen ? 500 : 2000,
                    }}
                >
                    <SideChatFullscreen
                        sideChats={sideChats}
                        activeSideChatId={activeSideChatId}
                        onSelectSideChat={setActiveSideChatId}
                        onCloseSideChat={closeSideChat}
                        creatingSideChat={creatingSideChat || Boolean(pendingSideChatId)}
                        canCreateSideChat={canCreateSideChat}
                        onCreateSideChat={createSideChat}
                        onCollapse={() => {
                            setSideChatFullscreenOpen(false);
                            setDesktopFileWorkspaceSessionId(sessionId);
                        }}
                    />
                </View>
            )}
        </>
    );

    const sessionContent = (
        <MobileTypographyFloor active={appliesWebPhoneTypographyFloor}>
            <SessionWorkspaceControllerContext.Provider value={sessionWorkspaceController}>
                <WorkspaceLinkPressContext.Provider
                    value={canUseSessionFileWorkspace ? handleWorkspaceLinkPress : undefined}
                >
                    {mainContent}
                </WorkspaceLinkPressContext.Provider>
            </SessionWorkspaceControllerContext.Provider>
        </MobileTypographyFloor>
    );

    const keepWorkspaceSplitMounted = canUseSessionFileWorkspace
        || canRenderSidebar
        || desktopFileWorkspaceActive;

    if (!keepWorkspaceSplitMounted) {
        return sessionContent;
    }

    const chatSurface = (
        <View
            style={{
                flex: 1,
                // Web-only: isolate the chat subtree's layout from the
                // parent flex-row so divider movement does not leak layout
                // work through the mounted conversation tree.
                ...(Platform.OS === 'web' ? { contain: 'layout style paint' as any } : {}),
            }}
        >
            {mainContent}
            {diffViewOpen && (canShowFileSidebar || (isWebMobileSessionViewport && canUseDesktopFileWorkspaceSession)) && (
                <View
                    testID="mobile-changes-workspace-overlay"
                    pointerEvents="box-none"
                    style={{
                        position: 'absolute',
                        top: safeArea.top + mobileHeaderHeight + voiceStatusBarHeight,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: theme.colors.surface,
                        ...(mobileSideChatWorkspaceOpen ? { zIndex: 1500 } : {}),
                    }}
                >
                    <AllFilesDiffView
                        sessionId={desktopFileWorkspaceSessionId}
                        scrollToFile={scrollToFile}
                        onHeaderRightSlotChange={setHeaderRightSlot}
                    />
                </View>
            )}
            {fileViewPath && canShowFileSidebar && (
                <View
                    pointerEvents="box-none"
                    style={{
                        position: 'absolute',
                        top: safeArea.top + mobileHeaderHeight + voiceStatusBarHeight,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: theme.colors.surface,
                    }}
                >
                    <FileViewPanel
                        sessionId={desktopFileWorkspaceSessionId}
                        filePath={fileViewPath}
                        onHeaderRightSlotChange={setHeaderRightSlot}
                        onDirtyChange={setFileViewDirty}
                        onDeleted={handleOverlayFileDeleted}
                    />
                </View>
            )}
        </View>
    );

    const sessionMachinePickerTarget = desktopFileWorkspaceSession?.metadata?.machineId
        ? {
            machineId: desktopFileWorkspaceSession.metadata.machineId,
            path: desktopFileWorkspaceSession.metadata.path
                || desktopFileWorkspaceSession.metadata.homeDir
                || '/',
        }
        : null;
    const effectiveMachinePickerTarget = desktopMachinePickerTarget ?? sessionMachinePickerTarget;
    const machineWorkspacePicker = effectiveMachinePickerTarget ? (
        <MachineWorkspaceBrowser
            key={`${desktopFileWorkspaceSessionId}:${effectiveMachinePickerTarget.machineId}:${effectiveMachinePickerTarget.path}`}
            embedded
            initialMachineId={effectiveMachinePickerTarget.machineId}
            initialPath={effectiveMachinePickerTarget.path}
            workspaceContextSessionId={desktopFileWorkspaceSessionId}
            onFilePress={handleMachineWorkspaceFilePress}
            onLocalhostUrlPress={handleMachineWorkspaceLocalhostUrlPress}
        />
    ) : null;

    const fallbackRightSurface = (
        <Animated.View style={[{ minWidth: 0, alignSelf: 'stretch' }, animatedSidebarStyle]}>
            <View style={{ width: sidebarWidth, flex: 1 }}>
                <FilesSidebar
                    sessionId={sessionId}
                    selectedPath={sidebarPanelActive === 'changes' ? scrollToFile : null}
                    onFilePress={handleSidebarFilePress}
                    openPanels={visibleSidebarPanels}
                    activePanel={visibleSidebarPanelActive}
                    onOpenPanel={openMainSidebarPanel}
                    onSelectPanel={selectMainSidebarPanel}
                    onClosePanel={removeSidebarPanel}
                    onOpenWorkspace={openWorkspaceFromRightSidebar}
                    canOpenFilePanels={canShowFileSidebar}
                    sideChats={sideChats}
                    activeSideChatId={activeSideChatId}
                    onSelectSideChat={setActiveSideChatId}
                    onCloseSideChat={closeSideChat}
                    creatingSideChat={creatingSideChat || Boolean(pendingSideChatId)}
                    canCreateSideChat={canCreateSideChat}
                    onCreateSideChat={createSideChat}
                />
            </View>
        </Animated.View>
    );

    const workspaceSurface = (
        <View style={{ flex: 1, minWidth: 0, position: 'relative' }}>
            {desktopFileWorkspaceActive ? (
                <View style={StyleSheet.absoluteFillObject}>
                    <DesktopFileWorkspace
                        sessionId={desktopFileWorkspaceSessionId}
                        paths={desktopFileWorkspace.paths}
                        activePath={desktopFileWorkspace.activePath}
                        references={desktopFileWorkspace.references}
                        dirtyPaths={desktopDirtyPaths}
                        machinePickerOpen={desktopMachinePickerOpen}
                        compact={desktopFileWorkspaceFullscreen}
                        machinePicker={machineWorkspacePicker}
                        onSelect={handleDesktopFileSelect}
                        onRequestClose={handleDesktopFileClose}
                        onFileDeleted={handleDesktopFileDeleted}
                        onOpenMachinePicker={() => {
                            setDesktopMachinePickerTarget(null);
                            setDesktopMachinePickerOpen(true);
                        }}
                        onClosePicker={() => {
                            setDesktopMachinePickerOpen(false);
                            setDesktopMachinePickerTarget(null);
                        }}
                        onDirtyChange={handleDesktopDirtyChange}
                    />
                </View>
            ) : null}
        </View>
    );

    // Wide layout keeps the Main Agent chat mounted beside a stable right-pane
    // host. Side chats and file picking may temporarily own the visible right
    // surface without unmounting dirty file editors.
    return (
        <MobileTypographyFloor active={appliesWebPhoneTypographyFloor}>
            <SessionWorkspaceControllerContext.Provider value={sessionWorkspaceController}>
                <WorkspaceLinkPressContext.Provider
                    value={canUseSessionFileWorkspace ? handleWorkspaceLinkPress : undefined}
                >
                    <DesktopFileWorkspaceSplit
                        workspaceVisible={rightWorkspaceVisible}
                        workspaceFullscreen={rightWorkspaceFullscreen}
                        workspace={workspaceSurface}
                        fallback={canRenderSidebar ? fallbackRightSurface : null}
                    >
                        {chatSurface}
                    </DesktopFileWorkspaceSplit>
                </WorkspaceLinkPressContext.Provider>
            </SessionWorkspaceControllerContext.Provider>
        </MobileTypographyFloor>
    );
});

// Hoisted so AgentInput's React.memo doesn't see a new array ref on every keystroke
const AGENT_INPUT_AUTOCOMPLETE_PREFIXES = ['@', '/'];

// Imperative handle exposed by ChatComposer so SessionViewLoaded can read /
// clear the message text without subscribing to it (which would re-render
// the whole loaded screen on every keystroke).
type ChatComposerHandle = {
    appendTranscript: (transcript: string) => void;
    getMessage: () => string;
    clearMessage: () => void;
    clearSentMessage: (sentMessage: string) => void;
};

function preserveDraftAfterSentSnapshot(currentDraft: string, sentMessage: string): string {
    if (currentDraft === sentMessage) return '';
    if (!sentMessage) return currentDraft;

    // Dictation appends a single space when the existing draft does not end
    // in whitespace. Remove only the exact snapshot that was delivered plus
    // that separator. Any divergent edit is left byte-for-byte intact rather
    // than risking the loss of text entered while delivery was in flight.
    const appendedPrefix = /\s$/.test(sentMessage) ? sentMessage : `${sentMessage} `;
    return currentDraft.startsWith(appendedPrefix)
        ? currentDraft.slice(appendedPrefix.length)
        : currentDraft;
}

type ChatComposerProps = Omit<
    React.ComponentProps<typeof AgentInput>,
    'initialValue' | 'onChangeText'
> & {
    sessionId: string;
    composerHandleRef: React.RefObject<ChatComposerHandle | null>;
};

// Owns the chat-message draft autosave. The textarea itself is uncontrolled:
// keystrokes never round-trip through React state, so the parent can stay
// stable on every keystroke and deletion doesn't batch on a busy main thread.
// `message` here is a low-priority mirror updated via startTransition; it's
// only used to feed useDraft's debounced autosave. Reads/clears on send go
// through the MultiTextInput handle imperatively.
const ChatComposer = React.memo(function ChatComposer(props: ChatComposerProps) {
    const { sessionId, composerHandleRef, ...rest } = props;
    // Synchronously hydrate the textarea with any saved draft so the user sees
    // their work-in-progress on session open without an extra round-trip.
    const initialDraft = React.useMemo(() => {
        return storage.getState().sessions[sessionId]?.draft ?? '';
    }, [sessionId]);
    const inputHandleRef = React.useRef<MultiTextInputHandle>(null);
    const [message, setMessage] = React.useState(initialDraft);

    const applyDraft = React.useCallback((text: string) => {
        inputHandleRef.current?.setTextAndSelection(text, { start: text.length, end: text.length });
        setMessage(text);
    }, []);

    const { clearDraft } = useDraft(sessionId, message, applyDraft);

    const handleChangeText = React.useCallback((text: string) => {
        // Transition keeps the textarea responsive even when the draft
        // autosave / re-render takes longer than a frame.
        React.startTransition(() => setMessage(text));
    }, []);

    React.useImperativeHandle(composerHandleRef, () => ({
        appendTranscript: (transcript: string) => {
            const current = inputHandleRef.current?.getText() ?? '';
            const separator = current.length > 0 && !/\s$/.test(current) ? ' ' : '';
            const next = `${current}${separator}${transcript}`;
            inputHandleRef.current?.setTextAndSelection(next, { start: next.length, end: next.length });
            inputHandleRef.current?.focus();
            setMessage(next);
        },
        getMessage: () => inputHandleRef.current?.getText() ?? '',
        clearMessage: () => {
            inputHandleRef.current?.setTextAndSelection('', { start: 0, end: 0 });
            setMessage('');
            clearDraft();
        },
        clearSentMessage: (sentMessage: string) => {
            const current = inputHandleRef.current?.getText() ?? '';
            const next = preserveDraftAfterSentSnapshot(current, sentMessage);
            inputHandleRef.current?.setTextAndSelection(next, { start: next.length, end: next.length });
            setMessage(next);
            if (!next) clearDraft();
        },
    }), [clearDraft]);

    return (
        <AgentInput
            {...rest}
            ref={inputHandleRef}
            sessionId={sessionId}
            initialValue={initialDraft}
            onChangeText={handleChangeText}
        />
    );
});

export function SessionViewLoaded({
    sessionId,
    session,
    focusMessageId,
    embedded = false,
    onHeaderBackdropVisibilityChange,
}: {
    sessionId: string;
    session: Session;
    focusMessageId?: string;
    embedded?: boolean;
    onHeaderBackdropVisibilityChange?: (visible: boolean) => void;
}) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const safeArea = useSafeAreaInsets();
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    const isTablet = useIsTablet();
    const { width: windowWidth } = useWindowDimensions();
    const isWebMobileSessionViewport = Platform.OS === 'web'
        && deviceType === 'phone'
        && windowWidth < SIDE_CHAT_SIDEBAR_MIN_WINDOW_WIDTH;
    const appliesWebPhoneTypographyFloor = shouldApplyPhoneWebTypographyFloor({
        platform: Platform.OS,
        deviceType,
        windowWidth,
        desktopLayoutMinWidth: SIDE_CHAT_SIDEBAR_MIN_WINDOW_WIDTH,
    });
    const isWebSessionViewport = Platform.OS === 'web';
    const workspaceController = React.useContext(SessionWorkspaceControllerContext);
    const webWorkspaceActions = React.useMemo(() => (
        isWebSessionViewport
        && workspaceController
        && rigCanBrowseFiles(session.metadata)
        && rigCanUseShell(session.metadata)
            ? {
                onOpenChanges: () => workspaceController.openChanges(sessionId),
                onOpenWorkspace: () => workspaceController.openWorkspace(session),
            }
            : undefined
    ), [isWebSessionViewport, session, sessionId, workspaceController]);
    // Only the portrait phone chat uses an overlay dock. Tablet, desktop,
    // landscape, and embedded views retain their existing split layout.
    const usesFloatingMobileDock = !embedded
        && deviceType === 'phone'
        && Platform.OS !== 'web'
        && !isRunningOnMac()
        && !isLandscape;
    const [bottomDockInset, setBottomDockInset] = React.useState(0);
    const [composerY, setComposerY] = React.useState(0);
    // Offset of the composer card inside AgentInput — the faded status rows
    // above it keep their space, so anchoring to the dock top floats the
    // scroll button over a visually empty band.
    const [composerCardOffset, setComposerCardOffset] = React.useState(0);
    const [isChatAtBottom, setIsChatAtBottom] = React.useState(true);
    const showBottomDockDetails = !usesFloatingMobileDock || isChatAtBottom;
    const scrollButtonInset = Math.max(0, bottomDockInset - composerY - composerCardOffset);

    const handleBottomDockInsetChange = React.useCallback((nextInset: number) => {
        setBottomDockInset((currentInset) => (
            Math.abs(currentInset - nextInset) < 1 ? currentInset : nextInset
        ));
    }, []);
    const handleComposerLayout = React.useCallback((event: LayoutChangeEvent) => {
        const nextY = Math.ceil(event.nativeEvent.layout.y);
        setComposerY((currentY) => (
            Math.abs(currentY - nextY) < 1 ? currentY : nextY
        ));
    }, []);
    const handleComposerCardOffsetChange = React.useCallback((offset: number) => {
        const nextOffset = Math.ceil(offset);
        setComposerCardOffset((currentOffset) => (
            Math.abs(currentOffset - nextOffset) < 1 ? currentOffset : nextOffset
        ));
    }, []);
    const handleChatBottomVisibilityChange = React.useCallback((visible: boolean) => {
        setIsChatAtBottom(visible);
    }, []);

    React.useEffect(() => {
        if (!usesFloatingMobileDock) {
            setBottomDockInset(0);
            setComposerY(0);
        }
    }, [usesFloatingMobileDock]);

    React.useEffect(() => {
        setIsChatAtBottom(true);
    }, [sessionId, usesFloatingMobileDock]);

    const realtimeStatus = useRealtimeStatus();
    const { messages, isLoaded } = useSessionMessages(sessionId);
    const queueProjection = React.useMemo(
        () => projectSessionQueue(messages, session.agentState?.messageQueue),
        [messages, session.agentState?.messageQueue],
    );
    const pendingCommunications = useSessionPendingCommunications(sessionId);
    const acknowledgedCliVersions = useLocalSetting('acknowledgedCliVersions');
    const zenMode = useLocalSetting('zenMode');
    const sessionInputHorizontalPadding = Platform.OS === 'web' || isRunningOnMac() || isTablet ? 12 : 8;
    const chatListTopContentInset = embedded || (isLandscape && deviceType === 'phone')
        ? 12
        : deviceType === 'phone' && Platform.OS !== 'web'
            ? safeArea.top
                + MOBILE_GLASS_HEADER_HEIGHT
                + (realtimeStatus !== 'disconnected' ? VOICE_PILL_TOTAL_HEIGHT : 0)
                + 12
            : undefined;

    // Check if CLI version is outdated and not already acknowledged
    const cliVersion = session.metadata?.version;
    const machineId = session.metadata?.machineId;
    const sessionMachine = useMachine(machineId ?? '');
    const isCliOutdated = cliVersion && !isVersionSupported(cliVersion, MINIMUM_CLI_VERSION);
    const isAcknowledged = machineId && acknowledgedCliVersions[machineId] === cliVersion;
    const shouldShowCliWarning = isCliOutdated && !isAcknowledged;
    const flavor = session.metadata?.flavor;
    const isRig = isRigMetadata(session.metadata);
    const isGrok = flavor === 'grok';
    const dshLaunchPermission = flavor === 'dsh'
        && session.metadata?.spawnSettings?.provider === 'dsh'
        ? session.metadata.spawnSettings.permission
        : null;
    const availableModels = React.useMemo(() => (
        getSessionAvailableModels(
            flavor,
            session.metadata,
            sessionMachine?.metadata,
            t,
            session.modelMode ?? (isGrok ? session.metadata?.currentModelCode : undefined),
        )
    ), [flavor, isGrok, session.metadata, session.modelMode, sessionMachine?.metadata]);
    const availableModes = React.useMemo(() => (
        getSessionAvailablePermissionModes(
            flavor,
            session.metadata,
            sessionMachine?.metadata,
            t,
            flavor === 'dsh' ? dshLaunchPermission : session.permissionMode,
        )
    ), [dshLaunchPermission, flavor, session.metadata, session.permissionMode, sessionMachine?.metadata]);
    const [agentDefaultOverrides, setAgentDefaultOverrides] = useSettingMutable('agentDefaultOverrides');
    const effectiveAgentDefaults = React.useMemo(() => (
        resolveAgentDefaultConfig(agentDefaultOverrides, flavor)
    ), [agentDefaultOverrides, flavor]);

    const permissionMode = React.useMemo<PermissionMode | null>(() => {
        if (flavor === 'dsh') {
            if (!dshLaunchPermission) return null;
            return resolveCurrentOption(availableModes, [dshLaunchPermission]) ?? {
                key: dshLaunchPermission,
                name: dshLaunchPermission,
                description: null,
            };
        }
        return resolveCurrentOption(availableModes, isGrok && !isRig
            ? [session.permissionMode, getAdvertisedDefaultOptionKey(availableModes)]
            : [
                session.permissionMode,
                ...(isRig ? [
                session.metadata?.currentOperatingModeCode,
                session.metadata?.permissionMode,
                session.metadata?.session?.permissionMode,
                ] : [
                    (flavor === 'claude' || flavor === 'codex')
                        && session.metadata?.spawnSettings?.provider === flavor
                        ? session.metadata.spawnSettings.permission
                        : undefined,
                    session.metadata?.permissionMode,
                    effectiveAgentDefaults.permissionMode,
                    session.metadata?.currentOperatingModeCode,
                ]),
        ]);
    }, [availableModes, dshLaunchPermission, session.permissionMode, effectiveAgentDefaults.permissionMode, session.metadata?.currentOperatingModeCode, session.metadata?.permissionMode, session.metadata?.session?.permissionMode, isGrok, isRig, flavor]);

    const modelMode = React.useMemo<ModelMode | null>(() => (
        resolveCurrentOption(availableModels, isGrok
            ? [session.modelMode, session.metadata?.currentModelCode]
            : [
                session.modelMode,
                isRig ? getRigCurrentModelOptionKey(session.metadata) : effectiveAgentDefaults.modelMode,
                isRig ? undefined : session.metadata?.currentModelCode,
            ])
    ), [availableModels, session.modelMode, effectiveAgentDefaults.modelMode, session.metadata, isGrok, isRig]);

    // Effort level state
    const modelKey = modelMode?.key ?? 'default';
    const availableEffortLevels = React.useMemo<EffortLevel[]>(() => (
        getSessionEffortLevelsForModel(flavor, modelKey, session.metadata, sessionMachine?.metadata)
    ), [flavor, modelKey, session.metadata, sessionMachine?.metadata]);
    const effectiveEffortDefault = React.useMemo(() => (
        resolveAgentDefaultEffortLevel(agentDefaultOverrides, flavor, availableEffortLevels)
    ), [agentDefaultOverrides, flavor, availableEffortLevels]);
    const effortLevel = React.useMemo<EffortLevel | null>(() => (
        resolveCurrentOption(availableEffortLevels, isGrok
            ? [session.effortLevel, session.metadata?.currentThoughtLevelCode]
            : [
                session.effortLevel,
                isRig ? getRigReasoningSelection(session.metadata, modelKey) : effectiveEffortDefault,
            ])
    ), [availableEffortLevels, session.effortLevel, effectiveEffortDefault, session.metadata, modelKey, isGrok, isRig]);

    // Adopt an explicit effort already stored on an existing Codex session
    // when upgrading from builds that had no synchronized effort preference.
    // Once the user-level preference exists, merely opening an older session
    // must not replace it.
    React.useEffect(() => {
        if (flavor !== 'codex' || !session.effortLevel) return;
        if (!availableEffortLevels.some((level) => level.key === session.effortLevel)) return;
        if (getAgentDefaultOverrideValue(agentDefaultOverrides, 'codex', 'effortLevel') !== undefined) return;
        setAgentDefaultOverrides(setAgentDefaultOverride(
            agentDefaultOverrides,
            'codex',
            'effortLevel',
            session.effortLevel,
        ));
    }, [
        flavor,
        session.effortLevel,
        availableEffortLevels,
        agentDefaultOverrides,
        setAgentDefaultOverrides,
    ]);

    // Never send a stale effort token that the selected model no longer
    // advertises. Preserve the synchronized preference for other models, but
    // normalize this session to its actual model-supported maximum.
    React.useEffect(() => {
        if (flavor !== 'codex' || !session.effortLevel || availableEffortLevels.length === 0) return;
        if (availableEffortLevels.some((level) => level.key === session.effortLevel)) return;
        if (!effectiveEffortDefault) return;
        sessionSetAgentModes(sessionId, { effortLevel: effectiveEffortDefault });
    }, [
        flavor,
        session.effortLevel,
        availableEffortLevels,
        effectiveEffortDefault,
        sessionId,
    ]);

    const sessionStatus = useSessionStatus(session);
    const sessionUsage = useSessionUsage(sessionId);
    const gitStatus = useSessionGitStatus(sessionId);
    const alwaysShowContextSize = useSetting('alwaysShowContextSize');
    const sessionStatusBarDisplay = useSetting('sessionStatusBarDisplay');
    const expImageUpload = useSetting('expImageUpload');
    const {
        canResume,
        resumeSession,
        resumeSessionWithQueuedTurn,
        resumingSession,
    } = useSessionQuickActions(session);
    const isDisconnected = !sessionStatus.isConnected;
    const resumeCommandBlock = getResumeCommandBlock(session);

    // Attachment availability is capability-driven by the active session.
    const { selectedImages, pickImages, pickImagesForUpload, removeImage, clearImages, addImages } = useImagePicker();
    const canUseAttachments = rigCanUseAttachments(session.metadata)
        && supportsImageAttachmentsForFlavor(flavor, session.metadata?.acpCapabilities);
    React.useEffect(() => {
        if (!canUseAttachments && selectedImages.length > 0) {
            clearImages();
        }
    }, [canUseAttachments, selectedImages.length, clearImages]);

    // ChatComposer owns the message state + useDraft subscription. We only
    // hold an imperative handle so handleSend can read the live text and
    // clear it without subscribing to it (which would re-render the whole
    // SessionViewLoaded tree on every keystroke).
    const composerHandleRef = React.useRef<ChatComposerHandle | null>(null);
    const voiceInputAvailability = useVoiceInputAvailability();
    const handleDictationTranscript = React.useCallback((transcript: string) => {
        composerHandleRef.current?.appendTranscript(transcript);
    }, []);
    const voiceDictation = useVoiceDictation(handleDictationTranscript);
    const selectedContextEntries = React.useSyncExternalStore(
        subscribeWorkspaceContext,
        () => getWorkspaceContextEntries(sessionId),
        () => getWorkspaceContextEntries(sessionId),
    );
    const workspaceUploader = useMachineFileUpload({
        machineId,
        directory: session.metadata?.path,
        maxFiles: Math.max(0, MAX_WORKSPACE_CONTEXT_ITEMS - selectedContextEntries.length),
        selectionKey: flavor ?? undefined,
        onUploaded: (filePath, target) => {
            if (!addWorkspaceContextFile(sessionId, filePath, {
                kind: 'machine',
                machineId: target.machineId,
            })) {
                Modal.alert(t("uiCopy.workspaceContext"), t("uiCopy.youCanAttachUpTo8FilesToOneMessage"));
            }
        },
    });
    const dshUploadBusy = flavor === 'dsh'
        && (workspaceUploader.state.phase === 'uploading' || workspaceUploader.state.phase === 'cancelling');
    const canUploadDshPhotos = flavor === 'dsh'
        && Boolean(machineId && session.metadata?.path)
        && selectedContextEntries.length < MAX_WORKSPACE_CONTEXT_ITEMS
        && !dshUploadBusy;
    const handlePickDshPhotos = React.useCallback(async () => {
        if (!canUploadDshPhotos) return;
        const images = await pickImagesForUpload(
            MAX_WORKSPACE_CONTEXT_ITEMS - selectedContextEntries.length,
        );
        await workspaceUploader.uploadAssets(images);
    }, [
        canUploadDshPhotos,
        pickImagesForUpload,
        selectedContextEntries.length,
        workspaceUploader.uploadAssets,
    ]);

    // Handle dismissing CLI version warning
    const handleDismissCliWarning = React.useCallback(() => {
        if (machineId && cliVersion) {
            storage.getState().applyLocalSettings({
                acknowledgedCliVersions: {
                    ...acknowledgedCliVersions,
                    [machineId]: cliVersion
                }
            });
        }
    }, [machineId, cliVersion, acknowledgedCliVersions]);

    const grokPermissionTransitionInFlight = React.useRef(false);

    // Runtime-selectable providers update metadata directly. Grok's mode is a
    // process launch policy, so its exact daemon must restart/resume first and
    // return the receipt that authorizes the visible composer update.
    const updatePermissionMode = React.useCallback((mode: PermissionMode) => {
        if (!isGrok) {
            sessionSetAgentModes(sessionId, { permissionMode: mode.key });
            return;
        }
        if (!machineId || grokPermissionTransitionInFlight.current) return;

        grokPermissionTransitionInFlight.current = true;
        void transitionGrokPermissionModeAndCommit(machineId, sessionId, mode.key, {
            commit: (permissionMode) => {
                sessionSetAgentModes(sessionId, { permissionMode });
            },
        }).catch((error) => {
            Modal.alert(
                t('errors.grokPermissionModeChangeFailed'),
                error instanceof Error ? error.message : String(error),
            );
        }).finally(() => {
            grokPermissionTransitionInFlight.current = false;
        });
    }, [isGrok, machineId, sessionId]);

    const updateModelMode = React.useCallback((mode: ModelMode) => {
        const nextEffortLevels = getSessionEffortLevelsForModel(
            flavor,
            mode.key,
            session.metadata,
            sessionMachine?.metadata,
        );
        const currentEffortSupported = session.effortLevel
            ? nextEffortLevels.some((level) => level.key === session.effortLevel)
            : true;
        const nextEffortDefault = resolveAgentDefaultEffortLevel(
            agentDefaultOverrides,
            flavor,
            nextEffortLevels,
        );
        sessionSetAgentModes(sessionId, {
            modelMode: mode.key,
            ...(!currentEffortSupported ? {
                effortLevel: mode.defaultThinkingLevel ?? nextEffortDefault,
            } : {}),
        });
    }, [sessionId, flavor, session.metadata, session.effortLevel, sessionMachine?.metadata, agentDefaultOverrides]);

    const updateEffortLevel = React.useCallback((level: EffortLevel) => {
        sessionSetAgentModes(sessionId, { effortLevel: level.key });
        if (flavor === 'codex') {
            setAgentDefaultOverrides(setAgentDefaultOverride(
                agentDefaultOverrides,
                'codex',
                'effortLevel',
                level.key,
            ));
        }
    }, [sessionId, flavor, agentDefaultOverrides, setAgentDefaultOverrides]);

    // Memoize header-dependent styles to prevent re-renders
    const headerDependentStyles = React.useMemo(() => ({
        contentContainer: {
            flex: 1
        },
        flatListStyle: {
            marginTop: 0 // No marginTop needed since header is handled by parent
        },
    }), []);

    // Read the live message via the composer ref so this callback does not
    // re-create on every keystroke. Both delivery paths use the same encrypted
    // outbox; the optional metadata only tells an active Codex turn to retain
    // this input in its existing provider queue rather than steer it now.
    const sendComposerMessage = React.useCallback(async (deliveryMode?: 'queue') => {
        if (dshUploadBusy) return;
        const liveMessage = composerHandleRef.current?.getMessage() ?? '';
        if (!liveMessage.trim() && !(expImageUpload && canUseAttachments && selectedImages.length > 0) && selectedContextEntries.length === 0) {
            return;
        }
        try {
            const heartbeatCommand = await HEARTBEAT_COMMAND.dispatch({
                text: liveMessage,
                machineId: machineId ?? '',
                sessionId,
                metadata: session.metadata,
                hasAttachments: selectedImages.length > 0,
                hasWorkspaceContext: selectedContextEntries.length > 0,
                translate: (key, params) => (t as any)(key, params),
                control: async (targetMachineId, action) => {
                    if (!targetMachineId) throw new Error(t('happyHerd.heartbeat.machineUnavailable'));
                    return machineControlHeartbeat(targetMachineId, action);
                },
            });
            if (heartbeatCommand.handled) {
                if (heartbeatCommand.clearComposer) composerHandleRef.current?.clearSentMessage(liveMessage);
                if (heartbeatCommand.message) {
                    Modal.alert(t('happyHerd.heartbeat.title'), heartbeatCommand.message);
                }
                return;
            }
            const contextMessage = await buildWorkspaceContextMessage(
                sessionId,
                liveMessage,
                selectedContextEntries,
                flavor === 'dsh' ? { machineFilesAsReferences: true } : undefined,
            );
            const attachments = expImageUpload && canUseAttachments ? selectedImages : undefined;
            const communicationsToDismiss = deliveryMode ? [] : [...pendingCommunications];
            await deliverSessionTurn({
                isDisconnected,
                canResume,
                sessionLifecycleState: session.metadata?.lifecycleState,
                requestedDeliveryMode: deliveryMode,
                awaitDelivery: communicationsToDismiss.length > 0,
                deliver: (continuation) => sync.sendMessage(sessionId, contextMessage.promptText, {
                    source: 'chat',
                    attachments,
                    ...(selectedContextEntries.length > 0 ? { displayText: contextMessage.displayText } : {}),
                    ...(continuation.deliveryMode ? { deliveryMode: continuation.deliveryMode } : {}),
                    awaitDelivery: continuation.awaitDelivery,
                }),
                resume: resumeSessionWithQueuedTurn,
            });
            composerHandleRef.current?.clearSentMessage(liveMessage);
            if (expImageUpload && canUseAttachments) clearImages();
            clearWorkspaceContextFiles(sessionId);
            const dismissals = await Promise.allSettled(communicationsToDismiss.map((communication) => (
                sessionCancelCommunication(sessionId, communication.id, communication.kind)
            )));
            for (const dismissal of dismissals) {
                if (dismissal.status === 'rejected') {
                    console.error('Failed to dismiss an agent question:', dismissal.reason);
                }
            }
        } catch (error) {
            Modal.alert(
                t('happyHerd.composer.sendFailedTitle'),
                error instanceof Error ? error.message : t('happyHerd.composer.sendFailedBody'),
            );
        }
    }, [
        sessionId,
        machineId,
        expImageUpload,
        canUseAttachments,
        selectedImages,
        selectedContextEntries,
        dshUploadBusy,
        flavor,
        clearImages,
        pendingCommunications,
        isDisconnected,
        canResume,
        session.metadata?.lifecycleState,
        resumeSessionWithQueuedTurn,
    ]);
    const handleSend = React.useCallback(() => sendComposerMessage(), [sendComposerMessage]);
    const handleQueueMessage = React.useCallback(() => sendComposerMessage('queue'), [sendComposerMessage]);

    const handleAbort = React.useCallback(() => {
        // Claude and Codex reset their turn-scoped permission override after an
        // abort. Grok's launch policy, Antigravity's per-session child policy,
        // and the retired Gemini runtime selection all persist across aborts;
        // clearing those would make the picker disagree with the next turn.
        if (!isRig && (flavor === null || flavor === undefined || flavor === 'claude' || flavor === 'codex')) {
            sessionSetAgentModes(sessionId, { permissionMode: null });
        }
        sessionAbort(sessionId);
    }, [flavor, isRig, sessionId]);

    const handleAutocompleteSuggestions = React.useCallback((query: string) => (
        getSuggestions(sessionId, query, t)
    ), [sessionId]);

    const connectionStatus = React.useMemo(() => ({
        text: sessionStatus.statusText,
        color: sessionStatus.statusColor,
        dotColor: sessionStatus.statusDotColor,
        isPulsing: sessionStatus.isPulsing,
    }), [sessionStatus.statusText, sessionStatus.statusColor, sessionStatus.statusDotColor, sessionStatus.isPulsing]);

    const usageData = React.useMemo(() => {
        const source = sessionUsage ?? session.latestUsage;
        if (!source) return undefined;
        return {
            inputTokens: source.inputTokens,
            outputTokens: source.outputTokens,
            cacheCreation: source.cacheCreation,
            cacheRead: source.cacheRead,
            contextSize: source.contextSize,
            contextWindow: source.contextWindow,
        };
    }, [sessionUsage, session.latestUsage]);
    const metadataGitBranch = React.useMemo(() => {
        const gitBranch = (session.metadata as { gitBranch?: unknown } | null)?.gitBranch;
        return typeof gitBranch === 'string' && gitBranch.trim() ? gitBranch.trim() : null;
    }, [session.metadata]);
    const statusBarGitBranch = resolveStatusBarGitBranch(gitStatus?.branch, metadataGitBranch);
    const statusBarModelLabel = modelMode?.name ?? session.metadata?.currentModelCode ?? session.modelMode ?? null;
    const statusBarEffortLabel = effortLevel?.name
        ? effortLevel.name.charAt(0).toUpperCase() + effortLevel.name.slice(1)
        : null;
    // Same source and fallback chain as the session list rows.
    const statusBarGitChanges = React.useMemo(() => {
        const liveInsertions = gitStatus?.unstagedLinesAdded ?? 0;
        const liveDeletions = gitStatus?.unstagedLinesRemoved ?? 0;
        if (liveInsertions > 0 || liveDeletions > 0) {
            return { approximate: false, insertions: liveInsertions, deletions: liveDeletions };
        }
        const rigGit = getRigGitSummary(session.metadata);
        if (rigGit && rigGit.changedFiles !== null) {
            return visibleRigGitLineChanges({
                changedFiles: rigGit.changedFiles,
                countsExact: rigGit.countsExact ?? true,
                deletions: rigGit.deletions ?? 0,
                insertions: rigGit.insertions ?? 0,
            });
        }
        return null;
    }, [gitStatus?.unstagedLinesAdded, gitStatus?.unstagedLinesRemoved, session.metadata]);

    const visibleAgentGoal = React.useMemo(() => (
        resolveVisibleAgentGoalStatus(session)
    ), [
        session.agentState?.agentGoalStatus,
        session.presence,
        session.metadata?.claudeSessionId,
        session.metadata?.codexThreadId,
    ]);
    const [goalActionInFlight, setGoalActionInFlight] = React.useState<AgentGoalAction | null>(null);
    const handleGoalAction = React.useCallback(async (action: AgentGoalAction) => {
        await performAgentGoalAction({
            action,
            currentGoalText: visibleAgentGoal?.text ?? '',
            promptEditGoal: (currentGoalText) => Modal.prompt(t('components.agentGoalBar.editGoal'), undefined, {
                placeholder: t('components.agentGoalBar.currentGoal'),
                defaultValue: currentGoalText,
                cancelText: t('common.cancel'),
                confirmText: t('common.save'),
            }),
            dispatchGoalAction: (nextAction, objective) => sessionGoalAction(sessionId, nextAction, objective),
            setInFlight: setGoalActionInFlight,
            onError: (error) => console.error('Failed to perform goal action', error),
        });
    }, [sessionId, visibleAgentGoal?.text]);

    // A separately active realtime conversation continues to use its header
    // pill. The composer microphone is reserved for OpenAI dictation.
    const voiceSessionActive = realtimeStatus === 'connected' || realtimeStatus === 'connecting';

    // Track route visibility only. App foregrounding and socket reconnects
    // reconcile the current conversation inside Sync without remounting it.
    React.useLayoutEffect(() => {

        // Trigger session sync
        sync.onSessionVisible(sessionId);

        // Mark session as currently being viewed (clears unread). Skipped when
        // embedded (e.g. the side-chat panel) so a second mounted chat body
        // doesn't steal "currently viewing" from the primary session.
        if (!embedded) {
            storage.getState().setCurrentViewingSession(sessionId);
        }

        // Initialize git status sync for this session
        gitStatusSync.getSync(sessionId).invalidate();

        return () => {
            if (embedded) {
                return;
            }
            // Clear viewing session on unmount
            const current = storage.getState().currentViewingSessionId;
            if (current === sessionId) {
                storage.getState().setCurrentViewingSession(null);
            }
        };
    }, [sessionId, embedded]);

    let content = (
        <>
            <Deferred>
                {messages.length > 0 && (
                    <ChatList
                        session={session}
                        focusMessageId={focusMessageId}
                        topContentInset={chatListTopContentInset}
                        bottomContentInset={usesFloatingMobileDock ? bottomDockInset : undefined}
                        scrollButtonInset={usesFloatingMobileDock ? scrollButtonInset : undefined}
                        headerOverlayHeight={safeArea.top + MOBILE_GLASS_HEADER_HEIGHT}
                        onHeaderBackdropVisibilityChange={onHeaderBackdropVisibilityChange}
                        onBottomDockVisibilityChange={usesFloatingMobileDock
                            ? handleChatBottomVisibilityChange
                            : undefined}
                    />
                )}
            </Deferred>
        </>
    );
    const placeholder = messages.length === 0 ? (
        <>
            {isLoaded ? (
                <EmptyMessages session={session} />
            ) : (
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            )}
        </>
    ) : null;

    const composer = (
        <View onLayout={usesFloatingMobileDock ? handleComposerLayout : undefined}>
            <MachineFileUploadStatus
                state={workspaceUploader.state}
                canCancel={workspaceUploader.canCancel}
                canRetry={workspaceUploader.canRetry}
                onCancel={workspaceUploader.cancel}
                onRetry={() => void workspaceUploader.retry()}
                style={{ paddingHorizontal: sessionInputHorizontalPadding, paddingBottom: 4 }}
            />
            <ChatComposer
                composerHandleRef={composerHandleRef}
                placeholder={t('session.inputPlaceholder')}
                sessionId={sessionId}
                permissionMode={permissionMode}
                permissionModeReadOnly={flavor === 'dsh' && permissionMode !== null}
                onPermissionModeChange={flavor !== 'dsh' && isRigPermissionSelectionEnabled(session.metadata)
                    && (!isGrok || Boolean(machineId && sessionMachine))
                    ? updatePermissionMode
                    : undefined}
                availableModes={availableModes}
                modelMode={modelMode}
                availableModels={availableModels}
                onModelModeChange={isRigModelSelectionEnabled(session.metadata) ? updateModelMode : undefined}
                effortLevel={effortLevel}
                availableEffortLevels={availableEffortLevels}
                onEffortLevelChange={isRigReasoningSelectionEnabled(session.metadata) ? updateEffortLevel : undefined}
                metadata={session.metadata}
                connectionStatus={connectionStatus}
                blockSend={isRig && session.thinking && session.metadata?.capabilities?.steering !== true}
                isSendDisabled={dshUploadBusy}
                onSend={handleSend}
                onQueueMessage={handleQueueMessage}
                showWebActionMenu={isWebSessionViewport}
                webWorkspaceActions={webWorkspaceActions}
                onMicPress={(voiceDictation.phase !== 'recording'
                    && (voiceSessionActive || !voiceInputAvailability.available))
                    ? undefined
                    : voiceDictation.toggle}
                dictationPhase={voiceDictation.phase}
                dictationError={voiceDictation.error}
                onDictationCancel={voiceDictation.cancel}
                onDictationRetry={voiceDictation.canRetry ? voiceDictation.retry : undefined}
                onAbort={isDisconnected || !rigCanAbort(session.metadata) ? undefined : handleAbort}
                showAbortButton={rigCanAbort(session.metadata) && (
                    sessionStatus.state === 'thinking'
                    // A pending selection or permission request parks the agent inside
                    // a tool call. Keep Stop reachable on every platform while either
                    // kind of user action is outstanding.
                    || sessionStatus.state === 'permission_required'
                    || sessionStatus.state === 'input_required'
                    || (Platform.OS === 'web' && sessionStatus.state === 'waiting')
                )}
                selectedImages={expImageUpload && canUseAttachments ? selectedImages : undefined}
                onPickImages={expImageUpload && canUseAttachments
                    ? pickImages
                    : canUploadDshPhotos
                        ? handlePickDshPhotos
                        : undefined}
                onPickDeviceFiles={machineId
                    && session.metadata?.path
                    && selectedContextEntries.length < MAX_WORKSPACE_CONTEXT_ITEMS
                    && workspaceUploader.state.phase !== 'uploading'
                    && workspaceUploader.state.phase !== 'cancelling'
                    ? () => void workspaceUploader.pickAndUpload()
                    : undefined}
                splitWebAttachmentActions={flavor === 'dsh'}
                onRemoveImage={expImageUpload && canUseAttachments ? removeImage : undefined}
                onAddImages={expImageUpload && canUseAttachments ? addImages : undefined}
                selectedContextEntries={selectedContextEntries}
                onRemoveContextEntry={(entry) => removeWorkspaceContextEntry(sessionId, entry)}
                autocompletePrefixes={AGENT_INPUT_AUTOCOMPLETE_PREFIXES}
                autocompleteSuggestions={handleAutocompleteSuggestions}
                usageData={usageData}
                alwaysShowContextSize={alwaysShowContextSize}
                zenMode={zenMode}
                showStatusDetails={showBottomDockDetails}
                sessionStatusGitBranch={statusBarGitBranch}
                sessionStatusGitChanges={statusBarGitChanges}
                sessionStatusUsageLimits={session.agentState?.usageLimits ?? null}
                onActionAreaOffsetChange={usesFloatingMobileDock ? handleComposerCardOffsetChange : undefined}
            />
        </View>
    );

    // Disconnected sessions get the full Resume affordance regardless of
    // whether they were explicitly archived or just lost their CLI (e.g.
    // Ctrl-C in terminal — lifecycleState stays 'running', server flips
    // active=false). InactiveArchivedHint handles both cases: shows the
    // Resume button when canResume is true, falls back to the
    // copy-this-command hint when the daemon is incompatible or the machine
    // isn't reachable.
    const inactiveHint = isDisconnected && !isRig ? (
        <AnimatedFade visible={showBottomDockDetails}>
            <CenteredInputWidth horizontalPadding={sessionInputHorizontalPadding}>
                <InactiveArchivedHint
                    resumeCommandBlock={resumeCommandBlock}
                    canResume={canResume}
                    resuming={resumingSession}
                    onResume={resumeSession}
                />
            </CenteredInputWidth>
        </AnimatedFade>
    ) : null;

    const showSessionStatusBar = sessionStatusBarDisplay === 'above' || sessionStatusBarDisplay === 'below';
    const sessionStatusBarPosition = sessionStatusBarDisplay === 'above' ? 'above' : 'below';
    const sessionStatusBar = showSessionStatusBar ? (
        <AnimatedFade visible={showBottomDockDetails}>
            <CenteredInputWidth horizontalPadding={sessionInputHorizontalPadding}>
                <SessionStatusBar
                    gitBranch={statusBarGitBranch}
                    modelLabel={statusBarModelLabel}
                    modelMode={modelMode}
                    availableModels={availableModels}
                    onModelModeChange={isRigModelSelectionEnabled(session.metadata) ? updateModelMode : undefined}
                    effortLabel={statusBarEffortLabel}
                    effortLevel={effortLevel}
                    availableEffortLevels={availableEffortLevels}
                    onEffortLevelChange={isRigReasoningSelectionEnabled(session.metadata) ? updateEffortLevel : undefined}
                    contextSize={usageData?.contextSize}
                    contextWindow={usageData?.contextWindow}
                    usageLimits={session.agentState?.usageLimits}
                />
            </CenteredInputWidth>
        </AnimatedFade>
    ) : null;

    const input = (
        <>
            <CenteredInputWidth horizontalPadding={sessionInputHorizontalPadding}>
                <ProviderContinuationLinks session={session} />
            </CenteredInputWidth>
            {inactiveHint}
            {visibleAgentGoal && (
                <AnimatedFade visible={showBottomDockDetails}>
                    <CenteredInputWidth horizontalPadding={sessionInputHorizontalPadding}>
                        <AgentGoalBar
                            goal={visibleAgentGoal}
                            onAction={handleGoalAction}
                            inFlightAction={goalActionInFlight}
                        />
                    </CenteredInputWidth>
                </AnimatedFade>
            )}
            <AnimatedFade visible={showBottomDockDetails}>
                <CenteredInputWidth horizontalPadding={sessionInputHorizontalPadding}>
                    <AgentQuestionBanner sessionId={sessionId} />
                </CenteredInputWidth>
            </AnimatedFade>
            {sessionStatusBarPosition === 'above' ? sessionStatusBar : null}
            <AnimatedFade visible={showBottomDockDetails}>
                <RigActivityBar metadata={session.metadata} />
            </AnimatedFade>
            <CenteredInputWidth horizontalPadding={sessionInputHorizontalPadding}>
                <QueuedMessagesPanel projection={queueProjection} />
            </CenteredInputWidth>
            {composer}
            {sessionStatusBarPosition === 'below' ? sessionStatusBar : null}
        </>
    );


    return (
        <>
            {/* CLI Version Warning Overlay - Subtle centered pill */}
            {shouldShowCliWarning && !(isLandscape && deviceType === 'phone') && (
                <Pressable
                    onPress={handleDismissCliWarning}
                    style={{
                        position: 'absolute',
                        top: 8, // Position at top of content area (padding handled by parent)
                        alignSelf: 'center',
                        backgroundColor: '#FFF3CD',
                        borderRadius: 100, // Fully rounded pill
                        paddingHorizontal: 14,
                        paddingVertical: 7,
                        flexDirection: 'row',
                        alignItems: 'center',
                        zIndex: 998, // Below voice bar but above content
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.15,
                        shadowRadius: 4,
                        elevation: 4,
                    }}
                >
                    <Ionicons name="warning-outline" size={14} color="#FF9500" style={{ marginRight: 6 }} />
                    <Text style={{
                        fontSize: 12,
                        color: '#856404',
                        fontWeight: '600'
                    }}>
                        {t('sessionInfo.cliVersionOutdated')}
                    </Text>
                    <Ionicons name="close" size={14} color="#856404" style={{ marginLeft: 8 }} />
                </Pressable>
            )}

            {/* Main content area - no padding since header is overlay */}
            <MobileTypographyFloor active={embedded && appliesWebPhoneTypographyFloor}>
                <View style={{
                    flexBasis: 0,
                    flexGrow: 1,
                    // The floating chat content reaches the physical bottom of
                    // the screen. AgentContentView keeps the dock itself above
                    // the home indicator / navigation area.
                    paddingBottom: usesFloatingMobileDock
                        ? 0
                        : safeArea.bottom + ((isRunningOnMac() || Platform.OS === 'web') ? 8 : 0),
                }}>
                    <AgentContentView
                        content={content}
                        input={input}
                        placeholder={placeholder}
                        floatingDock={usesFloatingMobileDock}
                        onDockInsetChange={handleBottomDockInsetChange}
                    />
                </View >
            </MobileTypographyFloor>

            {/* Back button for landscape phone mode when header is hidden */}
            {
                isLandscape && deviceType === 'phone' && (
                    <Pressable
                        onPress={() => isWebMobileSessionViewport
                            ? router.dismissTo('/')
                            : router.back()}
                        style={{
                            position: 'absolute',
                            top: safeArea.top + 8,
                            left: 16,
                            width: 44,
                            height: 44,
                            borderRadius: 22,
                            backgroundColor: `rgba(${theme.dark ? '28, 23, 28' : '255, 255, 255'}, 0.9)`,
                            alignItems: 'center',
                            justifyContent: 'center',
                            ...Platform.select({
                                ios: {
                                    shadowColor: '#000',
                                    shadowOffset: { width: 0, height: 2 },
                                    shadowOpacity: 0.1,
                                    shadowRadius: 4,
                                },
                                android: {
                                    elevation: 2,
                                }
                            }),
                        }}
                        hitSlop={15}
                    >
                        <Ionicons
                            name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
                            size={Platform.select({ ios: 28, default: 24 })}
                            color="#000"
                        />
                    </Pressable>
                )
            }
        </>
    )
}

function InactiveArchivedHint(props: {
    resumeCommandBlock: NonNullable<ReturnType<typeof getResumeCommandBlock>> | null;
    canResume: boolean;
    resuming: boolean;
    onResume: () => void;
}) {
    const { theme } = useUnistyles();
    const hintTextStyle = {
        color: theme.colors.agentEventText,
        fontSize: 13,
        lineHeight: 18,
        textAlign: 'left' as const,
    };

    return (
        <View style={{
            paddingTop: 12,
            paddingBottom: 10,
            gap: 10,
            alignItems: 'stretch',
        }}>
            <View style={{ paddingHorizontal: 8, gap: 4 }}>
                <Text style={hintTextStyle}>
                    {t('session.inactiveArchived')}
                </Text>
                {props.canResume ? null : props.resumeCommandBlock && (
                    <Text style={hintTextStyle}>
                        {t('session.resumeFromTerminal')}
                    </Text>
                )}
            </View>
            {props.canResume ? (
                <Pressable
                    onPress={props.onResume}
                    disabled={props.resuming}
                    style={({ pressed }) => ({
                        height: Platform.select({ web: 40, default: 44 }),
                        borderRadius: Platform.select({ web: 10, default: 18 }),
                        backgroundColor: Platform.select({
                            web: theme.colors.button.primary.background,
                            default: pressed ? theme.colors.surfacePressed : theme.colors.surfaceHigh,
                        }),
                        borderWidth: Platform.select({ web: 0, default: StyleSheet.hairlineWidth }),
                        borderColor: theme.colors.divider,
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: props.resuming ? 0.6 : Platform.OS === 'web' && pressed ? 0.8 : 1,
                        marginHorizontal: 8,
                    })}
                >
                    {props.resuming ? (
                        <ActivityIndicator size="small" color={Platform.select({ web: theme.colors.button.primary.tint, default: theme.colors.text })} />
                    ) : (
                        <Text style={{ color: Platform.select({ web: theme.colors.button.primary.tint, default: theme.colors.text }), fontSize: 15, fontWeight: '600' }}>
                            {t('sessionInfo.resumeSession')}
                        </Text>
                    )}
                </Pressable>
            ) : props.resumeCommandBlock && (
                <ResumeCommandCopyBlock resumeCommandBlock={props.resumeCommandBlock} />
            )}
        </View>
    );
}

function ResumeCommandCopyBlock({ resumeCommandBlock }: {
    resumeCommandBlock: NonNullable<ReturnType<typeof getResumeCommandBlock>>;
}) {
    const { theme } = useUnistyles();
    const [copied, setCopied] = React.useState(false);

    return (
        <Pressable
            onPress={async () => {
                await Clipboard.setStringAsync(resumeCommandBlock.copyText);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            }}
            style={({ pressed }) => ({
                minHeight: 48,
                borderRadius: Platform.select({ web: 14, default: 18 }),
                backgroundColor: Platform.select({
                    web: theme.colors.surfaceHigh,
                    default: pressed ? theme.colors.surfacePressed : theme.colors.surface,
                }),
                borderWidth: Platform.select({ web: 0, default: StyleSheet.hairlineWidth }),
                borderColor: theme.colors.divider,
                flexDirection: 'row',
                gap: 8,
                paddingHorizontal: 16,
                paddingVertical: 12,
                alignItems: 'flex-start',
            })}
        >
            <View style={{ flex: 1 }}>
                {resumeCommandBlock.lines.map((line, index) => (
                    <Text
                        key={`${line}-${index}`}
                        style={{
                            color: theme.colors.text,
                            fontSize: 13,
                            lineHeight: 18,
                            fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                        }}
                    >
                        {line}
                    </Text>
                ))}
            </View>
            <Ionicons
                name={copied ? 'checkmark' : 'copy-outline'}
                size={16}
                color={copied ? '#30D158' : theme.colors.textSecondary}
                style={{ marginTop: 1 }}
            />
        </Pressable>
    );
}

function CenteredInputWidth(props: {
    children: React.ReactNode;
    horizontalPadding: number;
}) {
    return (
        <View style={{
            width: '100%',
            paddingHorizontal: props.horizontalPadding,
            alignItems: 'center',
        }}>
            <View style={{
                width: '100%',
                maxWidth: layout.maxWidth,
            }}>
                {props.children}
            </View>
        </View>
    );
}
