import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { DecryptedMachine, DecryptedSession } from 'happy-agent/control';
import { authLogout, authStatus } from 'happy-agent/auth';
import {
  HAPPYHERD_MACHINE_SESSION_PROTOCOL_VERSION,
  type HappyHerdCommanderListResponse,
  type HappyHerdCommanderSummary,
} from '@slopus/happy-wire';

import type { AgentCapabilityCatalog, MachineMetadata } from '@/api/types';
import { configuration } from '@/configuration';
import { getLocalHappyAgentCredentialPath } from '@/resume/localHappyAgentAuth';

import {
  createDefaultClient,
  handleMachineCommand,
  handleSessionCommand,
  machineListReceipt,
  parseSessionCreateOptions,
  resolveMachineSelector,
  validateSessionSettings,
  type MachineControlClient,
} from './machine';

const sideChatBrief = {
  outcome: 'Deliver the delegated change.',
  scope: 'Use the owned files only.',
  dependencies: 'Use the parent context.',
  writeOwnership: '/srv/project/owned.ts',
  verification: 'Run the focused checks.',
  handoff: 'Return result, evidence, blockers, and remaining work.',
} as const;
const sideChatBriefArgs = [
  '--outcome', sideChatBrief.outcome,
  '--scope', sideChatBrief.scope,
  '--dependencies', sideChatBrief.dependencies,
  '--write-ownership', sideChatBrief.writeOwnership,
  '--verification', sideChatBrief.verification,
  '--handoff', sideChatBrief.handoff,
];

const targetAthena: HappyHerdCommanderSummary = {
  id: 'athena',
  name: 'Athena on target',
  workspace: '/remote/project',
  commanderPath: '/remote/.happyherd/commanders/athena/COMMANDER.md',
  agentContextPath: '/remote/.happyherd/commanders/athena/agentcontext',
};

function option(code: string, extra: Record<string, unknown> = {}) {
  return { code, value: code, description: null, ...extra };
}

function catalog(overrides: Partial<AgentCapabilityCatalog> = {}): AgentCapabilityCatalog {
  return {
    detectedAt: 1,
    providerVersion: '1.0.0',
    sources: {
      models: 'test',
      effortLevels: 'test',
      permissionModes: 'test',
    },
    models: [
      option('default'),
      option('gpt-5.6', {
        isDefault: true,
        effortLevels: [option('medium'), option('high')],
      }),
    ],
    effortLevels: [option('low'), option('medium'), option('high')],
    permissionModes: [option('default'), option('plan'), option('yolo', { isDefault: true })],
    ...overrides,
  } as AgentCapabilityCatalog;
}

function metadata(overrides: Partial<MachineMetadata> = {}): MachineMetadata {
  return {
    host: 'workstation',
    platform: 'linux',
    happyCliVersion: '1.2.3',
    machineSessionProtocolVersion: HAPPYHERD_MACHINE_SESSION_PROTOCOL_VERSION,
    homeDir: '/home/user',
    happyHomeDir: '/home/user/.happyherd',
    happyLibDir: '/opt/happy',
    cliAvailability: {
      claude: true,
      codex: true,
      gemini: false,
      grok: false,
      agy: false,
      detectedAt: 1,
    },
    agentCapabilities: {
      claude: catalog({ models: [option('default'), option('opus')] }),
      codex: catalog(),
    },
    ...overrides,
  };
}

function machine(
  id = 'machine-1',
  overrides: Partial<DecryptedMachine> = {},
): DecryptedMachine {
  return {
    id,
    seq: 1,
    createdAt: 1,
    updatedAt: 2,
    active: true,
    activeAt: 3,
    metadata: metadata(),
    metadataVersion: 4,
    daemonState: null,
    daemonStateVersion: 5,
    dataEncryptionKey: null,
    encryption: { key: new Uint8Array(32).fill(7), variant: 'dataKey' },
    ...overrides,
  };
}

