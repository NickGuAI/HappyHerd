import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createChildSideChat,
  handleSideChatCommand,
  type ResolvedSideChatMachine,
  type SideChatCommandDependencies,
} from './sideChat';

const parentId = 'happy-parent';
const machine: ResolvedSideChatMachine = {
  id: 'machine-owner',
  seq: 1,
  createdAt: 1,
  updatedAt: 1,
  active: true,
  activeAt: 1,
  metadata: {},
  metadataVersion: 1,
  daemonState: null,
  daemonStateVersion: 1,
  dataEncryptionKey: null,
  encryption: { key: new Uint8Array(32), variant: 'dataKey' },
};

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

  it.each(['grok', 'acp', 'gemini', 'agy', 'opencode']) (
    'rejects unsupported %s parents without trying another provider',
    async (flavor) => {
      const deps = dependencies({
        flavor,
        machineId: machine.id,
        path: '/srv/project',
        claudeSessionId: 'must-not-fallback',
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

  it('prints a stable secret-free JSON result', async () => {
    const deps = dependencies();
    await handleSideChatCommand([parentId, '--json'], deps);

    expect(console.log).toHaveBeenCalledWith('{"sessionId":"happy-child"}');
  });

  it('prints only the child session ID by default', async () => {
    await handleSideChatCommand([parentId], dependencies());

    expect(console.log).toHaveBeenCalledWith('happy-child');
  });

  it('shows help without resolving sessions or machines', async () => {
    const deps = dependencies();
    await handleSideChatCommand(['--help'], deps);

    expect(console.log).toHaveBeenCalledOnce();
    expect(deps.resolveSession).not.toHaveBeenCalled();
    expect(deps.resolveMachine).not.toHaveBeenCalled();
  });
});
