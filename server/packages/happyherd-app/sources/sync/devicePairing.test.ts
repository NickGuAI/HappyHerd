import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Machine } from '@/sync/storageTypes';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/apiSocket', () => ({ apiSocket: { machineRPC: rpc } }));
import { checkDevicePairing, confirmDevicePairing, normalizeDevicePairingCode, verifyDeviceIdentity } from './devicePairing';

const machine = (id: string, version: number | null = 1): Machine => ({
    id, active: true, metadata: { host: id, devicePairingProtocolVersion: version ?? undefined },
} as Machine);
const target = { machineId: 'target', host: 'target-host', expiresAt: 90000 };
const pending = { status: 'pending', ...target };

describe('existing-account device pairing', () => {
    beforeEach(() => { rpc.mockReset(); });
    afterEach(() => vi.useRealTimers());

    it.each(['12345678', '1234-5678', '1234 5678', ' 12345678 '])('accepts only a whole code: %s', (value) => {
        expect(normalizeDevicePairingCode(value)).toBe('12345678');
    });
    it.each(['123456789', 'x12345678', '1234-56x8', '1234567', '1234--5678', '123 45678', ''])('rejects malformed codes without truncation: %s', (value) => {
        expect(normalizeDevicePairingCode(value)).toBeNull();
    });
    it('queries only same-account supplied machines advertising supported pairing', async () => {
        rpc.mockResolvedValue(pending);
        expect(await checkDevicePairing([machine('old', null), machine('future', 2), machine('target')], '1234-5678')).toEqual({ status: 'pending', target });
        expect(rpc.mock.calls).toEqual([['target', 'happyherd-device-pairing-check', { code: '12345678' }]]);
    });
    it('never chooses an arbitrary target when multiple machines match', async () => {
        rpc.mockImplementation(async (id: string) => ({ ...pending, machineId: id }));
        expect(await checkDevicePairing([machine('a'), machine('b')], '12345678')).toEqual({ status: 'collision' });
    });
    it('offers the unique matching device despite an unrelated offline machine', async () => {
        rpc.mockImplementation(async (id: string) => { if (id === 'target') return pending; throw new Error('offline'); });
        expect(await checkDevicePairing([machine('target'), machine('offline')], '12345678')).toEqual({ status: 'pending', target });
    });
    it('does not claim invalid code when a possible target is unreachable', async () => {
        rpc.mockImplementation(async (id: string) => { if (id === 'other') return { status: 'not_found' }; throw new Error('offline'); });
        expect(await checkDevicePairing([machine('other'), machine('offline')], '12345678')).toEqual({ status: 'network' });
    });
    it.each(['not_found', 'expired', 'used', 'cancelled'] as const)('preserves recoverable daemon state %s', async (status) => {
        rpc.mockResolvedValue({ status });
        expect(await checkDevicePairing([machine('target')], '12345678')).toEqual({ status });
        expect(await confirmDevicePairing(target, '12345678', 'retry-id')).toEqual({ status });
    });
    it('requires a positive identity-matched confirmation', async () => {
        rpc.mockResolvedValue({ status: 'connected', machineId: 'other', host: target.host });
        expect(await confirmDevicePairing(target, '12345678', 'retry-id')).toEqual({ status: 'identity' });
        rpc.mockResolvedValue({ status: 'connected', machineId: 'target', host: 'other-host' });
        expect(await confirmDevicePairing(target, '12345678', 'retry-id')).toEqual({ status: 'identity' });
        rpc.mockResolvedValue({ status: 'connected', machineId: 'target', host: target.host });
        expect(await confirmDevicePairing(target, '12345678', 'retry-id')).toEqual({ status: 'connected', machineId: 'target', host: target.host });
    });
    it('rejects identity substitution in discovery and fresh reachability checks', async () => {
        rpc.mockResolvedValue({ ...pending, machineId: 'other' });
        expect(await checkDevicePairing([machine('target')], '12345678')).toEqual({ status: 'network' });
        rpc.mockResolvedValue({ machineId: 'other', host: target.host });
        expect(await verifyDeviceIdentity('target')).toBe(false);
        rpc.mockResolvedValue({ machineId: 'target', host: target.host });
        expect(await verifyDeviceIdentity('target')).toBe(true);
    });
    it('bounds a missing RPC acknowledgement to eight seconds', async () => {
        vi.useFakeTimers();
        rpc.mockImplementation(() => new Promise(() => {}));
        const result = checkDevicePairing([machine('target')], '12345678');
        await vi.advanceTimersByTimeAsync(8000);
        expect(await result).toEqual({ status: 'network' });
    });
    it('does not perform a request for malformed codes or an empty eligible account', async () => {
        expect(await checkDevicePairing([machine('target')], '123456789')).toEqual({ status: 'invalid' });
        expect(await checkDevicePairing([], '12345678')).toEqual({ status: 'unavailable' });
        expect(rpc).not.toHaveBeenCalled();
    });
});
