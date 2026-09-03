import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createChildSideChat,
  formatSideChatDelegationPrompt,
  formatSideChatLifecycleReceipt,
  handleSideChatCommand,
  normalizeSideChatLifecycleRequest,
  parseSideChatLifecycleRequest,
  sameSideChatDelegationBrief,
  sameSideChatLaunchOptions,
  sideChatHelp,
  type ResolvedSideChatMachine,
  type SideChatCommandDependencies,
  type SideChatLifecycleReceipt,
  type SideChatSingleReceipt,
} from './sideChat';

const parentId = 'happy-parent';
const machine: ResolvedSideChatMachine = {
  id: 'machine-owner',
  active: true,
};
const brief = {
  outcome: 'Open a verified pull request.',
  scope: 'Change only the side-chat command contract.',
  dependencies: 'Base branch feature/integration.',
  writeOwnership: 'server/packages/happy-cli/src/commands/sideChat.ts',
  verification: 'Run the focused CLI tests and typecheck.',
  handoff: 'Report the PR URL, checks, blockers, and remaining work.',
} as const;
const briefArgs = [
  '--outcome', brief.outcome,
  '--scope', brief.scope,
  '--dependencies', brief.dependencies,
  '--write-ownership', brief.writeOwnership,
  '--verification', brief.verification,
  '--handoff', brief.handoff,
];
const launchArgs = ['--model', 'gpt-5.6-sol', '--effort', 'xhigh'];

function dependencies(
  metadata: Record<string, unknown> = {
    flavor: 'claude',
    machineId: machine.id,
    path: '/srv/project',
    claudeSessionId: 'claude-parent',
  },
): SideChatCommandDependencies {
  const result = {
    resolveSession: vi.fn().mockResolvedValue({ id: parentId, metadata }),
    resolveMachine: vi.fn().mockResolvedValue(machine),
    machineRpc: vi.fn().mockResolvedValue({
      type: 'success',
      newClaudeSessionId: 'claude-child',
    }),
    createMachineSession: vi.fn().mockResolvedValue({
      type: 'success',
      sessionId: 'happy-child',
    }),
  } satisfies SideChatCommandDependencies;
  return result;
}

function lifecycleReceipt(): SideChatSingleReceipt {
  return {
    schemaVersion: 2,
    type: 'side-chat',
    action: 'create',
    success: true,
    parentSessionId: parentId,
    sessionId: 'happy-child',
    child: {
      sessionId: 'happy-child',
      parentSessionId: parentId,
      status: 'running',
      providerRunning: true,
      active: true,
      resumable: false,
    },
    phases: [
      { phase: 'resolve', status: 'succeeded' },
      { phase: 'readback', status: 'succeeded' },
    ],
    resource: {
      status: 'ok',
      sampledAt: '2026-09-03T10:00:00.000Z',
      cpu: { busyPercent: 12.5, sampleWindowMs: 250 },
      loadAverage: { oneMinute: 0.1, fiveMinutes: 0.2, fifteenMinutes: 0.3 },
      memory: {
        usedBytes: 8 * 1024 ** 3,
        totalBytes: 16 * 1024 ** 3,
        availableBytes: 8 * 1024 ** 3,
        swapUsedBytes: 1024 ** 3,
      },
    },
  };
}

