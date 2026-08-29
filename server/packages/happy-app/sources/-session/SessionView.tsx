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
import { Deferred } from '@/components/Deferred';
import { EmptyMessages } from '@/components/EmptyMessages';
import { SessionStatusBar } from '@/components/SessionStatusBar';
import { Avatar } from '@/components/Avatar';
import { VoiceAssistantStatusBar, VOICE_PILL_TOTAL_HEIGHT } from '@/components/VoiceAssistantStatusBar';
import { useDraft } from '@/hooks/useDraft';
import { useImagePicker } from '@/hooks/useImagePicker';
import { useMachineFileUpload } from '@/hooks/useMachineFileUpload';
import { Modal } from '@/modal';
import { voiceHooks } from '@/realtime/hooks/voiceHooks';
import { getCurrentVoiceConversationId, getCurrentVoiceSessionDurationSeconds, startRealtimeSession, stopRealtimeSession } from '@/realtime/RealtimeSession';
import { gitStatusSync } from '@/sync/gitStatusSync';
import { machineControlHeartbeat, machineStopSession, sessionAbort, sessionCancelCommunication, sessionGoalAction, sessionSetAgentModes, spawnSideChat, sessionKill, sessionArchive } from '@/sync/ops';
import { closeSideChatSession, resolveSideChatCloseReconciliation } from '@/sync/sideChatLifecycle';
import { storage, useIsDataReady, useLocalSetting, useMachine, useRealtimeStatus, useSessionGitStatus, useSessionMessages, useSessionPendingCommunications, useSessionUsage, useSetting, useSettingMutable, useSideChatSessions } from '@/sync/storage';
import { useSession } from '@/sync/storage';
import { getSessionForkSource } from '@/utils/sessionFork';
import { useHappyAction } from '@/hooks/useHappyAction';
import { HappyError } from '@/utils/errors';
import { Session } from '@/sync/storageTypes';
import { sync } from '@/sync/sync';
import { supportsImageAttachmentsForFlavor } from '@/sync/attachmentSupport';
import { t } from '@/text';
import { tracking } from '@/track';
import { getVoiceMessageCount, getVoiceOnboardingPromptLoadCount } from '@/sync/persistence';
import { isRunningOnMac } from '@/utils/platform';
import { useDeviceType, useHeaderHeight, useIsLandscape, useIsTablet } from '@/utils/responsive';
import { resolveStatusBarGitBranch } from '@/utils/sessionStatusBar';
import { visibleRigGitLineChanges } from '@/utils/rigGitLineChanges';
import { FilesSidebar, SidebarMode } from '@/components/FilesSidebar';
import { SideChatAccessButton, SideChatFullscreen } from '@/components/SideChatPanel';
import {
    resolveActiveSideChatId,
    resolveSideChatSelectionAfterClose,
    resolveSessionSidebarPresentation,
    shouldShowLandscapeSideChatAccess,
} from '@/components/sideChatPresentation';
import { AllFilesDiffView } from '@/components/AllFilesDiffView';
import { FileViewPanel } from '@/components/FileViewPanel';
import { prefetchPierreDiff } from '@/components/diff/PierreDiffView';
import { GitFileStatus } from '@/sync/gitStatusFiles';
import { useOverlayNav } from '@/-session/sessionOverlayNav';
import { formatPathRelativeToHome, getResumeCommandBlock, getSessionAvatarId, getSessionName, useSessionStatus } from '@/utils/sessionUtils';
import { useSessionQuickActions } from '@/hooks/useSessionQuickActions';
import { isVersionSupported, MINIMUM_CLI_VERSION } from '@/utils/versionUtils';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
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
import { buildWorkspaceAttachmentParams } from '@/utils/machineWorkspace';
import { projectSessionQueue } from '@/sync/queueProjection';
import { WorkspaceLinkSidePanel } from '@/components/WorkspaceLinkSidePanel';
import {
    resolveActiveWorkspaceLinkPresentation,
    resolveWorkspaceLinkPresentation,
} from '@/components/WorkspaceLinkViewerModel';
import {
    openWorkspaceLinkFromSession,
    useWorkspaceLinkDismissGuard,
    WorkspaceLinkPressContext,
} from './workspaceLinkNavigation';
import type { WorkspaceLinkRoute } from '@/utils/markdownWorkspaceLink';
import { AnimatedFade } from '@/components/AnimatedOverlay';
import { HEARTBEAT_COMMAND } from '@/utils/heartbeatCommand';
import { deliverSessionTurn } from '@/utils/sessionContinuation';

