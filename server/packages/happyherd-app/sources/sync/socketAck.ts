import type { Socket } from 'socket.io-client';

export class SocketAckTimeoutError extends Error {
    constructor(event: string) {
        super(`Socket acknowledgement timed out for ${event}`);
        this.name = 'SocketAckTimeoutError';
    }
}

/**
 * Use Socket.IO's native acknowledgement timeout rather than Promise.race.
 * Native timeout removes a disconnected packet from sendBuffer, preventing a
 * mutation that already reported failure from applying on a later reconnect.
 */
export async function emitWithNativeAckTimeout<T>(
    socket: Socket,
    event: string,
    data: unknown,
    timeoutMs: number,
): Promise<T> {
    try {
        return await socket.timeout(timeoutMs).emitWithAck(event, data) as T;
    } catch {
        throw new SocketAckTimeoutError(event);
    }
}
