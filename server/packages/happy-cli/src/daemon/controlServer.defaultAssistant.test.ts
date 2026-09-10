import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDaemonControlServer } from './controlServer';

let server: Awaited<ReturnType<typeof startDaemonControlServer>> | undefined;
afterEach(async () => { await server?.stop(); server = undefined; });

async function fixture(overrides: Record<string, unknown> = {}) {
  const spawnSession = vi.fn(async () => ({ type: 'success' as const, sessionId: 'legacy' }));
  server = await startDaemonControlServer({
    getChildren: () => [], stopSession: () => false, spawnSession, sideChat: vi.fn(),
    onProviderLimited: vi.fn(), requestShutdown: vi.fn(), onHappySessionWebhook: vi.fn(),
    automations: {} as any, ...overrides,
  });
  return {
    spawnSession,
    post: (route: string, body?: unknown) => fetch(`http://127.0.0.1:${server!.port}${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
    }),
  };
}

describe('local Assistant and confirmed creation control routes', () => {
  it('returns the safe Assistant receipt and keeps a deferred result truthful', async () => {
    const ensureDefaultAssistant = vi.fn(async () => ({
      schemaVersion: 1 as const, type: 'default-assistant' as const,
      status: 'waiting-for-provider' as const, sessionId: null,
    }));
    const { post, spawnSession } = await fixture({ ensureDefaultAssistant });
    const response = await post('/ensure-assistant');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(await ensureDefaultAssistant.mock.results[0].value);
    expect(spawnSession).not.toHaveBeenCalled();
  });

  it('preserves explicit local launch selections and only returns the safe confirmed receipt', async () => {
    const request = {
      directory: '/home/test', agent: 'codex', commanderId: 'assistant', isSuperSession: true,
      approvedNewDirectoryCreation: false, modelMode: 'provider-default', effortLevel: 'medium', permissionMode: 'safe-yolo',
    };
    const receipt = {
      success: true, sessionId: 'created', machine: { id: 'machine', host: 'host', platform: 'linux' }, path: '/home/test',
      settings: { provider: 'codex', model: 'provider-default', effort: 'medium', permission: 'safe-yolo' },
      commander: { id: 'assistant', name: 'Assistant', path: '/context/COMMANDER.md', workspace: '/home/test', agentContextPath: '/context/agentcontext' },
      superSession: true,
    };
    const createLocalSession = vi.fn(async () => ({ ...receipt, encryptionKey: 'must-not-leave-daemon' }));
    const { post, spawnSession } = await fixture({ createLocalSession });
    const response = await post('/create-session', request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(receipt);
    expect(createLocalSession).toHaveBeenCalledExactlyOnceWith(request);
    expect(spawnSession).not.toHaveBeenCalled();
  });

  it('rejects unknown fields or missing directory approval before invoking creation', async () => {
    const createLocalSession = vi.fn();
    const { post } = await fixture({ createLocalSession });
    for (const body of [
      { directory: '/home/test', agent: 'codex' },
      { directory: '/home/test', agent: 'codex', approvedNewDirectoryCreation: false, isSideChat: true },
    ]) expect((await post('/create-session', body)).status).toBe(400);
    expect(createLocalSession).not.toHaveBeenCalled();
  });

  it('does not fall through to legacy spawn when the new handler is unavailable', async () => {
    const { post, spawnSession } = await fixture();
    expect((await post('/create-session', { directory: '/home/test', agent: 'codex', approvedNewDirectoryCreation: false })).status).toBe(503);
    expect(spawnSession).not.toHaveBeenCalled();
    expect((await post('/spawn-session', { directory: '/home/test' })).status).toBe(200);
    expect(spawnSession).toHaveBeenCalledOnce();
  });
});
