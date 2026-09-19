import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MachineMetadata, Metadata } from '@/api/types';
import type { HappyHerdAutomationService } from '@/automations/service';
import type { SpawnSessionOptions, SpawnSessionResult } from '@/modules/common/registerCommonHandlers';
import type { resolveCredentialAccountEnvironment } from '@/credentialPool/store';

type Handlers = {
  requestShutdown: () => void;
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  onHappySessionWebhook: (sessionId: string, metadata: Metadata) => void;
  automations: HappyHerdAutomationService;
};

const mocks = vi.hoisted(() => ({
  handlers: undefined as Handlers | undefined,
  ready: false,
  spawnHappyCLI: vi.fn(),
  isTmuxAvailable: vi.fn(async () => false),
  spawnInTmux: vi.fn(),
  resolveCredentials: vi.fn<typeof resolveCredentialAccountEnvironment>(),
  schedule: vi.fn((_expression: string, _tick: () => void, _options: unknown) => ({
    destroy: vi.fn(async () => undefined),
  })),
}));

vi.mock('node-cron', async (importOriginal) => {
  const original = await importOriginal<typeof import('node-cron')>();
  return { ...original, default: { ...original.default, schedule: mocks.schedule } };
});
vi.mock('@/api/api', () => ({
  ApiClient: { create: vi.fn(async () => ({
    deactivateSession: vi.fn(),
    getOrCreateMachine: vi.fn(async ({ metadata }: { metadata: MachineMetadata }) => ({ id: 'machine-one', metadata })),
    machineSyncClient: vi.fn(() => ({
      connect: vi.fn(() => { mocks.ready = true; }),
      setRPCHandlers: vi.fn(),
      shutdown: vi.fn(),
      updateDaemonState: vi.fn(async () => undefined),
    })),
  })) },
}));
vi.mock('@/api/defaultAssistant', () => ({ DefaultAssistantApi: class {} }));
vi.mock('@/persistence', () => ({
  acquireDaemonLock: vi.fn(async () => ({})),
  releaseDaemonLock: vi.fn(async () => undefined),
  readDaemonState: vi.fn(async () => null),
  readPersistedSessions: vi.fn(() => ({})),
  persistSession: vi.fn(() => true),
  writeDaemonState: vi.fn(),
}));
vi.mock('@/daemon/controlClient', () => ({
  cleanupDaemonState: vi.fn(async () => undefined),
  isDaemonRunningCurrentlyInstalledHappyVersion: vi.fn(async () => false),
  listDaemonSessions: vi.fn(async () => []),
  stopDaemon: vi.fn(async () => undefined),
}));
vi.mock('@/daemon/controlServer', () => ({
  startDaemonControlServer: vi.fn(async (handlers: Handlers) => {
    mocks.handlers = handlers;
    return { port: 39001, stop: vi.fn(async () => undefined) };
  }),
}));
vi.mock('@/utils/spawnHappyCLI', () => ({ spawnHappyCLI: mocks.spawnHappyCLI }));
vi.mock('@/utils/tmux', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/utils/tmux')>(),
  isTmuxAvailable: mocks.isTmuxAvailable,
  getTmuxUtilities: () => ({ spawnInTmux: mocks.spawnInTmux }),
}));
vi.mock('@/ui/auth', () => ({
  authAndSetupMachineIfNeeded: vi.fn(async () => ({
    credentials: { token: 'test-token' }, machineId: 'machine-one',
  })),
}));
vi.mock('@/ui/logger', () => ({ logger: {
  debug: vi.fn(), debugLargeJson: vi.fn(), warn: vi.fn(), logFilePath: '/tmp/pre-spawn-test.log',
} }));
vi.mock('@/ui/doctor', () => ({ getEnvironmentInfo: vi.fn(() => ({})) }));
vi.mock('@/utils/caffeinate', () => ({
  startCaffeinate: vi.fn(() => false), stopCaffeinate: vi.fn(async () => undefined),
}));
vi.mock('@/utils/detectCLI', () => ({ detectCLIAvailability: vi.fn(() => ({})) }));
vi.mock('@/capabilities/agentCapabilities', () => ({ buildBaselineAgentCapabilities: vi.fn(() => ({})) }));
vi.mock('@/resume/localHappyAgentAuth', () => ({ detectResumeSupport: vi.fn(() => ({})) }));
vi.mock('@/agentContext/commanderContext', () => ({
  agentContextRoot: () => process.env.HAPPY_HOME_DIR!,
  listCommanders: vi.fn(async () => ({ commanders: [] })),
  contextEnvironment: vi.fn(() => ({})),
  prepareCommanderContext: vi.fn(async () => ({ commander: null })),
}));
vi.mock('@/automations/sessionBootstrap', () => ({
  prepareAutomationBootstrap: vi.fn(async () => ({})),
  automationBootstrapEnvironment: vi.fn(() => ({})),
}));
vi.mock('@/daemon/processStatus', () => ({ hasProviderProcessExited: vi.fn(() => false) }));
vi.mock('@/daemon/happyTerminalBoot', () => ({ startHappyTerminalDaemon: vi.fn() }));
vi.mock('@/credentialPool/store', () => ({ resolveCredentialAccountEnvironment: mocks.resolveCredentials }));
vi.mock('@/credentialPool/manager', () => ({
  CredentialAccountManager: class { dispose = vi.fn(async () => undefined); },
}));

