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

    return { canResume: true, canShowResume: true, messageKey: 'sessionInfo.resumeSessionSubtitle' };
}
