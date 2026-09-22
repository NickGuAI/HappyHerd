export type CodexQuotaRecoveryContext = {
    sessionId: string;
    machineId?: string;
    action: 'connect-account' | 'add-api-key';
};

/** Read only the recovery context carried by a quota notice, not a general return URL. */
export function getCodexQuotaRecovery(params: {
    quotaRecovery?: string | string[];
    sessionId?: string | string[];
    machineId?: string | string[];
}): CodexQuotaRecoveryContext | undefined {
    if (
        (params.quotaRecovery !== 'connect-account' && params.quotaRecovery !== 'add-api-key')
        || typeof params.sessionId !== 'string'
        || !params.sessionId.trim()
    ) return undefined;
    return {
        action: params.quotaRecovery,
        sessionId: params.sessionId,
        ...(typeof params.machineId === 'string' && params.machineId.trim()
            ? { machineId: params.machineId }
            : {}),
    };
}
