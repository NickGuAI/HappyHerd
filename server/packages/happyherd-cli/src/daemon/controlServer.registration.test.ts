import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDaemonControlServer } from './controlServer';

let server: Awaited<ReturnType<typeof startDaemonControlServer>> | undefined;
afterEach(async () => { await server?.stop(); server = undefined; });

describe('registration durability response', () => {
  it('returns a failed response when the pending registration save fails', async () => {
    let rejectSave!: (error: Error) => void;
    const saved = new Promise<void>((_resolve, reject) => { rejectSave = reject; });
    const onHappyHerdSessionWebhook = vi.fn(() => saved);
    server = await startDaemonControlServer({
      getChildren: () => [], stopSession: vi.fn(), spawnSession: vi.fn(), sideChat: vi.fn(),
      onProviderLimited: vi.fn(), requestShutdown: vi.fn(), onHappyHerdSessionWebhook,
      automations: {} as Parameters<typeof startDaemonControlServer>[0]['automations'],
    });
    const response = fetch(`http://127.0.0.1:${server.port}/session-started`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'registration', metadata: { hostPid: 1234 } }),
    });
    await vi.waitFor(() => expect(onHappyHerdSessionWebhook).toHaveBeenCalledOnce());
    rejectSave(new Error('test save failure'));
    expect((await response).status).toBe(500);
  });
});