describe('createChildSideChat', () => {
  it('forks Claude on the immutable parent machine and path before spawning the hidden child', async () => {
    const parentMetadata = {
      flavor: 'claude',
      machineId: machine.id,
      path: '/srv/project',
      claudeSessionId: 'claude-parent',
    };
    const deps = dependencies(parentMetadata);
    vi.mocked(deps.machineRpc).mockImplementation(async () => {
      parentMetadata.machineId = 'machine-mutated';
      parentMetadata.path = '/srv/mutated';
      parentMetadata.claudeSessionId = 'claude-mutated';
      return { type: 'success', newClaudeSessionId: 'claude-child' } as never;
    });

    await expect(createChildSideChat(parentId, deps)).resolves.toEqual({ sessionId: 'happy-child' });
    expect(deps.resolveSession).toHaveBeenCalledWith(parentId);
    expect(deps.resolveMachine).toHaveBeenCalledWith(machine.id);
    expect(deps.machineRpc).toHaveBeenCalledWith(machine, 'claude-fork-session', {
      directory: '/srv/project',
      claudeSessionId: 'claude-parent',
    });
    expect(deps.createMachineSession).toHaveBeenCalledWith({
      machine,
      directory: '/srv/project',
      approvedNewDirectoryCreation: false,
      agent: 'claude',
      resumeClaudeSessionId: 'claude-child',
      parentSessionId: parentId,
      isSideChat: true,
    });
    expect(vi.mocked(deps.machineRpc).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(deps.createMachineSession).mock.invocationCallOrder[0]);
  });

  it('treats a historical session with a Claude ID and no flavor as Claude', async () => {
    const deps = dependencies({
      machineId: machine.id,
      path: '/srv/legacy-project',
      claudeSessionId: 'claude-legacy-parent',
    });

    await expect(createChildSideChat(parentId, deps)).resolves.toEqual({ sessionId: 'happy-child' });
    expect(deps.machineRpc).toHaveBeenCalledWith(machine, 'claude-fork-session', {
      directory: '/srv/legacy-project',
      claudeSessionId: 'claude-legacy-parent',
    });
    expect(deps.createMachineSession).toHaveBeenCalledWith(expect.objectContaining({
      agent: 'claude',
      resumeClaudeSessionId: 'claude-child',
      parentSessionId: parentId,
      isSideChat: true,
    }));
  });

  it('forks Codex and spawns with the fresh thread ID', async () => {
    const deps = dependencies({
      flavor: 'codex',
      machineId: machine.id,
      path: '/srv/project',
      codexThreadId: 'codex-parent',
    });
    vi.mocked(deps.machineRpc).mockResolvedValue({
      type: 'success',
      newCodexThreadId: 'codex-child',
    });

    await expect(createChildSideChat(parentId, deps)).resolves.toEqual({ sessionId: 'happy-child' });
    expect(deps.machineRpc).toHaveBeenCalledWith(machine, 'codex-fork-thread', {
      directory: '/srv/project',
      codexThreadId: 'codex-parent',
    });
    expect(deps.createMachineSession).toHaveBeenCalledWith({
      machine,
      directory: '/srv/project',
      approvedNewDirectoryCreation: false,
      agent: 'codex',
      resumeCodexThreadId: 'codex-child',
      parentSessionId: parentId,
      isSideChat: true,
    });
  });

  it('passes explicit model and effort to the side-chat spawn boundary', async () => {
    const deps = dependencies({
      flavor: 'codex',
      machineId: machine.id,
      path: '/srv/project',
      codexThreadId: 'codex-parent',
    });
    vi.mocked(deps.machineRpc).mockResolvedValue({
      type: 'success',
      newCodexThreadId: 'codex-child',
    });

    await expect(createChildSideChat(parentId, deps, {
      model: 'gpt-5.6-sol',
      effort: 'xhigh',
    })).resolves.toEqual({ sessionId: 'happy-child' });
    expect(deps.createMachineSession).toHaveBeenCalledWith(expect.objectContaining({
      agent: 'codex',
      modelMode: 'gpt-5.6-sol',
      effortLevel: 'xhigh',
      resumeCodexThreadId: 'codex-child',
      parentSessionId: parentId,
      isSideChat: true,
    }));
  });

  it.each(['gemini', 'grok', 'dsh', 'agy'] as const) (
    'starts a fresh same-provider child for %s without invoking a native fork',
    async (flavor) => {
      const deps = dependencies({
        flavor,
        machineId: machine.id,
        path: '/srv/project',
      });

      await expect(createChildSideChat(parentId, deps)).resolves.toEqual({ sessionId: 'happy-child' });
      expect(deps.machineRpc).not.toHaveBeenCalled();
      expect(deps.createMachineSession).toHaveBeenCalledWith({
        machine,
        directory: '/srv/project',
        approvedNewDirectoryCreation: false,
        agent: flavor,
        parentSessionId: parentId,
        isSideChat: true,
      });
    },
  );

  it.each(['acp', 'opencode']) (
    'rejects unsupported %s parents without trying another provider',
    async (flavor) => {
      const deps = dependencies({
        flavor,
        machineId: machine.id,
        path: '/srv/project',
      });

      await expect(createChildSideChat(parentId, deps))
        .rejects.toThrow(`unsupported provider "${flavor}"`);
      expect(deps.resolveMachine).not.toHaveBeenCalled();
      expect(deps.machineRpc).not.toHaveBeenCalled();
      expect(deps.createMachineSession).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ machineId: machine.id, path: '/srv/project' }, 'provider metadata'],
    [{ flavor: 'claude', path: '/srv/project', claudeSessionId: 'claude-parent' }, 'owning machine metadata'],
    [{ flavor: 'claude', machineId: machine.id, path: '', claudeSessionId: 'claude-parent' }, 'working directory metadata'],
    [{ flavor: 'claude', machineId: machine.id, path: '/srv/project' }, 'Claude session ID'],
    [{ flavor: 'codex', machineId: machine.id, path: '/srv/project' }, 'Codex thread ID'],
  ])('fails clearly when required parent metadata is missing', async (metadata, message) => {
    const deps = dependencies(metadata);

    await expect(createChildSideChat(parentId, deps)).rejects.toThrow(message as string);
    expect(deps.resolveMachine).not.toHaveBeenCalled();
    expect(deps.machineRpc).not.toHaveBeenCalled();
    expect(deps.createMachineSession).not.toHaveBeenCalled();
  });

  it('fails on the exact offline owner without falling back', async () => {
    const deps = dependencies();
    vi.mocked(deps.resolveMachine).mockResolvedValue({ ...machine, active: false });

    await expect(createChildSideChat(parentId, deps)).rejects.toThrow(
      `Owning machine ${machine.id} for Happy session ${parentId} is offline.`,
    );
    expect(deps.machineRpc).not.toHaveBeenCalled();
    expect(deps.createMachineSession).not.toHaveBeenCalled();
  });

  it('rejects a machine resolver that substitutes a different owner', async () => {
    const deps = dependencies();
    vi.mocked(deps.resolveMachine).mockResolvedValue({ ...machine, id: 'machine-fallback' });

    await expect(createChildSideChat(parentId, deps)).rejects.toThrow(
      `Owning machine ${machine.id} for Happy session ${parentId} was not found.`,
    );
    expect(deps.machineRpc).not.toHaveBeenCalled();
    expect(deps.createMachineSession).not.toHaveBeenCalled();
  });

  it('does not spawn when the provider-native fork fails', async () => {
    const deps = dependencies();
    vi.mocked(deps.machineRpc).mockRejectedValue(new Error('Claude session file not found on this machine'));

    await expect(createChildSideChat(parentId, deps))
      .rejects.toThrow('Claude session file not found on this machine');
    expect(deps.createMachineSession).not.toHaveBeenCalled();
  });

  it('surfaces spawn failures and directory-approval responses without retrying', async () => {
    const errorDeps = dependencies();
    vi.mocked(errorDeps.createMachineSession).mockResolvedValue({
      type: 'error',
      errorMessage: 'daemon rejected spawn',
    });
    await expect(createChildSideChat(parentId, errorDeps))
      .rejects.toThrow('Failed to create side chat: daemon rejected spawn');
    expect(errorDeps.createMachineSession).toHaveBeenCalledOnce();

    const approvalDeps = dependencies();
    vi.mocked(approvalDeps.createMachineSession).mockResolvedValue({
      type: 'requestToApproveDirectoryCreation',
      directory: '/srv/project',
    });
    await expect(createChildSideChat(parentId, approvalDeps))
      .rejects.toThrow('existing parent directory unexpectedly requires creation approval');
    expect(approvalDeps.createMachineSession).toHaveBeenCalledOnce();
  });
});

