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

import { resumeSessionOnMachine, spawnSessionOnMachine } from './machineRpc';

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
                    pmaiBrokerUrl: 'http://127.0.0.1:3210/mcp',
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
            runtimeContext: {
                discordSurfaceId: 'dm:123',
                pmaiCapabilityId: 'capability-1',
                pmaiBrokerUrl: 'http://127.0.0.1:3210/mcp',
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
                runtimeContext: {
                    discordSurfaceId: 'dm:123',
                    pmaiCapabilityId: ' '.repeat(513),
                    pmaiBrokerUrl: 'http://127.0.0.1:3210/mcp',
                },
            },
        )).rejects.toThrow('pmaiCapabilityId must be a non-empty string');
    });

    it('reinjects bounded runtime context when resuming a session', async () => {
        await expect(resumeSessionOnMachine(
            { serverUrl: 'https://happy.example', homeDir: '/tmp/happy', credentialPath: '/tmp/key' },
            machine,
            'account-token',
            'session-1',
            {
                discordSurfaceId: 'guild:456:channel:789',
                pmaiCapabilityId: 'capability-2',
                pmaiBrokerUrl: 'http://127.0.0.1:3210/mcp',
            },
        )).resolves.toEqual({ type: 'success', sessionId: 'session-1' });

        expect(socket.rpcPayload?.method).toBe('machine-1:resume-happy-session');
        const params = decrypt(
            machine.encryption.key,
            machine.encryption.variant,
            decodeBase64(socket.rpcPayload!.params),
        );
        expect(params).toEqual({
            sessionId: 'session-1',
            runtimeContext: {
                discordSurfaceId: 'guild:456:channel:789',
                pmaiCapabilityId: 'capability-2',
                pmaiBrokerUrl: 'http://127.0.0.1:3210/mcp',
            },
        });
    });
});
