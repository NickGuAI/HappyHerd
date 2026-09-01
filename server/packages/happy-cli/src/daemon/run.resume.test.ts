import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Metadata } from '@/api/types';
import type { ProviderLimitNotice } from '@/credentialPool/providerLimitNotice';
import type { ProviderLimitRotationDependencies } from '@/credentialPool/rotation';
import type {
  SideChatDelegationBrief,
  SideChatLifecycleReceipt,
  SideChatLifecycleRequest,
} from '@/commands/sideChat';
import type { SessionEncryptionData } from './types';

const mocks = vi.hoisted(() => ({
  authoritativeActive: false,
  backfillReconnectableSessionForMachine: vi.fn(),
  controlHandlers: undefined as unknown,
  exitedPids: new Set<number>(),
  resolveCredentialAccountEnvironment: vi.fn(async (): Promise<any> => ({
    selection: { type: 'unconfigured' },
    env: {},
  })),
  forkCodexBackendThread: vi.fn(async () => ({
    type: 'success',
    newCodexThreadId: 'thread-child',
  })),
  hasProviderProcessExited: vi.fn((_pid: number) => false),
  inspectSessionAuthoritative: vi.fn(async (session: unknown) => ({ session, active: false })),
  persistSession: vi.fn(() => true),
  postSessionEvent: vi.fn(async () => undefined),
  postSideChatBrief: vi.fn(async () => undefined),
  readPersistedSessions: vi.fn(() => ({})),
  resolveLocalReconnectableSession: vi.fn(),
  rotateProviderSessionAfterLimit: vi.fn(),
  rotationDependencies: undefined as ProviderLimitRotationDependencies | undefined,
  rpcHandlers: undefined as unknown,
  spawnHappyCLI: vi.fn(),
}));

