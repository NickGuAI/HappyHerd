import axios, { AxiosError } from 'axios';
import type { SessionMessage as WireSessionMessage } from '@happyherd/wire';
import type { Config } from './config';
import type { Credentials } from './credentials';
import {
    decodeBase64,
    encodeBase64,
    decryptBoxBundle,
    decryptWithDataKey,
    decryptLegacy,
    encryptWithDataKey,
    libsodiumEncryptForPublicKey,
    getRandomBytes,
} from './encryption';

// --- Types ---

export type EncryptionVariant = 'legacy' | 'dataKey';

export type RecordEncryption = {
    key: Uint8Array;
    variant: EncryptionVariant;
};

export type SessionEncryption = RecordEncryption;

export type RawSession = {
    id: string;
    projectId?: string | null;
    seq: number;
    createdAt: number;
    updatedAt: number;
    active: boolean;
    activeAt: number;
    metadata: string;
    metadataVersion: number;
    agentState: string | null;
    agentStateVersion: number;
    dataEncryptionKey: string | null;
};

export type DecryptedSession = {
    id: string;
    projectId?: string | null;
    seq: number;
    createdAt: number;
    updatedAt: number;
    active: boolean;
    activeAt: number;
    metadata: unknown;
    metadataVersion: number;
    agentState: unknown | null;
    dataEncryptionKey: string | null;
    encryption: RecordEncryption;
};

export type RawProject = {
    id: string;
    metadata: string;
    dataEncryptionKey: string | null;
};

/** Project names are private metadata and are decrypted with account credentials. */
export type DecryptedProject = {
    id: string;
    name: string;
    kind: string | null;
};

export type RawMachine = {
    id: string;
    seq: number;
    createdAt: number;
    updatedAt: number;
    active: boolean;
    activeAt: number;
    metadata: string | null;
    metadataVersion: number;
    daemonState: string | null;
    daemonStateVersion: number;
    dataEncryptionKey: string | null;
};

export type DecryptedMachine = {
    id: string;
    seq: number;
    createdAt: number;
    updatedAt: number;
    active: boolean;
    activeAt: number;
    metadata: unknown | null;
    metadataVersion: number;
    daemonState: unknown | null;
    daemonStateVersion: number;
    dataEncryptionKey: string | null;
    encryption: RecordEncryption;
};

export type RawMessage = WireSessionMessage;

export type DecryptedMessage = {
    id: string;
    seq: number;
    content: unknown;
    localId: string | null;
    createdAt: number;
    updatedAt: number;
};

// --- Session encryption key resolution ---

function resolveRecordEncryption(
    record: { id: string; dataEncryptionKey: string | null },
    creds: Credentials,
    recordLabel: string,
): RecordEncryption {
    if (record.dataEncryptionKey) {
        const encrypted = decodeBase64(record.dataEncryptionKey);
        // Strip version byte (first byte)
        const bundle = encrypted.slice(1);
        const sessionKey = decryptBoxBundle(bundle, creds.contentKeyPair.secretKey);
        if (!sessionKey) {
            throw new Error(`Failed to decrypt ${recordLabel} key for ${recordLabel} ${record.id}`);
        }
        return { key: sessionKey, variant: 'dataKey' };
    }
    // Legacy: use account secret directly
    return { key: creds.secret, variant: 'legacy' };
}

export function resolveSessionEncryption(
    session: RawSession,
    creds: Credentials,
): SessionEncryption {
    return resolveRecordEncryption(session, creds, 'session');
}

export function resolveMachineEncryption(
    machine: RawMachine,
    creds: Credentials,
): RecordEncryption {
    return resolveRecordEncryption(machine, creds, 'machine');
}

// --- Decrypt helpers ---

function decryptField(
    encrypted: string | null,
    encryption: RecordEncryption,
): unknown | null {
    if (!encrypted) return null;
    const data = decodeBase64(encrypted);
    if (encryption.variant === 'dataKey') {
        return decryptWithDataKey(data, encryption.key);
    }
    return decryptLegacy(data, encryption.key);
}

