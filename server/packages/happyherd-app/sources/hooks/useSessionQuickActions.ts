import * as React from 'react';
import { useHappyHerdAction } from '@/hooks/useHappyHerdAction';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { Modal } from '@/modal';
import { machineResumeSession, sessionArchive, sessionKill, sessionSetAgentModes, forkAndSpawn, type ForkSource } from '@/sync/ops';
import { maybeCleanupWorktree } from '@/hooks/useWorktreeCleanup';
import { storage, useLocalSetting, useMachine, useSetting } from '@/sync/storage';
import { Session } from '@/sync/storageTypes';
import { sync } from '@/sync/sync';
import { resolveMessageModeMeta, UnsupportedPermissionModeError } from '@/sync/messageMeta';
import { t } from '@/text';
import { HappyHerdError } from '@/utils/errors';
import { copySessionMetadataToClipboard, copySessionMetadataAndLogsToClipboard } from '@/utils/copySessionMetadataToClipboard';
import { useSessionStatus } from '@/utils/sessionUtils';
import { isMachineOnline } from '@/utils/machineUtils';
import {
    getClaudeResumeModes,
    getCodexResumeModes,
    getDshResumeModes,
    getGrokResumePermissionMode,
    getResumeAvailability,
} from '@/utils/sessionResume';
import { getSessionForkSource } from '@/utils/sessionFork';
import { useRouter } from 'expo-router';
import { useSession } from '@/sync/storage';
import { DuplicateSheet } from '@/components/DuplicateSheet';
import { ProviderContinuationSheet } from '@/components/ProviderContinuationSheet';
import type { SessionActionShortcutId } from '@/keyboard/shortcuts';
import { isRigMetadata } from '@/sync/rig';
import { getProviderContinuationTarget } from '@/utils/providerContinuation';

export interface SessionActionItem {
    id: SessionActionShortcutId | 'context-window';
    label: string;
    icon: string;
    onPress: () => void;
    destructive?: boolean;
}

interface UseSessionQuickActionsOptions {
    /**
     * Called on the press, before anything is asked of the machine.
     *
     * Archiving the chat you are reading has to move the screen off it first.
     * A kill that lands while the session is still the route takes the screen
     * apart around the user: the tab strip loses the checkout it was drawing
     * and collapses, the content falls back to "session deleted", and both come
     * back a moment later once the neighbouring tab is routed to. Moving first
     * makes the only visible change the one that was asked for — a tab leaving
     * the strip.
     *
     * The cost is that a press which then fails has still moved the screen. The
     * chat is alive and still in the strip, one tab away, and the failure says
     * so in its own words.
     */
    onBeforeArchive?: () => void;
    onAfterArchive?: () => void;
    onAfterDelete?: () => void;
    onAfterCopySessionMetadata?: () => void;
}

