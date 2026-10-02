import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDaemonControlServer } from './controlServer';
import { SessionTransportRecovery } from './sessionTransport';

let server: Awaited<ReturnType<typeof startDaemonControlServer>> | undefined;
afterEach(async () => { await server?.stop(); server = undefined; });

describe('supported local transport exchange and recovery', () => {
  it('binds reports to the live owner, exposes status and coalesces recovery without invoking spawn or stop', async () => {
    const spawnSession = vi.fn();
    const stopSession = vi.fn();
    const sessionTransport = new SessionTransportRecovery({
      endpoint: 'http://127.0.0.1:4444',
      owner: id => id === 'same' ? { pid: 1234, isSuperSession: true, running: true } : undefined,
    });
    server = await startDaemonControlServer({ getChildren: () => [], stopSession, spawnSession,
      sideChat: vi.fn(), onProviderLimited: vi.fn(), requestShutdown: vi.fn(),
      onHappyHerdSessionWebhook: vi.fn(), automations: {} as any, sessionTransport });
    const post = (route: string, body: unknown) => fetch(`http://127.0.0.1:${server!.port}${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const report = { sessionId: 'same', pid: 1234,
      transport: { state: 'error', endpoint: 'http://127.0.0.1:3333', updatedAt: 1, errorCode: 'http', httpStatus: 502 } };
    expect((await post('/session-transport', { ...report, pid: 0 })).status).toBe(400);
    expect((await post('/session-transport', { ...report, pid: 9876 })).status).toBe(500);
    expect((await post('/session-transport', report)).status).toBe(200);
    expect(await (await post('/session-transport/status', { sessionId: 'same' })).json()).toMatchObject({
      state: 'disconnected', providerRunning: true, httpStatus: 502, pendingMessages: 'replay-on-reconnect',
    });
    const first = await (await post('/session-transport/recover', { sessionId: 'same' })).json() as any;
    const repeated = await (await post('/session-transport/recover', { sessionId: 'same' })).json() as any;
    expect(first.state).toBe('reconnecting');
    expect(repeated.recoveryId).toBe(first.recoveryId);
    expect(await (await post('/session-transport', report)).json()).toEqual({
      recovery: { id: first.recoveryId, endpoint: 'http://127.0.0.1:4444' },
    });
    expect(spawnSession).not.toHaveBeenCalled();
    expect(stopSession).not.toHaveBeenCalled();
  });
});