function decryptSession(raw: RawSession, creds: Credentials): DecryptedSession {
    const encryption = resolveSessionEncryption(raw, creds);
    return {
        id: raw.id,
        ...(raw.projectId === undefined ? {} : { projectId: raw.projectId }),
        seq: raw.seq,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        active: raw.active,
        activeAt: raw.activeAt,
        metadata: decryptField(raw.metadata, encryption),
        metadataVersion: raw.metadataVersion,
        agentState: decryptField(raw.agentState, encryption),
        dataEncryptionKey: raw.dataEncryptionKey,
        encryption,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decryptProject(raw: RawProject, creds: Credentials): DecryptedProject {
    const encryption = resolveRecordEncryption(raw, creds, 'project');
    const metadata = decryptField(raw.metadata, encryption);
    if (!isRecord(metadata) || typeof metadata.name !== 'string' || metadata.name.trim().length === 0) {
        throw new Error(`Failed to decrypt project metadata for project ${raw.id}`);
    }
    if (metadata.kind !== undefined && metadata.kind !== null && typeof metadata.kind !== 'string') {
        throw new Error(`Failed to decrypt project metadata for project ${raw.id}`);
    }
    return {
        id: raw.id,
        name: metadata.name.trim(),
        kind: typeof metadata.kind === 'string' && metadata.kind.trim().length > 0
            ? metadata.kind.trim()
            : null,
    };
}

function parseRawProject(value: unknown): RawProject {
    if (!isRecord(value)
        || typeof value.id !== 'string' || value.id.length === 0
        || typeof value.metadata !== 'string' || value.metadata.length === 0
        || (value.dataEncryptionKey !== null && typeof value.dataEncryptionKey !== 'string')) {
        throw new Error('Server returned an invalid Project record');
    }
    return {
        id: value.id,
        metadata: value.metadata,
        dataEncryptionKey: value.dataEncryptionKey as string | null,
    };
}

function decryptMachine(raw: RawMachine, creds: Credentials): DecryptedMachine {
    const encryption = resolveMachineEncryption(raw, creds);
    return {
        id: raw.id,
        seq: raw.seq,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        active: raw.active,
        activeAt: raw.activeAt,
        metadata: decryptField(raw.metadata, encryption),
        metadataVersion: raw.metadataVersion,
        daemonState: decryptField(raw.daemonState, encryption),
        daemonStateVersion: raw.daemonStateVersion,
        dataEncryptionKey: raw.dataEncryptionKey,
        encryption,
    };
}

// --- Error handling ---

function handleApiError(err: unknown, context: string): never {
    if (err instanceof AxiosError) {
        const status = err.response?.status;
        if (status === 401) {
            throw new Error('Authentication expired. Run `happyherd-control-agent auth login` to re-authenticate.');
        }
        if (status === 403) {
            throw new Error(`Forbidden: ${context}. Check your account permissions.`);
        }
        if (status === 404) {
            throw new Error(`Not found: ${context}`);
        }
        if (status && status >= 400 && status < 500) {
            const detail = err.response?.data ? `: ${JSON.stringify(err.response.data)}` : '';
            throw new Error(`Request failed (${status})${detail}`);
        }
        if (status && status >= 500) {
            throw new Error(`Server error (${status}): ${context}`);
        }
        throw new Error(`Request failed: ${err.message}`);
    }
    throw err;
}

function authHeaders(creds: Credentials): Record<string, string> {
    return {
        Authorization: `Bearer ${creds.token}`,
        'X-Happy-Client': 'cli-control-plane/0.1.0',
    };
}

// --- API functions ---

export async function listSessions(
    config: Config,
    creds: Credentials,
): Promise<DecryptedSession[]> {
    let data: { sessions: RawSession[] };
    try {
        const resp = await axios.get(`${config.serverUrl}/v1/sessions`, {
            headers: authHeaders(creds),
        });
        data = resp.data as { sessions: RawSession[] };
    } catch (err) {
        handleApiError(err, 'listing sessions');
    }

    return data.sessions.map(raw => decryptSession(raw, creds));
}

export async function listProjects(
    config: Config,
    creds: Credentials,
): Promise<DecryptedProject[]> {
    let data: unknown;
    try {
        const resp = await axios.get(`${config.serverUrl}/v1/projects`, {
            headers: authHeaders(creds),
        });
        data = resp.data;
    } catch (err) {
        handleApiError(err, 'listing Projects');
    }
    if (!isRecord(data) || !Array.isArray(data.projects)) {
        throw new Error('Server returned an invalid Project catalog');
    }
    return data.projects.map((project) => decryptProject(parseRawProject(project), creds));
}

/** Resolve and decrypt one exact account Project ID; names are never selectors. */
export async function getProjectById(
    config: Config,
    creds: Credentials,
    projectId: string,
): Promise<DecryptedProject | null> {
    let data: unknown;
    try {
        const resp = await axios.get(`${config.serverUrl}/v1/projects/${encodeURIComponent(projectId)}`, {
            headers: authHeaders(creds),
        });
        data = resp.data;
    } catch (err) {
        if (err instanceof AxiosError && err.response?.status === 404) return null;
        handleApiError(err, `resolving Project ${projectId}`);
    }
    const project = decryptProject(parseRawProject(data), creds);
    if (project.id !== projectId) {
        throw new Error(`Server returned Project ${project.id} while resolving ${projectId}`);
    }
    return project;
}

export async function assignSessionProject(
    config: Config,
    creds: Credentials,
    sessionId: string,
    projectId: string | null,
): Promise<{ id: string; projectId: string | null }> {
    let data: unknown;
    try {
        const resp = await axios.patch(
            `${config.serverUrl}/v1/sessions/${encodeURIComponent(sessionId)}/project`,
            { projectId },
            { headers: authHeaders(creds) },
        );
        data = resp.data;
    } catch (err) {
        handleApiError(err, `assigning Project for session ${sessionId}`);
    }
    const session = isRecord(data) && isRecord(data.session) ? data.session : null;
    if (!session
        || session.id !== sessionId
        || (session.projectId !== null && typeof session.projectId !== 'string')) {
        throw new Error(`Server returned an invalid Project assignment receipt for session ${sessionId}`);
    }
    if (session.projectId !== projectId) {
        throw new Error(`Server did not confirm Project ${projectId ?? 'none'} for session ${sessionId}`);
    }
    return { id: session.id as string, projectId: session.projectId as string | null };
}

export async function getSessionById(
    config: Config,
    creds: Credentials,
    sessionId: string,
): Promise<DecryptedSession | null> {
    let cursor: string | undefined;

    do {
        let data: { sessions: RawSession[]; nextCursor?: string | null };
        try {
            const resp = await axios.get(`${config.serverUrl}/v2/sessions`, {
                headers: authHeaders(creds),
                params: {
                    limit: 200,
                    ...(cursor ? { cursor } : {}),
                },
            });
            data = resp.data as { sessions: RawSession[]; nextCursor?: string | null };
        } catch (err) {
            handleApiError(err, `resolving session ${sessionId}`);
        }

        const matched = data.sessions.find(session => session.id === sessionId);
        if (matched) return decryptSession(matched, creds);
        cursor = data.nextCursor ?? undefined;
    } while (cursor);

    return null;
}

export async function listMachines(
    config: Config,
    creds: Credentials,
): Promise<DecryptedMachine[]> {
    let data: RawMachine[];
    try {
        const resp = await axios.get(`${config.serverUrl}/v1/machines`, {
            headers: authHeaders(creds),
        });
        data = resp.data as RawMachine[];
    } catch (err) {
        handleApiError(err, 'listing machines');
    }

    return data.map(raw => decryptMachine(raw, creds));
}

export async function listActiveSessions(
    config: Config,
    creds: Credentials,
): Promise<DecryptedSession[]> {
    let data: { sessions: RawSession[] };
    try {
        const resp = await axios.get(`${config.serverUrl}/v2/sessions/active`, {
            headers: authHeaders(creds),
        });
        data = resp.data as { sessions: RawSession[] };
    } catch (err) {
        handleApiError(err, 'listing active sessions');
    }

    return data.sessions.map(raw => decryptSession(raw, creds));
}

export async function createSession(
    config: Config,
    creds: Credentials,
    opts: { tag: string; metadata: unknown },
): Promise<DecryptedSession & { sessionKey: Uint8Array }> {
    // Generate random 32-byte per-session AES key
    const sessionKey = getRandomBytes(32);

    // Encrypt session key with content public key, prepend version byte
    const encryptedKey = libsodiumEncryptForPublicKey(sessionKey, creds.contentKeyPair.publicKey);
    const withVersion = new Uint8Array(1 + encryptedKey.length);
    withVersion[0] = 0x00; // version byte
    withVersion.set(encryptedKey, 1);
    const dataEncryptionKeyBase64 = encodeBase64(withVersion);

    // Encrypt metadata with the session key
    const encryptedMetadata = encryptWithDataKey(opts.metadata, sessionKey);
    const metadataBase64 = encodeBase64(encryptedMetadata);

    let data: { session: RawSession };
    try {
        const resp = await axios.post(
            `${config.serverUrl}/v1/sessions`,
            {
                tag: opts.tag,
                metadata: metadataBase64,
                dataEncryptionKey: dataEncryptionKeyBase64,
            },
            { headers: authHeaders(creds) },
        );
        data = resp.data as { session: RawSession };
    } catch (err) {
        handleApiError(err, 'creating session');
    }

    const decrypted = decryptSession(data.session, creds);
    return { ...decrypted, sessionKey: decrypted.encryption.key };
}

export async function deleteSession(
    config: Config,
    creds: Credentials,
    sessionId: string,
): Promise<void> {
    try {
        await axios.delete(`${config.serverUrl}/v1/sessions/${encodeURIComponent(sessionId)}`, {
            headers: authHeaders(creds),
        });
    } catch (err) {
        handleApiError(err, `deleting session ${sessionId}`);
    }
}

export async function getSessionMessages(
    config: Config,
    creds: Credentials,
    sessionId: string,
    encryption: SessionEncryption,
): Promise<DecryptedMessage[]> {
    let data: { messages: RawMessage[] };
    try {
        const resp = await axios.get(
            `${config.serverUrl}/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
            { headers: authHeaders(creds) },
        );
        data = resp.data as { messages: RawMessage[] };
    } catch (err) {
        handleApiError(err, `session ${sessionId} messages`);
    }

    return data.messages.map(msg => ({
        id: msg.id,
        seq: msg.seq,
        content: decryptField(msg.content.c, encryption),
        localId: msg.localId ?? null,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
    }));
}
