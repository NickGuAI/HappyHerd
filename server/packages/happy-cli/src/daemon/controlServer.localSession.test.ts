import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDaemonControlServer } from './controlServer';
let server: Awaited<ReturnType<typeof startDaemonControlServer>> | undefined;
afterEach(async () => { await server?.stop(); server = undefined; });
async function fixture(overrides: Record<string, unknown> = {}) {
  server = await startDaemonControlServer({ getChildren: () => [], stopSession: () => false,
    spawnSession: vi.fn(), sideChat: vi.fn(), onProviderLimited: vi.fn(), requestShutdown: vi.fn(),
    onHappySessionWebhook: vi.fn(), automations: {} as any, ...overrides });
  return (route: string, body: unknown) => fetch(`http://127.0.0.1:${server!.port}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
describe('local session send and inspection routes', () => {
  it('rejects malformed task delivery before callback invocation and strips secrets from the receipt', async () => {
    const receipt = { schemaVersion: 1, type: 'session-message', success: true, status: 'queued', sessionId: 'session-one', messageId: 'task-one', seq: 1 };
    const sendLocalMessage = vi.fn(async () => ({ ...receipt, encryptionKey: 'private' }));
    const post = await fixture({ sendLocalMessage });
    const request = { sessionId: 'session-one', messageId: 'task-one', text: 'Do the task.' };
    for (const body of [{ ...request, messageId: '' }, { ...request, token: 'invalid' }, { ...request, text: ' ' }, { ...request, text: 'x'.repeat(100_001) }]) {
      expect((await post('/session-send', body)).status).toBe(400);
    }
    expect(sendLocalMessage).not.toHaveBeenCalled();
    const response = await post('/session-send', request);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(receipt);
    expect(sendLocalMessage).toHaveBeenCalledExactlyOnceWith(request);
  });

  it('applies the recent-page default and rejects invalid limits and cursors', async () => {
    const inspectLocalSession = vi.fn(async (request: { limit: number }) => ({
      schemaVersion: 1, type: 'session-inspection', recent: true, limit: request.limit, messages: [],
      session: { id: 'session-one', active: true, providerRunning: true, seq: 3, metadata: { path: '/project' }, encryptionKey: 'private' },
    }));
    const post = await fixture({ inspectLocalSession });
    for (const body of [{ sessionId: 'session-one', limit: 101 }, { sessionId: 'session-one', limit: 0 }, { sessionId: 'session-one', after: 3 }]) {
      expect((await post('/session-inspect', body)).status).toBe(400);
    }
    expect(inspectLocalSession).not.toHaveBeenCalled();
    const response = await post('/session-inspect', { sessionId: 'session-one' });
    expect(response.status).toBe(200);
    expect(inspectLocalSession).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session-one', limit: 20 });
    expect(JSON.stringify(await response.json())).not.toContain('encryptionKey');
  });

  it('reports missing callbacks explicitly', async () => {
    const post = await fixture();
    expect((await post('/session-send', { sessionId: 'one', messageId: 'task', text: 'Task' })).status).toBe(503);
    expect((await post('/session-inspect', { sessionId: 'one' })).status).toBe(503);
  });
});
