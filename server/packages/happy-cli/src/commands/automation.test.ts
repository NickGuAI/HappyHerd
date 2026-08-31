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

describe('handleAutomationCommand', () => {
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

  it('creates an exec automation with an exact executable and argument array', async () => {
    await handleAutomationCommand([
      'create',
      '--name', 'Data sink',
      '--kind', 'scheduled',
      '--rail', 'exec',
      '--executable', '/opt/happyherd/bin/data-sink',
      '--argument', '--run-now',
      '--argument', 'literal value',
      '--schedule', '0 */2 * * *',
      '--timezone', 'UTC',
      '--workspace', '/srv/happyherd',
      '--status', 'paused',
    ]);

    expect(mocks.daemonAutomationAction).toHaveBeenCalledWith('create', {
      input: {
        name: 'Data sink',
        kind: 'scheduled',
        rail: 'exec',
        executable: '/opt/happyherd/bin/data-sink',
        arguments: ['--run-now', 'literal value'],
        schedule: '0 */2 * * *',
        timezone: 'UTC',
        workspace: '/srv/happyherd',
        status: 'paused',
      },
    });
  });

  it('requires an executable for exec creation and clears arguments explicitly on update', async () => {
    await expect(handleAutomationCommand([
      'create',
      '--name', 'Data sink',
      '--kind', 'scheduled',
      '--rail', 'exec',
      '--schedule', '0 */2 * * *',
      '--timezone', 'UTC',
      '--workspace', '/srv/happyherd',
    ])).rejects.toThrow('--executable is required');
    expect(mocks.daemonAutomationAction).not.toHaveBeenCalled();

    await handleAutomationCommand(['update', 'automation-id', '--clear-arguments']);
    expect(mocks.daemonAutomationAction).toHaveBeenCalledWith('update', {
      id: 'automation-id',
      input: { arguments: [] },
    });

    await expect(handleAutomationCommand([
      'update', 'automation-id', '--argument',
    ])).rejects.toThrow('--argument requires a value');
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

  it('targets one exact run for stop and requires explicit orphan confirmation', async () => {
    await handleAutomationCommand(['stop-run', 'automation-id', 'run-id']);
    expect(mocks.daemonAutomationAction).toHaveBeenNthCalledWith(1, 'stop-run', {
      id: 'automation-id',
      runId: 'run-id',
    });

    await handleAutomationCommand([
      'abandon-run', 'automation-id', 'run-id',
      '--session', 'session-id',
      '--confirm', 'ABANDON',
    ]);
    expect(mocks.daemonAutomationAction).toHaveBeenNthCalledWith(2, 'abandon-run', {
      id: 'automation-id',
      runId: 'run-id',
      input: {
        sessionId: 'session-id',
        confirmation: 'ABANDON',
      },
    });

    await expect(handleAutomationCommand([
      'abandon-run', 'automation-id', 'run-id', '--session', 'session-id',
    ])).rejects.toThrow('--confirm ABANDON is required');
  });
});
