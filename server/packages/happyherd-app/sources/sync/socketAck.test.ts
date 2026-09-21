import { afterEach, describe, expect, it, vi } from 'vitest';
import { io } from 'socket.io-client';

import { emitWithNativeAckTimeout, SocketAckTimeoutError } from './socketAck';

describe('emitWithNativeAckTimeout', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('removes a disconnected mutation before a later reconnect can apply it', async () => {
        vi.useFakeTimers();
        const socket = io('http://127.0.0.1:9', {
            autoConnect: false,
            reconnection: false,
        });
        const buffered = socket as unknown as { sendBuffer: unknown[] };

        const mutation = emitWithNativeAckTimeout(
            socket,
            'update-metadata',
            { sid: 'child' },
            100,
        );
        const rejection = expect(mutation).rejects.toBeInstanceOf(SocketAckTimeoutError);
        expect(buffered.sendBuffer).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(100);
        await rejection;

        expect(buffered.sendBuffer).toHaveLength(0);
        socket.close();
    });
});
