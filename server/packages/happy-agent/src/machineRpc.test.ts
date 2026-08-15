import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { decodeBase64, decrypt, encodeBase64, encrypt, getRandomBytes } from './encryption';
import type { DecryptedMachine } from './api';

class MockSocket extends EventEmitter {
    connected = true;
    rpcPayload: { method: string; params: string } | null = null;
    private readonly machine: DecryptedMachine;

    constructor(machine: DecryptedMachine) {
        super();
        this.machine = machine;
    }

    connect(): void {
        this.connected = true;
    }

    close(): void {
        this.connected = false;
    }

    timeout(): this {
        return this;
    }

    async emitWithAck(_event: string, payload: { method: string; params: string }) {
        this.rpcPayload = payload;
        return {
            ok: true,
            result: encodeBase64(encrypt(
                this.machine.encryption.key,
                this.machine.encryption.variant,
                { type: 'success', sessionId: 'session-1' },
            )),
        };
    }
}

let machine: DecryptedMachine;
let socket: MockSocket;

vi.mock('socket.io-client', () => ({
    io: vi.fn(() => {
        socket = new MockSocket(machine);
        return socket;
    }),
}));

import { spawnSessionOnMachine } from './machineRpc';

function makeMachine(): DecryptedMachine {
    return {
        id: 'machine-1',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: {},
        metadataVersion: 1,
        daemonState: null,
        daemonStateVersion: 0,
        dataEncryptionKey: null,
        encryption: { key: getRandomBytes(32), variant: 'dataKey' },
    };
}

describe('spawnSessionOnMachine', () => {
    beforeEach(() => {
        machine = makeMachine();
    });

    it('forwards Commander and bounded runtime context through encrypted RPC', async () => {
        await expect(spawnSessionOnMachine(
            { serverUrl: 'https://happy.example', homeDir: '/tmp/happy', credentialPath: '/tmp/key' },
            machine,
            'account-token',
            {
                directory: '/srv/pmai-agent',
                agent: 'codex',
                commanderId: 'pmai-team-agent',
                permissionMode: 'default',
                modelMode: 'gpt-5.6',
                effortLevel: 'high',
                runtimeContext: {
                    discordSurfaceId: 'dm:123',
                    pmaiCapabilityId: 'capability-1',
                    pmaiBrokerSocketPath: '/run/pmai/broker.sock',
                },
            },
        )).resolves.toEqual({ type: 'success', sessionId: 'session-1' });

        expect(socket.rpcPayload?.method).toBe('machine-1:spawn-happy-session');
        const params = decrypt(
            machine.encryption.key,
            machine.encryption.variant,
            decodeBase64(socket.rpcPayload!.params),
        );
        expect(params).toEqual(expect.objectContaining({
            type: 'spawn-in-directory',
            directory: '/srv/pmai-agent',
            agent: 'codex',
            commanderId: 'pmai-team-agent',
            permissionMode: 'default',
            modelMode: 'gpt-5.6',
            effortLevel: 'high',
            environmentVariables: {
                PMAI_DISCORD_SURFACE_ID: 'dm:123',
                PMAI_SESSION_CAPABILITY_ID: 'capability-1',
                PMAI_BROKER_SOCKET_PATH: '/run/pmai/broker.sock',
            },
        }));
    });

    it('rejects unbounded runtime context instead of forwarding arbitrary environment', async () => {
        await expect(spawnSessionOnMachine(
            { serverUrl: 'https://happy.example', homeDir: '/tmp/happy', credentialPath: '/tmp/key' },
            machine,
            'account-token',
            {
                directory: '/srv/pmai-agent',
                agent: 'codex',
                runtimeContext: { pmaiCapabilityId: ' '.repeat(513) },
            },
        )).rejects.toThrow('pmaiCapabilityId must be a non-empty string');
    });
});
