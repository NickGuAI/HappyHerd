// Creating a side chat can include a provider fork and brief delivery. Match
// the daemon lifecycle's four-minute create budget, plus reconnect grace.
const RPC_ACK_TIMEOUT_MS = 50_000;
const SIDE_CHAT_CREATE_ACK_TIMEOUT_MS = 260_000;

export function rpcAckTimeoutMs(method: string): number {
    const lastColon = method.lastIndexOf(':');
    const baseMethod = lastColon >= 0 ? method.substring(lastColon + 1) : method;
    return baseMethod === 'happyherd-side-chat-create'
        ? SIDE_CHAT_CREATE_ACK_TIMEOUT_MS
        : RPC_ACK_TIMEOUT_MS;
}
