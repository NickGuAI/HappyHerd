export type SessionTransportStatus = {
    sessionId: string;
    providerRunning: boolean;
    state: 'connected' | 'disconnected' | 'reconnecting' | 'error';
    endpoint: string | null;
    currentEndpoint: string;
    errorCode?: string;
    recoveryId?: string;
    pendingMessages: 'replay-on-reconnect';
    canRecover: boolean;
};

type TransportRpc = (machineId: string, method: 'session-transport-status' | 'recover-session-transport', request: { sessionId: string }) => Promise<SessionTransportStatus>;
let transportRpc: TransportRpc | undefined;

// The socket owner installs its existing encrypted RPC. Keeping the status
// store independent avoids pulling native socket/auth initialization into
// pure session selectors and list rendering.
export function configureSessionTransportRpc(rpc: TransportRpc): void {
    transportRpc = rpc;
}
async function requestStatus(machineId: string, method: 'session-transport-status' | 'recover-session-transport', sessionId: string) {
    return transportRpc ? transportRpc(machineId, method, { sessionId }) : unavailable(sessionId);
}

type Entry = {
    status: SessionTransportStatus | null;
    listeners: Set<() => void>;
    timer?: ReturnType<typeof setTimeout>;
    request?: Promise<void>;
    recovery?: Promise<void>;
    revision: number;
    pollGeneration: number;
};
const entries = new Map<string, Entry>();
function entry(machineId: string, sessionId: string) {
    const key = JSON.stringify([machineId, sessionId]);
    if (!entries.has(key)) entries.set(key, { status: null, listeners: new Set(), revision: 0, pollGeneration: 0 });
    return entries.get(key)!;
}
function publish(target: Entry, status: SessionTransportStatus) {
    target.status = status;
    for (const listener of target.listeners) listener();
}
function unavailable(sessionId: string): SessionTransportStatus {
    return { sessionId, providerRunning: false, state: 'error', endpoint: null, currentEndpoint: '',
        errorCode: 'unavailable', pendingMessages: 'replay-on-reconnect', canRecover: false };
}
export function getSessionTransport(machineId: string, sessionId: string) {
    return entry(machineId, sessionId).status;
}
export function refreshSessionTransport(machineId: string, sessionId: string): Promise<void> {
    const target = entry(machineId, sessionId);
    if (target.recovery) return target.recovery;
    if (target.request) return target.request;
    const revision = target.revision;
    target.request = (async () => {
        try {
            const status = await requestStatus(machineId, 'session-transport-status', sessionId);
            if (revision === target.revision) publish(target, status);
        } catch {
            if (revision === target.revision) publish(target, unavailable(sessionId));
        } finally { target.request = undefined; }
    })();
    return target.request;
}
export function subscribeSessionTransport(machineId: string, sessionId: string, listener: () => void) {
    const target = entry(machineId, sessionId);
    target.listeners.add(listener);
    if (target.listeners.size === 1) {
        const generation = ++target.pollGeneration;
        const poll = async () => {
            await refreshSessionTransport(machineId, sessionId);
            if (target.listeners.size && target.pollGeneration === generation) target.timer = setTimeout(poll, 3000);
        };
        void poll();
    }
    return () => {
        target.listeners.delete(listener);
        if (!target.listeners.size) {
            target.pollGeneration++;
            clearTimeout(target.timer);
        }
    };
}
export function recoverSessionTransport(machineId: string, sessionId: string): Promise<void> {
    const target = entry(machineId, sessionId);
    if (target.recovery) return target.recovery;
    if (!target.status?.canRecover || target.status.state === 'reconnecting') return Promise.resolve();
    target.revision++;
    publish(target, { ...target.status, state: 'reconnecting' });
    target.recovery = (async () => {
        try {
            publish(target, await requestStatus(machineId, 'recover-session-transport', sessionId));
        } catch { publish(target, unavailable(sessionId)); }
        finally { target.recovery = undefined; }
    })();
    return target.recovery;
}
