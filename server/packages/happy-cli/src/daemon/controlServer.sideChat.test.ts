import { afterEach, describe, expect, it, vi } from 'vitest';

import { startDaemonControlServer } from './controlServer';

describe('side-chat daemon control server aliases', () => {
  let stop: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await stop?.();
    stop = null;
  });

  it.each([
    ['inspect', 'status'],
    ['pause', 'stop'],
    ['resume', 'reopen'],
  ] as const)('normalizes %s to %s before lifecycle execution', async (alias, canonicalAction) => {
    const sideChat = vi.fn(async (request: { action: string; sessionId: string }) => ({
      schemaVersion: 1 as const,
      type: 'side-chat' as const,
      action: request.action as 'status' | 'stop' | 'reopen',
      success: true,
      parentSessionId: 'parent',
      sessionId: request.sessionId,
      child: null,
      phases: [],
    }));
    const server = await startDaemonControlServer({
      getChildren: () => [],
      stopSession: () => false,
      spawnSession: vi.fn(),
      sideChat: sideChat as any,
      requestShutdown: vi.fn(),
      onHappySessionWebhook: vi.fn(),
      onProviderLimited: vi.fn(),
      automations: {} as any,
    });
    stop = server.stop;

    const response = await fetch(`http://127.0.0.1:${server.port}/side-chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: alias, sessionId: 'child' }),
    });

    expect(response.status).toBe(200);
    expect(sideChat).toHaveBeenCalledWith({ action: canonicalAction, sessionId: 'child' });
    await expect(response.json()).resolves.toMatchObject({ action: canonicalAction });
  });
});
