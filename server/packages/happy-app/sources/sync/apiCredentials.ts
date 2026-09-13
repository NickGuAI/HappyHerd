import {
    SavedCredentialRevealResponseSchema,
    SavedCredentialErrorCodeSchema,
    SavedCredentialSummarySchema,
    SavedCredentialUpsertRequestSchema,
    type SavedCredentialRevealResponse,
    type SavedCredentialErrorCode,
    type SavedCredentialSummary,
    type SavedCredentialUpsertRequest,
} from '@slopus/happy-wire';
import { z } from 'zod';

import type { AuthCredentials } from '@/auth/tokenStorage';
import { getHappyClientId } from './apiSocket';
import { getServerUrl } from './serverConfig';

const SavedCredentialListSchema = z.object({
    credentials: z.array(SavedCredentialSummarySchema),
});

function headers(credentials: AuthCredentials): Record<string, string> {
    return {
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
        'X-Happy-Client': getHappyClientId(),
    };
}

export class CredentialApiError extends Error {
    readonly status: number;
    readonly code: SavedCredentialErrorCode | null;

    constructor(status: number, message: string, code: SavedCredentialErrorCode | null = null) {
        super(message);
        this.name = 'CredentialApiError';
        this.status = status;
        this.code = code;
    }
}

async function responseError(response: Response, fallback: string): Promise<CredentialApiError> {
    const payload = await response.json().catch(() => null) as { error?: unknown; code?: unknown } | null;
    const parsedCode = SavedCredentialErrorCodeSchema.safeParse(payload?.code);
    return new CredentialApiError(
        response.status,
        typeof payload?.error === 'string' ? payload.error : fallback,
        parsedCode.success ? parsedCode.data : null,
    );
}

export async function listSavedCredentials(credentials: AuthCredentials): Promise<SavedCredentialSummary[]> {
    const response = await fetch(`${getServerUrl()}/v1/credentials`, {
        headers: headers(credentials),
        cache: 'no-store',
    });
    if (!response.ok) throw await responseError(response, 'Could not load saved credentials');
    return SavedCredentialListSchema.parse(await response.json()).credentials;
}

export async function saveCredential(
    credentials: AuthCredentials,
    request: SavedCredentialUpsertRequest,
): Promise<SavedCredentialSummary> {
    const input = SavedCredentialUpsertRequestSchema.parse(request);
    const isUpdate = 'id' in input;
    const path = isUpdate
        ? `${getServerUrl()}/v1/credentials/${encodeURIComponent(input.id)}`
        : `${getServerUrl()}/v1/credentials`;
    const body = isUpdate
        ? (({ id: _id, ...update }) => update)(input)
        : input;
    const response = await fetch(
        path,
        {
            method: isUpdate ? 'PUT' : 'POST',
            headers: headers(credentials),
            body: JSON.stringify(body),
        },
    );
    if (!response.ok) throw await responseError(response, 'Could not save the credential');
    return SavedCredentialSummarySchema.parse(await response.json());
}

export async function revealSavedCredential(
    credentials: AuthCredentials,
    id: string,
): Promise<SavedCredentialRevealResponse> {
    const response = await fetch(
        `${getServerUrl()}/v1/credentials/${encodeURIComponent(id)}/reveal`,
        { method: 'POST', headers: headers(credentials), cache: 'no-store' },
    );
    if (!response.ok) throw await responseError(response, 'Could not reveal the credential');
    return SavedCredentialRevealResponseSchema.parse(await response.json());
}

export async function deleteSavedCredential(credentials: AuthCredentials, id: string): Promise<void> {
    const response = await fetch(`${getServerUrl()}/v1/credentials/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: headers(credentials),
    });
    if (!response.ok) throw await responseError(response, 'Could not delete the credential');
}