function rigMachine(id = 'rig-machine'): DecryptedMachine {
  return machine(id, {
    metadata: {
      host: 'rig-host',
      platform: 'darwin',
      happyCliVersion: '0.0.30',
      homeDir: '/Users/rig',
      happyHomeDir: '/Users/rig/.happy/rig',
      machineKind: 'rig',
      rigOnly: true,
      client: { id: 'rig', name: 'Rig', version: '0.0.136' },
      cliAvailability: {
        claude: false,
        codex: false,
        gemini: false,
        agy: false,
        rig: true,
        detectedAt: 1,
      },
      capabilities: { newSession: true },
      defaults: { providerId: 'codex', modelId: 'gpt-5.6', effort: 'high' },
      models: [{ providerId: 'codex', id: 'gpt-5.6', thinkingLevels: ['high'] }],
    },
  });
}

function sessionArgs(...extra: string[]): string[] {
  return [
    '--machine', 'machine-1',
    '--path', '/srv/project',
    '--provider', 'codex',
    ...extra,
  ];
}

function session(
  id = 'parent-session',
  metadataValue: Record<string, unknown> = {
    flavor: 'claude',
    machineId: 'machine-1',
    path: '/srv/project',
    claudeSessionId: '11111111-1111-4111-8111-111111111111',
  },
): DecryptedSession {
  return {
    id,
    seq: 1,
    createdAt: 1,
    updatedAt: 2,
    active: true,
    activeAt: 3,
    metadata: metadataValue,
    metadataVersion: 1,
    agentState: null,
    dataEncryptionKey: null,
    encryption: { key: new Uint8Array(32).fill(5), variant: 'dataKey' },
  };
}

function fakeClient(options: {
  listed?: DecryptedMachine[];
  refreshed?: DecryptedMachine;
  parent?: DecryptedSession;
  forkResult?: unknown;
  commanderList?: HappyHerdCommanderListResponse;
  createdCommander?: HappyHerdCommanderSummary;
  sessionId?: string;
  settings?: { provider: 'claude' | 'codex' | 'gemini' | 'grok' | 'agy'; model: string | null; effort: string | null; permission: string | null };
} = {}) {
  const listed = options.listed ?? [machine()];
  const refreshed = options.refreshed ?? listed[0];
  const listMachines = vi.fn(async () => listed);
  const resolveMachine = vi.fn(async (_machineId: string) => refreshed);
  const resolveSession = vi.fn(async (_sessionId: string) => options.parent ?? session());
  const callMachineRpc = vi.fn(async (
    _machine: DecryptedMachine,
    method: string,
  ) => method === 'happyherd-list-commanders'
    ? options.commanderList ?? {
      commanders: [targetAthena],
      globalAgentsPath: '/remote/.happyherd/AGENTS.md',
    }
    : options.forkResult ?? {
      type: 'success',
      newClaudeSessionId: '22222222-2222-4222-8222-222222222222',
    });
  const spawnSessionOnMachineConfirmed = vi.fn(async (
    targetMachine: DecryptedMachine,
    launch: Parameters<MachineControlClient['spawnSessionOnMachineConfirmed']>[1],
  ) => {
    const settings = options.settings ?? {
      provider: launch.agent,
      model: launch.modelMode ?? 'gpt-5.6',
      effort: launch.effortLevel ?? null,
      permission: launch.permissionMode ?? 'yolo',
    };
    const createdCommander = options.createdCommander
      ?? (launch.commanderId === targetAthena.id ? targetAthena : null);
    return {
      session: session(options.sessionId ?? 'session-real', {
        machineId: targetMachine.id,
        path: launch.directory,
        spawnSettings: settings,
        ...(createdCommander ? {
          commanderId: createdCommander.id,
          commanderName: createdCommander.name,
          commanderPath: createdCommander.commanderPath,
          commanderWorkspace: createdCommander.workspace,
          commanderAgentContextPath: createdCommander.agentContextPath,
        } : {}),
      }),
      settings,
    };
  });
  const updateSessionMetadata = vi.fn(async (
    target: DecryptedSession,
    update: Parameters<MachineControlClient['updateSessionMetadata']>[1],
  ) => ({ ...target, metadata: update(target.metadata) }));
  return {
    client: {
      listMachines,
      resolveMachine,
      resolveSession,
      callMachineRpc,
      spawnSessionOnMachineConfirmed,
      updateSessionMetadata,
    } as unknown as MachineControlClient,
    listMachines,
    resolveMachine,
    resolveSession,
    callMachineRpc,
    spawnSessionOnMachineConfirmed,
    updateSessionMetadata,
  };
}

