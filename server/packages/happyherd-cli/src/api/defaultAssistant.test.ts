import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Credentials } from '@/persistence';
import type { Metadata } from './types';
import { decodeBase64, decrypt, libsodiumPublicKeyFromSecretKey } from './encryption';
import { DefaultAssistantApi } from './defaultAssistant';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('axios', () => ({ default: http }));
const metadata: Metadata = {
  path: '/home/test', host: 'test', homeDir: '/home/test', happyHomeDir: '/home/test/.happyherd',
  happyLibDir: '/app', happyToolsDir: '/app/tools', machineId: 'machine', isSuperSession: true,
};

beforeEach(() => vi.clearAllMocks());

describe('ordinary-auth default Assistant API', () => {
  it.each(['legacy', 'dataKey'] as const)('retains %s original encryption through repeated publication and hydration', async (variant) => {
    const encryption: Credentials['encryption'] = variant === 'legacy'
      ? { type: 'legacy', secret: new Uint8Array(32).fill(1) }
      : { type: 'dataKey', machineKey: new Uint8Array(32).fill(2), publicKey: libsodiumPublicKeyFromSecretKey(new Uint8Array(32).fill(3)) };
    const api = new DefaultAssistantApi({ token: 'fixture-token', encryption });
    const prepared = api.prepare(metadata);
    http.post.mockImplementation(async (_url, body) => ({
      data: { session: {
        ...body, id: body.sessionId, seq: 7, metadataVersion: 2, agentStateVersion: 3,
      }, isRequestedSession: true },
    }));
    const first = await api.publish(prepared);
    const second = await api.publish(prepared);
    for (const record of [first.session, second.session]) {
      expect(decrypt(prepared.encryptionKey, variant, decodeBase64(record.metadata))).toEqual(metadata);
      expect(api.hydrate(record, prepared)).toMatchObject({ id: prepared.id, metadata, seq: 7 });
      expect(api.hydrate(record, prepared).encryptionKey).toEqual(prepared.encryptionKey);
    }
    expect(http.post.mock.calls[0][1].sessionId).toBe(http.post.mock.calls[1][1].sessionId);
    expect(http.post.mock.calls[0][2].headers.Authorization).toBe('Bearer fixture-token');
    expect(Boolean(http.post.mock.calls[0][1].dataEncryptionKey)).toBe(variant === 'dataKey');
  });

  it('returns an encrypted foreign winner without trying to decrypt it', async () => {
    const api = new DefaultAssistantApi({ token: 'fixture-token', encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) } });
    const winner = { id: 'foreign-id', metadata: 'not-local-ciphertext' };
    http.get.mockResolvedValue({ data: { session: winner } });
    await expect(api.get()).resolves.toEqual(winner);
    http.post.mockResolvedValue({ data: { session: winner, isRequestedSession: false } });
    await expect(api.publish(api.prepare(metadata))).resolves.toEqual({ session: winner, isRequestedSession: false });
    expect(() => api.hydrate(winner as any, api.prepare(metadata))).toThrow('identity');
  });
});