export function useSessionQuickActions(
    session: Session,
    options: UseSessionQuickActionsOptions = {},
) {
    const {
        onAfterArchive,
        onAfterCopySessionMetadata,
        onBeforeArchive,
    } = options;
    const router = useRouter();
    const navigateToSession = useNavigateToSession();
    const sessionStatus = useSessionStatus(session);
    const machineId = session.metadata?.machineId ?? '';
    const machine = useMachine(machineId);
    const contextWindowEnabled = useSetting('expContextWindow');
    const devModeEnabled = useLocalSetting('devModeEnabled');
    const continuationExperimentsEnabled = useSetting('expResumeSession');
    const resumeAvailability = React.useMemo(
        () => {
            const availability = getResumeAvailability(session, machine, sessionStatus.isConnected);
            // Retain ordinary resume for inactive sessions. A live provider or active
            // Super Session with unknown transport must never spawn another process.
            if (session.metadata?.isSuperSession && (session.active || sessionStatus.transport?.providerRunning) && sessionStatus.transport?.errorCode !== 'process-exited') {
                return { ...availability, canResume: false, canShowResume: false, subtitle: '', message: '' };
            }
            // Older daemons do not publish resumeSupport and do not implement
            // the RPC. Keep resume capability-driven instead of showing an
            // action that can only fail.
            if (availability.canResume && machine?.metadata?.resumeSupport?.rpcAvailable !== true) {
                return { ...availability, canResume: false, canShowResume: false, subtitle: '', message: '' };
            }
            const message = availability.messageKey ? t(availability.messageKey) : '';
            return { ...availability, subtitle: message, message };
        },
        [machine, session, sessionStatus.isConnected, sessionStatus.transport],
    );

    // Fork eligibility — separate from resume because fork works on both
    // active AND inactive provider sessions. Fork/duplicate still use the
    // legacy rollout flag because resumeSupport does not prove that the daemon
    // implements the newer fork RPC.
    const forkSource = React.useMemo(() => getSessionForkSource(session), [
        session.id,
        session.metadata?.flavor,
        session.metadata?.machineId,
        session.metadata?.path,
        session.metadata?.claudeSessionId,
        session.metadata?.codexThreadId,
    ]);
    const canFork = Boolean(
        continuationExperimentsEnabled
        && !isRigMetadata(session.metadata)
        && forkSource
        && machine
        && isMachineOnline(machine)
    );
    const continuationTarget = getProviderContinuationTarget(session.metadata?.flavor);
    const canContinueWithProvider = Boolean(
        continuationTarget
        && session.metadata?.path
        && machine
        && isMachineOnline(machine)
        && machine.metadata?.cliAvailability?.[continuationTarget] === true
    );

    const openDetails = React.useCallback(() => {
        router.push(`/session/${session.id}/info`);
    }, [router, session.id]);

    const openContextWindow = React.useCallback(() => {
        router.push(`/session/${session.id}/context`);
    }, [router, session.id]);

    const copySessionMetadata = React.useCallback(() => {
        void (async () => {
            const copied = await copySessionMetadataToClipboard(session);
            if (copied) {
                onAfterCopySessionMetadata?.();
            }
        })();
    }, [onAfterCopySessionMetadata, session]);

    const copySessionMetadataAndLogs = React.useCallback(() => {
        void (async () => {
            const copied = await copySessionMetadataAndLogsToClipboard(session);
            if (copied) {
                onAfterCopySessionMetadata?.();
            }
        })();
    }, [onAfterCopySessionMetadata, session]);

    const resumeSessionWithQueuedTurn = React.useCallback(async (replayQueueMessageId?: string) => {
        if (!resumeAvailability.canResume) {
            throw new HappyHerdError(resumeAvailability.message, false);
        }

        if (!machineId) {
            throw new HappyHerdError(t('sessionInfo.resumeSessionMissingMachine'), false);
        }

        const currentState = storage.getState();
        const latestMachine = currentState.machines[machineId];
        const latestAvailability = getResumeAvailability(session, latestMachine, false);
        if (!latestAvailability.canResume) {
            throw new HappyHerdError(
                latestAvailability.messageKey ? t(latestAvailability.messageKey) : t('uiCopy.theSelectedAgentConfigurationIsUnavailable'),
                false,
            );
        }

        let modeMeta: ReturnType<typeof resolveMessageModeMeta>;
        try {
            const agentKey = session.metadata?.flavor ?? 'claude';
            const availablePermissions = latestMachine?.metadata?.agentCapabilities?.[agentKey]
                ?.permissionModes.map((mode) => ({ key: mode.code }));
            modeMeta = resolveMessageModeMeta(session, currentState.settings, { availablePermissions });
        } catch (error) {
            if (error instanceof UnsupportedPermissionModeError) {
                // Refuse loudly instead of substituting a mode: swapping in a
                // default would silently change what the agent may do.
                throw new HappyHerdError(t('errors.unsupportedPermissionMode', {
                    mode: error.mode,
                    cliVersion: error.cliVersion,
                }), false);
            }
            throw error;
        }
        const providerResumeModes = session.metadata?.flavor === 'codex'
            ? getCodexResumeModes(session, latestMachine)
            : session.metadata?.flavor === 'claude'
                ? getClaudeResumeModes(session, latestMachine)
                : session.metadata?.flavor === 'dsh'
                    ? getDshResumeModes(session, latestMachine)
                    : undefined;
        const persistedResumePermissionMode = providerResumeModes?.permissionMode
            ?? (session.metadata?.flavor === 'grok'
                ? getGrokResumePermissionMode(session, latestMachine)
                : undefined);
        const result = await machineResumeSession({
            machineId,
            sessionId: session.id,
            model: providerResumeModes?.modelMode ?? modeMeta.model ?? undefined,
            effortLevel: providerResumeModes?.effortLevel ?? modeMeta.effort ?? undefined,
            permissionMode: persistedResumePermissionMode ?? modeMeta.permissionMode,
            replayQueueMessageId,
        });

        switch (result.type) {
            case 'success': {
                // Session reconnects to the same ID, so messages are preserved.
                // Refresh to pick up the updated session state.
                await sync.refreshSessions();

                if (
                    result.settings
                    && (result.settings.provider === 'claude'
                        || result.settings.provider === 'codex'
                        || result.settings.provider === 'dsh')
                ) {
                    // The daemon validates against the target machine and is
                    // the launch authority. Mirror its exact confirmed tuple.
                    sessionSetAgentModes(result.sessionId, {
                        permissionMode: result.settings.permission,
                        modelMode: result.settings.model,
                        effortLevel: result.settings.effort,
                    });
                } else if (providerResumeModes) {
                    // Compatibility with a daemon that validates the tuple but
                    // predates returning its settings receipt over the RPC.
                    sessionSetAgentModes(result.sessionId, providerResumeModes);
                } else if (persistedResumePermissionMode) {
                    sessionSetAgentModes(result.sessionId, { permissionMode: persistedResumePermissionMode });
                } else if (session.permissionMode) {
                    sessionSetAgentModes(result.sessionId, { permissionMode: session.permissionMode });
                }

                navigateToSession(result.sessionId);
                return;
            }
            case 'requestToApproveDirectoryCreation':
                throw new HappyHerdError(t('sessionInfo.resumeSessionUnexpectedDirectoryPrompt'), false);
            case 'error':
                throw new HappyHerdError(result.errorMessage, false);
        }
    }, [machineId, navigateToSession, resumeAvailability, session]);

    const [resumingSession, performResume] = useHappyHerdAction(async () => {
        await resumeSessionWithQueuedTurn();
    });

    const [archivingSession, performArchive] = useHappyHerdAction(async () => {
        // Before the first await: the screen has to be off this chat while it is
        // still whole, not once the store has started dismantling it.
        onBeforeArchive?.();
        // Also before it. Archiving asks a machine to check a worktree, then to
        // kill the agent, and sometimes the server to retire the session after
        // that — seconds, during which the row the user just archived used to
        // sit in the list looking untouched. It leaves now, and the only thing
        // that brings it back is the archive not working.
        storage.getState().markArchiving(session.id);
        try {
            const latestSession = storage.getState().sessions[session.id];
            if (latestSession?.metadata?.bot || session.metadata?.bot) {
                const result = await sessionKill(session.id);
                if (!result.success) {
                    throw new HappyHerdError(t('sessionInfo.botArchiveRequiresMachine'), false);
                }
                onAfterArchive?.();
                return;
            }
            await maybeCleanupWorktree(session.id, session.metadata?.path, session.metadata?.machineId);

            // Try to kill the CLI process; if it's already dead, force-archive via server
            const killResult = await sessionKill(session.id);
            if (!killResult.success) {
                // Checked, where it used to be fire-and-forget: the row has
                // already left the list on the strength of this working, and a
                // fallback that fails quietly would leave a live chat hidden.
                const archiveResult = await sessionArchive(session.id);
                if (!archiveResult.success) {
                    throw new HappyHerdError(archiveResult.message || t('sessionInfo.failedToArchiveSession'), false);
                }
            }
            onAfterArchive?.();
        } catch (error) {
            // Back into the list, where it still is as far as the machine is
            // concerned. The screen stays where the press put it: the user
            // moved on, and hauling them back to a chat they tried to close
            // would be a second surprise on top of the failure, which
            // useHappyHerdAction is already reporting in words.
            storage.getState().unmarkArchiving(session.id);
            throw error;
        }
    });

    const archiveSession = React.useCallback(() => {
        performArchive();
    }, [performArchive]);

    const resumeSession = React.useCallback(() => {
        performResume();
    }, [performResume]);

    // Fork the session (no truncation) — copies the on-disk Claude JSONL
    // and spawns a fresh HappyHerd session on the same machine. Works for
    // both active and inactive sessions; the source row stays untouched.
    const [forking, performFork] = useHappyHerdAction(async () => {
        if (!canFork) {
            throw new HappyHerdError(t('session.forkErrorMissingMetadata'), false);
        }
        if (!forkSource) {
            throw new HappyHerdError(t('session.forkErrorMissingMetadata'), false);
        }
        const result = await forkAndSpawn(forkSource as ForkSource);
        if (result.type !== 'success') {
            throw new HappyHerdError(result.type === 'error' ? result.errorMessage : t('session.forkErrorGeneric'), false);
        }
        navigateToSession(result.sessionId);
    });

    const forkSession = React.useCallback(() => {
        performFork();
    }, [performFork]);

    const openDuplicateSheet = React.useCallback(() => {
        if (!canFork) return;
        Modal.show({
            component: DuplicateSheet,
            props: { sessionId: session.id },
            presentation: 'dialog',
        } as any);
    }, [canFork, session.id]);

    const openProviderContinuationSheet = React.useCallback(() => {
        if (!canContinueWithProvider) return;
        Modal.show({
            component: ProviderContinuationSheet,
            props: { sessionId: session.id },
            presentation: 'dialog',
        } as any);
    }, [canContinueWithProvider, session.id]);

    const canCopySessionMetadata = __DEV__ || devModeEnabled;

    const actionItems = React.useMemo<SessionActionItem[]>(() => {
        const items: SessionActionItem[] = [
            { id: 'details', icon: 'information-circle-outline', label: t('profile.details'), onPress: openDetails },
        ];

        if (contextWindowEnabled) {
            items.push({ id: 'context-window', icon: 'document-text-outline', label: t('contextWindow.title'), onPress: openContextWindow });
        }

        if (resumeAvailability.canShowResume) {
            items.push({ id: 'resume', icon: 'play-circle-outline', label: t('sessionInfo.resumeSession'), onPress: resumeSession });
        }

        if (canFork) {
            items.push({ id: 'fork', icon: 'git-branch-outline', label: t('session.forkAction'), onPress: forkSession });
            items.push({ id: 'duplicate', icon: 'time-outline', label: t('session.duplicateAction'), onPress: openDuplicateSheet });
        }

        if (canContinueWithProvider) {
            items.push({
                id: 'continue-provider',
                icon: 'swap-horizontal-outline',
                label: t('session.providerContinuationAction'),
                onPress: openProviderContinuationSheet,
            });
        }

        if (canCopySessionMetadata) {
            items.push({ id: 'copy-metadata', icon: 'bug-outline', label: t('sessionInfo.copyMetadata'), onPress: copySessionMetadata });
            items.push({ id: 'copy-metadata-and-logs', icon: 'document-text-outline', label: t('uiCopy.copyMetadataAndClientLogs'), onPress: copySessionMetadataAndLogs });
        }

        items.push({ id: 'archive', icon: 'archive-outline', label: t("uiCopy.archive"), onPress: archiveSession, destructive: true });

        return items;
    }, [
        archiveSession,
        canCopySessionMetadata,
        canFork,
        canContinueWithProvider,
        copySessionMetadata,
        copySessionMetadataAndLogs,
        forkSource,
        forkSession,
        openDetails,
        contextWindowEnabled,
        openContextWindow,
        openDuplicateSheet,
        openProviderContinuationSheet,
        resumeAvailability.canShowResume,
        resumeSession,
    ]);

    const showActionAlert = React.useCallback(() => {
        const buttons: Array<{ text: string; onPress?: () => void; style?: 'cancel' | 'destructive' | 'default' }> = actionItems.map(item => ({
            text: item.label,
            onPress: item.onPress,
            style: item.destructive ? 'destructive' as const : undefined,
        }));
        buttons.push({ text: t('common.cancel'), style: 'cancel' });
        Modal.alert(t("uiCopy.session"), undefined, buttons);
    }, [actionItems]);

    return {
        actionItems,
        showActionAlert,
        archiveSession,
        archivingSession,
        canArchive: true,
        canCopySessionMetadata,
        canResume: resumeAvailability.canResume,
        canShowResume: resumeAvailability.canShowResume,
        canFork,
        canContinueWithProvider,
        copySessionMetadata,
        copySessionMetadataAndLogs,
        forkSession,
        forking,
        openDetails,
        openDuplicateSheet,
        openProviderContinuationSheet,
        resumeSession,
        resumeSessionWithQueuedTurn,
        resumeSessionSubtitle: resumeAvailability.subtitle,
        resumingSession,
    };
}

