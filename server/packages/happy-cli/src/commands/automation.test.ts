import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  daemonAutomationAction: vi.fn(),
  ensureDaemonRunning: vi.fn(),
}));

vi.mock('@/daemon/controlClient', () => ({
  daemonAutomationAction: mocks.daemonAutomationAction,
}));

vi.mock('@/daemon/ensureDaemonRunning', () => ({
  ensureDaemonRunning: mocks.ensureDaemonRunning,
}));

import { handleAutomationCommand } from './automation';

describe('handleAutomationCommand tags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureDaemonRunning.mockResolvedValue(undefined);
    mocks.daemonAutomationAction.mockResolvedValue({ ok: true });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('forwards repeated --tag values when creating an automation', async () => {
    await handleAutomationCommand([
      'create',
      '--name', 'Heartbeat',
      '--kind', 'heartbeat',
      '--instruction', 'Check status.',
      '--schedule', '*/15 * * * *',
      '--timezone', 'UTC',
      '--workspace', '/srv/app',
      '--rail', 'codex',
      '--tag', ' Project Beacon ',
      '--tag', 'Operations',
    ]);

    expect(mocks.daemonAutomationAction).toHaveBeenCalledWith('create', {
      input: expect.objectContaining({
        tags: ['Project Beacon', 'Operations'],
      }),
    });
  });

  it('forwards a validated per-automation timeout', async () => {
    await handleAutomationCommand([
      'update', 'automation-id', '--timeout-minutes', '360',
    ]);

    expect(mocks.daemonAutomationAction).toHaveBeenCalledWith('update', {
      id: 'automation-id',
      input: { timeoutMinutes: 360 },
    });
  });

  it('rejects malformed or out-of-range timeouts before daemon mutation', async () => {
    await expect(handleAutomationCommand([
      'update', 'automation-id', '--timeout-minutes', '1.5',
    ])).rejects.toThrow(/whole-number/);
    await expect(handleAutomationCommand([
      'update', 'automation-id', '--timeout-minutes', '0',
    ])).rejects.toThrow(/between 1 and 1440/);
    expect(mocks.daemonAutomationAction).not.toHaveBeenCalled();
  });

  it('clears tags explicitly on update and otherwise omits the field', async () => {
    await handleAutomationCommand(['update', 'automation-id', '--clear-tags']);
    expect(mocks.daemonAutomationAction).toHaveBeenNthCalledWith(1, 'update', {
      id: 'automation-id',
      input: { tags: [] },
    });

    await handleAutomationCommand(['update', 'automation-id', '--name', 'Renamed']);
    expect(mocks.daemonAutomationAction).toHaveBeenNthCalledWith(2, 'update', {
      id: 'automation-id',
      input: { name: 'Renamed' },
    });
  });

  it('rejects ambiguous or valueless tag flags before mutating the daemon', async () => {
    await expect(handleAutomationCommand([
      'update', 'automation-id', '--tag', 'Project Beacon', '--clear-tags',
    ])).rejects.toThrow('--tag and --clear-tags cannot be combined');
    await expect(handleAutomationCommand([
      'update', 'automation-id', '--tag',
    ])).rejects.toThrow('--tag requires a value');
    expect(mocks.daemonAutomationAction).not.toHaveBeenCalled();
  });
});
