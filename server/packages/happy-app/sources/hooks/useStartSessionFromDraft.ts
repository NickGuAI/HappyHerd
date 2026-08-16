import * as React from 'react';
import { useAllMachines, useSetting } from '@/sync/storage';
import { resolveAgentDefaultConfig, resolveAgentDefaultEffortLevel } from '@/sync/agentDefaults';
import { machineSpawnNewSession, sessionSetAgentModes, type SessionAgentModesPatch } from '@/sync/ops';
import { sync } from '@/sync/sync';
import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { isMachineOnline } from '@/utils/machineUtils';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import { createWorktree } from '@/utils/worktree';
import {
    getEffortLevelsForModel,
    getHardcodedModelModes,
    getHardcodedPermissionModes,
    getMachineAdvertisedEffortLevels,
    getMachineAdvertisedModels,
    getMachineAdvertisedPermissionModes,
} from '@/components/modelModeOptions';
import { Modal } from '@/modal';
import { t } from '@/text';
import { resolveMachineAgent } from '@/utils/newSessionAgentSelection';
import { delay } from '@/utils/time';
import {
    buildRigSpawnConfiguration,
    getRigMachineSessionCreation,
    resolveRigPendingRetryDelayMs,
} from '@/sync/rigSessionCreation';
import {
    buildSpawnRequestSignature,
    completeSpawnRequest,
    resolveSpawnRequestId,
} from '@/sync/spawnRequestId';

const MAX_RIG_PENDING_RESULTS = 3;

function resolveOption<T extends { key: string }>(
    options: T[],
    preferredKeys: Array<string | null | undefined>,
): T | null {
    for (const key of preferredKeys) {
        if (!key) continue;
        const option = options.find((candidate) => candidate.key === key);
        if (option) return option;
    }
    return options[0] ?? null;
}

