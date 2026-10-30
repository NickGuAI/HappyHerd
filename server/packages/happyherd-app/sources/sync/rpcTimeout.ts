// Creating a side chat can include a provider fork and brief delivery. Match
// the daemon lifecycle's four-minute create budget, plus reconnect grace.
const RPC_ACK_TIMEOUT_MS = 50_000;
const SIDE_CHAT_CREATE_ACK_TIMEOUT_MS = 260_000;
// Keep the app waiting slightly beyond the daemon/server five-minute budget.
const SIDE_CHAT_CLOSE_ALL_ACK_TIMEOUT_MS = 5 * 60_000 + 30_000;

export function rpcAckTimeoutMs(method: string): number {
    const lastColon = method.lastIndexOf(':');
    const baseMethod = lastColon >= 0 ? method.substring(lastColon + 1) : method;
    if (baseMethod === 'happyherd-side-chat-create') return SIDE_CHAT_CREATE_ACK_TIMEOUT_MS;
    if (baseMethod === 'happyherd-side-chat-close-all') return SIDE_CHAT_CLOSE_ALL_ACK_TIMEOUT_MS;
    return RPC_ACK_TIMEOUT_MS;
}