/**
 * Lightweight hook for list items that only have a sessionId.
 * Returns a long-press handler that shows the action alert on mobile.
 */
/**
 * A session that is not in the store has no actions, but the hooks above still
 * have to run in the same order on every render — so a missing session is
 * handed this frozen stand-in and the caller drops the result. Without it
 * useSessionQuickActions dereferences null long before its callers reach the
 * `if (!session)` guard they already have.
 */
export const MISSING_SESSION: Session = Object.freeze({
    id: '',
    seq: 0,
    createdAt: 0,
    updatedAt: 0,
    active: false,
    activeAt: 0,
    metadata: null,
    metadataVersion: 0,
    agentState: null,
    agentStateVersion: 0,
    thinking: false,
    thinkingAt: 0,
    presence: 0,
});

export function useSessionActionAlert(sessionId: string, options: UseSessionQuickActionsOptions = {}) {
    const session = useSession(sessionId);
    const { showActionAlert } = useSessionQuickActions(session ?? MISSING_SESSION, options);
    return session ? showActionAlert : undefined;
}

/**
 * Archiving for a row that only has an id — the flat list's swipe.
 *
 * It used to call `sessionKill` on its own, which meant the swipe skipped the
 * worktree cleanup, the server-side fallback for an agent that is already
 * dead, and — since the row leaving the list on the press lives in the action
 * too — the whole point of this change.
 */
export function useSessionArchiveAction(sessionId: string) {
    const session = useSession(sessionId);
    const { archiveSession, archivingSession } = useSessionQuickActions(session ?? MISSING_SESSION);
    return { archiveSession, archivingSession };
}