export function useStartSessionFromDraft() {
    const machines = useAllMachines({ includeOffline: true });
    const defaultOverrides = useSetting('agentDefaultOverrides');
    const navigateToSession = useNavigateToSession();
    const [isStarting, setIsStarting] = React.useState(false);
    const isStartingRef = React.useRef(false);
    const isMountedRef = React.useRef(true);
    React.useEffect(() => () => {
        isMountedRef.current = false;
    }, []);

    const startSession = React.useCallback(async (): Promise<boolean> => {
        if (isStartingRef.current) return false;

        const draft = useNewSessionDraft.getState();
        const machine = machines.find((candidate) => candidate.id === draft.selectedMachineId);
        if (!machine) {
            Modal.alert(t('common.error'), t("uiCopy.pleaseSelectAMachine"));
            return false;
        }
        if (!isMachineOnline(machine)) {
            Modal.alert(t('common.error'), t("newSession.machineOffline"));
            return false;
        }

        // The draft survives machine changes and app upgrades. Resolve it again
        // at launch time so a stale Claude selection cannot spawn Claude while
        // the selected machine only reports Codex (the Android 1.7.0 regression).
        const agentType = resolveMachineAgent(
            draft.agentType,
            machine.metadata?.cliAvailability,
        );
        const agentChanged = agentType !== draft.agentType;
        const rigCreation = agentType === 'rig'
            ? getRigMachineSessionCreation(machine.metadata)
            : null;
        if (agentType === 'rig' && !rigCreation) {
            Modal.alert(t('common.error'), t('uiCopy.thisRigMachineIsNotAvailableForSessionCreation'));
            return false;
        }
        const machineCatalog = machine.metadata?.agentCapabilities?.[agentType];
        const defaults = rigCreation
            ? {
                permissionMode: rigCreation.defaultPermissionMode ?? '',
                modelMode: rigCreation.defaultModelKey ?? '',
                effortLevel: rigCreation.defaultEffortForModel(rigCreation.defaultModelKey),
            }
            : resolveAgentDefaultConfig(defaultOverrides, agentType);
        const permissionOptions = rigCreation?.permissionModes
            ?? (machineCatalog
                ? getMachineAdvertisedPermissionModes(machine.metadata, agentType)
                : getHardcodedPermissionModes(agentType, t));
        const modelOptions = rigCreation?.models
            ?? (machineCatalog
                ? getMachineAdvertisedModels(machine.metadata, agentType)
                : getHardcodedModelModes(agentType, t));
        const permission = resolveOption<{ key: string }>(
            permissionOptions,
            agentChanged
                ? [defaults.permissionMode]
                : [draft.permissionMode, defaults.permissionMode],
        );
        const model = resolveOption<{ key: string }>(
            modelOptions,
            agentChanged
                ? [defaults.modelMode]
                : [draft.modelMode, defaults.modelMode],
        );
        const effortOptions = rigCreation
            ? rigCreation.effortsForModel(model?.key).map((key) => ({ key, name: key }))
            : machineCatalog
                ? getMachineAdvertisedEffortLevels(machine.metadata, agentType, model?.key ?? 'default')
                : getEffortLevelsForModel(agentType, model?.key ?? 'default');
        const effectiveEffortDefault = rigCreation?.defaultEffortForModel(model?.key)
            ?? resolveAgentDefaultEffortLevel(defaultOverrides, agentType, effortOptions);
        const effort = resolveOption<{ key: string }>(
            effortOptions,
            agentChanged
                ? [effectiveEffortDefault]
                : [draft.effortLevel, effectiveEffortDefault],
        );
        if (!permission || !model) {
            Modal.alert(t('common.error'), t("uiCopy.theSelectedAgentConfigurationIsUnavailable"));
            return false;
        }

        const prompt = draft.input.trim();
        const attachments = draft.attachments;
        const selectedPath = draft.selectedPath?.trim() || '~';
        const absolutePath = resolveAbsolutePath(selectedPath, machine.metadata?.homeDir);
        const worktreeSelection = rigCreation?.supportsWorktrees === false
            ? '__none__'
            : draft.sessionType === 'worktree'
                ? draft.worktreeKey ?? '__new__'
                : '__none__';
        // Reused across every retry of this exact request so a second press of
        // Start is deduped by Rig instead of spawning a second session.
        const clientRequestId = resolveSpawnRequestId(buildSpawnRequestSignature({
            machineId: machine.id,
            agent: agentType,
            directory: selectedPath,
            worktree: worktreeSelection,
            modelKey: model.key,
            permissionMode: permission.key,
            effort: effort?.key ?? null,
        }));

        isStartingRef.current = true;
        setIsStarting(true);
        try {
            let spawnDirectory = absolutePath;
            if (worktreeSelection === '__new__') {
                const worktreeResult = await createWorktree(machine.id, absolutePath);
                if (!worktreeResult.success) {
                    Modal.alert(t('common.error'), worktreeResult.error || t("uiCopy.failedToCreateWorktree"));
                    return false;
                }
                spawnDirectory = worktreeResult.worktreePath;
            } else if (worktreeSelection !== '__none__') {
                spawnDirectory = worktreeSelection;
            }

            const spawn = async (approvedNewDirectoryCreation = false): Promise<string | null> => {
                const spawnOptions = rigCreation
                    ? {
                        machineId: machine.id,
                        ...buildRigSpawnConfiguration(machine.metadata, {
                            directory: spawnDirectory,
                            clientRequestId,
                            approvedNewDirectoryCreation,
                            modelKey: model.key,
                            permissionMode: permission.key,
                            effort: effort?.key,
                        }),
                    }
                    : {
                        machineId: machine.id,
                        directory: spawnDirectory,
                        approvedNewDirectoryCreation,
                        agent: agentType,
                        permissionMode: agentType === 'codex' || permission.key !== 'default'
                            ? permission.key
                            : undefined,
                        modelMode: model.key !== 'default' ? model.key : undefined,
                        effortLevel: effort?.key,
                        commanderId: draft.selectedCommanderId ?? undefined,
                    };
                let result = await machineSpawnNewSession(spawnOptions);
                let pendingResults = 0;
                while (result.type === 'pending' && pendingResults < MAX_RIG_PENDING_RESULTS) {
                    pendingResults += 1;
                    await delay(resolveRigPendingRetryDelayMs(
                        result.retryAfterMs,
                        rigCreation?.pendingRetryAfterMs,
                    ));
                    if (!isMountedRef.current) return null;
                    result = await machineSpawnNewSession(spawnOptions);
                }
                if (!isMountedRef.current) return null;

                if (result.type === 'success') return result.sessionId;
                if (result.type === 'error') {
                    Modal.alert(t('common.error'), result.errorMessage);
                    return null;
                }
                if (result.type === 'pending') {
                    Modal.alert(
                        t('common.error'),
                        t('uiCopy.rigCreatedTheSessionButItIsStillSyncingWithHappy'),
                    );
                    return null;
                }

                const approved = await Modal.confirm(
                    t("uiCopy.createDirectory"),
                    t("uiCopy.theDirectoryValueDoesNotExistWouldYouLikeTo", { value1: result.directory }),
                    { cancelText: t('common.cancel'), confirmText: t('common.create') },
                );
                return approved ? spawn(true) : null;
            };

            const sessionId = await spawn();
            if (!sessionId) return false;
            // The idempotency key did its job; the next Start is a new session.
            completeSpawnRequest();

            await sync.refreshSessions();

            if (!rigCreation) {
                const modesPatch: SessionAgentModesPatch = {};
                if (permission.key !== defaults.permissionMode) modesPatch.permissionMode = permission.key;
                if (model.key !== defaults.modelMode) modesPatch.modelMode = model.key;
                if ((effort?.key ?? null) !== effectiveEffortDefault) modesPatch.effortLevel = effort?.key ?? null;
                if (Object.keys(modesPatch).length > 0) {
                    sessionSetAgentModes(sessionId, modesPatch);
                }
            }

            draft.setInput('');
            draft.setAttachments([]);
            navigateToSession(sessionId);
            if (prompt || attachments.length > 0) {
                // The session is ready at this point. Open it immediately and
                // let the first message enqueue without keeping the user on Home
                // during image upload or a slower network round-trip.
                void sync.sendMessage(sessionId, prompt, { source: 'new_session', attachments }).catch((error) => {
                    Modal.alert(
                        t('common.error'),
                        error instanceof Error ? error.message : t("uiCopy.failedToSendTheFirstMessage"),
                    );
                });
            }
            return true;
        } catch (error) {
            Modal.alert(
                t('common.error'),
                error instanceof Error ? error.message : t("uiCopy.failedToStartSession"),
            );
            return false;
        } finally {
            isStartingRef.current = false;
            if (isMountedRef.current) setIsStarting(false);
        }
    }, [defaultOverrides, machines, navigateToSession]);

    return { isStarting, startSession };
}