describe('machine and session command parsing', () => {
  it('shows help without loading account credentials', async () => {
    const createClient = vi.fn(async () => fakeClient().client);
    const output = vi.fn();

    await handleMachineCommand(['list', '--help'], { createClient, output });
    await handleSessionCommand(['create', '--help'], { createClient, output });
    await handleSessionCommand(['side-chat', '--help'], { createClient, output });

    expect(createClient).not.toHaveBeenCalled();
    expect(output.mock.calls.join('\n')).toContain('happy machine list');
    expect(output.mock.calls.join('\n')).toContain('happy session create');
    expect(output.mock.calls.join('\n')).toContain('happyherd session set-commander');
    expect(output.mock.calls.join('\n')).toContain('happyherd session side-chat');
  });

  it('routes account-control auth through the configured HappyHerd home', async () => {
    const login = vi.fn(async () => undefined);
    const status = vi.fn(async () => undefined);
    const logout = vi.fn(async () => undefined);
    const createClient = vi.fn(async () => fakeClient().client);
    const dependencies = {
      accountAuth: { login, status, logout },
      createClient,
      output: vi.fn(),
    };

    await handleMachineCommand(['auth', 'login'], dependencies);
    await handleMachineCommand(['auth', 'status'], dependencies);
    await handleMachineCommand(['auth', 'logout'], dependencies);

    const expectedConfig = {
      serverUrl: configuration.serverUrl.replace(/\/+$/, ''),
      homeDir: configuration.happyHomeDir,
      credentialPath: getLocalHappyAgentCredentialPath(configuration.happyHomeDir),
    };
    expect(login).toHaveBeenCalledWith(expectedConfig);
    expect(status).toHaveBeenCalledWith(expectedConfig);
    expect(logout).toHaveBeenCalledWith(expectedConfig);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('shows machine-auth help without linking and rejects extra arguments', async () => {
    const accountAuth = {
      login: vi.fn(async () => undefined),
      status: vi.fn(async () => undefined),
      logout: vi.fn(async () => undefined),
    };
    const output = vi.fn();

    await handleMachineCommand(['auth', '--help'], { accountAuth, output });
    expect(output.mock.calls.join('\n')).toContain('happy machine auth login');
    expect(accountAuth.login).not.toHaveBeenCalled();
    await expect(handleMachineCommand(['auth', 'login', 'extra'], { accountAuth, output }))
      .rejects.toThrow('accepts no arguments');
  });

  it('requires all creation inputs and rejects unknown, missing, or duplicate flags', () => {
    expect(() => parseSessionCreateOptions(['--machine', 'm'])).toThrow('--path is required');
    expect(() => parseSessionCreateOptions(sessionArgs('--model'))).toThrow('--model requires a value');
    expect(() => parseSessionCreateOptions(sessionArgs('--wat'))).toThrow('Unknown option: --wat');
    expect(() => parseSessionCreateOptions(sessionArgs('--json', '--json'))).toThrow('may only be specified once');
    expect(() => parseSessionCreateOptions([
      '--machine', 'm', '--path', '/x', '--provider', 'unknown',
    ])).toThrow('Unsupported Happy CLI daemon provider "unknown"');
  });
});

describe('machine discovery and resolution', () => {
  it('gives exact IDs priority and accepts only an unambiguous exact hostname', () => {
    const first = machine('same-host-id', { metadata: metadata({ host: 'duplicate' }) });
    const second = machine('machine-2', { metadata: metadata({ host: 'duplicate' }) });
    const unique = machine('machine-3', { metadata: metadata({ host: 'unique-host' }) });

    expect(resolveMachineSelector([first, second], 'same-host-id')).toBe(first);
    expect(resolveMachineSelector([first, unique], 'unique-host')).toBe(unique);
    expect(() => resolveMachineSelector([first, second], 'duplicate')).toThrow('Ambiguous machine hostname');
    expect(() => resolveMachineSelector([first], 'missing')).toThrow('No machine found');
  });

  it('emits sorted, stable JSON without encryption, daemon, or unknown metadata fields', async () => {
    const secretMachine = machine('z-machine', {
      metadata: { ...metadata(), apiToken: 'metadata-secret' },
      daemonState: { token: 'daemon-secret' },
      dataEncryptionKey: 'wrapped-key-secret',
      encryption: { key: new Uint8Array([1, 2, 3]), variant: 'dataKey' },
    });
    const fake = fakeClient({ listed: [secretMachine, machine('a-machine')] });
    const output = vi.fn();

    await handleMachineCommand(['list', '--json'], {
      createClient: async () => fake.client,
      output,
    });

    const raw = output.mock.calls[0][0] as string;
    const receipt = JSON.parse(raw);
    expect(receipt).toEqual(machineListReceipt([secretMachine, machine('a-machine')]));
    expect(receipt.machines.map((entry: { id: string }) => entry.id)).toEqual(['a-machine', 'z-machine']);
    expect(raw).not.toMatch(/metadata-secret|daemon-secret|wrapped-key-secret|encryption|dataEncryptionKey/);
    expect(receipt.machines[0]).toMatchObject({
      kind: 'happy-cli-daemon',
      machineSessionProtocolVersion: HAPPYHERD_MACHINE_SESSION_PROTOCOL_VERSION,
      sessionCreateSupported: true,
      availableProviders: ['claude', 'codex'],
    });
  });

  it('labels Rig machines truthfully and resolves them by their published hostname', () => {
    const rig = rigMachine();
    const receipt = machineListReceipt([rig]);

    expect(resolveMachineSelector([rig], 'rig-host')).toBe(rig);
    expect(receipt.machines[0]).toMatchObject({
      id: 'rig-machine',
      host: 'rig-host',
      platform: 'darwin',
      kind: 'rig',
      sessionCreateSupported: false,
      availableProviders: [],
      providers: {},
    });
  });

  it('does not advertise session creation for missing or unsupported confirmed-protocol versions', () => {
    for (const version of [undefined, HAPPYHERD_MACHINE_SESSION_PROTOCOL_VERSION + 1]) {
      const unsupported = machine('unsupported-daemon', {
        metadata: metadata({ machineSessionProtocolVersion: version }),
      });

      expect(machineListReceipt([unsupported]).machines[0]).toMatchObject({
        kind: 'happy-cli-daemon',
        machineSessionProtocolVersion: version ?? null,
        sessionCreateSupported: false,
      });
    }
  });
});

describe('exact-machine capability validation', () => {
  it('accepts POSIX, Windows drive, and Windows UNC absolute paths', () => {
    expect(validateSessionSettings(machine(), parseSessionCreateOptions(sessionArgs())).provider).toBe('codex');

    const windows = machine('windows', { metadata: metadata({ platform: 'win32' }) });
    expect(validateSessionSettings(windows, parseSessionCreateOptions([
      '--machine', 'windows', '--path', 'C:\\Users\\user\\project', '--provider', 'codex',
    ])).provider).toBe('codex');
    expect(validateSessionSettings(windows, parseSessionCreateOptions([
      '--machine', 'windows', '--path', '\\\\server\\share\\project', '--provider', 'codex',
    ])).provider).toBe('codex');
  });

  it('rejects relative, platform-mismatched, and NUL-containing paths', () => {
    for (const targetPath of ['project', 'C:\\project', `/srv/pro\0ject`]) {
      expect(() => validateSessionSettings(machine(), parseSessionCreateOptions([
        '--machine', 'machine-1', '--path', targetPath, '--provider', 'codex',
      ]))).toThrow('--path must be an absolute linux path');
    }
  });

  it('rejects offline targets and unavailable providers', () => {
    expect(() => validateSessionSettings(
      machine('offline', { active: false }),
      parseSessionCreateOptions(sessionArgs()),
    )).toThrow('offline');
    expect(() => validateSessionSettings(
      machine(),
      parseSessionCreateOptions([
        '--machine', 'machine-1', '--path', '/srv/project', '--provider', 'gemini',
      ]),
    )).toThrow('Provider gemini is unavailable');
  });

  it('allows an available provider to launch with defaults when no catalog is advertised', () => {
    const target = machine('legacy-machine', {
      metadata: metadata({
        cliAvailability: {
          claude: true,
          codex: true,
          gemini: true,
          grok: false,
          agy: false,
          detectedAt: 1,
        },
        agentCapabilities: {},
      }),
    });
    const options = parseSessionCreateOptions([
      '--machine', 'legacy-machine',
      '--path', '/srv/project',
      '--provider', 'gemini',
    ]);

    expect(validateSessionSettings(target, options)).toEqual({
      provider: 'gemini',
      model: null,
      effort: null,
      permission: null,
    });
    expect(() => validateSessionSettings(target, {
      ...options,
      model: 'gemini-override',
    })).toThrow('no valid advertised capability catalog');
  });

  it('rejects invalid model, permission, and effort without another provider fallback', () => {
    expect(() => validateSessionSettings(machine(), parseSessionCreateOptions(
      sessionArgs('--model', 'opus'),
    ))).toThrow('does not advertise model "opus"');
    expect(() => validateSessionSettings(machine(), parseSessionCreateOptions(
      sessionArgs('--permission', 'bypassPermissions'),
    ))).toThrow('does not advertise permission mode');
    expect(() => validateSessionSettings(machine(), parseSessionCreateOptions(
      sessionArgs('--model', 'gpt-5.6', '--effort', 'max'),
    ))).toThrow('does not advertise effort level');
  });

  it('treats an explicit empty model effort catalog as unsupported', () => {
    const explicitEmpty = catalog({
      models: [option('default'), option('gpt-empty', { isDefault: true, effortLevels: [] })],
      effortLevels: [option('high')],
    });
    const target = machine('machine-1', {
      metadata: metadata({
        agentCapabilities: { codex: explicitEmpty },
      }),
    });
    expect(() => validateSessionSettings(target, parseSessionCreateOptions(
      sessionArgs('--model', 'gpt-empty', '--effort', 'high'),
    ))).toThrow('does not support an explicit effort level');
  });
});

describe('remote tracked session creation', () => {
  it('refreshes the exact selected machine immediately before validation and RPC', async () => {
    const listed = machine('machine-1', { metadata: metadata({ host: 'workstation' }) });
    const refreshed = machine('machine-1', {
      activeAt: 99,
      metadataVersion: 20,
      metadata: metadata({ host: 'workstation-latest' }),
    });
    const fake = fakeClient({ listed: [listed], refreshed, sessionId: 'session-tracked-123' });
    const output = vi.fn();

    await handleSessionCommand(['create', ...sessionArgs(
      '--model', 'gpt-5.6',
      '--effort', 'high',
      '--permission', 'plan',
      '--create-dir',
      '--json',
    )], {
      createClient: async () => fake.client,
      output,
    });

    expect(fake.listMachines).toHaveBeenCalledTimes(1);
    expect(fake.resolveMachine).toHaveBeenCalledWith('machine-1');
    expect(fake.spawnSessionOnMachineConfirmed).toHaveBeenCalledWith(refreshed, {
      directory: '/srv/project',
      approvedNewDirectoryCreation: true,
      agent: 'codex',
      modelMode: 'gpt-5.6',
      effortLevel: 'high',
      permissionMode: 'plan',
    });
    expect(JSON.parse(output.mock.calls[0][0] as string)).toEqual({
      schemaVersion: 1,
      type: 'session-created',
      sessionId: 'session-tracked-123',
      machine: { id: 'machine-1', host: 'workstation-latest', platform: 'linux' },
      path: '/srv/project',
      settings: { provider: 'codex', model: 'gpt-5.6', effort: 'high', permission: 'plan' },
      commander: null,
    });
  });

  it('lets the target validate creation and reports the target canonical Commander metadata', async () => {
    const fake = fakeClient({ createdCommander: targetAthena });
    const output = vi.fn();

    await handleSessionCommand(['create', ...sessionArgs(
      '--commander', 'athena',
      '--json',
    )], {
      createClient: async () => fake.client,
      output,
    });

    expect(fake.spawnSessionOnMachineConfirmed.mock.calls[0][1]).toMatchObject({
      commanderId: 'athena',
    });
    expect(fake.callMachineRpc).not.toHaveBeenCalled();
    expect(JSON.parse(output.mock.calls[0][0] as string).commander).toEqual({
      id: 'athena',
      name: 'Athena on target',
      path: targetAthena.commanderPath,
      workspace: targetAthena.workspace,
      agentContextPath: targetAthena.agentContextPath,
    });
  });

  it('preserves the target daemon error for an unknown Commander', async () => {
    const fake = fakeClient();
    fake.spawnSessionOnMachineConfirmed.mockRejectedValueOnce(
      new Error('Commander "missing" was not found'),
    );

    await expect(handleSessionCommand(['create', ...sessionArgs(
      '--commander', 'missing',
    )], {
      createClient: async () => fake.client,
      output: vi.fn(),
    })).rejects.toThrow('Commander "missing" was not found');

    expect(fake.spawnSessionOnMachineConfirmed.mock.calls[0][1]).toMatchObject({
      commanderId: 'missing',
    });
  });

  it('never approves directory creation unless --create-dir is explicit', async () => {
    const fake = fakeClient();
    await handleSessionCommand(['create', ...sessionArgs()], {
      createClient: async () => fake.client,
      output: vi.fn(),
    });
    expect(fake.spawnSessionOnMachineConfirmed.mock.calls[0][1]).toMatchObject({
      approvedNewDirectoryCreation: false,
    });
  });

  it('reports target-confirmed settings instead of reconstructing omitted caller values', async () => {
    const confirmed = {
      provider: 'codex' as const,
      model: 'gpt-target-default',
      effort: 'medium',
      permission: 'default',
    };
    const fake = fakeClient({ settings: confirmed });
    const output = vi.fn();

    await handleSessionCommand(['create', ...sessionArgs('--json')], {
      createClient: async () => fake.client,
      output,
    });

    expect(JSON.parse(output.mock.calls[0][0] as string).settings).toEqual(confirmed);
    expect(fake.spawnSessionOnMachineConfirmed.mock.calls[0][1]).not.toHaveProperty('modelMode');
    expect(fake.spawnSessionOnMachineConfirmed.mock.calls[0][1]).not.toHaveProperty('effortLevel');
    expect(fake.spawnSessionOnMachineConfirmed.mock.calls[0][1]).not.toHaveProperty('permissionMode');
  });

  it('keeps retained auth commands private and explains explicit directory approval', async () => {
    const authFailure = fakeClient();
    authFailure.listMachines.mockRejectedValueOnce(
      new Error('Authentication expired. Run `happy-agent auth login` to re-authenticate.'),
    );
    await expect(handleSessionCommand(['create', ...sessionArgs()], {
      createClient: async () => authFailure.client,
      output: vi.fn(),
    })).rejects.toThrow('Run `happy machine auth login`');

    const approvalFailure = fakeClient();
    approvalFailure.spawnSessionOnMachineConfirmed.mockRejectedValueOnce(
      new Error('Directory creation requires approval: /srv/project'),
    );
    await expect(handleSessionCommand(['create', ...sessionArgs()], {
      createClient: async () => approvalFailure.client,
      output: vi.fn(),
    })).rejects.toThrow('Rerun with --create-dir to approve it');
  });

  it('rejects a refresh that does not return the exact selected machine', async () => {
    const fake = fakeClient({
      listed: [machine('machine-1')],
      refreshed: machine('machine-other'),
    });
    await expect(handleSessionCommand(['create', ...sessionArgs()], {
      createClient: async () => fake.client,
      output: vi.fn(),
    })).rejects.toThrow('could not be refreshed exactly');
    expect(fake.spawnSessionOnMachineConfirmed).not.toHaveBeenCalled();
  });

  it('rejects missing or unsupported target protocol versions before the side-effecting spawn RPC', async () => {
    for (const version of [undefined, HAPPYHERD_MACHINE_SESSION_PROTOCOL_VERSION + 1]) {
      const unsupported = machine('machine-1', {
        metadata: metadata({ machineSessionProtocolVersion: version }),
      });
      const fake = fakeClient({ listed: [unsupported], refreshed: unsupported });

      await expect(handleSessionCommand(['create', ...sessionArgs()], {
        createClient: async () => fake.client,
        output: vi.fn(),
      })).rejects.toThrow('does not advertise target-confirmed machine-session protocol version');

      expect(fake.resolveMachine).toHaveBeenCalledWith('machine-1');
      expect(fake.spawnSessionOnMachineConfirmed).not.toHaveBeenCalled();
    }
  });

  it('fails closed on Rig before applying the Happy CLI daemon schema or spawning', async () => {
    const rig = rigMachine();
    const fake = fakeClient({ listed: [rig], refreshed: rig });

    await expect(handleSessionCommand([
      'create',
      '--machine', 'rig-host',
      '--path', '/Users/rig/project',
      '--provider', 'codex',
    ], {
      createClient: async () => fake.client,
      output: vi.fn(),
    })).rejects.toThrow('Rig machine; native happy session create supports Happy CLI daemon machines only');
    expect(fake.resolveMachine).toHaveBeenCalledWith('rig-machine');
    expect(fake.spawnSessionOnMachineConfirmed).not.toHaveBeenCalled();
  });
});

describe('session Commander reassignment', () => {
  it('persists the canonical Commander fields and reports that live context is unchanged', async () => {
    const target = session('session-real', {
      machineId: 'machine-B',
      path: '/srv/project',
      commanderId: 'old',
      commanderName: 'Old',
      commanderPath: '/old/COMMANDER.md',
      commanderWorkspace: '/old',
      commanderAgentContextPath: '/old/agentcontext',
      contextHash: 'live-context-hash',
    });
    const owningMachine = machine('machine-B');
    const fake = fakeClient({
      parent: target,
      refreshed: owningMachine,
      commanderList: {
        commanders: [targetAthena],
        globalAgentsPath: '/remote/.happyherd/AGENTS.md',
      },
    });
    const output = vi.fn();

    await handleSessionCommand(['set-commander', 'session-real', 'athena', '--json'], {
      createClient: async () => fake.client,
      output,
    });

    expect(fake.resolveSession).toHaveBeenCalledWith('session-real');
    expect(fake.resolveMachine).toHaveBeenCalledWith('machine-B');
    expect(fake.callMachineRpc).toHaveBeenCalledWith(
      owningMachine,
      'happyherd-list-commanders',
      {},
    );
    const update = fake.updateSessionMetadata.mock.calls[0][1];
    expect(update(target.metadata))
      .toMatchObject({
        path: '/srv/project',
        commanderId: 'athena',
        commanderName: 'Athena on target',
        commanderPath: targetAthena.commanderPath,
        commanderWorkspace: targetAthena.workspace,
        commanderAgentContextPath: targetAthena.agentContextPath,
        contextHash: 'live-context-hash',
      });
    expect(JSON.parse(output.mock.calls[0][0] as string)).toMatchObject({
      type: 'session-commander-updated',
      sessionId: 'session-real',
      commander: { id: 'athena', name: 'Athena on target' },
      takesEffect: 'next-resume',
    });
  });

  it('detaches cleanly without resolving a Commander', async () => {
    const fake = fakeClient({
      parent: session('session-real', {
        path: '/srv/project',
        commanderId: 'athena',
        commanderName: 'Athena',
        commanderPath: targetAthena.commanderPath,
        commanderWorkspace: targetAthena.workspace,
        commanderAgentContextPath: targetAthena.agentContextPath,
      }),
    });
    const output = vi.fn();

    await handleSessionCommand(['set-commander', 'session-real', 'none', '--json'], {
      createClient: async () => fake.client,
      output,
    });

    expect(fake.resolveMachine).not.toHaveBeenCalled();
    expect(fake.callMachineRpc).not.toHaveBeenCalled();
    const updated = await fake.updateSessionMetadata.mock.results[0].value;
    expect(updated.metadata).toEqual({ path: '/srv/project' });
    expect(JSON.parse(output.mock.calls[0][0] as string).commander).toBeNull();
  });

  it('rejects a Commander missing from the session owning machine', async () => {
    const owningMachine = machine('machine-B');
    const fake = fakeClient({
      parent: session('session-real', {
        machineId: 'machine-B',
        path: '/srv/project',
      }),
      refreshed: owningMachine,
      commanderList: {
        commanders: [],
        globalAgentsPath: '/remote/.happyherd/AGENTS.md',
      },
    });

    await expect(handleSessionCommand(['set-commander', 'session-real', 'missing'], {
      createClient: async () => fake.client,
      output: vi.fn(),
    })).rejects.toThrow('Commander "missing" was not found on machine machine-B');

    expect(fake.callMachineRpc).toHaveBeenCalledWith(
      owningMachine,
      'happyherd-list-commanders',
      {},
    );
    expect(fake.updateSessionMetadata).not.toHaveBeenCalled();
  });
});

describe('local side-chat creation', () => {
  it('uses the existing local daemon without loading account-control credentials', async () => {
    const createClient = vi.fn(async () => fakeClient().client);
    const manageLocalSideChat = vi.fn(async () => ({
      schemaVersion: 1 as const,
      type: 'side-chat' as const,
      action: 'create' as const,
      success: true,
      parentSessionId: 'parent-codex',
      sessionId: 'child-session',
      child: {
        sessionId: 'child-session',
        parentSessionId: 'parent-codex',
        status: 'running' as const,
        providerRunning: true,
        active: true,
        resumable: false,
      },
      phases: [],
    }));
    const output = vi.fn();

    await handleSessionCommand(['side-chat', 'parent-codex', ...sideChatBriefArgs, '--json'], {
      createClient,
      manageLocalSideChat,
      output,
    });

    expect(manageLocalSideChat).toHaveBeenCalledWith({
      action: 'create',
      parentSessionId: 'parent-codex',
      brief: sideChatBrief,
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"sessionId":"child-session"'));
  });

  it('does not fall back to account-control or a QR flow after a local failure', async () => {
    const createClient = vi.fn(async () => fakeClient().client);
    const manageLocalSideChat = vi.fn(async () => {
      throw new Error("Side chats must be created on the parent session's owning machine.");
    });

    await expect(handleSessionCommand(['side-chat', 'parent-session', ...sideChatBriefArgs], {
      createClient,
      manageLocalSideChat,
      output: vi.fn(),
    })).rejects.toThrow("parent session's owning machine");

    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('account credential authority', () => {
  it('makes auth status, logout, and machine-command access agree on agent.key only', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happy-machine-auth-'));
    const credentialPath = getLocalHappyAgentCredentialPath(homeDir);
    const authConfig = {
      serverUrl: 'https://happy.example',
      homeDir,
      credentialPath,
    };
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const create = vi.fn(() => fakeClient().client);
    try {
      writeFileSync(credentialPath, JSON.stringify({
        token: 'account-control-token',
        secret: Buffer.alloc(32, 7).toString('base64'),
      }));
      // A native session key may coexist, but it never grants machine control.
      writeFileSync(join(homeDir, 'access.key'), JSON.stringify({
        token: 'native-session-token',
        encryption: { type: 'legacy', secret: Buffer.alloc(32, 9).toString('base64') },
      }));

      await authStatus(authConfig);
      expect(output.mock.calls.flat().join('\n')).toContain('Status: Authenticated');
      await expect(createDefaultClient({ homeDir, create })).resolves.toBeTruthy();
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ token: 'account-control-token' }));

      output.mockClear();
      await authLogout(authConfig);
      await authStatus(authConfig);
      expect(output.mock.calls.flat().join('\n')).toContain('Status: Not authenticated');
      await expect(createDefaultClient({ homeDir, create })).rejects.toThrow('machine control is not linked');
      expect(existsSync(join(homeDir, 'access.key'))).toBe(true);
    } finally {
      output.mockRestore();
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
