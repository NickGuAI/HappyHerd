import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('axios', () => ({ default: mocks }));
vi.mock('@/sync/serverConfig', () => ({ getServerUrl: () => 'https://selected.example' }));
vi.mock('@/sync/apiSocket', () => ({ getHappyHerdClientId: () => 'test-client' }));
import { authApprove } from './authApprove';

const key = new Uint8Array([1, 2, 3]);
const v1 = new Uint8Array([4, 5, 6]);
const v2 = new Uint8Array([7, 8, 9]);

describe('terminal authorization status', () => {
    beforeEach(() => vi.clearAllMocks());

    it('rejects an absent request instead of announcing a connection', async () => {
        mocks.get.mockResolvedValue({ data: { status: 'not_found', supportsV2: false } });
        await expect(authApprove('account-token', key, v1, v2)).rejects.toThrow();
        expect(mocks.post).not.toHaveBeenCalled();
    });

    it('keeps already-authorized requests idempotent', async () => {
        mocks.get.mockResolvedValue({ data: { status: 'authorized', supportsV2: true } });
        await expect(authApprove('account-token', key, v1, v2)).resolves.toBeUndefined();
        expect(mocks.post).not.toHaveBeenCalled();
    });

    it.each([false, true])('preserves the selected server, account and negotiated answer: v2=%s', async supportsV2 => {
        mocks.get.mockResolvedValue({ data: { status: 'pending', supportsV2 } });
        await authApprove('account-token', key, v1, v2);
        expect(mocks.get).toHaveBeenCalledWith('https://selected.example/v1/auth/request/status', {
            params: { publicKey: 'AQID' }, headers: { 'X-Happy-Client': 'test-client' },
        });
        expect(mocks.post).toHaveBeenCalledWith('https://selected.example/v1/auth/response', {
            publicKey: 'AQID', response: supportsV2 ? 'BwgJ' : 'BAUG',
        }, { headers: { Authorization: 'Bearer account-token', 'X-Happy-Client': 'test-client' } });
    });
});
