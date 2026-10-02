import * as React from 'react';
import { getSessionTransport, subscribeSessionTransport } from '@/sync/sessionTransport';
import type { Session } from '@/sync/storageTypes';
import type { SessionRowData } from '@/sync/storage';

function useTransportTarget(machineId: string | null | undefined, sessionId: string) {
    const subscribe = React.useCallback((listener: () => void) => machineId
        ? subscribeSessionTransport(machineId, sessionId, listener) : () => {}, [machineId, sessionId]);
    const snapshot = React.useCallback(() => machineId ? getSessionTransport(machineId, sessionId) : null, [machineId, sessionId]);
    return React.useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function useSessionTransport(session: Pick<Session, 'id' | 'metadata'> | null | undefined) {
    return useTransportTarget(session?.metadata?.isSuperSession ? session.metadata.machineId : undefined, session?.id ?? '');
}

export function useSessionRowState(session: SessionRowData) {
    const transport = useTransportTarget(session.isSuperSession ? session.machineId : undefined, session.id);
    return session.isSuperSession
        ? transport?.state === 'connected' ? session.connectedState ?? session.state : 'disconnected'
        : session.state;
}
