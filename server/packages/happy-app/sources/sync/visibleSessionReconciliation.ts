import type { AppStateStatus } from 'react-native';

export type VisibleSessionReconciliationTrigger =
    | { source: 'app-state'; state: AppStateStatus }
    | { source: 'web-lifecycle'; state: 'active' | 'background' }
    | { source: 'socket-reconnect' };

type VisibleSessionReconciliationDependencies = {
    getCurrentViewingSessionId: () => string | null;
    invalidateMessages: (sessionId: string) => void;
};

/**
 * Reconcile only when a client becomes active again or its socket reconnects.
 * Message request coalescing remains owned by the session's InvalidateSync.
 */
export function requestVisibleSessionReconciliation(
    trigger: VisibleSessionReconciliationTrigger,
    dependencies: VisibleSessionReconciliationDependencies,
): string | null {
    if (trigger.source !== 'socket-reconnect' && trigger.state !== 'active') {
        return null;
    }

    const sessionId = dependencies.getCurrentViewingSessionId();
    if (!sessionId) {
        return null;
    }

    dependencies.invalidateMessages(sessionId);
    return sessionId;
}
