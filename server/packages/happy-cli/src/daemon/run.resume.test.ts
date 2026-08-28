import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Metadata } from '@/api/types';
import type { SessionEncryptionData } from './types';

const mocks = vi.hoisted(() => ({
  backfillReconnectableSessionForMachine: vi.fn(),
  controlHandlers: undefined as unknown,
  forkCodexBackendThread: vi.fn(async () => ({
    type: 'success',
    newCodexThreadId: 'thread-child',
  })),
  hasProviderProcessExited: vi.fn(() => false),
  persistSession: vi.fn(() => true),
  readPersistedSessions: vi.fn(() => ({})),
  resolveLocalReconnectableSession: vi.fn(),
  rpcHandlers: undefined as unknown,
  spawnHappyCLI: vi.fn(),
}));

vi.mock('@/api/api', () => ({
  ApiClient: {
    create: vi.fn(async () => ({
      deactivateSession: vi.fn(),
      getOrCreateMachine: vi.fn(async ({ metadata }: { metadata: Metadata }) => ({
        id: 'machine-record',
        metadata,
      })),
      machineSyncClient: vi.fn(() => ({
        connect: vi.fn(),
        forkClaudeBackendSession: vi.fn(async () => ({
          type: 'success',
          newClaudeSessionId: '22222222-2222-4222-8222-222222222222',
        })),
        forkCodexBackendThread: mocks.forkCodexBackendThread,
        setRPCHandlers: vi.fn((handlers: unknown) => {
          mocks.rpcHandlers = handlers;
        }),
        shutdown: vi.fn(),
        updateDaemonState: vi.fn(async () => undefined),
      })),
    })),
  },
}));

vi.mock('@/persistence', () => ({
  acquireDaemonLock: vi.fn(async () => ({})),
  persistSession: mocks.persistSession,
  readDaemonState: vi.fn(async () => null),
  readPersistedSessions: mocks.readPersistedSessions,
  releaseDaemonLock: vi.fn(async () => undefined),
  writeDaemonState: vi.fn(),
}));

vi.mock('@/daemon/controlClient', () => ({
  cleanupDaemonState: vi.fn(async () => undefined),
  isDaemonRunningCurrentlyInstalledHappyVersion: vi.fn(async () => false),
  listDaemonSessions: vi.fn(async () => []),
  stopDaemon: vi.fn(async () => undefined),
}));

vi.mock('@/daemon/controlServer', () => ({
  startDaemonControlServer: vi.fn(async (handlers: unknown) => {
    mocks.controlHandlers = handlers;
    return { port: 39001, stop: vi.fn(async () => undefined) };
  }),
}));

vi.mock('@/resume/localResumeStore', () => ({
  backfillReconnectableSessionForMachine: mocks.backfillReconnectableSessionForMachine,
  resolveLocalReconnectableSession: mocks.resolveLocalReconnectableSession,
}));

vi.mock('@/utils/spawnHappyCLI', () => ({
  spawnHappyCLI: mocks.spawnHappyCLI,
}));

vi.mock('@/ui/auth', () => ({
  authAndSetupMachineIfNeeded: vi.fn(async () => ({
    credentials: { token: 'test-token' },
    machineId: 'machine-1',
  })),
}));

vi.mock('@/ui/logger', () => ({
  logger: {
    debug: vi.fn(),
    debugLargeJson: vi.fn(),
    logFilePath: '/tmp/happy-daemon-test.log',
    warn: vi.fn(),
  },
}));

vi.mock('@/ui/doctor', () => ({
  getEnvironmentInfo: vi.fn(() => ({})),
}));

vi.mock('@/utils/caffeinate', () => ({
  startCaffeinate: vi.fn(() => false),
  stopCaffeinate: vi.fn(async () => undefined),
}));

vi.mock('@/utils/detectCLI', () => ({
  detectCLIAvailability: vi.fn(() => ({ claude: true, codex: true, gemini: false, grok: true, opencode: false, agy: false, detectedAt: 1 })),
}));