export const SessionView = React.memo((props: { id: string; focusMessageId?: string }) => {
    const sessionId = props.id;
    const router = useRouter();
    const session = useSession(sessionId);
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
    const fileDiffsSidebarEnabled = useSetting('fileDiffsSidebar');
    const zenMode = useLocalSetting('zenMode');
    const [headerBackdropVisible, setHeaderBackdropVisible] = React.useState(false);
    const workspaceLinkPresentation = resolveWorkspaceLinkPresentation({
        width: windowWidth,
        platform: Platform.OS,
        runningOnMac: isRunningOnMac(),
    });
    const [workspaceLinkRoute, setWorkspaceLinkRoute] = React.useState<WorkspaceLinkRoute | null>(null);
    const activeWorkspaceLinkPresentation = resolveActiveWorkspaceLinkPresentation(
        workspaceLinkPresentation,
        workspaceLinkRoute !== null,
    );
    const {
        sendingRef: workspaceLinkFeedbackSendingRef,
        onSendingChange: onWorkspaceLinkFeedbackSendingChange,
        reset: resetWorkspaceLinkDismissGuard,
    } = useWorkspaceLinkDismissGuard();
    const [focusMessageId, setFocusMessageId] = React.useState<string | undefined>(props.focusMessageId);

    React.useEffect(() => {
        resetWorkspaceLinkDismissGuard();
        setWorkspaceLinkRoute(null);
    }, [resetWorkspaceLinkDismissGuard, sessionId]);

    React.useEffect(() => {
        setFocusMessageId(props.focusMessageId);
    }, [props.focusMessageId]);

    React.useEffect(() => {
        setHeaderBackdropVisible(false);
    }, [sessionId]);

    const showWorkspaceLinkPanel = activeWorkspaceLinkPresentation === 'side-panel' && workspaceLinkRoute !== null;
    const sidebarPresentation = resolveSessionSidebarPresentation({
        platform: Platform.OS,
        runningOnMac: isRunningOnMac(),
        windowWidth,
        zenMode,
        workspaceLinkPanelOpen: showWorkspaceLinkPanel,
        fileDiffsSidebarEnabled,
        canUseFilePanels: !session
            || (rigCanBrowseFiles(session.metadata) && rigCanUseShell(session.metadata)),
    });
    const canShowFileSidebar = sidebarPresentation.fileSidebarAvailable && isDataReady && !!session;
    const canShowSideChatSidebar = sidebarPresentation.sideChatSidebarAvailable && isDataReady && !!session;

    // Match left sidebar width: 30% of window, clamped to 250–360px
    const sidebarWidth = Math.min(Math.max(Math.floor(windowWidth * 0.3), 250), 360);

    // Sidebar panels are user-managed and persisted in local settings so the
    // layout (which panels are open + which is active) survives reloads and
    // long absences. State is device-local, shared across sessions.
    const sidebarPanelsOpen = useLocalSetting('sidebarPanelsOpen') as SidebarMode[];
    const sidebarPanelActiveRaw = useLocalSetting('sidebarPanelActive') as SidebarMode | null;
    // Guard against an inconsistent persisted value: the active panel must be
    // one of the open panels, otherwise fall back to the last opened (or none).
    const sidebarPanelActive = React.useMemo<SidebarMode | null>(() => {
        if (sidebarPanelActiveRaw && sidebarPanelsOpen.includes(sidebarPanelActiveRaw)) {
            return sidebarPanelActiveRaw;
        }
        return sidebarPanelsOpen[sidebarPanelsOpen.length - 1] ?? null;
    }, [sidebarPanelActiveRaw, sidebarPanelsOpen]);

    const openSidebarPanel = React.useCallback((panel: SidebarMode) => {
        const cur = storage.getState().localSettings.sidebarPanelsOpen as SidebarMode[];
        const open = cur.includes(panel) ? cur : [...cur, panel];
        storage.getState().applyLocalSettings({ sidebarPanelsOpen: open, sidebarPanelActive: panel });
    }, []);
    const selectSidebarPanel = React.useCallback((panel: SidebarMode) => {
        const cur = storage.getState().localSettings.sidebarPanelsOpen as SidebarMode[];
        if (cur.includes(panel)) {
            storage.getState().applyLocalSettings({ sidebarPanelActive: panel });
        }
    }, []);
    // Panel removal is always a non-destructive collapse. Side-chat teardown is
    // owned only by each child tab's explicit close action.
    const removeSidebarPanel = React.useCallback((panel: SidebarMode) => {
        const state = storage.getState().localSettings;
        const open = (state.sidebarPanelsOpen as SidebarMode[]).filter((p) => p !== panel);
        const active = state.sidebarPanelActive === panel
            ? (open[open.length - 1] ?? null)
            : (state.sidebarPanelActive as SidebarMode | null);
        storage.getState().applyLocalSettings({ sidebarPanelsOpen: open, sidebarPanelActive: active });
    }, []);

    // Side chats live inside the single "sideChat" panel as switchable tabs.
    // Creation is unified into the sidebar panel picker (the top "+") so there
    // is no separate per-tab add button. Which side chat is focused lives here
    // (not in the panel) so the picker can create-and-focus a new one in one go.
    const rawSideChats = useSideChatSessions(sessionId);
    const sideChatForkSource = session ? getSessionForkSource(session) : null;
    const [activeSideChatId, setActiveSideChatId] = React.useState<string | null>(null);
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

    // Hydrated CLI-created children have no local UI selection. Focus the
    // newest one without creating another, and remove stale empty panel state.
    React.useEffect(() => {
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
    }, [activeSideChatId, removeSidebarPanel, sideChatIds, sidebarPanelsOpen]);

    const sideChatSidebarExpanded = sidebarPresentation.sideChatSurface === 'sidebar'
        && sidebarPanelActive === 'sideChat'
        && sideChats.length > 0;
    const showSidebar = !zenMode
        && !showWorkspaceLinkPanel
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

    const toggleSideChats = React.useCallback(() => {
        const focusId = resolveActiveSideChatId(sideChatIds, activeSideChatId);
        if (!focusId) return;
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
    }, [activeSideChatId, openSidebarPanel, removeSidebarPanel, sideChatIds, sideChatSidebarExpanded, sidebarPresentation.sideChatSurface]);

    React.useEffect(() => {
        if (
            sideChatFullscreenOpen
            && sidebarPresentation.sideChatSurface === 'sidebar'
            && sideChats.length > 0
        ) {
            setSideChatFullscreenOpen(false);
            openSidebarPanel('sideChat');
        }
    }, [openSidebarPanel, sideChatFullscreenOpen, sideChats.length, sidebarPresentation.sideChatSurface]);

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

    const [creatingSideChat, createSideChat] = useHappyAction(async () => {
        if (!sideChatForkSource) {
            throw new HappyError(t('sideChat.unavailable'), false);
        }
        const result = await spawnSideChat(sideChatForkSource);
        if (result.type === 'error') {
            throw new HappyError(result.errorMessage, true);
        }
        if (result.type === 'success') {
            setActiveSideChatId(result.sessionId);
            if (sidebarPresentation.sideChatSurface === 'sidebar') {
                openSidebarPanel('sideChat');
            } else {
                setSideChatFullscreenOpen(true);
            }
        }
    });

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
        | { kind: 'diff'; file: string }
        | { kind: 'file'; path: string };
    const [overlayHistory, setOverlayHistory] = React.useState<{ stack: OverlayEntry[]; cursor: number }>(
        { stack: [{ kind: 'none' }], cursor: 0 }
    );
    const overlayCurrent = overlayHistory.stack[overlayHistory.cursor] ?? { kind: 'none' };
    const diffViewOpen = overlayCurrent.kind === 'diff';
    const fileViewPath = overlayCurrent.kind === 'file' ? overlayCurrent.path : null;
    const scrollToFile = overlayCurrent.kind === 'diff' ? overlayCurrent.file : null;
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
        openWorkspaceLinkFromSession({
            route,
            sessionId,
            feedbackSending: workspaceLinkFeedbackSendingRef.current,
            withFileDiscardConfirmation,
            pushRoute: (nextRoute) => router.push(nextRoute),
            showSidePanel: setWorkspaceLinkRoute,
        });
    }, [router, sessionId, withFileDiscardConfirmation]);

    const handleSidebarFilePress = React.useCallback((file: GitFileStatus) => {
        if (file.status === 'deleted') return;
        withFileDiscardConfirmation(() => pushOverlayNow({ kind: 'diff', file: file.fullPath }));
    }, [pushOverlayNow, withFileDiscardConfirmation]);
    const handleAllFilesFilePress = React.useCallback((filePath: string) => {
        if (filePath === fileViewPath) return;
        withFileDiscardConfirmation(() => pushOverlayNow({ kind: 'file', path: filePath }));
    }, [fileViewPath, pushOverlayNow, withFileDiscardConfirmation]);
    const handleAllFilesFileAttach = React.useCallback((filePath: string) => {
        if (!addWorkspaceContextFile(sessionId, filePath)) {
            Modal.alert(t("uiCopy.workspaceContext"), t("uiCopy.youCanAttachUpTo8FilesToOneMessage"));
        }
    }, [sessionId]);

    // File overlays still follow the file-panel feature/capability gate. Side
    // chats use their independent full-screen fallback when this is false.
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
    const sideChatAccessButton = sideChats.length > 0
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
    });
    const headerRight = sideChatAccessButton || sessionInfoButton
        ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {sideChatAccessButton}
                {sessionInfoButton}
            </View>
        )
        : null;

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
                            : safeArea.top + mobileHeaderHeight + (!isTablet && realtimeStatus !== 'disconnected' ? VOICE_PILL_TOTAL_HEIGHT : 0)
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
                        onBackPress={() => router.back()}
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
                        zIndex: 2000,
                    }}
                >
                    <SideChatFullscreen
                        parentSessionId={sessionId}
                        sideChats={sideChats}
                        activeSideChatId={activeSideChatId}
                        onSelectSideChat={setActiveSideChatId}
                        onCloseSideChat={closeSideChat}
                        onCreateSideChat={createSideChat}
                        canCreateSideChat={!!sideChatForkSource}
                        creatingSideChat={creatingSideChat}
                        onCollapse={() => setSideChatFullscreenOpen(false)}
                    />
                </View>
            )}
        </>
    );

    const sessionContent = (
        <WorkspaceLinkPressContext.Provider
            value={activeWorkspaceLinkPresentation === 'side-panel' ? handleWorkspaceLinkPress : undefined}
        >
            {mainContent}
        </WorkspaceLinkPressContext.Provider>
    );

    if (!canRenderSidebar && !showWorkspaceLinkPanel) {
        return sessionContent;
    }

    // Desktop layout: chat + animated sidebar at the same level (full height).
    // When a sidebar file is selected, InlineFileDiff overlays the main content
    // (chat stays mounted underneath so state is preserved).
    return (
        <View style={{ flex: 1, flexDirection: 'row' }}>
            <View
                style={{
                    flex: 1,
                    // Web-only: isolate the chat subtree's layout from the
                    // parent flex-row. If we ever bring back a width
                    // animation on the right sidebar, `contain` prevents
                    // layout work from leaking up to the chat tree on
                    // every frame.
                    ...(Platform.OS === 'web' ? { contain: 'layout style paint' as any } : {}),
                }}
            >
                {sessionContent}
                {diffViewOpen && canShowFileSidebar && !showWorkspaceLinkPanel && (
                    <View
                        pointerEvents="box-none"
                        style={{
                            position: 'absolute',
                            top: safeArea.top + mobileHeaderHeight,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: theme.colors.surface,
                        }}
                    >
                        <AllFilesDiffView
                            sessionId={sessionId}
                            scrollToFile={scrollToFile}
                            onHeaderRightSlotChange={setHeaderRightSlot}
                        />
                    </View>
                )}
                {fileViewPath && canShowFileSidebar && !showWorkspaceLinkPanel && (
                    <View
                        pointerEvents="box-none"
                        style={{
                            position: 'absolute',
                            top: safeArea.top + mobileHeaderHeight,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: theme.colors.surface,
                        }}
                    >
                        <FileViewPanel
                            sessionId={sessionId}
                            filePath={fileViewPath}
                            onHeaderRightSlotChange={setHeaderRightSlot}
                            onDirtyChange={setFileViewDirty}
                        />
                    </View>
                )}
            </View>
            {showWorkspaceLinkPanel && workspaceLinkRoute ? (
                <WorkspaceLinkSidePanel
                    reference={workspaceLinkRoute.params}
                    windowWidth={windowWidth}
                    onBack={() => setWorkspaceLinkRoute(null)}
                    onFeedbackSendingChange={onWorkspaceLinkFeedbackSendingChange}
                    onFeedbackSent={(receipt) => {
                        setWorkspaceLinkRoute(null);
                        setFocusMessageId(receipt.localId);
                    }}
                />
            ) : (
                <Animated.View style={[{ minWidth: 0, alignSelf: 'stretch' }, animatedSidebarStyle]}>
                    <View style={{ width: sidebarWidth, flex: 1 }}>
                        <FilesSidebar
                            sessionId={sessionId}
                            selectedPath={sidebarPanelActive === 'changes' ? scrollToFile : sidebarPanelActive === 'allFiles' ? fileViewPath : null}
                            onFilePress={handleSidebarFilePress}
                            openPanels={visibleSidebarPanels}
                            activePanel={visibleSidebarPanelActive}
                            onOpenPanel={openSidebarPanel}
                            onSelectPanel={selectSidebarPanel}
                            onClosePanel={removeSidebarPanel}
                            onAllFilesFilePress={handleAllFilesFilePress}
                            onAllFilesFileAttach={handleAllFilesFileAttach}
                            canOpenFilePanels={canShowFileSidebar}
                            sideChats={sideChats}
                            activeSideChatId={activeSideChatId}
                            onSelectSideChat={setActiveSideChatId}
                            onCloseSideChat={closeSideChat}
                            onCreateSideChat={createSideChat}
                            canCreateSideChat={!!sideChatForkSource}
                            creatingSideChat={creatingSideChat}
                        />
                    </View>
                </Animated.View>
            )}
        </View>
    );
});

