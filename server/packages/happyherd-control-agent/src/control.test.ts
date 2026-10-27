import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DecryptedMachine, DecryptedSession } from './api';

const mocks = vi.hoisted(() => ({
    getSessionById: vi.fn(),
    getProjectById: vi.fn(),
    listProjects: vi.fn(),
    listMachines: vi.fn(),
    listSessions: vi.fn(),
    listActiveSessions: vi.fn(),
    getSessionMessages: vi.fn(),
    assignSessionProject: vi.fn(),
    invokeRpc: vi.fn(),
    invokeSpawn: vi.fn(),
    resume: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./api')>()),
    getSessionById: mocks.getSessionById,
    getProjectById: mocks.getProjectById,
    listProjects: mocks.listProjects,
    listMachines: mocks.listMachines,
    listSessions: mocks.listSessions,
    listActiveSessions: mocks.listActiveSessions,
    getSessionMessages: mocks.getSessionMessages,
    assignSessionProject: mocks.assignSessionProject,
}));

vi.mock('./machineRpc', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./machineRpc')>()),
    callMachineRpc: mocks.invokeRpc,
    spawnSessionOnMachine: mocks.invokeSpawn,
    resumeSessionOnMachine: mocks.resume,
}));

import { HappyHerdControlClient } from './control';

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
        metadataVersion: 1,
        agentState: null,
        dataEncryptionKey: null,
        encryption: { key: new Uint8Array(32), variant: 'dataKey' },
    };
}

function legacySession(): DecryptedSession {
    return { ...session(), metadata: {} };
}

