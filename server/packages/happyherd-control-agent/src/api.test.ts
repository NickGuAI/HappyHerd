import { describe, it, expect, beforeEach, vi } from 'vitest';
import tweetnacl from 'tweetnacl';
import {
    encodeBase64,
    decodeBase64,
    decryptBoxBundle,
    decryptWithDataKey,
    decryptLegacy,
    getRandomBytes,
    encryptWithDataKey,
    encryptLegacy,
    libsodiumEncryptForPublicKey,
    deriveContentKeyPair,
} from './encryption';
import type { Config } from './config';
import type { Credentials } from './credentials';
import type { RawProject, RawSession, RawMessage } from './api';

// Mock axios
vi.mock('axios', () => {
    const fn = {
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    };
    return {
        default: fn,
        AxiosError: class AxiosError extends Error {
            response?: { status: number };
            constructor(message: string, opts?: { response?: { status: number } }) {
                super(message);
                this.name = 'AxiosError';
                this.response = opts?.response;
            }
        },
    };
});

import axios from 'axios';
import {
    getSessionById,
    listSessions,
    listActiveSessions,
    createSession,
    deleteSession,
    getSessionMessages,
    resolveSessionEncryption,
    listProjects,
    getProjectById,
    createProject,
    renameProject,
    assignSessionProject,
} from './api';

