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
        const result = rpcResultOverride ?? (payload.method.endsWith(':spawn-happy-session')
            ? {
                type: 'success',
                sessionId: 'session-1',
                settings: {
                    provider: 'codex',
                    model: 'gpt-5.6',
                    effort: 'high',
                    permission: 'default',
                },
            }
            : { type: 'success', sessionId: 'session-1' });
        return {
            ok: true,
            result: encodeBase64(encrypt(
                this.machine.encryption.key,
                this.machine.encryption.variant,
                result,
            )),
        };
    }
}

let machine: DecryptedMachine;
let socket: MockSocket;
let rpcResultOverride: unknown;

vi.mock('socket.io-client', () => ({
    io: vi.fn(() => {
        socket = new MockSocket(machine);
        return socket;
    }),
}));

import { callMachineRpc, resumeSessionOnMachine, spawnSessionOnMachine } from './machineRpc';

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
    const tools = [{ name: 'guide', family: 'guide', description: 'Governed guidance' }];
    beforeEach(() => {
        machine = makeMachine();
        rpcResultOverride = undefined;
    });

    it('forwards Commander and bounded runtime context through encrypted RPC', async () => {
        await expect(spawnSessionOnMachine(
            { serverUrl: 'https://happy.example', homeDir: '/tmp/happy', credentialPath: '/tmp/key' },
            machine,
            'account-token',
            {
                directory: '/srv/happyherd-agent',
                approvedNewDirectoryCreation: true,
                agent: 'codex',
                commanderId: 'team-agent',
                permissionMode: 'default',
                modelMode: 'gpt-5.6',
                effortLevel: 'high',
                runtimeContext: {
                    surfaceId: 'dm:123',
                    capabilityId: 'capability-1',
                    brokerUrl: 'http://127.0.0.1:3210/mcp',
                    tools,
                },
                resumeCodexThreadId: 'thread-child',
                parentSessionId: 'session-parent',
                isSideChat: true,
            },
        )).resolves.toEqual({
            type: 'success',
            sessionId: 'session-1',
            settings: {
                provider: 'codex',
                model: 'gpt-5.6',
                effort: 'high',
                permission: 'default',
            },
        });

        expect(socket.rpcPayload?.method).toBe('machine-1:spawn-happy-session');
        const params = decrypt(
            machine.encryption.key,
            machine.encryption.variant,
            decodeBase64(socket.rpcPayload!.params),
        );
        expect(params).toEqual(expect.objectContaining({
            type: 'spawn-in-directory',
            directory: '/srv/happyherd-agent',
            approvedNewDirectoryCreation: true,
            agent: 'codex',
            commanderId: 'team-agent',
            permissionMode: 'default',
            modelMode: 'gpt-5.6',
            effortLevel: 'high',
            runtimeContext: {
                surfaceId: 'dm:123',
                capabilityId: 'capability-1',
                brokerUrl: 'http://127.0.0.1:3210/mcp',
                tools,
            },
            resumeCodexThreadId: 'thread-child',
            parentSessionId: 'session-parent',
            isSideChat: true,
        }));
        expect(socket.rpcPayload?.params).not.toContain('account-token');
    });

    it('forwards Claude resume and child-lineage fields through the spawn RPC', async () => {
        rpcResultOverride = {
            type: 'success',
            sessionId: 'session-child',
            settings: { provider: 'claude', model: 'default', effort: null, permission: 'default' },
        };

        await spawnSessionOnMachine(
            { serverUrl: 'https://happy.example', homeDir: '/tmp/happy', credentialPath: '/tmp/key' },
            machine,
            'account-token',
            {
                directory: '/srv/project',
                agent: 'claude',
                resumeClaudeSessionId: 'claude-child',
                parentSessionId: 'session-parent',
                isSideChat: true,
            },
        );

        expect(decrypt(
            machine.encryption.key,
            machine.encryption.variant,
            decodeBase64(socket.rpcPayload!.params),
        )).toEqual(expect.objectContaining({
            resumeClaudeSessionId: 'claude-child',
            parentSessionId: 'session-parent',
            isSideChat: true,
        }));
    });

    it('rejects unbounded runtime context instead of forwarding arbitrary environment', async () => {
        await expect(spawnSessionOnMachine(
            { serverUrl: 'https://happy.example', homeDir: '/tmp/happy', credentialPath: '/tmp/key' },
            machine,
            'account-token',
            {
                directory: '/srv/happyherd-agent',
                agent: 'codex',
                runtimeContext: {
                    surfaceId: 'dm:123',
                    capabilityId: ' '.repeat(513),
                    brokerUrl: 'http://127.0.0.1:3210/mcp',
                    tools,
                },
            },
        )).rejects.toThrow('capabilityId must be a non-empty string');
    });

    it('accepts a legacy success receipt for an omitted-settings caller', async () => {
        rpcResultOverride = { type: 'success', sessionId: 'session-legacy' };
        await expect(spawnSessionOnMachine(
            { serverUrl: 'https://happy.example', homeDir: '/tmp/happy', credentialPath: '/tmp/key' },
            machine,
            'account-token',
            { directory: '/srv/project', agent: 'codex' },
        )).resolves.toEqual({ type: 'success', sessionId: 'session-legacy' });
    });

    it('accepts a legacy success receipt when the legacy caller passes optional settings', async () => {
        rpcResultOverride = { type: 'success', sessionId: 'session-legacy' };
        await expect(spawnSessionOnMachine(
            { serverUrl: 'https://happy.example', homeDir: '/tmp/happy', credentialPath: '/tmp/key' },
            machine,
            'account-token',
            {
                directory: '/srv/project',
                agent: 'codex',
                modelMode: 'gpt-5.6',
                effortLevel: 'high',
                permissionMode: 'yolo',
            },
        )).resolves.toEqual({ type: 'success', sessionId: 'session-legacy' });
    });

    it('reinjects bounded runtime context when resuming a session', async () => {
        await expect(resumeSessionOnMachine(
            { serverUrl: 'https://happy.example', homeDir: '/tmp/happy', credentialPath: '/tmp/key' },
            machine,
            'account-token',
            'session-1',
            {
                surfaceId: 'guild:456:channel:789',
                capabilityId: 'capability-2',
                brokerUrl: 'http://127.0.0.1:3210/mcp',
                tools,
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
                surfaceId: 'guild:456:channel:789',
                capabilityId: 'capability-2',
                brokerUrl: 'http://127.0.0.1:3210/mcp',
                tools,
            },
        });
    });

    it('serializes provider fork calls through the owning machine encryption', async () => {
        rpcResultOverride = { type: 'success', newCodexThreadId: 'thread-child' };

        await expect(callMachineRpc(
            { serverUrl: 'https://happy.example', homeDir: '/tmp/happy', credentialPath: '/tmp/key' },
            machine,
            'account-token-secret',
            'codex-fork-thread',
            { directory: '/srv/project', codexThreadId: 'thread-parent' },
        )).resolves.toEqual({ type: 'success', newCodexThreadId: 'thread-child' });

        expect(socket.rpcPayload?.method).toBe('machine-1:codex-fork-thread');
        expect(decrypt(
            machine.encryption.key,
            machine.encryption.variant,
            decodeBase64(socket.rpcPayload!.params),
        )).toEqual({ directory: '/srv/project', codexThreadId: 'thread-parent' });
        expect(socket.rpcPayload?.params).not.toContain('account-token-secret');
    });

    it('rejects method injection before connecting', async () => {
        await expect(callMachineRpc(
            { serverUrl: 'https://happy.example', homeDir: '/tmp/happy', credentialPath: '/tmp/key' },
            machine,
            'account-token',
            'machine-other:codex-fork-thread',
            {},
        )).rejects.toThrow('Machine RPC method must contain only');
    });
});
