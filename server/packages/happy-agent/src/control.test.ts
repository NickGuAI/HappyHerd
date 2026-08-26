import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DecryptedMachine, DecryptedSession } from './api';

const mocks = vi.hoisted(() => ({
    listMachines: vi.fn(),
    listSessions: vi.fn(),
    listActiveSessions: vi.fn(),
    getSessionMessages: vi.fn(),
    invokeSpawn: vi.fn(),
    resume: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./api')>()),
    listMachines: mocks.listMachines,
    listSessions: mocks.listSessions,
    listActiveSessions: mocks.listActiveSessions,
    getSessionMessages: mocks.getSessionMessages,
}));

vi.mock('./machineRpc', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./machineRpc')>()),
    spawnSessionOnMachine: mocks.invokeSpawn,
    resumeSessionOnMachine: mocks.resume,
}));

import { HappyControlClient } from './control';

function machine(): DecryptedMachine {
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
        encryption: { key: new Uint8Array(32), variant: 'dataKey' },
    };
}

function session(spawnSettings: Record<string, unknown> = {
    provider: 'grok', model: 'grok-4.6', effort: 'high', permission: 'plan',
}): DecryptedSession {
    return {
        id: 'session-real',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: { spawnSettings },
        agentState: null,
        dataEncryptionKey: null,
        encryption: { key: new Uint8Array(32), variant: 'dataKey' },
    };
}

function legacySession(): DecryptedSession {
    return { ...session(), metadata: {} };
}

describe('HappyControlClient machine session creation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.invokeSpawn.mockResolvedValue({
            type: 'success',
            sessionId: 'session-real',
            settings: { provider: 'grok', model: 'grok-4.6', effort: 'high', permission: 'plan' },
        });
        mocks.listSessions.mockResolvedValue([session()]);
    });

    it('forwards the selected machine and returns its tracked Happy session', async () => {
        const target = machine();
        const client = new HappyControlClient({
            config: {
                serverUrl: 'https://happy.example',
                homeDir: '/tmp/happy',
                credentialPath: '/tmp/happy/agent.key',
            },
            credentials: {
                token: 'account-token-secret',
                secret: new Uint8Array(32),
                contentKeyPair: {
                    publicKey: new Uint8Array(32),
                    secretKey: new Uint8Array(32),
                },
            },
        });

        await expect(client.spawnSessionOnMachine(target, {
            directory: '/srv/project',
            approvedNewDirectoryCreation: false,
            agent: 'grok',
            modelMode: 'grok-4.6',
            effortLevel: 'high',
            permissionMode: 'plan',
        })).resolves.toMatchObject({ id: 'session-real' });

        expect(mocks.invokeSpawn).toHaveBeenCalledWith(
            client.config,
            target,
            'account-token-secret',
            {
                directory: '/srv/project',
                approvedNewDirectoryCreation: false,
                agent: 'grok',
                modelMode: 'grok-4.6',
                effortLevel: 'high',
                permissionMode: 'plan',
                commanderId: undefined,
                runtimeContext: undefined,
            },
        );
        expect(mocks.listSessions).toHaveBeenCalledTimes(1);
    });

    it('preserves the Codex-specific compatibility method with safe directory defaults', async () => {
        const target = machine();
        mocks.listMachines.mockResolvedValue([target]);
        mocks.invokeSpawn.mockResolvedValueOnce({ type: 'success', sessionId: 'session-real' });
        mocks.listSessions.mockResolvedValueOnce([legacySession()]);
        const client = new HappyControlClient({
            config: { serverUrl: 'https://happy.example', homeDir: '/tmp/happy', credentialPath: '/tmp/key' },
            credentials: {
                token: 'token',
                secret: new Uint8Array(32),
                contentKeyPair: { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) },
            },
        });

        await expect(client.spawnCodexSession({
            machineId: 'machine-1',
            directory: '/srv/project',
            commanderId: 'commander-1',
            modelMode: 'gpt-5.6',
            effortLevel: 'high',
            permissionMode: 'yolo',
        })).resolves.toMatchObject({ id: 'session-real' });

        expect(mocks.invokeSpawn).toHaveBeenCalledWith(
            client.config,
            target,
            'token',
            expect.objectContaining({
                agent: 'codex',
                approvedNewDirectoryCreation: false,
                commanderId: 'commander-1',
                modelMode: 'gpt-5.6',
                effortLevel: 'high',
                permissionMode: 'yolo',
            }),
        );
    });

    it('preserves generic legacy callers with optional settings and a settings-free receipt', async () => {
        const target = machine();
        mocks.invokeSpawn.mockResolvedValueOnce({ type: 'success', sessionId: 'session-real' });
        mocks.listSessions.mockResolvedValueOnce([legacySession()]);
        const client = new HappyControlClient({
            config: { serverUrl: 'https://happy.example', homeDir: '/tmp/happy', credentialPath: '/tmp/key' },
            credentials: {
                token: 'token',
                secret: new Uint8Array(32),
                contentKeyPair: { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) },
            },
        });

        await expect(client.spawnSessionOnMachine(target, {
            directory: '/srv/project',
            approvedNewDirectoryCreation: false,
            agent: 'claude',
            modelMode: 'claude-opus-4-6',
            effortLevel: 'high',
            permissionMode: 'acceptEdits',
        })).resolves.toMatchObject({ id: 'session-real' });
    });

    it('returns the daemon-confirmed receipt only when the session persisted the same settings', async () => {
        const target = machine();
        const client = new HappyControlClient({
            config: { serverUrl: 'https://happy.example', homeDir: '/tmp/happy', credentialPath: '/tmp/key' },
            credentials: {
                token: 'token',
                secret: new Uint8Array(32),
                contentKeyPair: { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) },
            },
        });

        await expect(client.spawnSessionOnMachineConfirmed(target, {
            directory: '/srv/project',
            approvedNewDirectoryCreation: false,
            agent: 'grok',
        })).resolves.toMatchObject({
            session: { id: 'session-real' },
            settings: { provider: 'grok', model: 'grok-4.6', effort: 'high', permission: 'plan' },
        });

        mocks.listSessions.mockResolvedValueOnce([session({
            provider: 'grok', model: 'other', effort: 'high', permission: 'plan',
        })]);
        await expect(client.spawnSessionOnMachineConfirmed(target, {
            directory: '/srv/project',
            approvedNewDirectoryCreation: false,
            agent: 'grok',
        })).rejects.toThrow('persisted settings that do not match');
    });

    it('keeps strict confirmation unavailable for a legacy success receipt', async () => {
        const target = machine();
        mocks.invokeSpawn.mockResolvedValueOnce({ type: 'success', sessionId: 'session-real' });
        const client = new HappyControlClient({
            config: { serverUrl: 'https://happy.example', homeDir: '/tmp/happy', credentialPath: '/tmp/key' },
            credentials: {
                token: 'token',
                secret: new Uint8Array(32),
                contentKeyPair: { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) },
            },
        });

        await expect(client.spawnSessionOnMachineConfirmed(target, {
            directory: '/srv/project',
            approvedNewDirectoryCreation: false,
            agent: 'grok',
            modelMode: 'grok-4.6',
            effortLevel: 'high',
            permissionMode: 'plan',
        })).rejects.toThrow('did not return confirmed machine-session settings');
        expect(mocks.listSessions).not.toHaveBeenCalled();
    });
});
