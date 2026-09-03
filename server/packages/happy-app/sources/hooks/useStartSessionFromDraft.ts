import * as React from 'react';
import { storage, useAllMachines, useSessions, useSetting } from '@/sync/storage';
import {
    getCodeAgentDefaults,
    resolveAgentDefaultConfig,
    resolveAgentDefaultEffortLevel,
} from '@/sync/agentDefaults';
import {
    machineSpawnNewSession,
    machineStopSession,
    sessionArchive,
    sessionKill,
    sessionSetAgentModes,
    type SessionAgentModesPatch,
} from '@/sync/ops';
import { sync } from '@/sync/sync';
import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { isMachineOnline } from '@/utils/machineUtils';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import { createWorktree } from '@/utils/worktree';
import {
    getEffortLevelsForModel,
    getAdvertisedDefaultOptionKey,
    getHardcodedModelModes,
    getHardcodedPermissionModes,
    filterPermissionModesForCli,
    getMachineAdvertisedEffortLevels,
    getMachineAdvertisedModels,
    getMachineAdvertisedPermissionModes,
    getSupportsWorktree,
    includeConfiguredModel,
} from '@/components/modelModeOptions';
import { Modal } from '@/modal';
import { t } from '@/text';
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
import type { NewSessionStartPhase } from '@/components/newSessionProgress';
import { supportsImageAttachmentsForFlavor } from '@/sync/attachmentSupport';
import {
    addWorkspaceContextEntry,
    buildWorkspaceContextMessage,
    clearWorkspaceContextFiles,
    type WorkspaceContextEntry,
} from '@/sync/workspaceContext';
import { validateNewSessionLaunchSelection } from '@/utils/newSessionModeSelection';
import type { Session } from '@/sync/storageTypes';
import { collectSessionPlaces, collectSessionWorkspaces } from '@/sync/agentSessionPlaces';
import {
    HappyAgentWorkspaceUnavailableError,
    resolveHappyAgentSpawnTarget,
} from '@/sync/happyAgentSpawn';
import {
    collectMachineChoices,
    findMachineChoice,
    resolveAgentMachine,
    resolveWorktreeCreationMachine,
} from '@/sync/machineChoices';

const MAX_RIG_PENDING_RESULTS = 3;

// Stop has to be felt at once. A request already on its way to the machine
// cannot be recalled, and the machine may never answer it at all, so the flow
// stops waiting on it rather than waiting for it: every await below races this,
// and whatever the machine says afterwards is dealt with off screen.
const CANCELED = Symbol('canceled');

/**
 * One attempt at starting a session.
 *
 * Cancellation is per attempt rather than a shared flag, so an attempt that is
 * still unwinding cannot read — or write — the state of the one that replaced
 * it. `canceled` is what the flow checks between steps; `signal` is what its
 * awaits race, so a step already in flight ends immediately instead of at
 * whatever point the machine feels like answering.
 */
type StartRun = {
    canceled: boolean;
    signal: Promise<typeof CANCELED>;
    cancel: () => void;
};