vi.mock('@/api/api', () => ({
  ApiClient: {
    create: vi.fn(async () => ({
      deactivateSession: vi.fn(),
      inspectSessionAuthoritative: mocks.inspectSessionAuthoritative,
      postSessionEvent: mocks.postSessionEvent,
      postSideChatBrief: mocks.postSideChatBrief,
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
    claude: {
      detectedAt: 1,
      sources: { models: 'test', effortLevels: 'test', permissionModes: 'test' },
      models: [
        { code: 'default', value: 'Default' },
        { code: 'claude-opus-test', value: 'Claude Opus Test' },
      ],
      effortLevels: [
        { code: 'max', value: 'Max', isDefault: true },
        { code: 'high', value: 'High' },
      ],
      permissionModes: [
        { code: 'default', value: 'Default', isDefault: true },
        { code: 'bypassPermissions', value: 'Bypass permissions' },
        { code: 'plan', value: 'Plan' },
        { code: 'dontAsk', value: 'Deny without asking' },
      ],
    },
    codex: {
      detectedAt: 1,
      sources: { models: 'test', effortLevels: 'test', permissionModes: 'test' },
      models: [
        { code: 'gpt-5.6-codex', value: 'GPT-5.6 Codex', isDefault: true },
        { code: 'gpt-custom', value: 'GPT Custom' },
      ],
      effortLevels: [
        { code: 'xhigh', value: 'Extra high', isDefault: true },
        { code: 'high', value: 'High' },
      ],
      permissionModes: [
        { code: 'default', value: 'Ask first' },
        { code: 'auto', value: 'Auto' },
        { code: 'read-only', value: 'Read only' },
        { code: 'safe-yolo', value: 'Workspace', isDefault: true },
        { code: 'yolo', value: 'Full access' },
      ],
    },
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

vi.mock('@/credentialPool/store', () => ({
  resolveCredentialAccountEnvironment: mocks.resolveCredentialAccountEnvironment,
}));

vi.mock('@/credentialPool/rotation', () => ({
  rotateProviderSessionAfterLimit: mocks.rotateProviderSessionAfterLimit,
}));

import {
  initialMachineMetadata,
  resolveDaemonAgentCommand,
  resolveDaemonResumeAgent,
  startDaemon,
} from './run';
import { prepareCommanderContext } from '@/agentContext/commanderContext';

type CapturedRpcHandlers = {
  requestShutdown: () => void;
  spawnSession: (options: {
    directory: string;
    agent: 'codex';
    effectiveSettings: typeof codexAdvertisedDefaultSettings;
    continuedFromSessionId?: string;
  }) => Promise<{ type: string; sessionId?: string; errorMessage?: string; settings?: unknown }>;
  resumeSession: (
    sessionId: string,
    options?: {
      model?: string;
      effortLevel?: string;
      permissionMode?: string;
      replayQueueMessageId?: string;
    },
  ) => Promise<{ type: string; sessionId?: string; errorMessage?: string; settings?: unknown }>;
  changeGrokPermissionMode: (request: {
    sessionId: string;
    permissionMode: string;
  }) => Promise<{ type: 'success'; sessionId: string; permissionMode: string }>;
};

type CapturedControlHandlers = {
  onHappySessionWebhook: (
    sessionId: string,
    metadata: Metadata,
    encryption?: SessionEncryptionData,
  ) => void;
  onProviderLimited: (notice: ProviderLimitNotice) => void;
  sideChat: (request: SideChatLifecycleRequest) => Promise<SideChatLifecycleReceipt>;
};

let daemonRun: Promise<void> | undefined;
let originalCodexHome: string | undefined;
const temporaryDirectories: string[] = [];
const defaultAgentCapabilities = initialMachineMetadata.agentCapabilities;
const sideChatBrief: SideChatDelegationBrief = {
  outcome: 'Deliver the delegated change.',
  scope: 'Change the owned workstream only.',
  dependencies: 'Use the parent context.',
  writeOwnership: '/srv/project/owned.ts',
  verification: 'Run the focused checks.',
  handoff: 'Return result, evidence, blockers, and remaining work.',
};
const codexAdvertisedDefaultSettings = {
  provider: 'codex' as const,
  model: 'gpt-5.6-codex',
  effort: 'xhigh',
  permission: 'safe-yolo',
};
const commanderResumeCases = [
  {
    label: 'uses a reassigned Commander from authoritative metadata',
    commander: {
      id: 'athena',
      name: 'Athena',
      path: '/home/test/.happyherd/commanders/athena/COMMANDER.md',
      workspace: '/srv/project',
      agentContextPath: '/home/test/.happyherd/commanders/athena/agentcontext',
    },
  },
  {
    label: 'honors authoritative Commander detachment',
    commander: null,
  },
] as const;

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
    mocks.authoritativeActive = false;
    mocks.exitedPids.clear();
    mocks.hasProviderProcessExited.mockImplementation((pid: number) => mocks.exitedPids.has(pid));
    mocks.inspectSessionAuthoritative.mockImplementation(async (session: unknown) => ({
      session,
      active: mocks.authoritativeActive,
    }));
    mocks.persistSession.mockReturnValue(true);
    mocks.readPersistedSessions.mockReturnValue({});
    mocks.resolveCredentialAccountEnvironment.mockResolvedValue({
      selection: { type: 'unconfigured' },
      env: {},
    });
    mocks.rotateProviderSessionAfterLimit.mockImplementation(async (
      _notice: ProviderLimitNotice,
      dependencies: ProviderLimitRotationDependencies,
    ) => {
      mocks.rotationDependencies = dependencies;
      return { type: 'rotated', account: 'account-two' };
    });
    mocks.rotationDependencies = undefined;
    initialMachineMetadata.agentCapabilities = defaultAgentCapabilities;
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
    for (const directory of temporaryDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('backfills a missing local record despite a reused stale metadata PID and spawns the same Happy session', async () => {
    const resolvedSessionId = 'csynthetic000000000000001';
    const encryptionKey = new Uint8Array([1, 2, 3, 4]);
    const codexHome = '/unavailable/provider-home';
    const accountAuthFile = '/managed/codex/account-two/auth.json';
    const metadata: Metadata = {
      path: process.cwd(),
      flavor: 'codex',
      codexThreadId: 'thread-legacy',
      codexHome,
      providerAccount: 'account-one',
      host: 'test-host',
      hostPid: 9876,
      machineId: 'machine-1',
      homeDir: '/home/test',
      happyHomeDir: '/home/test/.happy',
      happyLibDir: '/srv/happy',
      happyToolsDir: '/srv/happy/tools',
      commanderId: 'athena',
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
    mocks.resolveCredentialAccountEnvironment.mockResolvedValue({
      selection: {
        type: 'available',
        account: {
          provider: 'codex',
          name: 'account-two',
          credential: { type: 'auth-file', path: accountAuthFile },
          createdAt: 1,
          updatedAt: 2,
          limitedUntil: null,
        },
      },
      env: {
        HAPPYHERD_PROVIDER_ACCOUNT: 'account-two',
        HAPPYHERD_PROVIDER_ACCOUNT_TYPE: 'codex',
        HAPPYHERD_CODEX_ACCOUNT_AUTH_FILE: accountAuthFile,
      },
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
    control.onHappySessionWebhook(resolvedSessionId, {
      ...metadata,
      hostPid: 4321,
      spawnSettings: codexAdvertisedDefaultSettings,
    }, encryption);

    await expect(resume).resolves.toMatchObject({ type: 'success', sessionId: resolvedSessionId });
    expect(mocks.backfillReconnectableSessionForMachine).toHaveBeenCalledWith(resolvedSessionId, 'machine-1');
    expect(prepareCommanderContext).toHaveBeenCalledWith('athena', metadata.path);
    expect(mocks.hasProviderProcessExited).not.toHaveBeenCalled();

    const [args, spawnOptions] = mocks.spawnHappyCLI.mock.calls[0] as unknown as [
      string[],
      { cwd: string; env: NodeJS.ProcessEnv },
    ];
    expect(args).toEqual([
      'codex',
      '--resume', metadata.codexThreadId,
      '--started-by', 'daemon',
      '--permission-mode', 'safe-yolo',
      '--model', 'gpt-5.6-codex',
      '--effort', 'xhigh',
    ]);
    expect(spawnOptions.cwd).toBe(metadata.path);
    expect(mocks.resolveCredentialAccountEnvironment).toHaveBeenCalledWith('codex', {
      preferred: 'account-one',
    });
    expect(spawnOptions.env.CODEX_HOME).toBe(codexHome);
    expect(spawnOptions.env.HAPPYHERD_PROVIDER_ACCOUNT).toBe('account-two');
    expect(spawnOptions.env.HAPPYHERD_CODEX_ACCOUNT_AUTH_FILE).toBe(accountAuthFile);
    expect(spawnOptions.env.HAPPY_RECONNECT_SESSION_ID).toBe(resolvedSessionId);
    expect(spawnOptions.env.HAPPY_RECONNECT_ENCRYPTION_KEY).toBe(persisted.encryptionKey);
    expect(spawnOptions.env.HAPPY_RECONNECT_ENCRYPTION_VARIANT).toBe(encryption.encryptionVariant);
    expect(spawnOptions.env.HAPPY_RECONNECT_SEQ).toBe(String(encryption.seq));
    expect(spawnOptions.env.HAPPY_RECONNECT_METADATA_VERSION).toBe(String(encryption.metadataVersion));
    expect(spawnOptions.env.HAPPY_RECONNECT_AGENT_STATE_VERSION).toBe(String(encryption.agentStateVersion));
    expect(JSON.parse(spawnOptions.env.HAPPYHERD_MACHINE_SESSION_SETTINGS_JSON!)).toEqual(
      codexAdvertisedDefaultSettings,
    );
  });

  it.each(commanderResumeCases)('$label on the next stopped-session resume', async ({ commander }) => {
    const sessionId = `commander-refresh-${commander?.id ?? 'none'}`;
    const encryptionKey = new Uint8Array(32).fill(7);
    const workingDirectory = process.cwd();
    const localMetadata: Metadata = {
      path: workingDirectory,
      flavor: 'codex',
      codexThreadId: 'thread-continuity',
      machineId: 'machine-1',
      host: 'test-host',
      hostPid: 9876,
      homeDir: '/home/test',
      happyHomeDir: '/home/test/.happyherd',
      happyLibDir: '/srv/happy',
      happyToolsDir: '/srv/happy/tools',
      codexHome: '/unavailable/provider-home',
      commanderId: 'old-commander',
      commanderName: 'Old Commander',
      commanderPath: '/old/COMMANDER.md',
      commanderWorkspace: '/old/workspace',
      commanderAgentContextPath: '/old/agentcontext',
      spawnSettings: codexAdvertisedDefaultSettings,
      gitBranch: 'preserve-me',
    };
    const authoritativeMetadata: Metadata = { ...localMetadata };
    delete authoritativeMetadata.commanderId;
    delete authoritativeMetadata.commanderName;
    delete authoritativeMetadata.commanderPath;
    delete authoritativeMetadata.commanderWorkspace;
    delete authoritativeMetadata.commanderAgentContextPath;
    if (commander) {
      Object.assign(authoritativeMetadata, {
        commanderId: commander.id,
        commanderName: commander.name,
        commanderPath: commander.path,
        commanderWorkspace: commander.workspace,
        commanderAgentContextPath: commander.agentContextPath,
      });
    }
    const localEncryption: SessionEncryptionData = {
      encryptionKey,
      encryptionVariant: 'dataKey',
      seq: 41,
      metadataVersion: 7,
      agentStateVersion: 8,
    };
    const refreshedEncryption: SessionEncryptionData = {
      ...localEncryption,
      seq: 84,
      metadataVersion: 12,
      agentStateVersion: 13,
    };
    mocks.readPersistedSessions.mockReturnValue({
      [sessionId]: {
        encryptionKey: Buffer.from(encryptionKey).toString('base64'),
        encryptionVariant: localEncryption.encryptionVariant,
        seq: localEncryption.seq,
        metadataVersion: localEncryption.metadataVersion,
        agentStateVersion: localEncryption.agentStateVersion,
        metadata: localMetadata,
        savedAt: 1,
      },
    });
    mocks.inspectSessionAuthoritative.mockImplementationOnce(async (session: any) => ({
      active: false,
      session: {
        ...session,
        seq: refreshedEncryption.seq,
        metadata: authoritativeMetadata,
        metadataVersion: refreshedEncryption.metadataVersion,
        agentStateVersion: refreshedEncryption.agentStateVersion,
      },
    }));
    mocks.spawnHappyCLI.mockReturnValue({
      pid: 4321,
      kill: vi.fn(),
      on: vi.fn(),
    });

    daemonRun = startDaemon();
    await vi.waitFor(() => expect(mocks.rpcHandlers).toBeDefined());
    const rpc = mocks.rpcHandlers as CapturedRpcHandlers;
    const control = mocks.controlHandlers as CapturedControlHandlers;

    const resume = rpc.resumeSession(sessionId);
    await vi.waitFor(() => expect(mocks.spawnHappyCLI).toHaveBeenCalledOnce());
    control.onHappySessionWebhook(sessionId, {
      ...authoritativeMetadata,
      hostPid: 4321,
    }, refreshedEncryption);

    await expect(resume).resolves.toMatchObject({ type: 'success', sessionId });
    expect(prepareCommanderContext).toHaveBeenCalledWith(commander?.id, workingDirectory);
    expect(mocks.inspectSessionAuthoritative).toHaveBeenCalledWith(expect.objectContaining({
      id: sessionId,
      seq: localEncryption.seq,
      metadata: localMetadata,
      metadataVersion: localEncryption.metadataVersion,
      agentStateVersion: localEncryption.agentStateVersion,
    }));
    const [args, spawnOptions] = mocks.spawnHappyCLI.mock.calls[0] as unknown as [
      string[],
      { cwd: string; env: NodeJS.ProcessEnv },
    ];
    expect(args).toEqual([
      'codex',
      '--resume', 'thread-continuity',
      '--started-by', 'daemon',
      '--permission-mode', 'safe-yolo',
      '--model', 'gpt-5.6-codex',
      '--effort', 'xhigh',
    ]);
    expect(spawnOptions.cwd).toBe(workingDirectory);
    expect(spawnOptions.env.HAPPY_RECONNECT_SESSION_ID).toBe(sessionId);
    expect(spawnOptions.env.HAPPY_RECONNECT_SEQ).toBe(String(refreshedEncryption.seq));
    expect(spawnOptions.env.HAPPY_RECONNECT_METADATA_VERSION).toBe(String(refreshedEncryption.metadataVersion));
    expect(spawnOptions.env.HAPPY_RECONNECT_AGENT_STATE_VERSION).toBe(String(refreshedEncryption.agentStateVersion));
    expect(mocks.persistSession.mock.calls[0]).toEqual([
      sessionId,
      expect.objectContaining({
        seq: refreshedEncryption.seq,
        metadataVersion: refreshedEncryption.metadataVersion,
        agentStateVersion: refreshedEncryption.agentStateVersion,
        metadata: authoritativeMetadata,
      }),
    ]);
    expect(authoritativeMetadata.gitBranch).toBe('preserve-me');
  });

  it('fails before spawning when authoritative resume metadata cannot be refreshed', async () => {
    const sessionId = 'commander-refresh-unavailable';
    const encryptionKey = new Uint8Array(32).fill(9);
    mocks.readPersistedSessions.mockReturnValue({
      [sessionId]: {
        encryptionKey: Buffer.from(encryptionKey).toString('base64'),
        encryptionVariant: 'dataKey',
        seq: 1,
        metadataVersion: 2,
        agentStateVersion: 3,
        metadata: {
          path: process.cwd(),
          flavor: 'codex',
          codexThreadId: 'thread-stale',
          machineId: 'machine-1',
          commanderId: 'old-commander',
        },
        savedAt: 1,
      },
    });
    mocks.inspectSessionAuthoritative.mockRejectedValueOnce(new Error('authoritative metadata unavailable'));

    daemonRun = startDaemon();
    await vi.waitFor(() => expect(mocks.rpcHandlers).toBeDefined());
    const rpc = mocks.rpcHandlers as CapturedRpcHandlers;

    await expect(rpc.resumeSession(sessionId)).resolves.toMatchObject({
      type: 'error',
      errorMessage: expect.stringContaining('authoritative metadata unavailable'),
    });
    expect(prepareCommanderContext).not.toHaveBeenCalled();
    expect(mocks.spawnHappyCLI).not.toHaveBeenCalled();
    expect(mocks.persistSession).not.toHaveBeenCalled();
  });

  it('carries provider-continuation lineage into a fresh daemon spawn without native resume state', async () => {
    mocks.spawnHappyCLI.mockReturnValue({
      pid: 4322,
      kill: vi.fn(),
      on: vi.fn(),
    });

    daemonRun = startDaemon();
    await vi.waitFor(() => expect(mocks.rpcHandlers).toBeDefined());
    const rpc = mocks.rpcHandlers as CapturedRpcHandlers;
    const control = mocks.controlHandlers as CapturedControlHandlers;
    const spawn = rpc.spawnSession({
      directory: process.cwd(),
      agent: 'codex',
      effectiveSettings: codexAdvertisedDefaultSettings,
      continuedFromSessionId: 'source-session',
    });

    await vi.waitFor(() => expect(mocks.spawnHappyCLI).toHaveBeenCalledOnce());
    control.onHappySessionWebhook('target-session', {
      path: process.cwd(),
      flavor: 'codex',
      codexThreadId: 'fresh-codex-thread',
      continuedFromSessionId: 'source-session',
      host: 'test-host',
      hostPid: 4322,
      machineId: 'machine-1',
      homeDir: '/home/test',
      happyHomeDir: '/home/test/.happyherd',
      happyLibDir: '/srv/happy',
      happyToolsDir: '/srv/happy/tools',
      spawnSettings: codexAdvertisedDefaultSettings,
    });

    await expect(spawn).resolves.toMatchObject({
      type: 'success',
      sessionId: 'target-session',
      settings: codexAdvertisedDefaultSettings,
    });
    const [args, spawnOptions] = mocks.spawnHappyCLI.mock.calls[0] as unknown as [
      string[],
      { cwd: string; env: NodeJS.ProcessEnv },
    ];
    expect(args).not.toContain('--resume');
    expect(spawnOptions.cwd).toBe(process.cwd());
    expect(spawnOptions.env.HAPPY_CONTINUED_FROM_SESSION_ID).toBe('source-session');
    expect(spawnOptions.env.HAPPY_FORKED_FROM_SESSION_ID).toBeUndefined();
  });

  it('replays the next archived turn from an older retained record without changing session identity or encryption', async () => {
    const sessionId = 'happy-archived-retained';
    const encryptionKey = new Uint8Array([7, 8, 9, 10]);
    const encryption: SessionEncryptionData = {
      encryptionKey,
      encryptionVariant: 'dataKey',
      seq: 91,
      metadataVersion: 12,
      agentStateVersion: 13,
    };
    const metadata: Metadata = {
      path: process.cwd(),
      flavor: 'codex',
      codexThreadId: 'thread-archived-retained',
      lifecycleState: 'archived',
      lifecycleStateSince: Date.now() - 60_000,
      archivedBy: 'app',
      archiveReason: 'User archived',
      host: 'test-host',
      machineId: 'machine-1',
      homeDir: '/home/test',
      happyHomeDir: '/home/test/.happyherd',
      happyLibDir: '/srv/happy',
      happyToolsDir: '/srv/happy/tools',
    };
    const persisted = {
      encryptionKey: Buffer.from(encryptionKey).toString('base64'),
      encryptionVariant: encryption.encryptionVariant,
      seq: encryption.seq,
      metadataVersion: encryption.metadataVersion,
      agentStateVersion: encryption.agentStateVersion,
      metadata,
      savedAt: Date.now() - 45 * 24 * 60 * 60 * 1000,
    };
    mocks.readPersistedSessions.mockReturnValue({ [sessionId]: persisted });
    mocks.spawnHappyCLI.mockReturnValue({ pid: 4324, kill: vi.fn(), on: vi.fn() });

    daemonRun = startDaemon();
    await vi.waitFor(() => expect(mocks.rpcHandlers).toBeDefined());
    const rpc = mocks.rpcHandlers as CapturedRpcHandlers;
    const control = mocks.controlHandlers as CapturedControlHandlers;
    const resume = rpc.resumeSession(sessionId, {
      replayQueueMessageId: 'archived-next-turn',
    });
    await vi.waitFor(() => expect(mocks.spawnHappyCLI).toHaveBeenCalledOnce());
    control.onHappySessionWebhook(sessionId, {
      ...metadata,
      hostPid: 4324,
      spawnSettings: codexAdvertisedDefaultSettings,
    }, encryption);

    await expect(resume).resolves.toMatchObject({ type: 'success', sessionId });
    expect(mocks.backfillReconnectableSessionForMachine).not.toHaveBeenCalled();

    const [args, spawnOptions] = mocks.spawnHappyCLI.mock.calls[0] as unknown as [
      string[],
      { cwd: string; env: NodeJS.ProcessEnv },
    ];
    expect(args).toEqual([
      'codex',
      '--resume', metadata.codexThreadId,
      '--started-by', 'daemon',
      '--permission-mode', 'safe-yolo',
      '--model', 'gpt-5.6-codex',
      '--effort', 'xhigh',
    ]);
    expect(spawnOptions.cwd).toBe(metadata.path);
    expect(spawnOptions.env.HAPPY_RECONNECT_SESSION_ID).toBe(sessionId);
    expect(spawnOptions.env.HAPPY_RECONNECT_QUEUE_MESSAGE_ID).toBe('archived-next-turn');
    expect(spawnOptions.env.HAPPY_RECONNECT_ENCRYPTION_KEY).toBe(persisted.encryptionKey);
    expect(spawnOptions.env.HAPPY_RECONNECT_ENCRYPTION_VARIANT).toBe(encryption.encryptionVariant);
    expect(spawnOptions.env.HAPPY_RECONNECT_SEQ).toBe(String(encryption.seq));
    expect(spawnOptions.env.HAPPY_RECONNECT_METADATA_VERSION).toBe(String(encryption.metadataVersion));
    expect(spawnOptions.env.HAPPY_RECONNECT_AGENT_STATE_VERSION).toBe(String(encryption.agentStateVersion));
  });

  it('launches and returns the latest complete Codex tuple from the resume RPC', async () => {
    const sessionId = 'codex-explicit-resume-mode';
    const encryption: SessionEncryptionData = {
      encryptionKey: new Uint8Array([11, 12, 13, 14]),
      encryptionVariant: 'dataKey',
      seq: 5,
      metadataVersion: 6,
      agentStateVersion: 7,
    };
    const metadata: Metadata = {
      path: process.cwd(),
      flavor: 'codex',
      codexThreadId: 'thread-explicit-resume-mode',
      permissionMode: 'read-only',
      spawnSettings: {
        ...codexAdvertisedDefaultSettings,
        model: 'gpt-custom',
        effort: 'high',
        permission: 'yolo',
      },
      host: 'test-host',
      machineId: 'machine-1',
      homeDir: '/home/test',
      happyHomeDir: '/home/test/.happyherd',
      happyLibDir: '/srv/happy',
      happyToolsDir: '/srv/happy/tools',
    };
    mocks.backfillReconnectableSessionForMachine.mockResolvedValue({
      session: { id: sessionId, active: false, metadata, ...encryption },
      persisted: {
        encryptionKey: Buffer.from(encryption.encryptionKey).toString('base64'),
        encryptionVariant: encryption.encryptionVariant,
        seq: encryption.seq,
        metadataVersion: encryption.metadataVersion,
        agentStateVersion: encryption.agentStateVersion,
        metadata,
        savedAt: Date.now(),
      },
    });
    mocks.spawnHappyCLI.mockReturnValue({ pid: 4325, kill: vi.fn(), on: vi.fn() });

    daemonRun = startDaemon();
    await vi.waitFor(() => expect(mocks.rpcHandlers).toBeDefined());
    const rpc = mocks.rpcHandlers as CapturedRpcHandlers;
    const control = mocks.controlHandlers as CapturedControlHandlers;
    const resume = rpc.resumeSession(sessionId, {
      model: 'gpt-5.6-codex',
      effortLevel: 'xhigh',
      permissionMode: 'read-only',
    });
    await vi.waitFor(() => expect(mocks.spawnHappyCLI).toHaveBeenCalledOnce());

    const expectedSettings = {
      ...codexAdvertisedDefaultSettings,
      model: 'gpt-5.6-codex',
      effort: 'xhigh',
      permission: 'read-only',
    };
    control.onHappySessionWebhook(sessionId, {
      ...metadata,
      hostPid: 4325,
      spawnSettings: expectedSettings,
    }, encryption);

    await expect(resume).resolves.toEqual({
      type: 'success',
      sessionId,
      settings: expectedSettings,
    });
    const [args, spawnOptions] = mocks.spawnHappyCLI.mock.calls[0] as unknown as [
      string[],
      { cwd: string; env: NodeJS.ProcessEnv },
    ];
    expect(args).toEqual([
      'codex',
      '--resume', metadata.codexThreadId,
      '--started-by', 'daemon',
      '--permission-mode', 'read-only',
      '--model', 'gpt-5.6-codex',
      '--effort', 'xhigh',
    ]);
    expect(JSON.parse(spawnOptions.env.HAPPYHERD_MACHINE_SESSION_SETTINGS_JSON!)).toEqual(expectedSettings);
  });

  it('launches and returns the complete Claude tuple with the advertised effort default on resume', async () => {
    const sessionId = 'claude-complete-resume-mode';
    const encryption: SessionEncryptionData = {
      encryptionKey: new Uint8Array([21, 22, 23, 24]),
      encryptionVariant: 'dataKey',
      seq: 8,
      metadataVersion: 9,
      agentStateVersion: 10,
    };
    const metadata: Metadata = {
      path: process.cwd(),
      flavor: 'claude',
      claudeSessionId: '11111111-1111-4111-8111-111111111111',
      permissionMode: 'plan',
      modelMode: 'default',
      effortLevel: null,
      spawnSettings: {
        provider: 'claude',
        model: 'default',
        effort: null,
        permission: 'default',
      },
      host: 'test-host',
      machineId: 'machine-1',
      homeDir: '/home/test',
      happyHomeDir: '/home/test/.happyherd',
      happyLibDir: '/srv/happy',
      happyToolsDir: '/srv/happy/tools',
    };
    mocks.backfillReconnectableSessionForMachine.mockResolvedValue({
      session: { id: sessionId, active: false, metadata, ...encryption },
      persisted: {
        encryptionKey: Buffer.from(encryption.encryptionKey).toString('base64'),
        encryptionVariant: encryption.encryptionVariant,
        seq: encryption.seq,
        metadataVersion: encryption.metadataVersion,
        agentStateVersion: encryption.agentStateVersion,
        metadata,
        savedAt: Date.now(),
      },
    });
    mocks.spawnHappyCLI.mockReturnValue({ pid: 4326, kill: vi.fn(), on: vi.fn() });

    daemonRun = startDaemon();
    await vi.waitFor(() => expect(mocks.rpcHandlers).toBeDefined());
    const rpc = mocks.rpcHandlers as CapturedRpcHandlers;
    const control = mocks.controlHandlers as CapturedControlHandlers;
    const expectedSettings = {
      provider: 'claude' as const,
      model: 'claude-opus-test',
      effort: 'max',
      permission: 'bypassPermissions',
    };
    const resume = rpc.resumeSession(sessionId, {
      model: expectedSettings.model,
      permissionMode: expectedSettings.permission,
    });
    await vi.waitFor(() => expect(mocks.spawnHappyCLI).toHaveBeenCalledOnce());
    control.onHappySessionWebhook(sessionId, {
      ...metadata,
      hostPid: 4326,
      permissionMode: expectedSettings.permission,
      modelMode: expectedSettings.model,
      effortLevel: expectedSettings.effort,
      spawnSettings: expectedSettings,
    }, encryption);

    await expect(resume).resolves.toEqual({
      type: 'success',
      sessionId,
      settings: expectedSettings,
    });
    const [args, spawnOptions] = mocks.spawnHappyCLI.mock.calls[0] as unknown as [
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    expect(args).toEqual([
      'claude',
      '--happy-starting-mode', 'remote',
      '--started-by', 'daemon',
      '--resume', metadata.claudeSessionId,
      '--permission-mode', 'bypassPermissions',
      '--model', 'claude-opus-test',
      '--effort', 'max',
    ]);
    expect(JSON.parse(spawnOptions.env.HAPPYHERD_MACHINE_SESSION_SETTINGS_JSON!)).toEqual(expectedSettings);
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

    await expect(resume).resolves.toMatchObject({ type: 'success', sessionId: resolvedSessionId });
    const [args] = mocks.spawnHappyCLI.mock.calls[0] as unknown as [string[]];
    expect(args).toEqual([
      'grok',
      '--started-by', 'daemon',
      '--resume', 'grok-provider-session',
      '--permission-mode', 'dontAsk',
    ]);
  });

  it('uses the advertised default for legacy Grok resumes and rejects raw RPC policy without a valid catalog', async () => {
    const encryptionKey = new Uint8Array([1, 2, 3, 4]);
    const encryption: SessionEncryptionData = {
      encryptionKey,
      encryptionVariant: 'dataKey',
      seq: 2,
      metadataVersion: 3,
      agentStateVersion: 4,
    };
    const metadata = (providerSessionId: string): Metadata => ({
      path: process.cwd(),
      flavor: 'grok',
      acpSessionId: providerSessionId,
      acpCapabilities: { loadSession: true, prompt: { image: true } },
      host: 'test-host',
      machineId: 'machine-1',
      homeDir: '/home/test',
      happyHomeDir: '/home/test/.happyherd',
      happyLibDir: '/srv/happy',
      happyToolsDir: '/srv/happy/tools',
    });
    const recovered = (sessionId: string, sessionMetadata: Metadata) => ({
      session: { id: sessionId, active: false, metadata: sessionMetadata, ...encryption },
      persisted: {
        encryptionKey: Buffer.from(encryptionKey).toString('base64'),
        encryptionVariant: encryption.encryptionVariant,
        seq: encryption.seq,
        metadataVersion: encryption.metadataVersion,
        agentStateVersion: encryption.agentStateVersion,
        metadata: sessionMetadata,
        savedAt: Date.now(),
      },
    });
    const legacyMetadata = metadata('grok-legacy-provider-session');
    mocks.backfillReconnectableSessionForMachine.mockResolvedValueOnce(
      recovered('grok-legacy-session', legacyMetadata),
    );
    mocks.spawnHappyCLI.mockReturnValue({ pid: 4323, kill: vi.fn(), on: vi.fn() });

    daemonRun = startDaemon();
    await vi.waitFor(() => expect(mocks.rpcHandlers).toBeDefined());
    const rpc = mocks.rpcHandlers as CapturedRpcHandlers;
    const control = mocks.controlHandlers as CapturedControlHandlers;
    const legacyResume = rpc.resumeSession('grok-legacy-session', {
      permissionMode: 'bypassPermissions',
    });
    await vi.waitFor(() => expect(mocks.spawnHappyCLI).toHaveBeenCalledOnce());
    control.onHappySessionWebhook('grok-legacy-session', {
      ...legacyMetadata,
      hostPid: 4323,
      permissionMode: 'default',
      spawnSettings: {
        provider: 'grok',
        model: 'grok-build',
        effort: null,
        permission: 'default',
      },
    }, encryption);

    await expect(legacyResume).resolves.toMatchObject({ type: 'success', sessionId: 'grok-legacy-session' });
    expect(mocks.spawnHappyCLI.mock.calls[0]?.[0]).toEqual([
      'grok',
      '--started-by', 'daemon',
      '--resume', 'grok-legacy-provider-session',
      '--permission-mode', 'default',
    ]);

    for (const [catalogState, capabilities] of [
      ['missing', {}],
      ['invalid', { grok: { permissionModes: 'invalid' } }],
    ] as const) {
      initialMachineMetadata.agentCapabilities = capabilities as never;
      const sessionId = `grok-${catalogState}-catalog-session`;
      mocks.backfillReconnectableSessionForMachine.mockResolvedValueOnce(
        recovered(sessionId, metadata(`grok-${catalogState}-provider-session`)),
      );

      await expect(rpc.resumeSession(sessionId, {
        permissionMode: 'bypassPermissions',
      })).resolves.toEqual({
        type: 'error',
        errorMessage: 'Failed to resume session: Grok resume requires a validated advertised permission mode on machine machine-record',
      });
      expect(mocks.spawnHappyCLI).toHaveBeenCalledTimes(1);
    }
  });

  it('validates, restarts, and resumes the same Grok session before returning a changed-mode receipt', async () => {
    const sessionId = 'grok-live-session';
    const oldPid = 7001;
    const newPid = 7002;
    const encryption: SessionEncryptionData = {
      encryptionKey: new Uint8Array([1, 2, 3, 4]),
      encryptionVariant: 'dataKey',
      seq: 18,
      metadataVersion: 6,
      agentStateVersion: 7,
    };
    const oldSettings = {
      provider: 'grok' as const,
      model: 'grok-build',
      effort: null,
      permission: 'default',
    };
    const metadata: Metadata = {
      path: process.cwd(),
      flavor: 'grok',
      acpSessionId: 'grok-provider-session',
      acpCapabilities: { loadSession: true, prompt: { image: true } },
      spawnSettings: oldSettings,
      permissionMode: 'default',
      host: 'test-host',
      hostPid: oldPid,
      machineId: 'machine-1',
      homeDir: '/home/test',
      happyHomeDir: '/home/test/.happyherd',
      happyLibDir: '/srv/happy',
      happyToolsDir: '/srv/happy/tools',
    };
    const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
      mocks.exitedPids.add(Math.abs(pid));
      return true;
    }) as typeof process.kill);
    mocks.spawnHappyCLI.mockReturnValue({ pid: newPid, kill: vi.fn(), on: vi.fn() });

    daemonRun = startDaemon();
    await vi.waitFor(() => expect(mocks.rpcHandlers).toBeDefined());
    const rpc = mocks.rpcHandlers as CapturedRpcHandlers;
    const control = mocks.controlHandlers as CapturedControlHandlers;
    control.onHappySessionWebhook(sessionId, metadata, encryption);

    await expect(rpc.changeGrokPermissionMode({
      sessionId,
      permissionMode: 'unknown-mode',
    })).rejects.toThrow('does not advertise permission mode "unknown-mode"');
    expect(kill).not.toHaveBeenCalled();

    let settled = false;
    const transition = rpc.changeGrokPermissionMode({
      sessionId,
      permissionMode: 'bypassPermissions',
    }).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(mocks.spawnHappyCLI).toHaveBeenCalledOnce());
    expect(kill).toHaveBeenCalledWith(oldPid, 'SIGTERM');

    const [args, spawnOptions] = mocks.spawnHappyCLI.mock.calls[0] as unknown as [
      string[],
      { cwd: string; env: NodeJS.ProcessEnv },
    ];
    expect(args).toEqual([
      'grok',
      '--started-by', 'daemon',
      '--resume', 'grok-provider-session',
      '--permission-mode', 'bypassPermissions',
    ]);
    expect(spawnOptions.cwd).toBe(metadata.path);
    expect(spawnOptions.env.HAPPY_RECONNECT_SESSION_ID).toBe(sessionId);
    expect(JSON.parse(spawnOptions.env.HAPPYHERD_MACHINE_SESSION_SETTINGS_JSON!)).toEqual({
      ...oldSettings,
      permission: 'bypassPermissions',
    });

    // Reconnect registration alone is not a receipt: it still carries the old
    // launch policy and must leave the RPC pending.
    control.onHappySessionWebhook(sessionId, { ...metadata, hostPid: newPid }, encryption);
    await Promise.resolve();
    expect(settled).toBe(false);

    control.onHappySessionWebhook(sessionId, {
      ...metadata,
      hostPid: newPid,
      permissionMode: 'bypassPermissions',
      spawnSettings: { ...oldSettings, permission: 'bypassPermissions' },
    }, encryption);
    await expect(transition).resolves.toEqual({
      type: 'success',
      sessionId,
      permissionMode: 'bypassPermissions',
    });
  });

  it('persists one structured provider switch event through the resumed tracked session', async () => {
    const sessionId = 'claude-provider-account-switch';
    const encryption: SessionEncryptionData = {
      encryptionKey: new Uint8Array([31, 32, 33, 34]),
      encryptionVariant: 'dataKey',
      seq: 27,
      metadataVersion: 8,
      agentStateVersion: 9,
    };
    const metadata: Metadata = {
      path: process.cwd(),
      flavor: 'claude',
      claudeSessionId: '44444444-4444-4444-8444-444444444444',
      providerAccount: 'personal 旧',
      host: 'test-host',
      hostPid: 7331,
      machineId: 'machine-1',
      homeDir: '/home/test',
      happyHomeDir: '/home/test/.happyherd',
      happyLibDir: '/srv/happy',
      happyToolsDir: '/srv/happy/tools',
    };

    daemonRun = startDaemon();
    await vi.waitFor(() => expect(mocks.controlHandlers).toBeDefined());
    const control = mocks.controlHandlers as CapturedControlHandlers;
    control.onHappySessionWebhook(sessionId, metadata, encryption);

    control.onProviderLimited({
      sessionId,
      provider: 'claude',
      account: 'personal 旧',
      limitedUntil: 12_345,
    });
    await vi.waitFor(() => expect(mocks.rotationDependencies).toBeDefined());
    expect(mocks.postSessionEvent).not.toHaveBeenCalled();

    await mocks.rotationDependencies!.onAccountSwitched!({
      sessionId,
      provider: 'claude',
      fromAccount: 'personal 旧',
      toAccount: 'work 新',
    });

    expect(mocks.postSessionEvent).toHaveBeenCalledOnce();
    const [session, event, localId] = mocks.postSessionEvent.mock.calls[0] as unknown as [
      { id: string; seq: number; encryptionKey: Uint8Array },
      {
        type: string;
        provider: string;
        fromAccount: string;
        toAccount: string;
        incidentId: string;
      },
      string,
    ];
    expect(session).toMatchObject({
      id: sessionId,
      seq: encryption.seq,
      encryptionKey: encryption.encryptionKey,
    });
    expect(event).toEqual({
      type: 'provider-account-switched',
      provider: 'claude',
      fromAccount: 'personal 旧',
      toAccount: 'work 新',
      incidentId: expect.any(String),
    });
    expect(localId).toBe(event.incidentId);
  });

  it('activates the parent Codex account before forking from a stale credential home', async () => {
    mocks.authoritativeActive = true;
    const testRoot = await mkdtemp(join(tmpdir(), 'happyherd-codex-sidechat-auth-'));
    temporaryDirectories.push(testRoot);
    const codexHome = join(testRoot, 'runtime');
    const providerAccount = 'rotated-account';
    const accountHome = join(testRoot, 'accounts', providerAccount);
    const accountAuthFile = join(accountHome, 'auth.json');
    const selectedAccountAuth = '{"account":"rotated"}';
    await mkdir(codexHome, { recursive: true });
    await mkdir(accountHome, { recursive: true });
    await writeFile(join(codexHome, 'auth.json'), '{"account":"stale"}');
    await writeFile(accountAuthFile, selectedAccountAuth);
    let authAtFork: string | undefined;
    mocks.forkCodexBackendThread.mockImplementationOnce(async () => {
      authAtFork = await readFile(join(codexHome, 'auth.json'), 'utf8');
      return {
        type: 'success',
        newCodexThreadId: 'thread-child',
      };
    });
    const parentMetadata: Metadata = {
      path: process.cwd(),
      flavor: 'codex',
      codexThreadId: 'thread-parent',
      codexHome,
      providerAccount,
      host: 'test-host',
      hostPid: 9876,
      machineId: 'machine-1',
      homeDir: '/home/test',
      happyHomeDir: '/home/test/.happyherd',
      happyLibDir: '/srv/happy',
      happyToolsDir: '/srv/happy/tools',
    };
    mocks.resolveCredentialAccountEnvironment.mockResolvedValue({
      selection: {
        type: 'available',
        account: {
          provider: 'codex',
          name: providerAccount,
          credential: { type: 'auth-file', path: accountAuthFile },
          createdAt: 1,
          updatedAt: 2,
          limitedUntil: null,
        },
      },
      env: {
        HAPPYHERD_PROVIDER_ACCOUNT: providerAccount,
        HAPPYHERD_PROVIDER_ACCOUNT_TYPE: 'codex',
        HAPPYHERD_CODEX_ACCOUNT_AUTH_FILE: accountAuthFile,
      },
    });
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

    const sideChat = control.sideChat({
      action: 'create',
      parentSessionId: 'parent-session',
      brief: null,
    });
    const concurrentSideChat = control.sideChat({
      action: 'create',
      parentSessionId: 'parent-session',
      brief: null,
    });
    await vi.waitFor(() => expect(mocks.spawnHappyCLI).toHaveBeenCalledOnce());
    control.onHappySessionWebhook('child-session', {
      ...parentMetadata,
      hostPid: 5432,
      codexThreadId: 'thread-child',
      parentSessionId: 'parent-session',
      isSideChat: true,
    }, {
      encryptionKey: new Uint8Array(32).fill(7),
      encryptionVariant: 'dataKey',
      seq: 1,
      metadataVersion: 1,
      agentStateVersion: 1,
    });

    await expect(sideChat).resolves.toMatchObject({ success: true, sessionId: 'child-session' });
    await expect(concurrentSideChat).resolves.toMatchObject({ success: true, sessionId: 'child-session' });
    expect(mocks.resolveLocalReconnectableSession).toHaveBeenCalledWith('parent-session');
    expect(mocks.resolveCredentialAccountEnvironment).toHaveBeenCalledWith('codex', {
      preferred: providerAccount,
    });
    expect(mocks.forkCodexBackendThread).toHaveBeenCalledWith(
      parentMetadata.path,
      parentMetadata.codexThreadId,
      expect.objectContaining({
        CODEX_HOME: codexHome,
        HAPPYHERD_PROVIDER_ACCOUNT: providerAccount,
        HAPPYHERD_PROVIDER_ACCOUNT_TYPE: 'codex',
        HAPPYHERD_CODEX_ACCOUNT_AUTH_FILE: accountAuthFile,
      }),
    );
    expect(authAtFork).toBe(selectedAccountAuth);
    expect(mocks.postSideChatBrief).not.toHaveBeenCalled();
    const [args, spawnOptions] = mocks.spawnHappyCLI.mock.calls[0] as unknown as [
      string[],
      { cwd: string; env: NodeJS.ProcessEnv },
    ];
    expect(args).toEqual(expect.arrayContaining(['codex', '--resume', 'thread-child', '--started-by', 'daemon']));
    expect(spawnOptions.cwd).toBe(parentMetadata.path);
    expect(spawnOptions.env.CODEX_HOME).toBe(codexHome);
    expect(spawnOptions.env.HAPPYHERD_PROVIDER_ACCOUNT).toBe(providerAccount);
    expect(spawnOptions.env.HAPPYHERD_PROVIDER_ACCOUNT_TYPE).toBe('codex');
    expect(spawnOptions.env.HAPPYHERD_CODEX_ACCOUNT_AUTH_FILE).toBe(accountAuthFile);
  });

  it('lists a stopped side chat after daemon restart from durable metadata and authoritative server state', async () => {
    const metadata: Metadata = {
      path: process.cwd(),
      flavor: 'codex',
      codexThreadId: 'thread-persisted',
      host: 'test-host',
      hostPid: 9999,
      machineId: 'machine-1',
      homeDir: '/home/test',
      happyHomeDir: '/home/test/.happyherd',
      happyLibDir: '/srv/happy',
      happyToolsDir: '/srv/happy/tools',
      parentSessionId: 'parent-persisted',
      isSideChat: true,
    };
    mocks.readPersistedSessions.mockReturnValue({
      'child-persisted': {
        encryptionKey: Buffer.alloc(32, 5).toString('base64'),
        encryptionVariant: 'dataKey',
        seq: 8,
        metadataVersion: 4,
        agentStateVersion: 3,
        metadata,
        savedAt: Date.now(),
      },
    });

    daemonRun = startDaemon();
    await vi.waitFor(() => expect(mocks.rpcHandlers).toBeDefined());
    const control = mocks.controlHandlers as CapturedControlHandlers;

    await expect(control.sideChat({ action: 'list', parentSessionId: 'parent-persisted' }))
      .resolves.toMatchObject({
        success: true,
        children: [{
          sessionId: 'child-persisted',
          status: 'stopped',
          active: false,
          providerRunning: false,
        }],
      });
    expect(mocks.hasProviderProcessExited).not.toHaveBeenCalledWith(9999);
  });
});
