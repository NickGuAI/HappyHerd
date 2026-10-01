import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { socketServerOptions } from '@/app/api/socketConfig';

// Exercise both real Engine.IO transports. The upper bound uses WebSocket:
// polling repeatedly scans accumulated text, making a 41 MiB request quadratic.
describe('socket server packet limit', () => {
    it('carries an encrypted metadata packet past the 1 MB Engine.IO default and stays bounded at 40 MiB', async () => {
        const httpServer = createServer();
        expect(socketServerOptions.maxHttpBufferSize).toBe(40 * 1024 * 1024);
        const io = new Server(httpServer, socketServerOptions);
        const receivedLengths: number[] = [];
        const received = new Promise<number>((resolve) => {
            io.on('connection', (socket) => {
                socket.on('metadata', (value: string) => {
                    receivedLengths.push(value.length);
                    resolve(value.length);
                });
            });
        });
        await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
        const port = (httpServer.address() as AddressInfo).port;
        const base = `http://127.0.0.1:${port}/v1/updates/?EIO=4&transport=polling`;
        let websocket: WebSocket | undefined;
        const requestOptions = { headers: { Connection: 'close' } };
        try {
            const open = await fetch(base, requestOptions);
            const handshake = JSON.parse((await open.text()).slice(1)) as { sid: string; maxPayload: number };
            expect(handshake.maxPayload).toBe(40 * 1024 * 1024);
            const sid = handshake.sid;
            const post = (body: string) => fetch(`${base}&sid=${sid}`, { ...requestOptions, method: 'POST', body });
            expect(await (await post('40')).text()).toBe('ok'); // namespace connect
            await (await fetch(`${base}&sid=${sid}`, requestOptions)).text(); // drain the connect ack

            // A session draft near the daemon's 1,000,000-character limit arrives
            // as one encrypted base64 packet well past the old 1,000,000-byte
            // default, which answered it with 413 and broke synchronization.
            const accepted = await post(`42["metadata","${'a'.repeat(1_400_000)}"]`);
            expect(accepted.status).toBe(200);
            await accepted.text();
            expect(await received).toBe(1_400_000);

            // Send an actual oversized frame through the production WebSocket
            // transport. 1009 means the peer rejected the message as too large.
            websocket = new WebSocket(`ws://127.0.0.1:${port}/v1/updates/?EIO=4&transport=websocket`);
            await once(websocket, 'message'); // Engine.IO open packet
            const namespaceConnected = once(websocket, 'message');
            websocket.send('40');
            await namespaceConnected;
            const closed = once(websocket, 'close');
            await new Promise<void>((resolve, reject) => {
                websocket!.send(`42["metadata","${'a'.repeat(41 * 1024 * 1024)}"]`, (error) => error ? reject(error) : resolve());
            });
            const [code] = await closed;
            expect(code).toBe(1009);
            expect(receivedLengths).toEqual([1_400_000]);
        } finally {
            websocket?.terminate();
            httpServer.closeAllConnections();
            await io.close();
        }
    });
});
