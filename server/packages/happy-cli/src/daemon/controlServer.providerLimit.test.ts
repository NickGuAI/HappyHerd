import { afterEach, describe, expect, it, vi } from 'vitest';

import { startDaemonControlServer } from './controlServer';

describe('provider-limit daemon control route', () => {
  let stop: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await stop?.();
    stop = null;
  });

  it('accepts dsh quota notices without a credential-pool account', async () => {
    const onProviderLimited = vi.fn();
    const server = await startDaemonControlServer({
      getChildren: () => [],
      stopSession: () => false,
      spawnSession: vi.fn(),
      sideChat: vi.fn(),
      requestShutdown: vi.fn(),
      onHappySessionWebhook: vi.fn(),
      onProviderLimited,
      automations: {} as any,
    });
    stop = server.stop;

    const response = await fetch(`http://127.0.0.1:${server.port}/provider-limited`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'dsh-session',
        provider: 'dsh',
        limitedUntil: 1234,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'scheduled' });
    expect(onProviderLimited).toHaveBeenCalledWith({
      sessionId: 'dsh-session',
      provider: 'dsh',
      limitedUntil: 1234,
    });
  });
});