function beginRun(): StartRun {
    let resolve!: (value: typeof CANCELED) => void;
    const signal = new Promise<typeof CANCELED>((r) => { resolve = r; });
    const run: StartRun = {
        canceled: false,
        signal,
        cancel: () => {
            run.canceled = true;
            resolve(CANCELED);
        },
    };
    return run;
}

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
    const sessions = useSessions();
    const defaultOverrides = useSetting('agentDefaultOverrides');
    const navigateToSession = useNavigateToSession();
    // The composer stays on screen for the whole flow, so what it is waiting on
    // is state rather than a bare boolean: creating a worktree, asking the
    // machine for a session, and opening it are three different waits.
    const [phase, setPhase] = React.useState<NewSessionStartPhase | null>(null);
    const activeRunRef = React.useRef<StartRun | null>(null);
    const isMountedRef = React.useRef(true);
    React.useEffect(() => {
        // Set on the way in as well as cleared on the way out. An effect that
        // only clears is wrong for any setup/cleanup/setup cycle — Strict Mode
        // does exactly that in development — and the flag would stay false for
        // a mounted hook, which silently skips the final phase reset and leaves
        // the composer spinning forever.
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const cancelStart = React.useCallback(() => {
        const run = activeRunRef.current;
        if (!run) return;
        run.cancel();
        // Spent here, synchronously, and not when the canceled flow eventually
        // resumes. Stop hands the composer back on this same tick, so a new
        // Start can be pressed before that resumption ever runs — and if the
        // key were still pending it would be handed to that new attempt, which
        // the machine would then dedupe straight onto the session this cancel
        // is in the middle of killing.
        completeSpawnRequest();
        // The flow is let go of right here rather than when its body finishes
        // unwinding. Waiting for that is what left Stop useless: one await that
        // never returns and the composer, and every later Start, is held
        // hostage by an attempt nobody is watching any more.
        activeRunRef.current = null;
        if (isMountedRef.current) setPhase(null);
    }, []);

    const startSession = React.useCallback(async (
        workspaceEntries: readonly WorkspaceContextEntry[] = [],
    ): Promise<boolean> => {
        if (activeRunRef.current) return false;

        const draft = useNewSessionDraft.getState();
        const agentType = draft.agentType;
        const selectedChoice = findMachineChoice(
            collectMachineChoices(machines),
            draft.selectedMachineId,
        );
        const machine = resolveAgentMachine(selectedChoice, agentType);
        if (!machine) {
            Modal.alert(t('common.error'), t("uiCopy.pleaseSelectAMachine"));
            return false;
        }

        // Home stores one physical-computer choice. Resolve its exact daemon
        // from the selected agent at submit time so a render between picker
        // changes cannot send Happy Agent work to Happy CLI (or vice versa).
        if (!isMachineOnline(machine)) {
            Modal.alert(t('common.error'), t("newSession.machineOffline"));
            return false;
        }
        const rigCreation = agentType === 'rig'
            ? getRigMachineSessionCreation(machine.metadata)
            : null;
        const availability = machine.metadata?.cliAvailability;
        const agentUnavailable = agentType === 'agy' || agentType === 'grok' || agentType === 'dsh'
            ? availability?.[agentType] !== true
            : Boolean(availability && availability[agentType] !== true);
        if (agentType !== 'rig' && agentUnavailable) {
            Modal.alert(t('common.error'), t("uiCopy.theSelectedAgentConfigurationIsUnavailable"));
            return false;
        }
        if (agentType === 'rig' && !rigCreation) {
            Modal.alert(t('common.error'), t('uiCopy.thisRigMachineIsNotAvailableForSessionCreation'));
            return false;
        }
        const machineCatalog = machine.metadata?.agentCapabilities?.[agentType];
        if ((agentType === 'grok' || agentType === 'dsh') && !machineCatalog) {
            Modal.alert(
                t('common.error'),
                (agentType === 'grok'
                    ? machine.metadata?.grokCapabilityError
                    : machine.metadata?.dshCapabilityError)
                    ?? t("uiCopy.theSelectedAgentConfigurationIsUnavailable"),
            );
            return false;
        }
        const defaults = resolveAgentDefaultConfig(defaultOverrides, agentType);
        const permissionOptions = rigCreation?.permissionModes
            ?? (machineCatalog
                ? getMachineAdvertisedPermissionModes(machine.metadata, agentType, t, draft.permissionMode)
                : filterPermissionModesForCli(
                    getHardcodedPermissionModes(agentType, t),
                    machine.metadata?.happyCliVersion,
                ));
        const modelOptions = rigCreation?.models
            ?? (machineCatalog
                ? getMachineAdvertisedModels(machine.metadata, agentType, t, draft.modelMode)
                : includeConfiguredModel(
                    agentType,
                    getHardcodedModelModes(agentType, t),
                    draft.modelMode ?? defaults.modelMode,
                    t,
                ));
        const permission = resolveOption<{ key: string }>(
            permissionOptions,
            agentType === 'grok' || agentType === 'dsh' || agentType === 'rig'
                ? [
                    draft.permissionMode ?? defaults.permissionMode,
                    rigCreation?.defaultPermissionMode ?? getAdvertisedDefaultOptionKey(permissionOptions),
                ]
                : [
                    draft.permissionMode,
                    defaults.permissionMode,
                    getCodeAgentDefaults(agentType).permissionMode,
                ],
        );
        const model = resolveOption<{ key: string }>(
            modelOptions,
            agentType === 'grok' || agentType === 'dsh' || agentType === 'rig'
                ? [
                    draft.modelMode ?? defaults.modelMode,
                    rigCreation?.defaultModelKey ?? getAdvertisedDefaultOptionKey(modelOptions),
                ]
                : [draft.modelMode, defaults.modelMode],
        );
        const effortOptions = rigCreation
            ? rigCreation.effortsForModel(model?.key).map((key) => ({ key, name: key }))
            : machineCatalog
                ? getMachineAdvertisedEffortLevels(machine.metadata, agentType, model?.key ?? 'default')
                : getEffortLevelsForModel(agentType, model?.key ?? 'default');
        const effectiveEffortDefault = resolveAgentDefaultEffortLevel(
            defaultOverrides,
            agentType,
            effortOptions,
        ) ?? rigCreation?.defaultEffortForModel(model?.key);
        const effort = resolveOption<{ key: string }>(
            effortOptions,
            agentType === 'grok' || agentType === 'dsh' || agentType === 'rig'
                ? [
                    draft.effortLevel ?? effectiveEffortDefault,
                    rigCreation?.defaultEffortForModel(model?.key)
                        ?? getAdvertisedDefaultOptionKey(effortOptions),
                ]
                : [draft.effortLevel, effectiveEffortDefault],
        );
        const initialSelectionError = validateNewSessionLaunchSelection({
            agentAvailable: true,
            permissionOptions,
            modelOptions,
            effortOptions,
            permissionKey: permission?.key,
            modelKey: model?.key,
            effortKey: effort?.key,
        });
        if (initialSelectionError || (agentType === 'rig' && (!permission || !model || !effort))) {
            Modal.alert(t('common.error'), t("uiCopy.theSelectedAgentConfigurationIsUnavailable"));
            return false;
        }

        const prompt = draft.input.trim();
        const attachments = supportsImageAttachmentsForFlavor(agentType, machineCatalog?.acp)
            ? draft.attachments
            : [];
        const selectedPath = draft.selectedPath?.trim() || '~';
        const absolutePath = resolveAbsolutePath(selectedPath, machine.metadata?.homeDir);
        const sessionList = (sessions ?? []).filter((item): item is Session => typeof item !== 'string');
        const places = collectSessionPlaces({
            machineIds: selectedChoice?.machineIds ?? [machine.id],
            selectedPath,
            sessions: sessionList,
        });
        const selectedProjectId = places.find((place) => place.path === selectedPath)?.projectId ?? null;
        const projectWorkspaces = collectSessionWorkspaces({
            machineIds: selectedChoice?.machineIds ?? [machine.id],
            projectId: selectedProjectId,
            sessions: sessionList,
        });
        const requestedWorktree = draft.sessionType === 'worktree'
            ? draft.worktreeKey ?? '__new__'
            : '__none__';
        let happyAgentTarget: ReturnType<typeof resolveHappyAgentSpawnTarget>;
        try {
            happyAgentTarget = rigCreation
                ? resolveHappyAgentSpawnTarget({
                    projectId: selectedProjectId,
                    workspaceSelection: requestedWorktree,
                    workspaces: projectWorkspaces,
                })
                : null;
        } catch (error) {
            Modal.alert(
                t('common.error'),
                error instanceof HappyAgentWorkspaceUnavailableError
                    ? t('newSession.workspaceNoLongerAvailable')
                    : t('uiCopy.theSelectedAgentConfigurationIsUnavailable'),
            );
            return false;
        }
        // Native Project workspace creation belongs to Happy Agent. An
        // ordinary git worktree may instead belong to the paired Happy CLI,
        // while the session itself still spawns through the selected agent.
        const worktreeSelection = requestedWorktree;
        const worktreeCreationMachine = resolveWorktreeCreationMachine(
            selectedChoice,
            agentType,
            rigCreation?.supportsWorktrees ?? getSupportsWorktree(agentType),
        );
        // Reused across every retry of this exact request so a second press of
        // Start is deduped by Rig instead of spawning a second session.
        const clientRequestId = resolveSpawnRequestId(buildSpawnRequestSignature({
            machineId: machine.id,
            agent: agentType,
            directory: selectedPath,
            worktree: worktreeSelection,
            modelKey: model?.key ?? null,
            permissionMode: permission?.key ?? null,
            effort: effort?.key ?? null,
        }));

        const run = beginRun();
        activeRunRef.current = run;
        // Stop returns the composer on the next tick, prompt still in it, no
        // matter what the machine is or is not doing.
        const untilCanceled = <T,>(work: Promise<T>): Promise<T | typeof CANCELED> =>
            Promise.race([work, run.signal]);
        // Only this attempt may drive the display, and only while it is still
        // the current one: a step finishing late must not raise a spinner over
        // a composer that has already been handed back.
        const showPhase = (next: NewSessionStartPhase) => {
            if (isMountedRef.current && activeRunRef.current === run) setPhase(next);
        };
        setPhase(worktreeSelection === '__new__' ? 'worktree' : 'spawning');
        // A session that arrives after Stop still has to be put down, and by
        // then nobody is on this screen to do it, so this runs unattended.
        const stopAbandonedSession = async (createdSessionId: string) => {
            // The daemon first: it holds the child process and its socket is the
            // one this session was spawned through. The session's own kill RPC
            // is tried after, for a session already up and detached from the
            // daemon, and the archive last so a session nobody can reach still
            // leaves the active list rather than sitting there as debris.
            const stopped = await machineStopSession(machine.id, createdSessionId);
            if (!stopped.success) {
                const killed = await sessionKill(createdSessionId);
                if (!killed.success) {
                    await sessionArchive(createdSessionId);
                }
            }
            await sync.refreshSessions().catch(() => { /* the list catches up on its own */ });
        };
        try {
            let spawnDirectory = absolutePath;
            if (worktreeSelection === '__new__' && !happyAgentTarget) {
                if (!worktreeCreationMachine) {
                    Modal.alert(t('common.error'), t("uiCopy.failedToCreateWorktree"));
                    return false;
                }
                const worktreeResult = await untilCanceled(createWorktree(worktreeCreationMachine.id, absolutePath));
                // The worktree itself is left wherever git got to: it is a
                // directory, not a running agent, and the next start offers it.
                if (worktreeResult === CANCELED) return false;
                if (!worktreeResult.success) {
                    Modal.alert(t('common.error'), worktreeResult.error || t("uiCopy.failedToCreateWorktree"));
                    return false;
                }
                spawnDirectory = worktreeResult.worktreePath;
                showPhase('spawning');
            } else if (!happyAgentTarget && worktreeSelection !== '__none__') {
                spawnDirectory = worktreeSelection;
            }

            const spawn = async (approvedNewDirectoryCreation = false): Promise<string | null> => {
                // Directory approval can keep this flow open while the daemon
                // refreshes its provider catalog. Re-read and revalidate on
                // every actual launch attempt, including the approved retry.
                const latestMachine = storage.getState().machines[machine.id];
                if (!latestMachine || !isMachineOnline(latestMachine)) {
                    Modal.alert(t('common.error'), t("newSession.machineOffline"));
                    return null;
                }
                const latestRigCreation = agentType === 'rig'
                    ? getRigMachineSessionCreation(latestMachine.metadata)
                    : null;
                const latestAvailability = latestMachine.metadata?.cliAvailability;
                const latestAgentAvailable = agentType === 'rig'
                    ? latestRigCreation !== null
                    : agentType === 'agy' || agentType === 'grok' || agentType === 'dsh'
                        ? latestAvailability?.[agentType] === true
                        : !latestAvailability || latestAvailability[agentType] === true;
                const latestMachineCatalog = latestMachine.metadata?.agentCapabilities?.[agentType];
                if ((agentType === 'grok' || agentType === 'dsh') && !latestMachineCatalog) {
                    Modal.alert(
                        t('common.error'),
                        (agentType === 'grok'
                            ? latestMachine.metadata?.grokCapabilityError
                            : latestMachine.metadata?.dshCapabilityError)
                            ?? t("uiCopy.theSelectedAgentConfigurationIsUnavailable"),
                    );
                    return null;
                }
                const latestPermissionOptions = latestRigCreation?.permissionModes
                    ?? (latestMachineCatalog
                        ? getMachineAdvertisedPermissionModes(
                            latestMachine.metadata,
                            agentType,
                            t,
                            permission?.key,
                        )
                        : filterPermissionModesForCli(
                            getHardcodedPermissionModes(agentType, t),
                            latestMachine.metadata?.happyCliVersion,
                        ));
                const latestModelOptions = latestRigCreation?.models
                    ?? (latestMachineCatalog
                        ? getMachineAdvertisedModels(latestMachine.metadata, agentType, t, model?.key)
                        : includeConfiguredModel(
                            agentType,
                            getHardcodedModelModes(agentType, t),
                            model?.key ?? defaults.modelMode,
                            t,
                        ));
                const latestEffortOptions = latestRigCreation
                    ? latestRigCreation.effortsForModel(model?.key).map((key) => ({ key, name: key }))
                    : latestMachineCatalog
                        ? getMachineAdvertisedEffortLevels(
                            latestMachine.metadata,
                            agentType,
                            model?.key ?? 'default',
                        )
                        : getEffortLevelsForModel(agentType, model?.key ?? 'default');
                const latestSelectionError = validateNewSessionLaunchSelection({
                    agentAvailable: latestAgentAvailable,
                    permissionOptions: latestPermissionOptions,
                    modelOptions: latestModelOptions,
                    effortOptions: latestEffortOptions,
                    permissionKey: permission?.key,
                    modelKey: model?.key,
                    effortKey: effort?.key,
                });
                if (latestSelectionError || (agentType === 'rig' && (!permission || !model || !effort))) {
                    Modal.alert(t('common.error'), t("uiCopy.theSelectedAgentConfigurationIsUnavailable"));
                    return null;
                }

                const spawnOptions = latestRigCreation
                    ? {
                        machineId: latestMachine.id,
                        ...buildRigSpawnConfiguration(latestMachine.metadata, {
                            directory: spawnDirectory,
                            clientRequestId,
                            approvedNewDirectoryCreation,
                            modelKey: model?.key,
                            permissionMode: permission?.key,
                            effort: effort?.key,
                        }),
                        ...(happyAgentTarget ? { happyAgentTarget } : {}),
                    }
                    : {
                        machineId: latestMachine.id,
                        directory: spawnDirectory,
                        approvedNewDirectoryCreation,
                        agent: agentType,
                        // Claude's Default is ambient; Codex's Default is a
                        // concrete ask-first execution policy.
                        permissionMode: permission?.key && (
                            agentType === 'codex' || agentType === 'grok' || permission.key !== 'default'
                        )
                            ? permission.key
                            : undefined,
                        modelMode: model?.key && model.key !== 'default' ? model.key : undefined,
                        effortLevel: effort?.key,
                        commanderId: draft.selectedCommanderId ?? undefined,
                    };
                let result = await machineSpawnNewSession(spawnOptions);
                let pendingResults = 0;
                while (result.type === 'pending' && pendingResults < MAX_RIG_PENDING_RESULTS) {
                    pendingResults += 1;
                    await delay(resolveRigPendingRetryDelayMs(
                        result.retryAfterMs,
                        latestRigCreation?.pendingRetryAfterMs,
                    ));
                    if (!isMountedRef.current || run.canceled) return null;
                    result = await machineSpawnNewSession(spawnOptions);
                }

                // The id comes back even when nobody is waiting on it any
                // more: a session that was really created is the caller's to
                // clean up, and it cannot do that without the id.
                if (result.type === 'success') return result.sessionId;
                if (!isMountedRef.current || run.canceled) return null;

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

            const spawning = spawn();
            const spawned = await untilCanceled(spawning);
            if (spawned === CANCELED) {
                // The key was already spent by cancelStart, on the tick Stop
                // was pressed. Nothing to do here but put down whatever the
                // machine hands back.
                void spawning
                    .then((late) => { if (late) return stopAbandonedSession(late); })
                    .catch(() => { /* the spawn already reported its own failure */ });
                return false;
            }
            const sessionId = spawned;
            if (!sessionId) return false;
            // The idempotency key did its job; the next Start is a new session.
            completeSpawnRequest();
            showPhase('opening');

            if (await untilCanceled(sync.refreshSessions()) === CANCELED) {
                void stopAbandonedSession(sessionId);
                return false;
            }

            if (agentType !== 'rig') {
                const modesPatch: SessionAgentModesPatch = {};
                // GrokBuild permission is launch-only, so every session keeps
                // the exact policy its process started with even if the saved
                // New Session default changes later.
                if (agentType !== 'dsh' && permission?.key && (agentType === 'grok' || permission.key !== defaults.permissionMode)) {
                    modesPatch.permissionMode = permission.key;
                }
                if (model?.key && model.key !== defaults.modelMode) modesPatch.modelMode = model.key;
                if ((effort?.key ?? null) !== effectiveEffortDefault) modesPatch.effortLevel = effort?.key ?? null;
                if (Object.keys(modesPatch).length > 0) {
                    sessionSetAgentModes(sessionId, modesPatch);
                }
            }

            // Last look before anything becomes irreversible. Past this line the
            // prompt is cleared, the screen changes, and the message goes out —
            // a Stop that lands a moment too late must not do all three anyway.
            if (run.canceled) {
                void stopAbandonedSession(sessionId);
                return false;
            }

            let initialPrompt = prompt;
            let initialDisplayText = prompt;
            if (workspaceEntries.length > 0) {
                workspaceEntries.forEach((entry) => addWorkspaceContextEntry(sessionId, entry));
                const buildingWorkspaceMessage = buildWorkspaceContextMessage(
                    sessionId,
                    prompt,
                    workspaceEntries,
                    agentType === 'dsh' ? { machineFilesAsReferences: true } : undefined,
                );
                let workspaceMessage: Awaited<typeof buildingWorkspaceMessage>;
                try {
                    const completedWorkspaceMessage = await untilCanceled(buildingWorkspaceMessage);
                    if (completedWorkspaceMessage === CANCELED) {
                        // The context reader can be waiting on the same quiet
                        // machine as spawn/refresh. Release Home immediately,
                        // clear its transient selection, and put down the
                        // already-created session when Stop wins the race.
                        void buildingWorkspaceMessage.catch(() => { /* cancellation owns this failure */ });
                        void stopAbandonedSession(sessionId);
                        return false;
                    }
                    workspaceMessage = completedWorkspaceMessage;
                } finally {
                    clearWorkspaceContextFiles(sessionId);
                }
                initialPrompt = workspaceMessage.promptText;
                initialDisplayText = workspaceMessage.displayText;
            }

            draft.setInput('');
            draft.setAttachments([]);
            navigateToSession(sessionId);
            if (initialPrompt || attachments.length > 0) {
                // The session is ready at this point. Open it immediately and
                // let the first message enqueue without keeping the user on Home
                // during image upload or a slower network round-trip.
                void sync.sendMessage(sessionId, initialPrompt, {
                    source: 'new_session',
                    attachments,
                    ...(workspaceEntries.length > 0 ? { displayText: initialDisplayText } : {}),
                }).catch((error) => {
                    Modal.alert(
                        t('common.error'),
                        error instanceof Error ? error.message : t("uiCopy.failedToSendTheFirstMessage"),
                    );
                });
            }
            return true;
        } catch (error) {
            // A failure the user already walked away from is not news.
            if (!run.canceled) {
                Modal.alert(
                    t('common.error'),
                    error instanceof Error ? error.message : t("uiCopy.failedToStartSession"),
                );
            }
            return false;
        } finally {
            // Only if this attempt is still the current one. A canceled attempt
            // gave up its claim the moment Stop was pressed, and a newer Start
            // may already own the composer by the time this line is reached.
            if (activeRunRef.current === run) {
                activeRunRef.current = null;
                if (isMountedRef.current) setPhase(null);
            }
        }
    }, [defaultOverrides, machines, navigateToSession, sessions]);

    return { isStarting: phase !== null, phase, startSession, cancelStart };
}
