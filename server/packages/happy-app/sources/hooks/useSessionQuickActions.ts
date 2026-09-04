import * as React from 'react';
import { useHappyAction } from '@/hooks/useHappyAction';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { Modal } from '@/modal';
import { machineResumeSession, sessionArchive, sessionKill, sessionSetAgentModes, forkAndSpawn, type ForkSource } from '@/sync/ops';
import { maybeCleanupWorktree } from '@/hooks/useWorktreeCleanup';
import { storage, useLocalSetting, useMachine, useSetting } from '@/sync/storage';
import { Session } from '@/sync/storageTypes';
import { sync } from '@/sync/sync';
import { resolveMessageModeMeta, UnsupportedPermissionModeError } from '@/sync/messageMeta';
import { t } from '@/text';
import { HappyError } from '@/utils/errors';
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
    id: SessionActionShortcutId;
    label: string;
    icon: string;
    onPress: () => void;
    destructive?: boolean;
}

interface UseSessionQuickActionsOptions {
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
    } = options;
    const router = useRouter();
    const navigateToSession = useNavigateToSession();
    const sessionStatus = useSessionStatus(session);
    const machineId = session.metadata?.machineId ?? '';
    const machine = useMachine(machineId);
    const devModeEnabled = useLocalSetting('devModeEnabled');
    const continuationExperimentsEnabled = useSetting('expResumeSession');
    const resumeAvailability = React.useMemo(
        () => {
            const availability = getResumeAvailability(session, machine, sessionStatus.isConnected);
            // Older daemons do not publish resumeSupport and do not implement
            // the RPC. Keep resume capability-driven instead of showing an
            // action that can only fail.
            if (availability.canResume && machine?.metadata?.resumeSupport?.rpcAvailable !== true) {
                return { ...availability, canResume: false, canShowResume: false, subtitle: '', message: '' };
            }
            const message = availability.messageKey ? t(availability.messageKey) : '';
            return { ...availability, subtitle: message, message };
        },
        [machine, session, sessionStatus.isConnected],
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
            throw new HappyError(resumeAvailability.message, false);
        }

        if (!machineId) {
            throw new HappyError(t('sessionInfo.resumeSessionMissingMachine'), false);
        }

        const currentState = storage.getState();
        const latestMachine = currentState.machines[machineId];
        const latestAvailability = getResumeAvailability(session, latestMachine, false);
        if (!latestAvailability.canResume) {
            throw new HappyError(
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
                throw new HappyError(t('errors.unsupportedPermissionMode', {
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
                throw new HappyError(t('sessionInfo.resumeSessionUnexpectedDirectoryPrompt'), false);
            case 'error':
                throw new HappyError(result.errorMessage, false);
        }
    }, [machineId, navigateToSession, resumeAvailability, session]);

    const [resumingSession, performResume] = useHappyAction(async () => {
        await resumeSessionWithQueuedTurn();
    });

    const [archivingSession, performArchive] = useHappyAction(async () => {
        await maybeCleanupWorktree(session.id, session.metadata?.path, session.metadata?.machineId);

        // Try to kill the CLI process; if it's already dead, force-archive via server
        const killResult = await sessionKill(session.id);
        if (!killResult.success) {
            await sessionArchive(session.id);
        }
        onAfterArchive?.();
    });

    const archiveSession = React.useCallback(() => {
        performArchive();
    }, [performArchive]);

    const resumeSession = React.useCallback(() => {
        performResume();
    }, [performResume]);

    // Fork the session (no truncation) — copies the on-disk Claude JSONL
    // and spawns a fresh Happy session on the same machine. Works for
    // both active and inactive sessions; the source row stays untouched.
    const [forking, performFork] = useHappyAction(async () => {
        if (!canFork) {
            throw new HappyError(t('session.forkErrorMissingMetadata'), false);
        }
        if (!forkSource) {
            throw new HappyError(t('session.forkErrorMissingMetadata'), false);
        }
        const result = await forkAndSpawn(forkSource as ForkSource);
        if (result.type !== 'success') {
            throw new HappyError(result.type === 'error' ? result.errorMessage : t('session.forkErrorGeneric'), false);
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
        } as any);
    }, [canFork, session.id]);

    const openProviderContinuationSheet = React.useCallback(() => {
        if (!canContinueWithProvider) return;
        Modal.show({
            component: ProviderContinuationSheet,
            props: { sessionId: session.id },
        } as any);
    }, [canContinueWithProvider, session.id]);

    const canCopySessionMetadata = __DEV__ || devModeEnabled;

    const actionItems = React.useMemo<SessionActionItem[]>(() => {
        const items: SessionActionItem[] = [
            { id: 'details', icon: 'information-circle-outline', label: t('profile.details'), onPress: openDetails },
        ];

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
export function useSessionActionAlert(sessionId: string) {
    const session = useSession(sessionId);
    const { showActionAlert } = useSessionQuickActions(session!, {});
    return session ? showActionAlert : undefined;
}
