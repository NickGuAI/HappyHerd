import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthCredentials } from '@/auth/tokenStorage';
import {
    CredentialApiError,
    listSavedCredentials,
    revealSavedCredential,
    saveCredential,
} from './apiCredentials';

vi.mock('./serverConfig', () => ({ getServerUrl: () => 'https://api.example.test' }));
vi.mock('./apiSocket', () => ({ getHappyClientId: () => 'happy-test' }));

const auth: AuthCredentials = { token: 'account-token', secret: 'account-secret' };
const summary = {
    id: 'credential-1',
    name: 'Example',
    type: 'token',
    service: 'api.example.test',
    username: null,
    usage: ['skills'],
    version: 2,
    createdAt: 1,
    updatedAt: 2,
};

function response(body: unknown, ok = true, status = ok ? 200 : 500) {
    return { ok, status, json: async () => body };
}

describe('saved credential API', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => vi.unstubAllGlobals());

    it('lists only safe summaries with authenticated no-store transport', async () => {
        fetchMock.mockResolvedValue(response({ credentials: [summary] }));
        await expect(listSavedCredentials(auth)).resolves.toEqual([summary]);
        expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/v1/credentials', {
            headers: expect.objectContaining({ Authorization: 'Bearer account-token' }),
            cache: 'no-store',
        });
    });

    it('keeps the id in the URL and out of an optimistic update body', async () => {
        fetchMock.mockResolvedValue(response(summary));
        await saveCredential(auth, {
            id: 'credential-1',
            expectedVersion: 2,
            name: 'Example',
            type: 'token',
            service: 'api.example.test',
            username: null,
            usage: ['skills'],
        });
        const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://api.example.test/v1/credentials/credential-1');
        expect(options.method).toBe('PUT');
        expect(JSON.parse(String(options.body))).toEqual({
            expectedVersion: 2,
            name: 'Example',
            type: 'token',
            service: 'api.example.test',
            username: null,
            usage: ['skills'],
        });
    });

    it('requires an explicit reveal request and validates the response', async () => {
        fetchMock.mockResolvedValue(response({ id: 'credential-1', secret: 'revealed-once' }));
        await expect(revealSavedCredential(auth, 'credential-1')).resolves.toEqual({
            id: 'credential-1',
            secret: 'revealed-once',
        });
        expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', cache: 'no-store' });
    });

    it.each([
        ['saved-credential-limit-reached', 'Saved credential limit reached'],
        ['saved-credential-name-conflict', 'A saved credential with this name already exists'],
        ['saved-credential-version-conflict', 'Saved credential changed'],
    ] as const)('preserves the %s HTTP conflict cause and server message', async (code, message) => {
        fetchMock.mockResolvedValue(response({ code, error: message }, false, 409));

        const error = await saveCredential(auth, {
            id: 'credential-1',
            expectedVersion: 2,
            name: 'Example',
            type: 'token',
            service: 'api.example.test',
            username: null,
            usage: ['skills'],
        }).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(CredentialApiError);
        expect(error).toMatchObject({
            name: 'CredentialApiError',
            status: 409,
            code,
            message,
        });
    });
});
