import { describe, expect, it, vi } from 'vitest';
import { DEVICE_PAIRING_TTL_MS } from '@happyherd/wire';
import { DevicePairingService } from './devicePairing';

function fixture() {
  let now = 1_000;
  const identity = { machineId: 'existing-machine', host: 'workstation' };
  const nextCode = vi.fn().mockReturnValueOnce('00123456').mockReturnValueOnce('00123456').mockReturnValue('87654321');
  const service = new DevicePairingService(identity, 'https://server.example', () => now, nextCode);
  return { service, identity, nextCode, advance: (ms: number) => { now += ms; } };
}

describe('daemon-owned device pairing lifecycle', () => {
  it('creates an expiring identifier, checks without consuming and preserves existing identity', () => {
    const { service, identity } = fixture();
    expect(service.create()).toEqual({ ...identity, code: '00123456', expiresAt: 1_000 + DEVICE_PAIRING_TTL_MS, serverUrl: 'https://server.example' });
    expect(service.check('12345678')).toEqual({ status: 'not_found' });
    expect(service.check('00123456')).toEqual({ status: 'pending', ...identity, expiresAt: 1_000 + DEVICE_PAIRING_TTL_MS });
    expect(service.check('00123456').status).toBe('pending');
    const receivedIdentity = service.getIdentity();
    receivedIdentity.machineId = 'changed-by-caller';
    expect(service.getIdentity()).toEqual(identity);
  });

  it('expires exactly at the deadline and never confirms expired codes', () => {
    const { service, advance } = fixture();
    service.create();
    advance(DEVICE_PAIRING_TTL_MS - 1);
    expect(service.check('00123456').status).toBe('pending');
    advance(1);
    expect(service.confirm('00123456', 'request')).toEqual({ status: 'expired' });
    expect(service.check('00123456')).toEqual({ status: 'expired' });
    expect(service.cancel()).toEqual({ status: 'expired' });
  });

  it('retains cancellation, replaces the preceding code and loses codes at daemon restart', () => {
    const { service, identity, nextCode } = fixture();
    expect(service.cancel()).toEqual({ status: 'not_found' });
    service.create();
    expect(service.cancel()).toEqual({ status: 'cancelled' });
    expect(service.confirm('00123456', 'request')).toEqual({ status: 'cancelled' });
    expect(service.check('00123456')).toEqual({ status: 'cancelled' });
    expect(service.create().code).toBe('87654321');
    expect(nextCode).toHaveBeenCalledTimes(3);
    expect(service.check('00123456')).toEqual({ status: 'not_found' });
    expect(new DevicePairingService(identity, 'https://server.example').check('87654321')).toEqual({ status: 'not_found' });
  });

  it('atomically consumes once and allows only the winning request to recover a lost ACK, even after expiry', async () => {
    const { service, identity, advance } = fixture();
    service.create();
    const results = await Promise.all(['first', 'second'].map(async (id) => service.confirm('00123456', id)));
    expect(results).toEqual([{ status: 'connected', ...identity }, { status: 'used' }]);
    expect(service.check('00123456')).toEqual({ status: 'used' });
    advance(DEVICE_PAIRING_TTL_MS);
    expect(service.confirm('00123456', 'first')).toEqual({ status: 'connected', ...identity });
    expect(service.confirm('00123456', 'second')).toEqual({ status: 'used' });
    service.create();
    expect(service.confirm('00123456', 'first')).toEqual({ status: 'not_found' });
  });

  it('uses zero-padded, random eight-digit codes by default', () => {
    const service = new DevicePairingService({ machineId: 'machine', host: 'host' }, 'https://server.example');
    const first = service.create().code;
    const second = service.create().code;
    expect(first).toMatch(/^\d{8}$/);
    expect(second).toMatch(/^\d{8}$/);
    expect(second).not.toBe(first);
  });
});
