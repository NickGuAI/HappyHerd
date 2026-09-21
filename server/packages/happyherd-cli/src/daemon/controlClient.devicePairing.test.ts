import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/persistence', () => ({
  readDaemonState: vi.fn(async () => ({ pid: 4321, httpPort: 39001 })),
  clearDaemonState: vi.fn(),
}));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));

import { readDaemonState, clearDaemonState } from '@/persistence';
import { createDaemonDevicePairing, cancelDaemonDevicePairing } from './controlClient';

const created = { code: '00123456', machineId: 'same-machine', host: 'host', serverUrl: 'https://server.example', expiresAt: 121_000 };

describe('local pairing control client', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('sends only empty loopback requests and validates both receipts', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => created })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'cancelled' }) });
    vi.stubGlobal('fetch', fetch);
    expect(await createDaemonDevicePairing()).toEqual(created);
    expect(await cancelDaemonDevicePairing()).toEqual({ status: 'cancelled' });
    for (const [index, route] of ['create', 'cancel'].entries()) {
      expect(fetch.mock.calls[index]).toEqual([
        `http://127.0.0.1:39001/device-pairing/${route}`,
        expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
      ]);
    }
    expect(clearDaemonState).not.toHaveBeenCalled();
  });

  it('reports no daemon without clearing state or making any HTTP or authentication request', async () => {
    vi.mocked(readDaemonState).mockResolvedValueOnce(null);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(createDaemonDevicePairing()).rejects.toThrow('No daemon running');
    expect(fetch).not.toHaveBeenCalled();
    expect(clearDaemonState).not.toHaveBeenCalled();
  });

  it('keeps old-daemon errors actionable and does not retry or synthesize a code', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'Route not found' }) }));
    vi.stubGlobal('fetch', fetch);
    await expect(createDaemonDevicePairing()).rejects.toThrow('HTTP 404: Route not found');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects incomplete receipts even when local HTTP succeeds', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ code: '00123456' }) })));
    await expect(createDaemonDevicePairing()).rejects.toThrow();
  });
});