const authHeader = {
    Authorization: 'Bearer test-jwt-token',
    'X-Happy-Client': 'cli-control-plane/0.1.0',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockedAxios = axios as any as {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
};

// --- Test helpers ---

function makeConfig(): Config {
    return {
        serverUrl: 'https://test-server.example.com',
        homeDir: '/tmp/happyherd-test',
        credentialPath: '/tmp/happyherd-test/agent.key',
    };
}

function makeCredentials(): Credentials {
    const secret = getRandomBytes(32);
    const contentKeyPair = deriveContentKeyPair(secret);
    return { token: 'test-jwt-token', secret, contentKeyPair };
}

function makeRawSessionWithDataKey(
    creds: Credentials,
    metadata: unknown,
    agentState: unknown | null = null,
    overrides: Partial<RawSession> = {},
): { raw: RawSession; sessionKey: Uint8Array } {
    const sessionKey = getRandomBytes(32);

    // Encrypt session key with content public key and prepend version byte
    const encryptedKey = libsodiumEncryptForPublicKey(sessionKey, creds.contentKeyPair.publicKey);
    const withVersion = new Uint8Array(1 + encryptedKey.length);
    withVersion[0] = 0x00;
    withVersion.set(encryptedKey, 1);

    // Encrypt metadata and agentState with session key
    const encryptedMetadata = encryptWithDataKey(metadata, sessionKey);
    const encryptedAgentState = agentState ? encryptWithDataKey(agentState, sessionKey) : null;

    const raw: RawSession = {
        id: overrides.id ?? 'session-abc123',
        ...(overrides.projectId === undefined ? {} : { projectId: overrides.projectId }),
        seq: overrides.seq ?? 1,
        createdAt: overrides.createdAt ?? Date.now(),
        updatedAt: overrides.updatedAt ?? Date.now(),
        active: overrides.active ?? true,
        activeAt: overrides.activeAt ?? Date.now(),
        metadata: encodeBase64(encryptedMetadata),
        metadataVersion: overrides.metadataVersion ?? 1,
        agentState: encryptedAgentState ? encodeBase64(encryptedAgentState) : null,
        agentStateVersion: overrides.agentStateVersion ?? 0,
        dataEncryptionKey: encodeBase64(withVersion),
        ...('dataEncryptionKey' in overrides ? { dataEncryptionKey: overrides.dataEncryptionKey } : {}),
    };

    return { raw, sessionKey };
}

function makeRawSessionLegacy(
    creds: Credentials,
    metadata: unknown,
    agentState: unknown | null = null,
    overrides: Partial<RawSession> = {},
): RawSession {
    const encryptedMetadata = encryptLegacy(metadata, creds.secret);
    const encryptedAgentState = agentState ? encryptLegacy(agentState, creds.secret) : null;

    return {
        id: overrides.id ?? 'session-legacy-456',
        ...(overrides.projectId === undefined ? {} : { projectId: overrides.projectId }),
        seq: overrides.seq ?? 1,
        createdAt: overrides.createdAt ?? Date.now(),
        updatedAt: overrides.updatedAt ?? Date.now(),
        active: overrides.active ?? true,
        activeAt: overrides.activeAt ?? Date.now(),
        metadata: encodeBase64(encryptedMetadata),
        metadataVersion: overrides.metadataVersion ?? 1,
        agentState: encryptedAgentState ? encodeBase64(encryptedAgentState) : null,
        agentStateVersion: overrides.agentStateVersion ?? 0,
        dataEncryptionKey: null,
    };
}

function makeRawProjectWithDataKey(
    creds: Credentials,
    id = 'project-data-key',
    metadata: unknown = { name: 'Example Project A', kind: 'work' },
): RawProject {
    const projectKey = getRandomBytes(32);
    const wrappedKey = libsodiumEncryptForPublicKey(projectKey, creds.contentKeyPair.publicKey);
    const withVersion = new Uint8Array(1 + wrappedKey.length);
    withVersion[0] = 0;
    withVersion.set(wrappedKey, 1);
    return {
        id,
        metadata: encodeBase64(encryptWithDataKey(metadata, projectKey)),
        metadataVersion: 7,
        dataEncryptionKey: encodeBase64(withVersion),
    };
}

function makeRawProjectLegacy(
    creds: Credentials,
    id = 'project-legacy',
    metadata: unknown = { name: 'Personal Notes', kind: null },
): RawProject {
    return {
        id,
        metadata: encodeBase64(encryptLegacy(metadata, creds.secret)),
        metadataVersion: 7,
        dataEncryptionKey: null,
    };
}

// --- Tests ---

describe('api', () => {
    let config: Config;
    let creds: Credentials;

    beforeEach(() => {
        config = makeConfig();
        creds = makeCredentials();
        vi.resetAllMocks();
    });

    describe('resolveSessionEncryption', () => {
        it('resolves dataKey variant when dataEncryptionKey is present', () => {
            const { raw, sessionKey } = makeRawSessionWithDataKey(creds, { name: 'test' });

            const encryption = resolveSessionEncryption(raw, creds);

            expect(encryption.variant).toBe('dataKey');
            expect(encryption.key).toEqual(sessionKey);
        });

        it('resolves legacy variant when no dataEncryptionKey', () => {
            const raw = makeRawSessionLegacy(creds, { name: 'test' });

            const encryption = resolveSessionEncryption(raw, creds);

            expect(encryption.variant).toBe('legacy');
            expect(encryption.key).toEqual(creds.secret);
        });

        it('throws when dataEncryptionKey cannot be decrypted', () => {
            // Create a session with a key encrypted for a different keypair
            const otherKeyPair = tweetnacl.box.keyPair();
            const sessionKey = getRandomBytes(32);
            const encryptedKey = libsodiumEncryptForPublicKey(sessionKey, otherKeyPair.publicKey);
            const withVersion = new Uint8Array(1 + encryptedKey.length);
            withVersion[0] = 0x00;
            withVersion.set(encryptedKey, 1);

            const raw: RawSession = {
                id: 'session-bad',
                seq: 1,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                active: true,
                activeAt: Date.now(),
                metadata: encodeBase64(getRandomBytes(50)),
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                dataEncryptionKey: encodeBase64(withVersion),
            };

            expect(() => resolveSessionEncryption(raw, creds)).toThrow(
                'Failed to decrypt session key for session session-bad',
            );
        });
    });

    describe('listSessions', () => {
        it('returns decrypted sessions with dataKey encryption', async () => {
            const metadata = { path: '/home/user/project', host: 'my-machine' };
            const agentState = { controlledByUser: false, requests: [] };
            const { raw } = makeRawSessionWithDataKey(creds, metadata, agentState, {
                id: 'sess-1',
                active: true,
                projectId: 'project-one',
            });

            mockedAxios.get.mockResolvedValueOnce({
                data: { sessions: [raw] },
            });

            const sessions = await listSessions(config, creds);

            expect(sessions).toHaveLength(1);
            expect(sessions[0].id).toBe('sess-1');
            expect(sessions[0].projectId).toBe('project-one');
            expect(sessions[0].metadata).toEqual(metadata);
            expect(sessions[0].metadataVersion).toBe(raw.metadataVersion);
            expect(sessions[0].agentState).toEqual(agentState);
            expect(sessions[0].encryption.variant).toBe('dataKey');
        });

        it('returns decrypted sessions with legacy encryption', async () => {
            const metadata = { path: '/old/project' };
            const raw = makeRawSessionLegacy(creds, metadata, null, {
                id: 'sess-legacy',
                active: false,
            });

            mockedAxios.get.mockResolvedValueOnce({
                data: { sessions: [raw] },
            });

            const sessions = await listSessions(config, creds);

            expect(sessions).toHaveLength(1);
            expect(sessions[0].id).toBe('sess-legacy');
            expect(sessions[0].metadata).toEqual(metadata);
            expect(sessions[0].agentState).toBeNull();
            expect(sessions[0].encryption.variant).toBe('legacy');
        });

        it('handles mixed dataKey and legacy sessions', async () => {
            const { raw: dataKeySession } = makeRawSessionWithDataKey(
                creds,
                { name: 'new' },
                null,
                { id: 'sess-new' },
            );
            const legacySession = makeRawSessionLegacy(
                creds,
                { name: 'old' },
                null,
                { id: 'sess-old' },
            );

            mockedAxios.get.mockResolvedValueOnce({
                data: { sessions: [dataKeySession, legacySession] },
            });

            const sessions = await listSessions(config, creds);

            expect(sessions).toHaveLength(2);
            expect(sessions[0].encryption.variant).toBe('dataKey');
            expect(sessions[0].metadata).toEqual({ name: 'new' });
            expect(sessions[1].encryption.variant).toBe('legacy');
            expect(sessions[1].metadata).toEqual({ name: 'old' });
        });

        it('sends authorization header', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: { sessions: [] } });

            await listSessions(config, creds);

            expect(mockedAxios.get).toHaveBeenCalledWith(
                'https://test-server.example.com/v1/sessions',
                { headers: authHeader },
            );
        });

        it('throws on 401 with re-authenticate message', async () => {
            const { AxiosError } = await import('axios');
            const err = new (AxiosError as any)('Unauthorized', { response: { status: 401 } });
            mockedAxios.get.mockRejectedValueOnce(err);

            await expect(listSessions(config, creds)).rejects.toThrow(
                'Authentication expired. Run `happyherd-control-agent auth login` to re-authenticate.',
            );
        });

        it('throws on 404', async () => {
            const { AxiosError } = await import('axios');
            const err = new (AxiosError as any)('Not Found', { response: { status: 404 } });
            mockedAxios.get.mockRejectedValueOnce(err);

            await expect(listSessions(config, creds)).rejects.toThrow('Not found');
        });

        it('throws on 500 server error', async () => {
            const { AxiosError } = await import('axios');
            const err = new (AxiosError as any)('Internal Server Error', { response: { status: 500 } });
            mockedAxios.get.mockRejectedValueOnce(err);

            await expect(listSessions(config, creds)).rejects.toThrow('Server error (500)');
        });

        it('returns empty array for no sessions', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: { sessions: [] } });

            const sessions = await listSessions(config, creds);
            expect(sessions).toEqual([]);
        });
    });

    describe('account Projects', () => {
        it('creates an encrypted Project that appears in the decrypted account catalog', async () => {
            let stored: RawProject;
            mockedAxios.post.mockImplementationOnce(async (_url, body) => {
                stored = { ...body, id: 'created-project', metadataVersion: 1 };
                return { data: stored };
            });
            const created = await createProject(config, creds, '  Example Project  ');
            expect(created).toEqual({ id: 'created-project', name: 'Example Project', kind: 'personal' });
            const [url, body, options] = mockedAxios.post.mock.calls[0];
            expect(url).toBe('https://test-server.example.com/v1/projects');
            expect(options).toEqual({ headers: authHeader });
            expect(Object.keys(body).sort()).toEqual(['dataEncryptionKey', 'externalId', 'metadata']);
            expect(body.externalId).toMatch(/^[0-9a-f-]{36}$/);
            const wrappedKey = decodeBase64(body.dataEncryptionKey);
            expect(wrappedKey[0]).toBe(0);
            const key = decryptBoxBundle(wrappedKey.slice(1), creds.contentKeyPair.secretKey)!;
            expect(key.length).toBe(32);
            expect(decryptWithDataKey(decodeBase64(body.metadata), key)).toEqual({
                name: 'Example Project', kind: 'personal',
            });
            mockedAxios.get.mockResolvedValueOnce({ data: { projects: [stored!] } });
            await expect(listProjects(config, creds)).resolves.toEqual([created]);
        });

        it.each(['dataKey', 'legacy'] as const)('renames a %s Project without changing other metadata or assignments', async (variant) => {
            const metadata = {
                name: 'Original Project', kind: 'work', description: 'Keep this description',
                settings: { color: 'blue', order: 3 },
            };
            const raw = variant === 'dataKey'
                ? makeRawProjectWithDataKey(creds, 'project-one', metadata)
                : makeRawProjectLegacy(creds, 'project-one', metadata);
            mockedAxios.get.mockResolvedValueOnce({ data: raw });
            mockedAxios.patch.mockImplementationOnce(async (_url, body) => ({
                data: { ...raw, metadata: body.metadata, metadataVersion: 8 },
            }));
            await expect(renameProject(config, creds, raw.id, '  New Name  ')).resolves.toEqual({
                id: raw.id, name: 'New Name', kind: 'work',
            });
            expect(mockedAxios.get).toHaveBeenCalledWith(
                'https://test-server.example.com/v1/projects/project-one', { headers: authHeader },
            );
            expect(mockedAxios.patch).toHaveBeenCalledTimes(1);
            const [url, body, options] = mockedAxios.patch.mock.calls[0];
            expect(url).toBe('https://test-server.example.com/v1/projects/project-one');
            expect(options).toEqual({ headers: authHeader });
            expect(body).toEqual({ metadata: expect.any(String), expectedMetadataVersion: 7 });
            const updated = variant === 'dataKey'
                ? decryptWithDataKey(decodeBase64(body.metadata), decryptBoxBundle(
                    decodeBase64(raw.dataEncryptionKey!).slice(1), creds.contentKeyPair.secretKey,
                )!)
                : decryptLegacy(decodeBase64(body.metadata), creds.secret);
            expect(updated).toEqual({ ...metadata, name: 'New Name' });
            expect(mockedAxios.post).not.toHaveBeenCalled();
        });

        it('reports a version conflict without retrying or overwriting concurrent changes', async () => {
            const { AxiosError } = await import('axios');
            mockedAxios.get.mockResolvedValueOnce({ data: makeRawProjectLegacy(creds) });
            mockedAxios.patch.mockRejectedValueOnce(new (AxiosError as any)('Conflict', { response: { status: 409 } }));
            await expect(renameProject(config, creds, 'project-legacy', 'New Name')).rejects.toThrow('409');
            expect(mockedAxios.patch).toHaveBeenCalledTimes(1);
        });

        it('lists decrypted names for data-key and legacy Projects without exposing wire data', async () => {
            mockedAxios.get.mockResolvedValueOnce({
                data: { projects: [makeRawProjectWithDataKey(creds), makeRawProjectLegacy(creds)] },
            });

            await expect(listProjects(config, creds)).resolves.toEqual([
                { id: 'project-data-key', name: 'Example Project A', kind: 'work' },
                { id: 'project-legacy', name: 'Personal Notes', kind: null },
            ]);
            expect(mockedAxios.get).toHaveBeenCalledWith(
                'https://test-server.example.com/v1/projects',
                { headers: authHeader },
            );
        });

        it('fails the catalog read when encrypted project data cannot be opened', async () => {
            const foreignCreds = {
                ...creds,
                contentKeyPair: deriveContentKeyPair(getRandomBytes(32)),
            };
            mockedAxios.get.mockResolvedValueOnce({
                data: { projects: [makeRawProjectWithDataKey(foreignCreds, 'project-foreign')] },
            });

            await expect(listProjects(config, creds)).rejects.toThrow(
                'Failed to decrypt project key for project project-foreign',
            );
        });

        it('resolves one exact Project ID and treats non-owned IDs as 404', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: makeRawProjectLegacy(creds, 'exact-project') });
            await expect(getProjectById(config, creds, 'exact-project')).resolves.toEqual({
                id: 'exact-project', name: 'Personal Notes', kind: null,
            });
            expect(mockedAxios.get).toHaveBeenCalledWith(
                'https://test-server.example.com/v1/projects/exact-project',
                { headers: authHeader },
            );

            const { AxiosError } = await import('axios');
            mockedAxios.get.mockRejectedValueOnce(new (AxiosError as any)('Not Found', { response: { status: 404 } }));
            await expect(getProjectById(config, creds, 'foreign-project')).resolves.toBeNull();
        });

        it('validates assignment and returns the exact session and Project receipt', async () => {
            mockedAxios.patch.mockResolvedValueOnce({
                data: { session: { id: 'session-one', projectId: 'project-one' } },
            });
            await expect(assignSessionProject(config, creds, 'session-one', 'project-one')).resolves.toEqual({
                id: 'session-one', projectId: 'project-one',
            });
            expect(mockedAxios.patch).toHaveBeenCalledWith(
                'https://test-server.example.com/v1/sessions/session-one/project',
                { projectId: 'project-one' },
                { headers: authHeader },
            );

            const { AxiosError } = await import('axios');
            mockedAxios.patch.mockRejectedValueOnce(new (AxiosError as any)('Not Found', { response: { status: 404 } }));
            await expect(assignSessionProject(config, creds, 'foreign-session', 'project-one')).rejects.toThrow('Not found');
        });
    });

    describe('getSessionById', () => {
        it('paginates beyond the recent-session window and returns the exact encrypted session', async () => {
            const metadata = { path: '/historical/project', marker: 'preserved' };
            const { raw } = makeRawSessionWithDataKey(creds, metadata, null, {
                id: 'historical-session',
                active: false,
                metadataVersion: 17,
            });
            mockedAxios.get
                .mockResolvedValueOnce({
                    data: {
                        sessions: [makeRawSessionLegacy(creds, { path: '/recent' }, null, { id: 'recent-session' })],
                        nextCursor: 'cursor_v1_recent-session',
                    },
                })
                .mockResolvedValueOnce({
                    data: { sessions: [raw], nextCursor: null },
                });

            const session = await getSessionById(config, creds, 'historical-session');

            expect(session).toMatchObject({
                id: 'historical-session',
                active: false,
                metadata,
                metadataVersion: 17,
            });
            expect(mockedAxios.get).toHaveBeenNthCalledWith(1,
                'https://test-server.example.com/v2/sessions',
                { headers: authHeader, params: { limit: 200 } },
            );
            expect(mockedAxios.get).toHaveBeenNthCalledWith(2,
                'https://test-server.example.com/v2/sessions',
                { headers: authHeader, params: { limit: 200, cursor: 'cursor_v1_recent-session' } },
            );
        });
    });

    describe('listActiveSessions', () => {
        it('calls the v2 active endpoint', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: { sessions: [] } });

            await listActiveSessions(config, creds);

            expect(mockedAxios.get).toHaveBeenCalledWith(
                'https://test-server.example.com/v2/sessions/active',
                { headers: authHeader },
            );
        });

        it('returns decrypted active sessions', async () => {
            const metadata = { path: '/active/project' };
            const { raw } = makeRawSessionWithDataKey(creds, metadata, null, {
                id: 'active-1',
                active: true,
            });

            mockedAxios.get.mockResolvedValueOnce({
                data: { sessions: [raw] },
            });

            const sessions = await listActiveSessions(config, creds);

            expect(sessions).toHaveLength(1);
            expect(sessions[0].id).toBe('active-1');
            expect(sessions[0].metadata).toEqual(metadata);
        });
    });

    describe('createSession', () => {
        it('creates a session with encrypted metadata and key', async () => {
            const metadata = { path: '/new/project', host: 'laptop' };

            // The createSession function generates a sessionKey, encrypts it, and sends it.
            // The server echoes back the session. We need to capture the sent data
            // and return it as if the server stored it.
            mockedAxios.post.mockImplementation(async (_url: string, body?: unknown) => {
                const reqBody = body as {
                    tag: string;
                    metadata: string;
                    dataEncryptionKey: string;
                };

                return {
                    data: {
                        session: {
                            id: 'new-session-id',
                            seq: 1,
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                            active: true,
                            activeAt: Date.now(),
                            metadata: reqBody.metadata,
                            metadataVersion: 1,
                            agentState: null,
                            agentStateVersion: 0,
                            dataEncryptionKey: reqBody.dataEncryptionKey,
                        },
                    },
                };
            });

            const result = await createSession(config, creds, {
                tag: 'my-project',
                metadata,
            });

            expect(result.id).toBe('new-session-id');
            expect(result.metadata).toEqual(metadata);
            expect(result.sessionKey).toBeInstanceOf(Uint8Array);
            expect(result.sessionKey.length).toBe(32);
            expect(result.encryption.variant).toBe('dataKey');

            // Verify the POST was called with correct args
            expect(mockedAxios.post).toHaveBeenCalledWith(
                'https://test-server.example.com/v1/sessions',
                expect.objectContaining({
                    tag: 'my-project',
                    metadata: expect.any(String),
                    dataEncryptionKey: expect.any(String),
                }),
                { headers: authHeader },
            );
        });

        it('returns existing session when tag already exists', async () => {
            const existingMetadata = { path: '/existing' };
            const { raw } = makeRawSessionWithDataKey(creds, existingMetadata, null, {
                id: 'existing-session',
            });

            mockedAxios.post.mockResolvedValueOnce({
                data: { session: raw },
            });

            const result = await createSession(config, creds, {
                tag: 'existing-tag',
                metadata: existingMetadata,
            });

            expect(result.id).toBe('existing-session');
            // Note: the returned sessionKey is the one generated locally,
            // but the decrypted metadata comes from the server's existing session
            expect(result.metadata).toEqual(existingMetadata);
        });

        it('throws on server error during create', async () => {
            const { AxiosError } = await import('axios');
            const err = new (AxiosError as any)('Server Error', { response: { status: 500 } });
            mockedAxios.post.mockRejectedValueOnce(err);

            await expect(
                createSession(config, creds, { tag: 'test', metadata: {} }),
            ).rejects.toThrow('Server error (500)');
        });
    });

    describe('getSessionMessages', () => {
        it('fetches and decrypts messages with dataKey encryption', async () => {
            const { raw: rawSession, sessionKey } = makeRawSessionWithDataKey(
                creds,
                { path: '/project' },
                null,
                { id: 'msg-session' },
            );

            const encryption = resolveSessionEncryption(rawSession, creds);

            // Create encrypted messages
            const msgContent1 = { role: 'user', text: 'Hello agent' };
            const msgContent2 = { role: 'assistant', text: 'Hello! How can I help?' };
            const encMsg1 = encryptWithDataKey(msgContent1, sessionKey);
            const encMsg2 = encryptWithDataKey(msgContent2, sessionKey);

            const rawMessages: RawMessage[] = [
                {
                    id: 'msg-1',
                    seq: 1,
                    content: { t: 'encrypted', c: encodeBase64(encMsg1) },
                    localId: 'local-1',
                    createdAt: 1000,
                    updatedAt: 1000,
                },
                {
                    id: 'msg-2',
                    seq: 2,
                    content: { t: 'encrypted', c: encodeBase64(encMsg2) },
                    localId: null,
                    createdAt: 2000,
                    updatedAt: 2000,
                },
            ];

            mockedAxios.get.mockResolvedValueOnce({
                data: { messages: rawMessages },
            });

            const messages = await getSessionMessages(config, creds, 'msg-session', encryption);

            expect(messages).toHaveLength(2);
            expect(messages[0].content).toEqual(msgContent1);
            expect(messages[0].id).toBe('msg-1');
            expect(messages[1].content).toEqual(msgContent2);
            expect(messages[1].id).toBe('msg-2');
        });

        it('fetches and decrypts messages with legacy encryption', async () => {
            const rawSession = makeRawSessionLegacy(
                creds,
                { path: '/legacy-project' },
                null,
                { id: 'legacy-msg-session' },
            );

            const encryption = resolveSessionEncryption(rawSession, creds);

            const msgContent = { role: 'user', text: 'Legacy message' };
            const encMsg = encryptLegacy(msgContent, creds.secret);

            const rawMessages: RawMessage[] = [
                {
                    id: 'legacy-msg-1',
                    seq: 1,
                    content: { t: 'encrypted', c: encodeBase64(encMsg) },
                    localId: null,
                    createdAt: 1000,
                    updatedAt: 1000,
                },
            ];

            mockedAxios.get.mockResolvedValueOnce({
                data: { messages: rawMessages },
            });

            const messages = await getSessionMessages(config, creds, 'legacy-msg-session', encryption);

            expect(messages).toHaveLength(1);
            expect(messages[0].content).toEqual(msgContent);
        });

        it('throws on 404 for messages endpoint', async () => {
            const { AxiosError } = await import('axios');
            const err = new (AxiosError as any)('Not Found', { response: { status: 404 } });
            mockedAxios.get.mockRejectedValueOnce(err);

            const encryption = { key: creds.secret, variant: 'legacy' as const };
            await expect(
                getSessionMessages(config, creds, 'bad-id', encryption),
            ).rejects.toThrow('Not found');
        });
    });

    describe('deleteSession', () => {
        it('sends DELETE request with correct URL and auth headers', async () => {
            mockedAxios.delete.mockResolvedValueOnce({ data: {} });

            await deleteSession(config, creds, 'session-to-delete');

            expect(mockedAxios.delete).toHaveBeenCalledWith(
                'https://test-server.example.com/v1/sessions/session-to-delete',
                { headers: authHeader },
            );
        });

        it('throws on 404', async () => {
            const { AxiosError } = await import('axios');
            const err = new (AxiosError as any)('Not Found', { response: { status: 404 } });
            mockedAxios.delete.mockRejectedValueOnce(err);

            await expect(deleteSession(config, creds, 'bad-id')).rejects.toThrow('Not found');
        });

        it('throws on 401 with re-authenticate message', async () => {
            const { AxiosError } = await import('axios');
            const err = new (AxiosError as any)('Unauthorized', { response: { status: 401 } });
            mockedAxios.delete.mockRejectedValueOnce(err);

            await expect(deleteSession(config, creds, 'some-id')).rejects.toThrow(
                'Authentication expired',
            );
        });
    });
});