import { startDaemon } from './run';

let root: string;
let daemonRun: Promise<void> | undefined;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.handlers = undefined;
  mocks.ready = false;
  daemonRun = undefined;
  root = await mkdtemp(join(tmpdir(), 'happyherd-pre-spawn-'));
  vi.stubEnv('HAPPY_HOME_DIR', join(root, '.happyherd'));
  vi.stubEnv('HAPPYHERD_MISSING_PRESPAWN_TEST_VAR', undefined);
  await mkdir(process.env.HAPPY_HOME_DIR!, { recursive: true });
  await writeFile(join(process.env.HAPPY_HOME_DIR!, 'AGENTS.md'), '# Test');
  mocks.isTmuxAvailable.mockResolvedValue(false);
  mocks.resolveCredentials.mockResolvedValue({ selection: { type: 'unconfigured' }, env: {} });
  mocks.spawnHappyCLI.mockReturnValue({ pid: 4321, on: vi.fn(), kill: vi.fn() });
  vi.spyOn(process, 'on').mockImplementation((() => process) as typeof process.on);
  vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  daemonRun = startDaemon();
  await vi.waitFor(() => expect(mocks.ready).toBe(true));
});

afterEach(async () => {
  try {
    if (daemonRun && mocks.handlers) {
      const timers = vi.spyOn(global, 'setTimeout');
      mocks.handlers.requestShutdown();
      const index = timers.mock.calls.findIndex((call) => call[1] === 10_000);
      if (index >= 0) clearTimeout(timers.mock.results[index].value);
      await daemonRun;
    }
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

function expectNoSpawn() {
  expect(mocks.spawnHappyCLI).not.toHaveBeenCalled();
  expect(mocks.spawnInTmux).not.toHaveBeenCalled();
}

function limitAllAccounts() {
  mocks.resolveCredentials.mockResolvedValue({
    selection: { type: 'all-limited', limitedUntil: Date.parse('2026-09-15T00:00:00Z') },
    env: {},
  });
}

describe('daemon pre-spawn rejection evidence', () => {
  it.each(['claude', 'codex', 'grok'] as const)('marks all-limited %s accounts retry-safe without spawning', async (agent) => {
    limitAllAccounts();
    await expect(mocks.handlers!.spawnSession({ directory: root, agent })).resolves.toMatchObject({
      type: 'error', retrySafe: true, errorMessage: expect.stringContaining(`All ${agent} accounts are limited`),
    });
    expectNoSpawn();
  });

  it('marks a directory-creation rejection retry-safe without spawning', async () => {
    const file = join(root, 'not-a-directory');
    await writeFile(file, 'test');
    await expect(mocks.handlers!.spawnSession({ directory: join(file, 'child') })).resolves.toMatchObject({
      type: 'error', retrySafe: true, errorMessage: expect.stringContaining('Unable to create directory'),
    });
    expectNoSpawn();
  });

  it('marks unresolved environment variables retry-safe without spawning', async () => {
    await expect(mocks.handlers!.spawnSession({
      directory: root,
      environmentVariables: { ANTHROPIC_AUTH_TOKEN: '${HAPPYHERD_MISSING_PRESPAWN_TEST_VAR}' },
    })).resolves.toMatchObject({
      type: 'error', retrySafe: true, errorMessage: expect.stringContaining('Session environment is invalid'),
    });
    expectNoSpawn();
  });

  it.each([false, true])('marks unsupported agents retry-safe with tmux=%s', async (tmux) => {
    mocks.isTmuxAvailable.mockResolvedValue(tmux);
    await expect(mocks.handlers!.spawnSession({
      directory: root,
      agent: 'future-provider' as SpawnSessionOptions['agent'],
      environmentVariables: { TMUX_SESSION_NAME: 'test' },
    })).resolves.toMatchObject({
      type: 'error', retrySafe: true, errorMessage: expect.stringContaining('Unsupported agent type'),
    });
    expectNoSpawn();
  });

  it('does not infer retry safety from a catch-all exception after process creation', async () => {
    mocks.spawnHappyCLI.mockReturnValue({ pid: 4321, on: () => { throw new Error('listener setup failed'); } });
    const result = await mocks.handlers!.spawnSession({ directory: root, agent: 'codex' });
    expect(result).toMatchObject({ type: 'error', errorMessage: 'Failed to spawn session: listener setup failed' });
    expect(result).not.toHaveProperty('retrySafe');
    expect(mocks.spawnHappyCLI).toHaveBeenCalledOnce();
  });

  it('does not infer retry safety when tmux created a window but returned no PID', async () => {
    mocks.isTmuxAvailable.mockResolvedValue(true);
    mocks.spawnInTmux.mockResolvedValue({ success: true, sessionId: 'test:1' });
    const result = await mocks.handlers!.spawnSession({
      directory: root, agent: 'codex', environmentVariables: { TMUX_SESSION_NAME: 'test' },
    });
    expect(result).toMatchObject({ type: 'error', errorMessage: expect.stringContaining('no PID returned') });
    expect(result).not.toHaveProperty('retrySafe');
    expect(mocks.spawnInTmux).toHaveBeenCalledOnce();
    expect(mocks.spawnHappyCLI).not.toHaveBeenCalled();
  });

  it('keeps a webhook timeout ambiguous after a process was spawned', async () => {
    const timers = vi.spyOn(global, 'setTimeout');
    const pending = mocks.handlers!.spawnSession({ directory: root, agent: 'codex' });
    await vi.waitFor(() => expect(timers.mock.calls.some((call) => call[1] === 15_000)).toBe(true));
    const index = timers.mock.calls.findIndex((call) => call[1] === 15_000);
    clearTimeout(timers.mock.results[index].value);
    (timers.mock.calls[index][0] as () => void)();
    const result = await pending;
    expect(result).toMatchObject({ type: 'error', errorMessage: expect.stringContaining('Session webhook timeout') });
    expect(result).not.toHaveProperty('retrySafe');
    expect(mocks.spawnHappyCLI).toHaveBeenCalledOnce();
  });

  it('records terminal failures on consecutive scheduled ticks and starts after quota recovers', async () => {
    limitAllAccounts();
    const service = mocks.handlers!.automations;
    const automation = await service.create({
      name: 'Quota recovery', kind: 'scheduled', instruction: 'Review the task list.',
      schedule: '* * * * *', timezone: 'UTC', workspace: root,
      rail: 'codex', commanderId: null, status: 'active', maxRetries: 0,
    });
    const tick = mocks.schedule.mock.calls.at(-1)![1];
    for (const count of [1, 2]) {
      tick();
      await vi.waitFor(async () => {
        const { runs } = await service.history(automation.id);
        expect(runs).toHaveLength(count);
        expect(runs.every((run) => run.status === 'failed' && run.finishedAt !== null && run.sessionId === null)).toBe(true);
      });
      expect(await service.listActiveRuns()).toEqual([]);
    }
    expect(mocks.resolveCredentials).toHaveBeenCalledTimes(2);
    expectNoSpawn();

    mocks.resolveCredentials.mockResolvedValue({ selection: { type: 'unconfigured' }, env: {} });
    tick();
    await vi.waitFor(() => expect(mocks.spawnHappyCLI).toHaveBeenCalledOnce());
    mocks.handlers!.onHappySessionWebhook('recovered-session', {
      path: root, host: 'test-host', hostPid: 4321,
      homeDir: root, happyHomeDir: process.env.HAPPY_HOME_DIR!, happyLibDir: root, happyToolsDir: root,
    });
    await vi.waitFor(async () => {
      const { runs } = await service.history(automation.id);
      expect(runs).toHaveLength(3);
      expect(runs.filter((run) => run.status === 'failed')).toHaveLength(2);
      expect(runs.find((run) => run.status === 'started')).toMatchObject({
        source: 'schedule', sessionId: 'recovered-session', finishedAt: null,
      });
      expect(runs.some((run) => run.status === 'skipped')).toBe(false);
    });
  });

  it('keeps an ambiguous scheduled launch active and skips the next tick without spawning again', async () => {
    mocks.spawnHappyCLI.mockReturnValue({ pid: 4321, on: () => { throw new Error('listener setup failed'); } });
    const service = mocks.handlers!.automations;
    const automation = await service.create({
      name: 'Ambiguous launch', kind: 'scheduled', instruction: 'Review the task list.',
      schedule: '* * * * *', timezone: 'UTC', workspace: root,
      rail: 'codex', commanderId: null, status: 'active', maxRetries: 0,
    });
    const tick = mocks.schedule.mock.calls.at(-1)![1];
    tick();
    await vi.waitFor(async () => {
      const { runs } = await service.history(automation.id);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        status: 'running', sessionId: null, finishedAt: null,
        message: expect.stringContaining('Provider start could not be disproved'),
      });
    });
    tick();
    await vi.waitFor(async () => {
      const { runs } = await service.history(automation.id);
      expect(runs).toHaveLength(2);
      expect(runs.filter((run) => run.status === 'running')).toHaveLength(1);
      expect(runs.filter((run) => run.status === 'skipped')).toHaveLength(1);
    });
    expect(mocks.spawnHappyCLI).toHaveBeenCalledOnce();
  });
});
