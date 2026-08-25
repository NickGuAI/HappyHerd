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

    return { canResume: true, canShowResume: true, messageKey: 'sessionInfo.resumeSessionSubtitle' };
}