// Hoisted so AgentInput's React.memo doesn't see a new array ref on every keystroke
const AGENT_INPUT_AUTOCOMPLETE_PREFIXES = ['@', '/'];

// Imperative handle exposed by ChatComposer so SessionViewLoaded can read /
// clear the message text without subscribing to it (which would re-render
// the whole loaded screen on every keystroke).
type ChatComposerHandle = {
    getMessage: () => string;
    clearMessage: () => void;
};

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
        getMessage: () => inputHandleRef.current?.getText() ?? '',
        clearMessage: () => {
            inputHandleRef.current?.setTextAndSelection('', { start: 0, end: 0 });
            setMessage('');
            clearDraft();
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
            session.permissionMode,
        )
    ), [flavor, session.metadata, session.permissionMode, sessionMachine?.metadata]);
    const [agentDefaultOverrides, setAgentDefaultOverrides] = useSettingMutable('agentDefaultOverrides');
    const effectiveAgentDefaults = React.useMemo(() => (
        resolveAgentDefaultConfig(agentDefaultOverrides, flavor)
    ), [agentDefaultOverrides, flavor]);

    const permissionMode = React.useMemo<PermissionMode | null>(() => (
        resolveCurrentOption(availableModes, isGrok && !isRig
            ? [session.permissionMode, getAdvertisedDefaultOptionKey(availableModes)]
            : [
                session.permissionMode,
                ...(isRig ? [
                session.metadata?.currentOperatingModeCode,
                session.metadata?.permissionMode,
                session.metadata?.session?.permissionMode,
                ] : [
                    effectiveAgentDefaults.permissionMode,
                    session.metadata?.currentOperatingModeCode,
                ]),
            ])
    ), [availableModes, session.permissionMode, effectiveAgentDefaults.permissionMode, session.metadata?.currentOperatingModeCode, session.metadata?.permissionMode, session.metadata?.session?.permissionMode, isGrok, isRig]);

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
    const { selectedImages, pickImages, removeImage, clearImages, addImages } = useImagePicker();
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
    const selectedContextEntries = React.useSyncExternalStore(
        subscribeWorkspaceContext,
        () => getWorkspaceContextEntries(sessionId),
        () => getWorkspaceContextEntries(sessionId),
    );
    const workspaceUploader = useMachineFileUpload({
        machineId,
        directory: session.metadata?.path,
        maxFiles: Math.max(0, MAX_WORKSPACE_CONTEXT_ITEMS - selectedContextEntries.length),
        onUploaded: (filePath) => {
            if (!addWorkspaceContextFile(sessionId, filePath)) {
                Modal.alert(t("uiCopy.workspaceContext"), t("uiCopy.youCanAttachUpTo8FilesToOneMessage"));
            }
        },
    });

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

    // Function to update permission mode
    const updatePermissionMode = React.useCallback((mode: PermissionMode) => {
        sessionSetAgentModes(sessionId, { permissionMode: mode.key });
    }, [sessionId]);

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
                if (heartbeatCommand.clearComposer) composerHandleRef.current?.clearMessage();
                if (heartbeatCommand.message) {
                    Modal.alert(t('happyHerd.heartbeat.title'), heartbeatCommand.message);
                }
                return;
            }
            const contextMessage = await buildWorkspaceContextMessage(sessionId, liveMessage, selectedContextEntries);
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
            composerHandleRef.current?.clearMessage();
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
        // Permission is turn-scoped and returns to the launch policy after an
        // abort. Model and effort are session preferences: the Codex runtime
        // retains them, so clearing them here would desynchronize the picker
        // from the next resumed turn.
        if (!isRig) {
            sessionSetAgentModes(sessionId, { permissionMode: null });
        }
        sessionAbort(sessionId);
    }, [sessionId]);

    const handleFileViewerPress = React.useCallback(() => {
        const params = buildWorkspaceAttachmentParams(sessionId, session?.metadata);
        if (!params) return;
        router.push({
            pathname: '/workspace',
            params,
        });
    }, [router, session?.metadata, sessionId]);

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

    // Handle microphone button press - memoized to prevent button flashing
    const handleMicrophonePress = React.useCallback(async () => {
        if (!voiceInputAvailability.enabled) {
            return;
        }
        if (realtimeStatus === 'connecting') {
            return; // Prevent actions during transitions
        }
        if (realtimeStatus === 'disconnected' || realtimeStatus === 'error') {
            try {
                const initialPrompt = voiceHooks.onVoiceStarted(sessionId);
                const conversationId = await startRealtimeSession(sessionId, initialPrompt);
                if (conversationId) {
                    const hasPro = storage.getState().purchases.entitlements['pro'] ?? false;
                    tracking?.capture('voice_session_started', {
                        session_id: sessionId,
                        elevenlabs_conversation_id: conversationId,
                        has_pro: hasPro,
                        onboarding_prompt_load_count: getVoiceOnboardingPromptLoadCount(),
                        voice_message_count: getVoiceMessageCount(),
                    });
                }
            } catch (error) {
                console.error('Failed to start realtime session:', error);
                Modal.alert(t('common.error'), t('errors.voiceSessionFailed'));
                tracking?.capture('voice_session_error', {
                    session_id: sessionId,
                    elevenlabs_conversation_id: getCurrentVoiceConversationId(),
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        } else if (realtimeStatus === 'connected') {
            const conversationId = getCurrentVoiceConversationId();
            const durationSeconds = getCurrentVoiceSessionDurationSeconds();
            await stopRealtimeSession();
            tracking?.capture('voice_session_stopped', {
                session_id: sessionId,
                elevenlabs_conversation_id: conversationId,
                ...(durationSeconds !== undefined ? { duration_seconds: durationSeconds } : {}),
            });

            // Notify voice assistant about voice session stop
            voiceHooks.onVoiceStopped();
        }
    }, [realtimeStatus, sessionId, voiceInputAvailability.enabled]);

    // Memoize mic button state to prevent flashing during chat transitions.
    // While a call runs the pill under the header is the only stop control,
    // so the composer mic disappears instead of doubling as a stop button.
    const voiceSessionActive = realtimeStatus === 'connected' || realtimeStatus === 'connecting';
    const micButtonState = useMemo(() => ({
        onMicPress: voiceSessionActive ? undefined : handleMicrophonePress,
        isMicActive: false,
    }), [handleMicrophonePress, voiceSessionActive]);

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
                onPermissionModeChange={isRigPermissionSelectionEnabled(session.metadata) ? updatePermissionMode : undefined}
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
                onSend={handleSend}
                onQueueMessage={handleQueueMessage}
                onMicPress={(embedded || isDisconnected || !voiceInputAvailability.enabled)
                    ? undefined
                    : micButtonState.onMicPress}
                isMicActive={(embedded || isDisconnected) ? false : micButtonState.isMicActive}
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
                onFileViewerPress={rigCanBrowseFiles(session.metadata) && rigCanReadFiles(session.metadata) ? handleFileViewerPress : undefined}
                selectedImages={expImageUpload && canUseAttachments ? selectedImages : undefined}
                onPickImages={expImageUpload && canUseAttachments ? pickImages : undefined}
                onPickDeviceFiles={machineId
                    && session.metadata?.path
                    && selectedContextEntries.length < MAX_WORKSPACE_CONTEXT_ITEMS
                    && workspaceUploader.state.phase !== 'uploading'
                    && workspaceUploader.state.phase !== 'cancelling'
                    ? () => void workspaceUploader.pickAndUpload()
                    : undefined}
                onRemoveImage={expImageUpload && canUseAttachments ? removeImage : undefined}
                onAddImages={expImageUpload && canUseAttachments ? addImages : undefined}
                selectedContextEntries={selectedContextEntries}
                onRemoveContextEntry={(path) => removeWorkspaceContextEntry(sessionId, path)}
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

            {/* Back button for landscape phone mode when header is hidden */}
            {
                isLandscape && deviceType === 'phone' && (
                    <Pressable
                        onPress={() => router.back()}
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