describe('handleSideChatCommand', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('prints a stable secret-free JSON receipt', async () => {
    const receipt = lifecycleReceipt();
    await handleSideChatCommand([parentId, ...briefArgs, '--json'], {
      execute: vi.fn(async () => receipt),
    });

    expect(console.log).toHaveBeenCalledWith(JSON.stringify(receipt));
  });

  it('prints a stable human receipt by default', async () => {
    const receipt = lifecycleReceipt();
    await handleSideChatCommand(['create', parentId, ...briefArgs], {
      execute: vi.fn(async () => receipt),
    });

    expect(console.log).toHaveBeenCalledWith(
      [
        'Created side chat happy-child: running (active)',
        'Resources (ok, sampled 2026-09-03T10:00:00.000Z)',
        '  CPU: 12.5% busy over 250 ms; load 0.1 / 0.2 / 0.3',
        '  RAM: 8.00 GiB used / 16.00 GiB total; 8.00 GiB available',
        '  Swap: 1.00 GiB used',
      ].join('\n'),
    );
  });

  it('shows help without calling the daemon', async () => {
    const receipt = lifecycleReceipt();
    const execute = vi.fn(async () => receipt);
    await handleSideChatCommand(['--help'], {
      execute,
    });

    expect(console.log).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('parseSideChatLifecycleRequest', () => {
  it('supports briefed shorthand create and every lifecycle action', () => {
    expect(parseSideChatLifecycleRequest([parentId, ...briefArgs])).toEqual({
      request: { action: 'create', parentSessionId: parentId, brief },
      json: false,
    });
    expect(parseSideChatLifecycleRequest(['create', parentId, ...briefArgs, '--json'])).toEqual({
      request: { action: 'create', parentSessionId: parentId, brief },
      json: true,
    });
    expect(parseSideChatLifecycleRequest([
      'create', parentId, ...briefArgs, ...launchArgs, '--json',
    ])).toEqual({
      request: {
        action: 'create',
        parentSessionId: parentId,
        brief,
        launch: { model: 'gpt-5.6-sol', effort: 'xhigh' },
      },
      json: true,
    });
    expect(parseSideChatLifecycleRequest(['list', parentId])).toEqual({
      request: { action: 'list', parentSessionId: parentId },
      json: false,
    });
    expect(parseSideChatLifecycleRequest(['status', 'child'])).toEqual({
      request: { action: 'status', sessionId: 'child' },
      json: false,
    });
    expect(parseSideChatLifecycleRequest(['inspect', 'child'])).toEqual({
      request: { action: 'status', sessionId: 'child' },
      json: false,
    });
    expect(parseSideChatLifecycleRequest(['stop', 'child'])).toEqual({
      request: { action: 'stop', sessionId: 'child' },
      json: false,
    });
    expect(parseSideChatLifecycleRequest(['pause', 'child'])).toEqual({
      request: { action: 'stop', sessionId: 'child' },
      json: false,
    });
    expect(parseSideChatLifecycleRequest(['close', 'child'])).toEqual({
      request: { action: 'close', sessionId: 'child' },
      json: false,
    });
    expect(parseSideChatLifecycleRequest(['close', parentId, '--all', '--json'])).toEqual({
      request: { action: 'close-all', parentSessionId: parentId },
      json: true,
    });
    expect(parseSideChatLifecycleRequest(['close-all', parentId])).toEqual({
      request: { action: 'close-all', parentSessionId: parentId },
      json: false,
    });
    expect(parseSideChatLifecycleRequest(['reopen', 'child'])).toEqual({
      request: { action: 'reopen', sessionId: 'child' },
      json: false,
    });
    expect(parseSideChatLifecycleRequest(['resume', 'child'])).toEqual({
      request: { action: 'reopen', sessionId: 'child' },
      json: false,
    });
  });

  it('normalizes CLI and daemon API aliases to canonical lifecycle requests', () => {
    expect(normalizeSideChatLifecycleRequest({ action: 'inspect', sessionId: 'child' }))
      .toEqual({ action: 'status', sessionId: 'child' });
    expect(normalizeSideChatLifecycleRequest({ action: 'pause', sessionId: 'child' }))
      .toEqual({ action: 'stop', sessionId: 'child' });
    expect(normalizeSideChatLifecycleRequest({ action: 'resume', sessionId: 'child' }))
      .toEqual({ action: 'reopen', sessionId: 'child' });
    expect(normalizeSideChatLifecycleRequest({ action: 'close', sessionId: 'child' }))
      .toEqual({ action: 'close', sessionId: 'child' });
  });

  it('advertises lifecycle aliases and their canonical receipts', () => {
    const help = sideChatHelp();
    expect(help).toContain('side-chat inspect <child-session-id>');
    expect(help).toContain('side-chat pause <child-session-id>');
    expect(help).toContain('side-chat resume <child-session-id>');
    expect(help).toContain('[--model <model>] [--effort <effort>]');
    expect(help).toContain("validated against the parent machine's");
    expect(help).toContain('receipts use the canonical action names');
  });

  it('rejects ambiguous or unsupported action shapes', () => {
    expect(() => parseSideChatLifecycleRequest(['stop', 'child', '--all']))
      .toThrow('--all is supported only with the close action');
    expect(() => parseSideChatLifecycleRequest(['create']))
      .toThrow('Usage: happyherd session side-chat create');
    expect(() => parseSideChatLifecycleRequest(['--unknown']))
      .toThrow('Unknown side-chat option');
  });

  it('requires all six bounded brief fields and confines them to create', () => {
    expect(() => parseSideChatLifecycleRequest(['create', parentId]))
      .toThrow('Side-chat creation requires: --outcome, --scope, --dependencies, --write-ownership, --verification, --handoff');
    expect(() => parseSideChatLifecycleRequest([
      'create', parentId,
      ...briefArgs.slice(0, -2),
    ])).toThrow('Side-chat creation requires: --handoff');
    expect(() => parseSideChatLifecycleRequest(['status', 'child', '--outcome', 'wrong action']))
      .toThrow('supported only with the create action');
    expect(() => parseSideChatLifecycleRequest(['status', 'child', '--effort', 'xhigh']))
      .toThrow('Launch options are supported only with the create action');
    expect(() => parseSideChatLifecycleRequest([
      'create', parentId,
      ...briefArgs,
      '--outcome', 'duplicate',
    ])).toThrow('Duplicate side-chat option: --outcome');
    expect(() => parseSideChatLifecycleRequest([
      'create', parentId,
      '--outcome', '--scope', 'wrongly consumed',
    ])).toThrow('Side-chat option --outcome requires a non-empty value');
    expect(() => parseSideChatLifecycleRequest([
      'create', parentId,
      ...briefArgs,
      '--model', 'gpt-5.6-sol',
      '--model', 'gpt-5.5',
    ])).toThrow('Duplicate side-chat option: --model');
    expect(() => parseSideChatLifecycleRequest([
      'create', parentId,
      ...briefArgs,
      '--effort', '--json',
    ])).toThrow('Side-chat option --effort requires a non-empty value');

    const markdownBriefArgs = [...briefArgs];
    markdownBriefArgs[1] = '- deliver only the owned files';
    expect(parseSideChatLifecycleRequest(['create', parentId, ...markdownBriefArgs]))
      .toMatchObject({ request: { brief: { outcome: '- deliver only the owned files' } } });
  });

  it('keeps a failed create JSON receipt with resources on stdout and marks the command unsuccessful', async () => {
    const receipt = { ...lifecycleReceipt(), success: false };
    const output = vi.fn();
    const setExitCode = vi.fn();

    await handleSideChatCommand(['create', parentId, ...briefArgs, '--json'], {
      execute: vi.fn(async () => receipt),
      output,
      setExitCode,
    });

    expect(output).toHaveBeenCalledWith(JSON.stringify(receipt));
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
      schemaVersion: 2,
      success: false,
      resource: { status: 'ok', cpu: { sampleWindowMs: 250 } },
    });
    expect(setExitCode).toHaveBeenCalledWith(1);
  });
});

describe('formatSideChatDelegationPrompt', () => {
  it('delivers stable lineage, every bounded field, role semantics, and handoff accountability', () => {
    const prompt = formatSideChatDelegationPrompt(parentId, 'happy-child', brief);

    expect(prompt).toContain(`side chat \`happy-child\``);
    expect(prompt).toContain(`session \`${parentId}\``);
    for (const value of Object.values(brief)) expect(prompt).toContain(value);
    expect(prompt).toContain('Human interacts directly with the Main Agent');
    expect(prompt).toContain('provider-native subagent is the default inline fan-out');
    expect(prompt).toContain('durable, visible, resumable child conversation');
    expect(prompt).toContain('explicitly create each delegated task');
    expect(prompt).toContain('Do not create another HappyHerd side chat');
    expect(prompt).toContain('result, exact verification evidence, blockers, and remaining work');
  });

  it('compares the complete structured brief for concurrent creation accountability', () => {
    expect(sameSideChatDelegationBrief(brief, { ...brief })).toBe(true);
    expect(sameSideChatDelegationBrief(brief, { ...brief, handoff: 'Different handoff' })).toBe(false);
    expect(sameSideChatLaunchOptions(
      { model: 'gpt-5.6-sol', effort: 'xhigh' },
      { model: 'gpt-5.6-sol', effort: 'xhigh' },
    )).toBe(true);
    expect(sameSideChatLaunchOptions(
      { model: 'gpt-5.6-sol', effort: 'xhigh' },
      { model: 'gpt-5.6-sol', effort: 'max' },
    )).toBe(false);
  });
});

describe('formatSideChatLifecycleReceipt', () => {
  it('renders partial failures with the exact failed phase', () => {
    const receipt = lifecycleReceipt();
    expect(formatSideChatLifecycleReceipt({
      ...receipt,
      action: 'close',
      success: false,
      phases: [{ phase: 'archive-metadata', status: 'failed', message: 'version conflict' }],
    })).toContain('archive-metadata: version conflict');
  });

  it('renders unavailable values from a failed create sample without hiding lifecycle errors', () => {
    const receipt = lifecycleReceipt();
    expect(formatSideChatLifecycleReceipt({
      ...receipt,
      success: false,
      child: null,
      phases: [{ phase: 'resolve', status: 'failed', message: 'parent unavailable' }],
      resource: {
        status: 'failed',
        sampledAt: '2026-09-03T10:05:00.000Z',
        cpu: { busyPercent: null, sampleWindowMs: 250 },
        loadAverage: { oneMinute: null, fiveMinutes: null, fifteenMinutes: null },
        memory: {
          usedBytes: null,
          totalBytes: null,
          availableBytes: null,
          swapUsedBytes: null,
        },
      },
    })).toBe([
      'Created side chat happy-child: failed',
      'Resources (failed, sampled 2026-09-03T10:05:00.000Z)',
      '  CPU: unavailable busy over 250 ms; load unavailable / unavailable / unavailable',
      '  RAM: unavailable used / unavailable total; unavailable available',
      '  Swap: unavailable used',
      'resolve: parent unavailable',
    ].join('\n'));
  });
});
