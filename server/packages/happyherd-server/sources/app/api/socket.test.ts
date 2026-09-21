import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startSocket } from './socket';
import { getMetricsLabelsFromSocket } from '@/app/monitoring/metrics2';
import type { Socket } from 'socket.io';
import type { Fastify } from './types';

const { io, verifyToken } = vi.hoisted(() => ({
    io: { use: vi.fn(), on: vi.fn() },
    verifyToken: vi.fn(async () => ({ userId: 'owner' })),
}));
vi.mock('socket.io', () => ({ Server: vi.fn(function () { return io; }) }));
vi.mock('@/app/auth/auth', () => ({ auth: { verifyToken } }));
vi.mock('@/app/events/eventRouter', () => ({ eventRouter: { init: vi.fn() } }));
vi.mock('@/utils/shutdown', () => ({ onShutdown: vi.fn() }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
vi.mock('@/storage/db', () => ({ db: {} }));
vi.mock('./socket/usageHandler', () => ({ usageHandler: vi.fn() }));
vi.mock('./socket/rpcHandler', () => ({ rpcHandler: vi.fn() }));
vi.mock('./socket/pingHandler', () => ({ pingHandler: vi.fn() }));
vi.mock('./socket/sessionUpdateHandler', () => ({ sessionUpdateHandler: vi.fn() }));
vi.mock('./socket/machineUpdateHandler', () => ({ machineUpdateHandler: vi.fn() }));
vi.mock('./socket/artifactUpdateHandler', () => ({ artifactUpdateHandler: vi.fn() }));
vi.mock('./socket/accessKeyHandler', () => ({ accessKeyHandler: vi.fn() }));

describe('socket handshake compatibility', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('REDIS_URL', '');
    });
    afterEach(() => vi.unstubAllEnvs());

    it.each([
        ['user-scoped', 'ios'],
        ['user-scoped', 'android'],
        ['user-scoped', 'web'],
        ['user-scoped', 'desktop'],
        ['session-scoped', 'cli-coding-session'],
        ['machine-scoped', 'cli-daemon'],
    ])('retains the established %s %s client identity through authentication', async (clientType, client) => {
        startSocket({ server: {} } as Fastify);
        const middleware = io.use.mock.calls[0][0];
        const socket = {
            handshake: {
                auth: JSON.parse(JSON.stringify({
                    token: 'test-token', clientType, sessionId: 'session', machineId: 'machine',
                    happyClient: `${client}/1.2.3`,
                })),
                headers: {},
            },
            data: {},
        } as Socket;
        const next = vi.fn();

        await middleware(socket, next);

        expect(verifyToken).toHaveBeenCalledWith('test-token');
        expect(next).toHaveBeenCalledWith();
        expect(socket.data.userId).toBe('owner');
        expect(getMetricsLabelsFromSocket(socket)).toEqual({ client, client_type: client });
    });
});

describe('Socket.IO payload limit', () => {
    it('can carry the encoded 16 MiB Workspace live response envelope', () => {
        const source = readFileSync(join(__dirname, 'socket.ts'), 'utf8');
        expect(source).toContain('maxHttpBufferSize: 40 * 1024 * 1024');
    });
});
