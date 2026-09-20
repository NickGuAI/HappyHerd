import { describe, expect, it, vi } from 'vitest';
import { ApiMachineClient } from './apiMachine';
import { DevicePairingService } from '@/daemon/devicePairing';
import { decodeBase64, decrypt, encodeBase64, encrypt } from './encryption';
import type { Machine } from './types';
import type { RpcHandlerManager } from './rpc/RpcHandlerManager';

function fixture(encryptionVariant: Machine['encryptionVariant']) {
  const machine: Machine = {
    id: 'existing-machine', encryptionKey: new Uint8Array(32).fill(42), encryptionVariant,
    metadata: { host: 'workstation', platform: 'linux', happyCliVersion: 'test', homeDir: '/home/user', happyHomeDir: '/home/user/.happy', happyLibDir: '/opt/happy' },
    metadataVersion: 2, daemonState: null, daemonStateVersion: 0,
  };
  const original = structuredClone(machine);
  const devicePairing = new DevicePairingService({ machineId: machine.id, host: machine.metadata.host }, 'https://server.example');
  const client = new ApiMachineClient('existing-token', machine);
  const spawnSession = vi.fn();
  const stopSession = vi.fn();
  const requestShutdown = vi.fn();
  client.setRPCHandlers({ spawnSession, stopSession, requestShutdown, devicePairing });
  const manager = (client as unknown as { rpcHandlerManager: RpcHandlerManager }).rpcHandlerManager;
  const call = async (method: string, params: unknown, key = machine.encryptionKey, target = machine.id) => {
    const response = await manager.handleRequest({
      method: `${target}:happyherd-device-pairing-${method}`,
      params: encodeBase64(encrypt(key, encryptionVariant, params)),
    });
    return decrypt(machine.encryptionKey, encryptionVariant, decodeBase64(response));
  };
  return { machine, original, devicePairing, call, spawnSession, stopSession, requestShutdown };
}

describe.each(['legacy', 'dataKey'] as const)('pairing over existing %s machine RPC encryption', (variant) => {
  it('checks, confirms and re-reads the same daemon identity without altering machine state or sessions', async () => {
    const { machine, original, devicePairing, call, spawnSession, stopSession, requestShutdown } = fixture(variant);
    const created = devicePairing.create();
    const identity = { machineId: machine.id, host: machine.metadata.host };
    expect(await call('check', { code: created.code })).toEqual({ status: 'pending', ...identity, expiresAt: created.expiresAt });
    expect(await call('confirm', { code: created.code, requestId: 'request-1' })).toEqual({ status: 'connected', ...identity });
    expect(await call('confirm', { code: created.code, requestId: 'request-1' })).toEqual({ status: 'connected', ...identity });
    expect(await call('confirm', { code: created.code, requestId: 'request-2' })).toEqual({ status: 'used' });
    expect(await call('identity', {})).toEqual(identity);
    expect(machine).toEqual(original);
    expect(spawnSession).not.toHaveBeenCalled();
    expect(stopSession).not.toHaveBeenCalled();
    expect(requestShutdown).not.toHaveBeenCalled();
  });

  it('requires the existing machine encryption and exact target scope before code consumption', async () => {
    const { devicePairing, call } = fixture(variant);
    const { code } = devicePairing.create();
    expect(await call('confirm', { code, requestId: 'wrong-key' }, new Uint8Array(32).fill(9))).toHaveProperty('error');
    expect(await call('confirm', { code, requestId: 'wrong-target' }, undefined, 'another-machine')).toHaveProperty('error');
    expect(await call('confirm', { code })).toHaveProperty('error');
    expect(await call('check', { code: '1234-5678' })).toHaveProperty('error');
    expect(devicePairing.check(code).status).toBe('pending');
  });
});
