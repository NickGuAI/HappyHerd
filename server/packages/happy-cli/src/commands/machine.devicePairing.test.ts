import { describe, expect, it, vi } from 'vitest';
import { handleMachineCommand } from './machine';

const receipt = {
  code: '00123456', machineId: 'existing-machine', host: 'workstation',
  serverUrl: 'https://server.example', expiresAt: 121_000,
};
function fixture() {
  return {
    createDevicePairing: vi.fn(async () => receipt),
    cancelDevicePairing: vi.fn(async () => ({ status: 'cancelled' as const })),
    createClient: vi.fn(),
    accountAuth: { login: vi.fn(), logout: vi.fn(), status: vi.fn() },
    output: vi.fn(),
  };
}

describe('happyherd machine pair', () => {
  it('uses the running local daemon without account auth or remote client creation', async () => {
    const dependencies = fixture();
    await handleMachineCommand(['pair', '--json'], dependencies);
    expect(dependencies.createDevicePairing).toHaveBeenCalledOnce();
    expect(JSON.parse(dependencies.output.mock.calls[0][0])).toEqual(receipt);
    expect(dependencies.createClient).not.toHaveBeenCalled();
    for (const call of Object.values(dependencies.accountAuth)) expect(call).not.toHaveBeenCalled();
  });

  it('prints grouped code, exact machine and server, deadline and same-account requirement', async () => {
    const dependencies = fixture();
    await handleMachineCommand(['pair'], dependencies);
    const output = dependencies.output.mock.calls.flat().join('\n');
    for (const value of ['0012-3456', receipt.host, receipt.machineId, receipt.serverUrl, '1970-01-01T00:02:01.000Z', 'same Happy account and server']) {
      expect(output).toContain(value);
    }
  });

  it('cancels only through the local daemon and never creates another code', async () => {
    const dependencies = fixture();
    await handleMachineCommand(['pair', 'cancel', '--json'], dependencies);
    expect(dependencies.cancelDevicePairing).toHaveBeenCalledOnce();
    expect(dependencies.createDevicePairing).not.toHaveBeenCalled();
    expect(JSON.parse(dependencies.output.mock.calls[0][0])).toEqual({ status: 'cancelled' });
    expect(dependencies.createClient).not.toHaveBeenCalled();
  });

  it('keeps help and malformed arguments side-effect free and surfaces daemon failure', async () => {
    const dependencies = fixture();
    await handleMachineCommand(['pair', '--help'], dependencies);
    await expect(handleMachineCommand(['pair', '--machine', 'different'], dependencies)).rejects.toThrow('Unknown option');
    expect(dependencies.createDevicePairing).not.toHaveBeenCalled();
    dependencies.createDevicePairing.mockRejectedValueOnce(new Error('No daemon running'));
    await expect(handleMachineCommand(['pair'], dependencies)).rejects.toThrow('No daemon running');
    expect(dependencies.createDevicePairing).toHaveBeenCalledOnce();
    for (const call of Object.values(dependencies.accountAuth)) expect(call).not.toHaveBeenCalled();
  });
});
