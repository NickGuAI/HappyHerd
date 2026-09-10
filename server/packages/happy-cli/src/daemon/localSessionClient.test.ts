import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { readDaemonState } = vi.hoisted(() => ({ readDaemonState: vi.fn() }));
vi.mock('@/persistence', () => ({ readDaemonState }));
import { inspectLocalSession, sendLocalSessionMessage } from './localSessionClient';

const request = { sessionId: 'session-one', messageId: 'task-one', text: 'Do the task.' };
const queued = { schemaVersion: 1, type: 'session-message', success: true, status: 'queued', sessionId: 'session-one', messageId: 'task-one', seq: 3 };
const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock);
  readDaemonState.mockResolvedValue({ pid: 1234, httpPort: 39001 });
  vi.spyOn(process, 'kill').mockImplementation(() => true);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function respond(body: unknown, status = 200) { fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status })); }

describe('local daemon session transport', () => {
  it('validates before daemon lookup and sends no account-control material', async () => {
    await expect(sendLocalSessionMessage({ ...request, messageId: '' })).rejects.toThrow();
    expect(readDaemonState).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    respond(queued);
    await expect(sendLocalSessionMessage(request)).resolves.toEqual(queued);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:39001/session-send', expect.objectContaining({
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    }));
    expect(process.kill).toHaveBeenCalledExactlyOnceWith(1234, 0);
  });

  it.each([
    { ...queued, sessionId: 'other-session' }, { ...queued, messageId: 'other-message' },
    { ...queued, seq: undefined },
  ])('requires an acknowledgement for the exact persisted message', async (receipt) => {
    respond(receipt); await expect(sendLocalSessionMessage(request)).rejects.toThrow();
  });

  it('strips encryption and unapproved metadata fields from inspection readback', async () => {
    const safe = { schemaVersion: 1, type: 'session-inspection', recent: true, limit: 20,
      session: { id: 'session-one', seq: 3, active: false, providerRunning: false, metadata: { path: '/project', commanderId: 'selected' } },
      messages: [{ seq: 3, localId: null, createdAt: 100, content: { role: 'agent', content: { type: 'text', text: 'Done.' } } }] };
    respond({ ...safe, token: 'not-for-cli', session: { ...safe.session, encryptionKey: 'not-for-cli', metadata: { ...safe.session.metadata, secretEnvironment: 'not-for-cli' } } });
    await expect(inspectLocalSession({ sessionId: 'session-one', limit: 20 })).resolves.toEqual(safe);
  });

  it('reports unavailable capability without falling back to a mutating route', async () => {
    respond({ error: 'Route unavailable' }, 404);
    await expect(sendLocalSessionMessage(request)).rejects.toThrow('Route unavailable');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