vi.mock('@/capabilities/agentCapabilities', () => ({
  buildBaselineAgentCapabilities: vi.fn(() => ({
    grok: {
      detectedAt: 1,
      sources: { models: 'test', effortLevels: 'test', permissionModes: 'test' },
      models: [{ code: 'grok-build', value: 'GrokBuild', isDefault: true }],
      effortLevels: [],
      permissionModes: [
        { code: 'default', value: 'Default', isDefault: true },
        { code: 'bypassPermissions', value: 'Bypass permissions' },
        { code: 'dontAsk', value: 'Deny without asking' },
      ],
      acp: { loadSession: true, prompt: { image: true } },
    },
  })),
}));

vi.mock('@/resume/localHappyAgentAuth', () => ({
  detectResumeSupport: vi.fn(() => ({ happyAgentAuthenticated: true })),
}));

vi.mock('@/agentContext/commanderContext', () => ({
  contextEnvironment: vi.fn(() => ({})),
  prepareCommanderContext: vi.fn(async () => ({
    commander: null,
    contextHash: 'context-hash',
    bundlePath: '/tmp/context.md',
    globalAgentsPath: null,
    globalAgentContextPath: '/tmp/agentcontext',
    projectGuidancePath: null,
  })),
}));

vi.mock('@/automations/service', () => ({
  HappyHerdAutomationService: class {
    start = vi.fn(async () => undefined);
    stop = vi.fn(async () => undefined);
    listActiveRuns = vi.fn(async () => []);
  },
}));

vi.mock('@/daemon/processStatus', () => ({
  hasProviderProcessExited: mocks.hasProviderProcessExited,
}));

vi.mock('@/daemon/happyTerminalBoot', () => ({
  startHappyTerminalDaemon: vi.fn(),
}));

import { resolveDaemonAgentCommand, resolveDaemonResumeAgent, startDaemon } from './run';

type CapturedRpcHandlers = {
  requestShutdown: () => void;
  resumeSession: (
    sessionId: string,
    options?: { permissionMode?: string },
  ) => Promise<{ type: string; sessionId?: string; errorMessage?: string }>;
};

type CapturedControlHandlers = {
  onHappySessionWebhook: (
    sessionId: string,
    metadata: Metadata,
    encryption?: SessionEncryptionData,
  ) => void;
  createSideChat: (parentSessionId: string) => Promise<{ sessionId: string }>;
};

let daemonRun: Promise<void> | undefined;
let originalCodexHome: string | undefined;