describe('HappyHerdControlClient machine session creation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSessionById.mockResolvedValue(null);
        mocks.getProjectById.mockResolvedValue(null);
        mocks.assignSessionProject.mockResolvedValue({ id: 'session-real', projectId: 'project-one' });
        mocks.invokeSpawn.mockResolvedValue({
            type: 'success',
            sessionId: 'session-real',
            settings: { provider: 'grok', model: 'grok-4.6', effort: 'high', permission: 'plan' },
        });
        mocks.listSessions.mockResolvedValue([session()]);
    });

    it('falls back to exact paginated lookup for a session outside the recent window', async () => {
        const historical = { ...session(), id: 'historical-session' };
        mocks.listSessions.mockResolvedValueOnce([]);
        mocks.getSessionById.mockResolvedValueOnce(historical);
        const client = new HappyHerdControlClient({
            config: { serverUrl: 'https://happy.example', homeDir: '/tmp/happyherd', credentialPath: '/tmp/key' },
            credentials: {
                token: 'token',
                secret: new Uint8Array(32),
                contentKeyPair: { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) },
            },
        });

        await expect(client.resolveSession('historical-session')).resolves.toBe(historical);
        expect(mocks.getSessionById).toHaveBeenCalledWith(
            client.config,
            client.credentials,
            'historical-session',
        );
    });

    it('forwards the selected machine and returns its tracked HappyHerd session', async () => {
        const target = machine();
        const client = new HappyHerdControlClient({
            config: {
                serverUrl: 'https://happy.example',
                homeDir: '/tmp/happyherd',
                credentialPath: '/tmp/happyherd/agent.key',
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
                resumeClaudeSessionId: undefined,
                resumeCodexThreadId: undefined,
                parentSessionId: undefined,
                isSideChat: undefined,
            },
        );
        expect(mocks.listSessions).toHaveBeenCalledTimes(1);
    });

    it('forwards encrypted machine RPC calls with account authority', async () => {
        const target = machine();
        mocks.invokeRpc.mockResolvedValueOnce({ type: 'success', newClaudeSessionId: 'claude-child' });
        const client = new HappyHerdControlClient({
            config: { serverUrl: 'https://happy.example', homeDir: '/tmp/happyherd', credentialPath: '/tmp/key' },
            credentials: {
                token: 'account-token',
                secret: new Uint8Array(32),
                contentKeyPair: { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) },
            },
        });

        await expect(client.callMachineRpc(target, 'claude-fork-session', {
            directory: '/srv/project',
            claudeSessionId: 'claude-parent',
        })).resolves.toEqual({ type: 'success', newClaudeSessionId: 'claude-child' });
        expect(mocks.invokeRpc).toHaveBeenCalledWith(
            client.config,
            target,
            'account-token',
            'claude-fork-session',
            { directory: '/srv/project', claudeSessionId: 'claude-parent' },
        );
    });

    it('lists and resolves account Projects by exact ID', async () => {
        const project = { id: 'project-one', name: 'Example Project A', kind: 'work' };
        mocks.listProjects.mockResolvedValue([project]);
        mocks.getProjectById.mockImplementation((_config: unknown, _credentials: unknown, id: string) =>
            Promise.resolve(id === project.id ? project : null));
        const client = new HappyHerdControlClient({
            config: { serverUrl: 'https://happy.example', homeDir: '/tmp/happyherd', credentialPath: '/tmp/key' },
            credentials: {
                token: 'account-token', secret: new Uint8Array(32),
                contentKeyPair: { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) },
            },
        });

        await expect(client.listProjects()).resolves.toEqual([project]);
        await expect(client.resolveProject('project-one')).resolves.toEqual(project);
        await expect(client.resolveProject('project')).rejects.toThrow('Project "project" was not found');
        expect(mocks.getProjectById).toHaveBeenCalledWith(client.config, client.credentials, 'project');
        await expect(client.resolveProject(' project-one ')).rejects.toThrow('exact, non-empty ID');
    });

    it('verifies the persisted Project after the server assignment response', async () => {
        const selected = { ...session(), projectId: null };
        const updated = { ...session(), projectId: 'project-one' };
        mocks.listSessions
            .mockResolvedValueOnce([selected])
            .mockResolvedValueOnce([updated]);
        mocks.assignSessionProject.mockResolvedValueOnce({ id: 'session-real', projectId: 'project-one' });
        const client = new HappyHerdControlClient({
            config: { serverUrl: 'https://happy.example', homeDir: '/tmp/happyherd', credentialPath: '/tmp/key' },
            credentials: {
                token: 'account-token', secret: new Uint8Array(32),
                contentKeyPair: { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) },
            },
        });

        await expect(client.setSessionProject('session-real', 'project-one')).resolves.toMatchObject({
            id: 'session-real', projectId: 'project-one',
        });
        expect(mocks.assignSessionProject).toHaveBeenCalledWith(
            client.config, client.credentials, 'session-real', 'project-one',
        );
    });

    it('reports actual persisted Project when an assignment does not take effect', async () => {
        const selected = { ...session(), projectId: 'project-old' };
        const unchanged = { ...session(), projectId: 'project-old' };
        mocks.listSessions
            .mockResolvedValueOnce([selected])
            .mockResolvedValueOnce([unchanged]);
        mocks.assignSessionProject.mockResolvedValueOnce({ id: 'session-real', projectId: 'project-one' });
        const client = new HappyHerdControlClient({
            config: { serverUrl: 'https://happy.example', homeDir: '/tmp/happyherd', credentialPath: '/tmp/key' },
            credentials: {
                token: 'account-token', secret: new Uint8Array(32),
                contentKeyPair: { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) },
            },
        });

        await expect(client.setSessionProject('session-real', 'project-one')).rejects.toMatchObject({
            name: 'SessionProjectAssignmentError', actualProjectId: 'project-old',
        });
    });

    it('does not accept a Project receipt read back for a different session ID', async () => {
        const selected = { ...session(), projectId: null };
        const wrongSession = { ...session(), id: 'session-other', projectId: 'project-one' };
        mocks.listSessions
            .mockResolvedValueOnce([selected])
            .mockResolvedValueOnce([]);
        mocks.getSessionById.mockResolvedValueOnce(wrongSession);
        mocks.assignSessionProject.mockResolvedValueOnce({ id: 'session-real', projectId: 'project-one' });
        const client = new HappyHerdControlClient({
            config: { serverUrl: 'https://happy.example', homeDir: '/tmp/happyherd', credentialPath: '/tmp/key' },
            credentials: {
                token: 'account-token', secret: new Uint8Array(32),
                contentKeyPair: { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) },
            },
        });

        await expect(client.setSessionProject('session-real', 'project-one')).rejects.toMatchObject({
            name: 'SessionProjectAssignmentError', actualProjectId: 'project-one',
        });
    });

    it('forwards child lineage and provider resume IDs in the spawn payload', async () => {
        const target = machine();
        const client = new HappyHerdControlClient({
            config: { serverUrl: 'https://happy.example', homeDir: '/tmp/happyherd', credentialPath: '/tmp/key' },
            credentials: {
                token: 'account-token',
                secret: new Uint8Array(32),
                contentKeyPair: { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) },
            },
        });

        await client.spawnSessionOnMachine(target, {
            directory: '/srv/project',
            approvedNewDirectoryCreation: false,
            agent: 'codex',
            resumeCodexThreadId: 'thread-child',
            parentSessionId: 'session-parent',
            isSideChat: true,
        });

        expect(mocks.invokeSpawn).toHaveBeenCalledWith(
            client.config,
            target,
            'account-token',
            expect.objectContaining({
                resumeCodexThreadId: 'thread-child',
                parentSessionId: 'session-parent',
                isSideChat: true,
            }),
        );
    });

    it('preserves the Codex-specific compatibility method with safe directory defaults', async () => {
        const target = machine();
        mocks.listMachines.mockResolvedValue([target]);
        mocks.invokeSpawn.mockResolvedValueOnce({ type: 'success', sessionId: 'session-real' });
        mocks.listSessions.mockResolvedValueOnce([legacySession()]);
        const client = new HappyHerdControlClient({
            config: { serverUrl: 'https://happy.example', homeDir: '/tmp/happyherd', credentialPath: '/tmp/key' },
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
        const client = new HappyHerdControlClient({
            config: { serverUrl: 'https://happy.example', homeDir: '/tmp/happyherd', credentialPath: '/tmp/key' },
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
        const client = new HappyHerdControlClient({
            config: { serverUrl: 'https://happy.example', homeDir: '/tmp/happyherd', credentialPath: '/tmp/key' },
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

    it('confirms a requested Commander from persisted session metadata', async () => {
        const target = machine();
        const client = new HappyHerdControlClient({
            config: { serverUrl: 'https://happy.example', homeDir: '/tmp/happyherd', credentialPath: '/tmp/key' },
            credentials: {
                token: 'token',
                secret: new Uint8Array(32),
                contentKeyPair: { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) },
            },
        });
        mocks.listSessions.mockResolvedValueOnce([{
            ...session(),
            metadata: {
                ...(session().metadata as Record<string, unknown>),
                commanderId: 'athena',
                isSuperSession: true,
            },
        }]);

        await expect(client.spawnSessionOnMachineConfirmed(target, {
            directory: '/srv/project',
            approvedNewDirectoryCreation: false,
            agent: 'grok',
            commanderId: 'athena',
            isSuperSession: true,
        })).resolves.toMatchObject({ session: { id: 'session-real' } });

        mocks.listSessions.mockResolvedValueOnce([session()]);
        await expect(client.spawnSessionOnMachineConfirmed(target, {
            directory: '/srv/project',
            approvedNewDirectoryCreation: false,
            agent: 'grok',
            commanderId: 'athena',
        })).rejects.toThrow('did not persist Commander athena');

        mocks.listSessions.mockResolvedValueOnce([{
            ...session(),
            metadata: {
                ...(session().metadata as Record<string, unknown>),
                commanderId: 'athena',
            },
        }]);
        await expect(client.spawnSessionOnMachineConfirmed(target, {
            directory: '/srv/project',
            approvedNewDirectoryCreation: false,
            agent: 'grok',
            commanderId: 'athena',
            isSuperSession: true,
        })).rejects.toThrow('did not persist the Super Session marker');
    });

    it('keeps strict confirmation unavailable for a legacy success receipt', async () => {
        const target = machine();
        mocks.invokeSpawn.mockResolvedValueOnce({ type: 'success', sessionId: 'session-real' });
        const client = new HappyHerdControlClient({
            config: { serverUrl: 'https://happy.example', homeDir: '/tmp/happyherd', credentialPath: '/tmp/key' },
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
