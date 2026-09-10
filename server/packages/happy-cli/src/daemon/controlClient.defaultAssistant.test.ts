import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/persistence', () => ({
  readDaemonState: vi.fn(async () => ({ pid: 4321, httpPort: 39001 })),
  clearDaemonState: vi.fn(),
}));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));

import { ensureDaemonAssistant, spawnLocalDaemonSession } from './controlClient';

describe('local Assistant transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('ensures through the existing local daemon without sending account credentials', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const receipt = {
      schemaVersion: 1, type: 'default-assistant', status: 'existing', sessionId: 'same-assistant',
    };
    const fetch = vi.fn(async () => ({ ok: true, json: async () => receipt }));
    vi.stubGlobal('fetch', fetch);

    await expect(ensureDaemonAssistant()).resolves.toEqual(receipt);
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:39001/ensure-assistant', expect.objectContaining({
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }));
  });

  it('does not fall back to an older daemon route that would discard Commander selection', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
      ok: false, status: 404, json: async () => ({ error: 'Route not found' }),
    }));
    vi.stubGlobal('fetch', fetch);

    await expect(spawnLocalDaemonSession({
      directory: '/srv/project', agent: 'codex', commanderId: 'selected-commander',
      approvedNewDirectoryCreation: false,
    })).rejects.toThrow('HTTP 404');
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:39001/create-session');
  });

  it('requires a confirmed creation receipt before reporting success', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ success: true, sessionId: 'unconfirmed-session' }),
    })));

    await expect(spawnLocalDaemonSession({
      directory: '/srv/project', agent: 'codex', approvedNewDirectoryCreation: false,
    })).rejects.toThrow('confirmed local session');
  });
});
