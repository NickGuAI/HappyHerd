import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDaemonControlServer } from './controlServer';
import { DevicePairingService } from './devicePairing';

let server: Awaited<ReturnType<typeof startDaemonControlServer>> | undefined;
afterEach(async () => { await server?.stop(); server = undefined; });
async function fixture(devicePairing?: () => DevicePairingService | undefined) {
  server = await startDaemonControlServer({ getChildren: () => [], stopSession: () => false,
    spawnSession: vi.fn(), sideChat: vi.fn(), onProviderLimited: vi.fn(), requestShutdown: vi.fn(),
    onHappyHerdSessionWebhook: vi.fn(), automations: {} as any, devicePairing });
  return (route: string, body: unknown = {}) => fetch(`http://127.0.0.1:${server!.port}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('daemon local pairing HTTP', () => {
  it('shares the same in-memory state with remote checks and cancellation', async () => {
    const service = new DevicePairingService({ machineId: 'machine-1', host: 'host' }, 'https://server.example', () => 100, () => '00001234');
    const post = await fixture(() => service);
    const created = await post('/device-pairing/create');
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ code: '00001234', machineId: 'machine-1', host: 'host', serverUrl: 'https://server.example', expiresAt: 120_100 });
    expect(service.check('00001234').status).toBe('pending');
    const cancelled = await post('/device-pairing/cancel');
    expect(await cancelled.json()).toEqual({ status: 'cancelled' });
    expect(service.confirm('00001234', 'request')).toEqual({ status: 'cancelled' });
  });

  it('rejects attempts to replace target identity in the local request', async () => {
    const service = new DevicePairingService({ machineId: 'machine-1', host: 'host' }, 'https://server.example');
    const create = vi.spyOn(service, 'create');
    const post = await fixture(() => service);
    expect((await post('/device-pairing/create', { machineId: 'other' })).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('reports daemon startup unavailability without inventing a machine', async () => {
    const post = await fixture(() => undefined);
    expect((await post('/device-pairing/create')).status).toBe(503);
    expect((await post('/device-pairing/cancel')).status).toBe(503);
  });
});
