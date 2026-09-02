import type { Machine, Session } from '@/sync/storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';
import { isRigMetadata } from '@/sync/rig';

export type ResumeAvailability = {
    canResume: boolean;
    canShowResume: boolean;
    messageKey: 'sessionInfo.resumeSessionMissingMachine'
        | 'sessionInfo.resumeSessionMissingBackendId'
        | 'sessionInfo.resumeSessionSameMachineOnly'
        | 'sessionInfo.resumeSessionMachineOffline'
        | 'sessionInfo.resumeSessionSubtitle'
        | null;
};

function storedGrokPermissionMode(session: Session): string | undefined {
    const persistedSettings = session.metadata?.spawnSettings;
    if (persistedSettings?.provider === 'grok') {
        return persistedSettings.permission ?? undefined;
    }
    return session.permissionMode ?? session.metadata?.permissionMode ?? undefined;
}

function defaultCatalogOption<T extends { code: string; isDefault?: boolean }>(options: T[]): T | undefined {
    return options.find((option) => option.isDefault === true)
        ?? options.find((option) => option.code === 'default');
}

export type ProviderResumeModes = {
    permissionMode: string;
    modelMode: string | null;
    effortLevel: string | null;
};

function getCatalogResumeModes(
    session: Session,
    machine: Machine | null | undefined,
    provider: 'claude' | 'codex',
): ProviderResumeModes | undefined {
    if (session.metadata?.flavor !== provider) return undefined;

    const catalog = machine?.metadata?.agentCapabilities?.[provider];
    if (!catalog) return undefined;

    const persistedSettings = session.metadata?.spawnSettings?.provider === provider
        ? session.metadata.spawnSettings
        : undefined;
    // A local null is the immediate post-abort state. Prefer the immutable
    // launch receipt before asynchronously synced metadata so a fast next turn
    // cannot revive the stale pre-abort selection.
    const requestedPermission = session.permissionMode
        ?? persistedSettings?.permission
        ?? session.metadata?.permissionMode
        ?? undefined;
    const permission = requestedPermission
        ? catalog.permissionModes.find((option) => option.code === requestedPermission)
        : defaultCatalogOption(catalog.permissionModes);
    if (!permission) return undefined;

    const requestedModel = session.modelMode
        ?? persistedSettings?.model
        ?? session.metadata?.modelMode
        ?? undefined;
    const model = requestedModel
        ? catalog.models.find((option) => option.code === requestedModel)
        : defaultCatalogOption(catalog.models);
    if (requestedModel && !model) return undefined;

    const effortOptions = model?.effortLevels !== undefined
        ? model.effortLevels
        : catalog.effortLevels;
    const requestedEffort = session.effortLevel
        ?? persistedSettings?.effort
        ?? session.metadata?.effortLevel
        ?? undefined;
    if (requestedEffort && !model) return undefined;
    const effort = requestedEffort
        ? effortOptions.find((option) => option.code === requestedEffort)
        : defaultCatalogOption(effortOptions);
    if (requestedEffort && !effort) return undefined;

    return {
        permissionMode: permission.code,
        modelMode: model?.code ?? null,
        effortLevel: effort?.code ?? null,
    };
}

/** Resolve Codex's complete resumable receipt from the exact-machine catalog. */
export function getCodexResumeModes(
    session: Session,
    machine: Machine | null | undefined,
): ProviderResumeModes | undefined {
    return getCatalogResumeModes(session, machine, 'codex');
}

/** Resolve Claude's complete resumable tuple from the exact-machine catalog. */
export function getClaudeResumeModes(
    session: Session,
    machine: Machine | null | undefined,
): ProviderResumeModes | undefined {
    return getCatalogResumeModes(session, machine, 'claude');
}

/** Resolve Codex's resumable permission from its complete validated receipt. */
export function getCodexResumePermissionMode(
    session: Session,
    machine: Machine | null | undefined,
): string | undefined {
    return getCodexResumeModes(session, machine)?.permissionMode;
}

/** Resolve Grok's process launch policy only from the session that is being resumed. */
export function getGrokResumePermissionMode(
    session: Session,
    machine: Machine | null | undefined,
): string | undefined {
    if (session.metadata?.flavor !== 'grok') return undefined;

    const permissionMode = storedGrokPermissionMode(session);
    if (!permissionMode) return undefined;

    const catalog = machine?.metadata?.agentCapabilities?.grok;
    return catalog?.permissionModes.some((option) => option.code === permissionMode)
        ? permissionMode
        : undefined;
}

export function getResumeAvailability(
    session: Session,
    machine: Machine | null | undefined,
    isConnected: boolean,
): ResumeAvailability {
    if (isRigMetadata(session.metadata) || session.metadata?.capabilities?.resume === false) {
        return { canResume: false, canShowResume: false, messageKey: null };
    }
    if (session.metadata?.flavor === 'grok' && session.metadata?.acpCapabilities?.loadSession !== true) {
        return { canResume: false, canShowResume: false, messageKey: null };
    }
    if (session.metadata?.flavor === 'dsh') {
        return { canResume: false, canShowResume: false, messageKey: null };
    }
    if (isConnected) {
        return { canResume: false, canShowResume: false, messageKey: null };
    }

    const machineId = session.metadata?.machineId;
    if (!machineId) {
        return { canResume: false, canShowResume: true, messageKey: 'sessionInfo.resumeSessionMissingMachine' };
    }

    const hasBackendResumeId = Boolean(
        session.metadata?.claudeSessionId
        || session.metadata?.codexThreadId
        || (session.metadata?.flavor === 'grok' && session.metadata?.acpSessionId),
    );
    if (!hasBackendResumeId) {
        return { canResume: false, canShowResume: true, messageKey: 'sessionInfo.resumeSessionMissingBackendId' };
    }

    if (!machine) {
        return { canResume: false, canShowResume: true, messageKey: 'sessionInfo.resumeSessionSameMachineOnly' };
    }

    if (!isMachineOnline(machine)) {
        return { canResume: false, canShowResume: true, messageKey: 'sessionInfo.resumeSessionMachineOffline' };
    }

    if (session.metadata?.flavor === 'grok') {
        const catalog = machine.metadata?.agentCapabilities?.grok;
        const selectedPermission = storedGrokPermissionMode(session);
        if (
            machine.metadata?.cliAvailability?.grok !== true
            || catalog?.acp?.loadSession !== true
            || (selectedPermission !== undefined
                && !catalog.permissionModes.some((option) => option.code === selectedPermission))
        ) {
            return { canResume: false, canShowResume: false, messageKey: null };
        }
    }
    if (session.metadata?.flavor === 'codex') {
        if (
            machine.metadata?.cliAvailability?.codex !== true
            || !getCodexResumeModes(session, machine)
        ) {
            return { canResume: false, canShowResume: false, messageKey: null };
        }
    }
    if (session.metadata?.flavor === 'claude') {
        if (
            machine.metadata?.cliAvailability?.claude !== true
            || !getClaudeResumeModes(session, machine)
        ) {
            return { canResume: false, canShowResume: false, messageKey: null };
        }
    }

    return { canResume: true, canShowResume: true, messageKey: 'sessionInfo.resumeSessionSubtitle' };
}
