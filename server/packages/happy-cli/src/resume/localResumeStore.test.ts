import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    mockReadPersistedSessions: vi.fn(),
    mockReadCredentials: vi.fn(),
    mockPersistSession: vi.fn(),
    mockResolveReconnectableSession: vi.fn(),
}));

vi.mock('@/persistence', () => ({
    readPersistedSessions: mocks.mockReadPersistedSessions,
    readCredentials: mocks.mockReadCredentials,
    persistSession: mocks.mockPersistSession,
}));

vi.mock('@/configuration', () => ({
    configuration: {
        sessionsFile: '/tmp/.happy/sessions.json',
        serverUrl: 'https://api.example.test',
        currentCliVersion: '1.1.10',
    },
}));

vi.mock('./resolveHappySession', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./resolveHappySession')>();
    return {
        ...actual,
        resolveReconnectableSession: mocks.mockResolveReconnectableSession,
    };
});

import {
    backfillReconnectableSessionForMachine,
    LocalResumeSessionError,
    resolveLocalReconnectableSession,
} from './localResumeStore';

describe('resolveLocalReconnectableSession', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockReadCredentials.mockResolvedValue(null);
    });

    it('resolves a locally persisted dataKey session without agent.key credentials', async () => {
        mocks.mockReadPersistedSessions.mockReturnValue({
            'session-1': {
                encryptionKey: 'AQIDBA==',
                encryptionVariant: 'dataKey',
                seq: 12,
                metadataVersion: 3,
                agentStateVersion: 4,
                metadata: {
                    path: '/tmp/repo',
                    flavor: 'codex',
                    codexThreadId: 'thread-1',
                    host: 'localhost',
                    homeDir: '/tmp',
                    happyHomeDir: '/tmp/.happy',
                    happyLibDir: '/tmp/happy',
                    happyToolsDir: '/tmp/happy/tools',
                },
                savedAt: Date.now(),
            },
        });

        await expect(resolveLocalReconnectableSession('session-1')).resolves.toMatchObject({
            id: 'session-1',
            seq: 12,
            metadataVersion: 3,
            agentStateVersion: 4,
            encryptionVariant: 'dataKey',
            metadata: {
                codexThreadId: 'thread-1',
            },
        });
    });

    it('reports missing local encryption data without suggesting happy-agent auth login', async () => {
        mocks.mockReadPersistedSessions.mockReturnValue({});

        let thrown: unknown;
        try {
            await resolveLocalReconnectableSession('missing');
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(LocalResumeSessionError);
        expect((thrown as Error).message).toContain('/tmp/.happy/sessions.json');
        expect((thrown as Error).message).not.toContain('happy-agent auth login');
    });
});

describe('backfillReconnectableSessionForMachine', () => {
    const recoveredSession = {
        id: 'session-legacy',
        active: false,
        metadata: {
            path: '/tmp/repo',
            flavor: 'codex',
            codexThreadId: 'thread-legacy',
            host: 'localhost',
            machineId: 'machine-1',
            homeDir: '/tmp',
            happyHomeDir: '/tmp/.happy',
            happyLibDir: '/tmp/happy',
            happyToolsDir: '/tmp/happy/tools',
        },
        seq: 42,
        metadataVersion: 7,
        agentStateVersion: 9,
        encryptionKey: new Uint8Array([1, 2, 3, 4]),
        encryptionVariant: 'dataKey' as const,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPersistSession.mockReturnValue(true);
        mocks.mockResolveReconnectableSession.mockResolvedValue(recoveredSession);
    });

    it('recovers an already-pruned session for its original machine', async () => {
        const recovered = await backfillReconnectableSessionForMachine('session-legacy', 'machine-1');

        expect(recovered.session).toBe(recoveredSession);
        expect(mocks.mockPersistSession).toHaveBeenCalledWith('session-legacy', recovered.persisted);
    });

    it('does not recover a session onto another machine', async () => {
        await expect(backfillReconnectableSessionForMachine('session-legacy', 'machine-2'))
            .rejects.toThrow('belongs to another machine');
        expect(mocks.mockPersistSession).not.toHaveBeenCalled();
    });

    it('does not claim recovery when the reconnect record cannot be persisted', async () => {
        mocks.mockPersistSession.mockReturnValue(false);

        await expect(backfillReconnectableSessionForMachine('session-legacy', 'machine-1'))
            .rejects.toThrow('could not be persisted');
    });
});