describe('daemon session continuity', () => {
  it('resolves GrokBuild for the shared tmux and direct-spawn command path', () => {
    expect(resolveDaemonAgentCommand('grok')).toBe('grok');
    expect(resolveDaemonResumeAgent({ flavor: 'grok' } as Metadata)).toBe('grok');
    expect(resolveDaemonAgentCommand('future-provider' as any)).toBeNull();
    expect(resolveDaemonResumeAgent({ flavor: 'future-provider' } as Metadata)).toBeNull();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    daemonRun = undefined;
    mocks.controlHandlers = undefined;
    mocks.rpcHandlers = undefined;
    originalCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = '/ambient/wrong-provider-home';
    vi.spyOn(process, 'on').mockImplementation((() => process) as typeof process.on);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(async () => {
    const rpc = mocks.rpcHandlers as CapturedRpcHandlers | undefined;
    if (daemonRun && rpc?.requestShutdown) {
      const timeoutSpy = vi.spyOn(global, 'setTimeout');
      rpc.requestShutdown();
      const fallbackTimer = timeoutSpy.mock.calls.findIndex((call) => call[1] === 1_000);
      await daemonRun;
      if (fallbackTimer >= 0) {
        clearTimeout(timeoutSpy.mock.results[fallbackTimer].value as ReturnType<typeof setTimeout>);
      }
    }
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    vi.restoreAllMocks();
  });

  it('backfills a missing local record despite a reused stale metadata PID and spawns the same Happy session', async () => {
    const resolvedSessionId = 'csynthetic000000000000001';
    const encryptionKey = new Uint8Array([1, 2, 3, 4]);
    const codexHome = '/unavailable/provider-home';
    const metadata: Metadata = {
      path: process.cwd(),
      flavor: 'codex',
      codexThreadId: 'thread-legacy',
      codexHome,
      host: 'test-host',
      hostPid: 9876,
      machineId: 'machine-1',
      homeDir: '/home/test',
      happyHomeDir: '/home/test/.happy',
      happyLibDir: '/srv/happy',
      happyToolsDir: '/srv/happy/tools',
    };
    const encryption: SessionEncryptionData = {
      encryptionKey,
      encryptionVariant: 'dataKey',
      seq: 42,
      metadataVersion: 7,
      agentStateVersion: 9,
    };
    const persisted = {
      encryptionKey: Buffer.from(encryptionKey).toString('base64'),
      encryptionVariant: encryption.encryptionVariant,
      seq: encryption.seq,
      metadataVersion: encryption.metadataVersion,
      agentStateVersion: encryption.agentStateVersion,
      metadata,
      savedAt: Date.now(),
    };
    mocks.backfillReconnectableSessionForMachine.mockResolvedValue({
      session: {
        id: resolvedSessionId,
        active: false,
        metadata,
        ...encryption,
      },
      persisted,
    });
    mocks.spawnHappyCLI.mockReturnValue({
      pid: 4321,
      kill: vi.fn(),
      on: vi.fn(),
    });

    daemonRun = startDaemon();
    await vi.waitFor(() => expect(mocks.rpcHandlers).toBeDefined());
    const rpc = mocks.rpcHandlers as CapturedRpcHandlers;
    const control = mocks.controlHandlers as CapturedControlHandlers;
    expect(mocks.readPersistedSessions).toHaveReturnedWith({});

    const resume = rpc.resumeSession(resolvedSessionId);
    await vi.waitFor(() => expect(mocks.spawnHappyCLI).toHaveBeenCalledOnce());
    control.onHappySessionWebhook(resolvedSessionId, { ...metadata, hostPid: 4321 }, encryption);

    await expect(resume).resolves.toEqual({ type: 'success', sessionId: resolvedSessionId });
    expect(mocks.backfillReconnectableSessionForMachine).toHaveBeenCalledWith(resolvedSessionId, 'machine-1');
    expect(mocks.hasProviderProcessExited).not.toHaveBeenCalled();

    const [args, spawnOptions] = mocks.spawnHappyCLI.mock.calls[0] as unknown as [
      string[],
      { cwd: string; env: NodeJS.ProcessEnv },
    ];
    expect(args).toEqual(['codex', '--resume', metadata.codexThreadId, '--started-by', 'daemon']);
    expect(spawnOptions.cwd).toBe(metadata.path);
    expect(spawnOptions.env.CODEX_HOME).toBe(codexHome);
    expect(spawnOptions.env.HAPPY_RECONNECT_SESSION_ID).toBe(resolvedSessionId);
    expect(spawnOptions.env.HAPPY_RECONNECT_ENCRYPTION_KEY).toBe(persisted.encryptionKey);
    expect(spawnOptions.env.HAPPY_RECONNECT_ENCRYPTION_VARIANT).toBe(encryption.encryptionVariant);
    expect(spawnOptions.env.HAPPY_RECONNECT_SEQ).toBe(String(encryption.seq));
    expect(spawnOptions.env.HAPPY_RECONNECT_METADATA_VERSION).toBe(String(encryption.metadataVersion));
    expect(spawnOptions.env.HAPPY_RECONNECT_AGENT_STATE_VERSION).toBe(String(encryption.agentStateVersion));
  });

  it('keeps the persisted Grok policy authoritative over a mismatched resume RPC', async () => {
    const resolvedSessionId = 'grok-session';
    const encryptionKey = new Uint8Array([1, 2, 3, 4]);
    const metadata: Metadata = {
      path: process.cwd(),
      flavor: 'grok',
      acpSessionId: 'grok-provider-session',
      acpCapabilities: { loadSession: true, prompt: { image: true } },
      spawnSettings: {
        provider: 'grok',
        model: 'grok-build',
        effort: null,
        permission: 'dontAsk',
      },
      host: 'test-host',
      machineId: 'machine-1',
      homeDir: '/home/test',
      happyHomeDir: '/home/test/.happyherd',
      happyLibDir: '/srv/happy',
      happyToolsDir: '/srv/happy/tools',
    };
    const encryption: SessionEncryptionData = {
      encryptionKey,
      encryptionVariant: 'dataKey',
      seq: 2,
      metadataVersion: 3,
      agentStateVersion: 4,
    };
    mocks.backfillReconnectableSessionForMachine.mockResolvedValue({
      session: { id: resolvedSessionId, active: false, metadata, ...encryption },
      persisted: {
        encryptionKey: Buffer.from(encryptionKey).toString('base64'),
        encryptionVariant: encryption.encryptionVariant,
        seq: encryption.seq,
        metadataVersion: encryption.metadataVersion,
        agentStateVersion: encryption.agentStateVersion,
        metadata,
        savedAt: Date.now(),
      },
    });
    mocks.spawnHappyCLI.mockReturnValue({ pid: 4322, kill: vi.fn(), on: vi.fn() });

    daemonRun = startDaemon();
    await vi.waitFor(() => expect(mocks.rpcHandlers).toBeDefined());
    const rpc = mocks.rpcHandlers as CapturedRpcHandlers;
    const control = mocks.controlHandlers as CapturedControlHandlers;
    const resume = rpc.resumeSession(resolvedSessionId, {
      permissionMode: 'bypassPermissions',
    });
    await vi.waitFor(() => expect(mocks.spawnHappyCLI).toHaveBeenCalledOnce());
    control.onHappySessionWebhook(resolvedSessionId, { ...metadata, hostPid: 4322 }, encryption);

    await expect(resume).resolves.toEqual({ type: 'success', sessionId: resolvedSessionId });
    const [args] = mocks.spawnHappyCLI.mock.calls[0] as unknown as [string[]];
    expect(args).toEqual([
      'grok',
      '--started-by', 'daemon',
      '--resume', 'grok-provider-session',
      '--permission-mode', 'dontAsk',
    ]);
  });

  it('creates a local Codex side chat without account-control credentials', async () => {
    const parentMetadata: Metadata = {
      path: process.cwd(),
      flavor: 'codex',
      codexThreadId: 'thread-parent',
      host: 'test-host',
      hostPid: 9876,
      machineId: 'machine-1',
      homeDir: '/home/test',
      happyHomeDir: '/home/test/.happyherd',
      happyLibDir: '/srv/happy',
      happyToolsDir: '/srv/happy/tools',
    };
    mocks.resolveLocalReconnectableSession.mockResolvedValue({
      id: 'parent-session',
      metadata: parentMetadata,
    });
    mocks.spawnHappyCLI.mockReturnValue({
      pid: 5432,
      kill: vi.fn(),
      on: vi.fn(),
    });

    daemonRun = startDaemon();
    await vi.waitFor(() => expect(mocks.rpcHandlers).toBeDefined());
    const control = mocks.controlHandlers as CapturedControlHandlers;

    const sideChat = control.createSideChat('parent-session');
    const concurrentSideChat = control.createSideChat('parent-session');
    await vi.waitFor(() => expect(mocks.spawnHappyCLI).toHaveBeenCalledOnce());
    control.onHappySessionWebhook('child-session', {
      ...parentMetadata,
      hostPid: 5432,
      codexThreadId: 'thread-child',
      parentSessionId: 'parent-session',
      isSideChat: true,
    });

    await expect(sideChat).resolves.toEqual({ sessionId: 'child-session' });
    await expect(concurrentSideChat).resolves.toEqual({ sessionId: 'child-session' });
    expect(mocks.resolveLocalReconnectableSession).toHaveBeenCalledWith('parent-session');
    expect(mocks.forkCodexBackendThread).toHaveBeenCalledOnce();
    const [args, spawnOptions] = mocks.spawnHappyCLI.mock.calls[0] as unknown as [
      string[],
      { cwd: string },
    ];
    expect(args).toEqual(expect.arrayContaining(['codex', '--resume', 'thread-child', '--started-by', 'daemon']));
    expect(spawnOptions.cwd).toBe(parentMetadata.path);
  });
});
