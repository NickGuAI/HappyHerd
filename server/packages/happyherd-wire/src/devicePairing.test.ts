import { describe, expect, it } from 'vitest';
import {
  DevicePairingCodeSchema, DevicePairingConfirmRequestSchema,
  DevicePairingCheckResponseSchema, DevicePairingConfirmResponseSchema,
} from './devicePairing';

describe('device pairing wire contract', () => {
  it('keeps leading zeroes and rejects formatted or malformed wire codes', () => {
    expect(DevicePairingCodeSchema.parse('00001234')).toBe('00001234');
    for (const code of ['1234-5678', '1234567', '123456789', 'abcdefgh', 12345678]) {
      expect(DevicePairingCodeSchema.safeParse(code).success).toBe(false);
    }
  });

  it('requires an idempotency key and a daemon identity for successful confirmation', () => {
    for (const requestId of ['', 'x'.repeat(129), undefined]) {
      expect(DevicePairingConfirmRequestSchema.safeParse({ code: '12345678', requestId }).success).toBe(false);
    }
    expect(DevicePairingConfirmRequestSchema.safeParse({ code: '12345678', requestId: 'retry-1' }).success).toBe(true);
    expect(DevicePairingConfirmResponseSchema.safeParse({ status: 'connected' }).success).toBe(false);
    expect(DevicePairingCheckResponseSchema.safeParse({ status: 'pending', machineId: 'machine', host: 'host' }).success).toBe(false);
    for (const status of ['not_found', 'expired', 'cancelled', 'used']) {
      expect(DevicePairingConfirmResponseSchema.parse({ status, token: 'never-return' })).toEqual({ status });
    }
  });
});
