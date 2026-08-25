import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    axiosGet: vi.fn(),
    decryptLegacy: vi.fn(),
    readCredentials: vi.fn(),
    readLocalHappyAgentCredentials: vi.fn(),
}));

vi.mock('axios', () => ({
    default: { get: mocks.axiosGet },
    AxiosError: class AxiosError extends Error {},
}));

vi.mock('@/api/encryption', () => ({
    decodeBase64: vi.fn(() => new Uint8Array([1, 2, 3, 4])),
    decryptLegacy: mocks.decryptLegacy,
    decryptWithDataKey: vi.fn(),
}));

vi.mock('@/configuration', () => ({
    configuration: {
        currentCliVersion: '1.2.1',
        serverUrl: 'https://api.example.test',
    },
}));

vi.mock('@/persistence', () => ({
    readCredentials: mocks.readCredentials,
}));

vi.mock('./localHappyAgentAuth', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./localHappyAgentAuth')>();
    return {
        ...actual,
        getLocalHappyAgentCredentialPath: vi.fn(() => '/tmp/agent.key'),
        readLocalHappyAgentCredentials: mocks.readLocalHappyAgentCredentials,
    };
});

import { resolveReconnectableSession, resolveSessionRecordByPrefix } from './resolveHappySession';

beforeEach(() => {
    vi.clearAllMocks();
    mocks.readCredentials.mockResolvedValue(null);
    mocks.readLocalHappyAgentCredentials.mockReturnValue({
        token: 'agent-token',
        secret: new Uint8Array([1, 2, 3, 4]),
        contentKeyPair: {
            publicKey: new Uint8Array(32),
            secretKey: new Uint8Array(32),
        },
    });
});

describe('resolveSessionRecordByPrefix', () => {
    const sessions = [
        { id: 'cmmij8olq00dp5jcxr3wtbpau' },
        { id: 'cmmhiilo00dv7y7e8wjdr5s9x' },
    ];

    it('resolves an exact match', () => {
        expect(resolveSessionRecordByPrefix(sessions, 'cmmhiilo00dv7y7e8wjdr5s9x')).toEqual({
            id: 'cmmhiilo00dv7y7e8wjdr5s9x',
        });
    });

    it('resolves by unique prefix', () => {
        expect(resolveSessionRecordByPrefix(sessions, 'cmmij8')).toEqual({
            id: 'cmmij8olq00dp5jcxr3wtbpau',
        });
    });

    it('rejects unknown prefixes', () => {
        expect(() => resolveSessionRecordByPrefix(sessions, 'missing')).toThrow(
            'No Happy session found matching "missing"',
        );
    });

    it('rejects ambiguous prefixes', () => {
        expect(() => resolveSessionRecordByPrefix(sessions, 'cmm')).toThrow(
            'Ambiguous Happy session "cmm" matches 2 sessions. Be more specific.',
        );
    });
});

describe('resolveReconnectableSession', () => {
    it('recovers a pruned legacy session beyond the first cursor page from access.key without agent.key', async () => {
        const accessSecret = new Uint8Array([9, 8, 7, 6]);
        mocks.readCredentials.mockResolvedValue({
            token: 'access-token',
            encryption: { type: 'legacy', secret: accessSecret },
        });
        mocks.readLocalHappyAgentCredentials.mockReturnValue(null);
        mocks.axiosGet
            .mockResolvedValueOnce({
                data: {
                    sessions: [{ id: 'newer-session' }],
                    nextCursor: 'cursor_v1_newer-session',
                },
            })
            .mockResolvedValueOnce({
                data: {
                    sessions: [{
                        id: 'cmt6he5kr13j6pd0wyib3azp1',
                        active: false,
                        metadata: 'encrypted-metadata',
                        metadataVersion: 7,
                        agentState: null,
                        agentStateVersion: 9,
                        seq: 42,
                        dataEncryptionKey: null,
                    }],
                    nextCursor: null,
                },
            });
        mocks.decryptLegacy.mockReturnValue({
            path: '/srv/project',
            flavor: 'codex',
            codexThreadId: 'thread-legacy',
        });

        const recovered = await resolveReconnectableSession('cmt6he5kr');
        expect(recovered).toMatchObject({
            id: 'cmt6he5kr13j6pd0wyib3azp1',
            seq: 42,
            metadataVersion: 7,
            agentStateVersion: 9,
            encryptionVariant: 'legacy',
        });
        expect(recovered.encryptionKey).toEqual(accessSecret);
        expect(mocks.readLocalHappyAgentCredentials).not.toHaveBeenCalled();
        expect(mocks.axiosGet).toHaveBeenNthCalledWith(
            1,
            'https://api.example.test/v2/sessions',
            expect.objectContaining({ params: { limit: 200 } }),
        );
        expect(mocks.axiosGet).toHaveBeenNthCalledWith(
            2,
            'https://api.example.test/v2/sessions',
            expect.objectContaining({
                params: { limit: 200, cursor: 'cursor_v1_newer-session' },
            }),
        );
    });
});
