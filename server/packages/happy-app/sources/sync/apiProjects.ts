/** Account-scoped Project API helpers.
 *
 * Project metadata, avatar previews, and avatar bytes are ciphertext. This
 * module only transports opaque values and never exposes a public image URL.
 */
import type { AuthCredentials } from '@/auth/tokenStorage';
import { getHappyClientId } from './apiSocket';
import { getServerUrl, rewriteLoopbackHost } from './serverConfig';
import type { ApiProjectAvatar, ApiProjectRecord } from './projectTypes';

const PROJECT_BATCH_SIZE = 100;

function authHeaders(credentials: AuthCredentials, contentType = true): Record<string, string> {
    return {
        Authorization: `Bearer ${credentials.token}`,
        ...(contentType ? { 'Content-Type': 'application/json' } : {}),
        'X-Happy-Client': getHappyClientId(),
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asAvatar(value: unknown): ApiProjectAvatar | null {
    if (value === null) return null;
    if (!isRecord(value)
        || typeof value.ref !== 'string'
        || value.ref.length === 0
        || typeof value.preview !== 'string'
        || value.preview.length === 0
        || typeof value.version !== 'number'
        || !Number.isFinite(value.version)) {
        return null;
    }
    return {
        ref: value.ref,
        preview: value.preview,
        version: value.version,
    };
}

function asProjectRecord(value: unknown): ApiProjectRecord | null {
    if (!isRecord(value)
        || typeof value.id !== 'string'
        || value.id.length === 0
        || typeof value.externalId !== 'string'
        || value.externalId.length === 0
        || typeof value.metadata !== 'string'
        || value.metadata.length === 0
        || typeof value.metadataVersion !== 'number'
        || !Number.isFinite(value.metadataVersion)
        || (value.dataEncryptionKey !== null && typeof value.dataEncryptionKey !== 'string')
        || typeof value.createdAt !== 'number'
        || typeof value.updatedAt !== 'number') {
        return null;
    }

    // `avatar` is nullable in the contract. A malformed non-null descriptor
    // is treated as absent rather than allowing ciphertext from an unexpected
    // shape to reach image rendering.
    const avatar = value.avatar === null ? null : asAvatar(value.avatar);
    if (value.avatar !== null && avatar === null) return null;

    return {
        id: value.id,
        externalId: value.externalId,
        metadata: value.metadata,
        metadataVersion: value.metadataVersion,
        dataEncryptionKey: value.dataEncryptionKey as string | null,
        avatar,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
        ...(typeof value.seq === 'number' && Number.isFinite(value.seq) ? { seq: value.seq } : {}),
    };
}

async function projectRecordFromResponse(response: Response, operation: string): Promise<ApiProjectRecord> {
    if (!response.ok) {
        throw new Error(`${operation}: ${response.status}`);
    }
    const record = asProjectRecord(await response.json());
    if (!record) throw new Error(`${operation}: invalid response`);
    return record;
}

/** Fetch the account catalog, or a bounded subset when ids are supplied. */
export async function fetchProjects(
    credentials: AuthCredentials,
    projectIds?: readonly string[],
): Promise<ApiProjectRecord[]> {
    if (projectIds === undefined) {
        const response = await fetch(`${getServerUrl()}/v1/projects`, {
            headers: authHeaders(credentials),
        });
        if (!response.ok) throw new Error(`Failed to fetch projects: ${response.status}`);
        const body: unknown = await response.json();
        const values = isRecord(body) && Array.isArray(body.projects) ? body.projects : [];
        return values.map(asProjectRecord).filter((record): record is ApiProjectRecord => record !== null);
    }

    const ids = [...new Set(projectIds.filter((id) => id.length > 0))];
    if (ids.length === 0) return [];

    const projects: ApiProjectRecord[] = [];
    for (let index = 0; index < ids.length; index += PROJECT_BATCH_SIZE) {
        const batch = ids.slice(index, index + PROJECT_BATCH_SIZE);
        const query = encodeURIComponent(batch.join(','));
        const response = await fetch(`${getServerUrl()}/v1/projects?ids=${query}`, {
            headers: authHeaders(credentials),
        });
        if (response.status === 404) continue;
        if (!response.ok) {
            throw new Error(`Failed to fetch projects: ${response.status}`);
        }

        const body: unknown = await response.json();
        const values = isRecord(body) && Array.isArray(body.projects) ? body.projects : [];
        projects.push(...values.map(asProjectRecord).filter((record): record is ApiProjectRecord => record !== null));
    }
    return projects;
}

export async function createProjectRecord(
    credentials: AuthCredentials,
    input: { externalId: string; metadata: string; dataEncryptionKey: string },
): Promise<ApiProjectRecord> {
    const response = await fetch(`${getServerUrl()}/v1/projects`, {
        method: 'POST',
        headers: authHeaders(credentials),
        body: JSON.stringify(input),
    });
    return projectRecordFromResponse(response, 'Failed to create project');
}

export async function updateProjectRecord(
    credentials: AuthCredentials,
    projectId: string,
    input: { metadata: string; expectedMetadataVersion: number },
): Promise<ApiProjectRecord> {
    const response = await fetch(`${getServerUrl()}/v1/projects/${encodeURIComponent(projectId)}`, {
        method: 'PATCH',
        headers: authHeaders(credentials),
        body: JSON.stringify(input),
    });
    return projectRecordFromResponse(response, response.status === 409
        ? 'Project changed on another device'
        : 'Failed to rename project');
}

export async function assignSessionProject(
    credentials: AuthCredentials,
    sessionId: string,
    projectId: string | null,
): Promise<{ id: string; projectId: string | null }> {
    const response = await fetch(`${getServerUrl()}/v1/sessions/${encodeURIComponent(sessionId)}/project`, {
        method: 'PATCH',
        headers: authHeaders(credentials),
        body: JSON.stringify({ projectId }),
    });
    if (!response.ok) throw new Error(`Failed to assign project: ${response.status}`);
    const body: unknown = await response.json();
    const session = isRecord(body) ? body.session : null;
    if (!isRecord(session)
        || typeof session.id !== 'string'
        || session.id !== sessionId
        || (session.projectId !== null && typeof session.projectId !== 'string')) {
        throw new Error('Failed to assign project: invalid response');
    }
    return { id: session.id, projectId: session.projectId as string | null };
}

/**
 * Ask the server for the currently activated avatar. The server resolves the
 * ref itself; the client deliberately sends no body and cannot choose one.
 */
export async function requestProjectAvatarDownload(
    credentials: AuthCredentials,
    projectId: string,
): Promise<string> {
    const endpoint = `${getServerUrl()}/v1/projects/${encodeURIComponent(projectId)}/avatar/request-download`;
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: authHeaders(credentials, false),
    });
    if (!response.ok) {
        throw new Error(`Failed to request project avatar download: ${response.status}`);
    }
    const body: unknown = await response.json();
    if (!isRecord(body) || typeof body.downloadUrl !== 'string' || body.downloadUrl.length === 0) {
        throw new Error('Project avatar download response did not include downloadUrl');
    }
    return rewriteLoopbackHost(body.downloadUrl);
}

function isServerHostedUrl(downloadUrl: string, serverUrl: string): boolean {
    try {
        return new URL(downloadUrl).origin === new URL(serverUrl).origin;
    } catch {
        return downloadUrl.startsWith(serverUrl);
    }
}

/** Download the encrypted avatar bytes from the granted URL. */
export async function downloadProjectAvatar(
    credentials: AuthCredentials,
    projectId: string,
): Promise<Uint8Array> {
    const serverUrl = getServerUrl();
    const downloadUrl = await requestProjectAvatarDownload(credentials, projectId);
    const headers = isServerHostedUrl(downloadUrl, serverUrl)
        ? { Authorization: `Bearer ${credentials.token}`, 'X-Happy-Client': getHappyClientId() }
        : undefined;
    const response = await fetch(downloadUrl, headers ? { headers } : undefined);
    if (!response.ok) {
        throw new Error(`Failed to download project avatar: ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
}
