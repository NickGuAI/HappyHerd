import { describe, expect, it, vi } from 'vitest';

import { handleSessionCommand, parseSessionCreateOptions } from './machine';

describe('local default Assistant command', () => {
  it('reuses the daemon session without requesting account-control authentication', async () => {
    const createClient = vi.fn();
    const ensureLocalAssistant = vi.fn(async () => ({
      schemaVersion: 1 as const,
      type: 'default-assistant' as const,
      status: 'existing' as const,
      sessionId: 'persistent-assistant',
    }));
    const output = vi.fn();
    const setExitCode = vi.fn();

    await handleSessionCommand(['ensure-assistant', '--json'], {
      createClient, ensureLocalAssistant, output, setExitCode,
    });

    expect(createClient).not.toHaveBeenCalled();
    expect(ensureLocalAssistant).toHaveBeenCalledOnce();
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
      sessionId: 'persistent-assistant', status: 'existing',
    });
    expect(setExitCode).not.toHaveBeenCalled();
  });

  it.each([null, 'prepared-assistant'])('reports unfinished setup for session %s', async (sessionId) => {
    const output = vi.fn();
    const setExitCode = vi.fn();

    await handleSessionCommand(['ensure-assistant', '--json'], {
      ensureLocalAssistant: async () => ({
        schemaVersion: 1,
        type: 'default-assistant',
        status: 'waiting-for-provider',
        sessionId,
      }),
      output, setExitCode,
    });

    expect(JSON.parse(output.mock.calls[0][0]).sessionId).toBe(sessionId);
    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it('does not execute setup for help or an unsupported option', async () => {
    const ensureLocalAssistant = vi.fn();
    await handleSessionCommand(['ensure-assistant', '--help'], {
      ensureLocalAssistant, output: vi.fn(),
    });
    await expect(handleSessionCommand(['ensure-assistant', '--machine', 'another-host'], {
      ensureLocalAssistant,
    })).rejects.toThrow('Unknown option');
    expect(ensureLocalAssistant).not.toHaveBeenCalled();
  });

  it('surfaces daemon failure without retrying creation', async () => {
    const ensureLocalAssistant = vi.fn(async () => { throw new Error('Daemon unavailable'); });
    await expect(handleSessionCommand(['ensure-assistant'], {
      ensureLocalAssistant,
    })).rejects.toThrow('Daemon unavailable');
    expect(ensureLocalAssistant).toHaveBeenCalledOnce();
  });
});

describe('local Commander session creation', () => {
  it('dispatches task messaging through the local daemon without account-control authentication', async () => {
    const createClient = vi.fn();
    const output = vi.fn();
    const send = vi.fn(async () => ({
      schemaVersion: 1 as const, type: 'session-message' as const,
      success: true, status: 'queued' as const,
      sessionId: 'delegated-session', messageId: 'task-1', seq: 1,
    }));
    await handleSessionCommand([
      'send', 'delegated-session', '--text-file', '/srv/task.txt', '--message-id', 'task-1', '--json',
    ], {
      createClient, output, localSession: { readTextFile: async () => 'Verify the task.', send },
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({
      sessionId: 'delegated-session', messageId: 'task-1', text: 'Verify the task.',
    });
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({ success: true, seq: 1 });
    await handleSessionCommand(['inspect', '--help'], { createClient, output });
    expect(createClient).not.toHaveBeenCalled();
    expect(output.mock.calls.at(-1)?.[0]).toContain('session inspect');
  });

  it('uses the local daemon and preserves the requested Commander, workspace, and settings', async () => {
    const createClient = vi.fn();
    const createLocalSession = vi.fn(async () => ({
      success: true as const,
      sessionId: 'delegated-session',
      machine: { id: 'local-machine', host: 'workstation', platform: 'linux' },
      path: '/srv/project',
      settings: { provider: 'codex' as const, model: 'selected-model', effort: 'high', permission: 'default' },
      commander: {
        id: 'project-commander', name: 'Project Commander', path: '/srv/commander/COMMANDER.md',
        workspace: '/srv/project', agentContextPath: '/srv/commander/agentcontext',
      },
    }));
    const output = vi.fn();

    await handleSessionCommand([
      'create', '--local', '--path', '/srv/project', '--provider', 'codex',
      '--commander', 'project-commander', '--model', 'selected-model', '--effort', 'high', '--json',
    ], { createClient, createLocalSession, output });

    expect(createClient).not.toHaveBeenCalled();
    expect(createLocalSession).toHaveBeenCalledWith({
      directory: '/srv/project', agent: 'codex', commanderId: 'project-commander',
      modelMode: 'selected-model', effortLevel: 'high', approvedNewDirectoryCreation: false,
    });
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
      schemaVersion: 1, type: 'session-created', sessionId: 'delegated-session',
      path: '/srv/project', commander: { id: 'project-commander' },
    });
  });

  it('requires one unambiguous destination and retains directory and Commander decisions', () => {
    const args = ['--path', '/srv/project', '--provider', 'codex'];
    expect(() => parseSessionCreateOptions([...args, '--local', '--machine', 'other']))
      .toThrow('--local and --machine cannot be combined');
    expect(() => parseSessionCreateOptions(args)).toThrow('--machine is required');
    expect(() => parseSessionCreateOptions([...args, '--local', '--super-session']))
      .toThrow('--super-session requires --commander');
    expect(parseSessionCreateOptions([...args, '--local', '--create-dir']))
      .toMatchObject({ local: true, createDirectory: true });
  });
});
