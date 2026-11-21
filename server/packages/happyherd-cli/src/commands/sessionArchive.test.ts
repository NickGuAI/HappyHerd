import { describe, expect, it, vi } from 'vitest';

import { handleSessionCommand } from './machine';
import { handleSessionArchiveCommand } from './sessionArchive';

const closedNone = {
  schemaVersion: 1,
  type: 'side-chat-close-all',
  action: 'close-all',
  success: true,
  parentSessionId: 'session-1',
  total: 0,
  closed: 0,
  failed: 0,
  children: [],
};

function makeFixture(options: {
  running: boolean;
  metadata?: Record<string, unknown>;
  closeAll?: unknown;
  hostMarksArchived?: boolean;
}) {
  const key = new Uint8Array(32).fill(7);
  let stored = {
    id: 'session-1',
    active: options.running,
    metadataVersion: 4,
    encryption: { key, variant: 'dataKey' as const },
    metadata: {
      machineId: 'machine-1',
      path: '/work/project',
      flavor: 'codex',
      commanderId: 'commander-1',
      lifecycleState: options.running ? 'running' : undefined,
      ...options.metadata,
    } as Record<string, unknown>,
  };
  const outputs: string[] = [];
  let hostStopping = false;
  let readsAfterStop = 0;
  const client = {
    resolveSession: vi.fn(async (_selector: string) => {
      // The host replies to the stop request first, then marks the session
      // archived and exits; the second read after the stop sees that.
      if (hostStopping && options.hostMarksArchived !== false && ++readsAfterStop === 2) {
        stored = {
          ...stored,
          active: false,
          metadata: { ...stored.metadata, lifecycleState: 'archived', archivedBy: 'cli', archiveReason: 'User terminated' },
        };
      }
      return { ...stored };
    }),
    resolveMachine: vi.fn(async (machineId: string) => ({ id: machineId, active: true, metadata: {} })),
    callMachineRpc: vi.fn(async () => options.closeAll ?? closedNone),
    killSession: vi.fn(async (_session: unknown) => {
      if (!options.running) throw new Error('Session session-1 is not running.');
      hostStopping = true;
      return { success: true, message: 'Killing happyherd-cli process' };
    }),
    deactivateSession: vi.fn(async (_sessionId: string) => {
      stored = { ...stored, active: false };
    }),
    updateSessionMetadata: vi.fn(async (selected: { metadata: unknown }, updater: (metadata: unknown) => unknown) => {
      stored = { ...stored, metadata: updater(selected.metadata) as Record<string, unknown>, metadataVersion: 5 };
      return { ...stored };
    }),
  };
  const wait = vi.fn(async (_ms: number) => {});
  return {
    key,
    client,
    outputs,
    wait,
    stored: () => stored,
    dependencies: { createClient: async () => client as any, output: (line: string) => outputs.push(line), wait },
  };
}

describe('session archive', () => {
  it('prints usage and rejects bad arguments without loading an account client', async () => {
    const createClient = vi.fn();
    const outputs: string[] = [];
    await handleSessionArchiveCommand(['--help'], { createClient, output: (line) => outputs.push(line) });
    expect(outputs[0]).toContain('happyherd session archive SESSION_ID [--json]');
    expect(outputs[0]).toContain('happyherd machine auth login');

    await expect(handleSessionArchiveCommand([], { createClient })).rejects.toThrow('session-id is required');
    await expect(handleSessionArchiveCommand(['session-1', '--force'], { createClient }))
      .rejects.toThrow('Unknown option: --force');
    await expect(handleSessionArchiveCommand(['session-1', '--json', '--json'], { createClient }))
      .rejects.toThrow('may only be specified once');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('stops a running session through its session host with its key and reads the archived state back', async () => {
    const fixture = makeFixture({ running: true });
    await handleSessionArchiveCommand(['session-1', '--json'], fixture.dependencies);

    expect(fixture.client.callMachineRpc).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'machine-1' }),
      'happyherd-side-chat-close-all',
      { parentSessionId: 'session-1' },
      { responseTimeoutMs: 330_000 },
    );
    expect(fixture.client.killSession).toHaveBeenCalledTimes(1);
    const stopped = fixture.client.killSession.mock.calls[0][0] as { id: string; encryption: { key: Uint8Array } };
    expect(stopped.id).toBe('session-1');
    expect(stopped.encryption.key).toBe(fixture.key);
    expect(fixture.client.callMachineRpc.mock.invocationCallOrder[0])
      .toBeLessThan(fixture.client.killSession.mock.invocationCallOrder[0]);
    // Initial read plus two reads after the stop.
    expect(fixture.client.resolveSession).toHaveBeenCalledTimes(3);
    expect(fixture.wait).toHaveBeenCalledTimes(1);
    expect(fixture.client.deactivateSession).not.toHaveBeenCalled();
    expect(fixture.client.updateSessionMetadata).not.toHaveBeenCalled();
    expect(JSON.parse(fixture.outputs[0])).toEqual({
      schemaVersion: 1,
      type: 'session-archived',
      sessionId: 'session-1',
      archivedThrough: 'session-host',
      sideChatsClosed: 0,
      active: false,
      lifecycleState: 'archived',
    });
  });

  it('archives a session that is not running through the server and keeps its metadata and record', async () => {
    const fixture = makeFixture({ running: false });
    await handleSessionArchiveCommand(['session-1'], fixture.dependencies);

    expect(fixture.client.killSession).toHaveBeenCalledTimes(1);
    expect(fixture.client.deactivateSession).toHaveBeenCalledWith('session-1');
    expect(fixture.client.deactivateSession.mock.invocationCallOrder[0])
      .toBeLessThan(fixture.client.updateSessionMetadata.mock.invocationCallOrder[0]);
    expect(fixture.stored()).toMatchObject({
      id: 'session-1',
      active: false,
      metadata: {
        machineId: 'machine-1',
        path: '/work/project',
        flavor: 'codex',
        commanderId: 'commander-1',
        lifecycleState: 'archived',
        archivedBy: 'cli',
        archiveReason: 'Archived from HappyHerd CLI',
      },
    });
    expect(fixture.stored().metadata.lifecycleStateSince).toEqual(expect.any(Number));
    expect(fixture.wait).not.toHaveBeenCalled();
    expect(fixture.outputs).toEqual([
      'Archived session session-1.',
      'Its session host did not take the stop request, so the server marked it inactive.',
      'The conversation is kept. Resume it with "happyherd resume session-1".',
    ]);
  });

  it('reports an ID that the account does not have and changes nothing', async () => {
    const fixture = makeFixture({ running: true });
    fixture.client.resolveSession.mockRejectedValueOnce(new Error('No session found matching "missing-session"'));
    await expect(handleSessionArchiveCommand(['missing-session', '--json'], fixture.dependencies))
      .rejects.toThrow('No session found matching "missing-session"');

    expect(fixture.client.resolveSession).toHaveBeenCalledWith('missing-session');
    expect(fixture.client.callMachineRpc).not.toHaveBeenCalled();
    expect(fixture.client.killSession).not.toHaveBeenCalled();
    expect(fixture.client.deactivateSession).not.toHaveBeenCalled();
    expect(fixture.client.updateSessionMetadata).not.toHaveBeenCalled();
    expect(fixture.outputs).toEqual([]);
  });

  it('does not archive another session through a shortened ID', async () => {
    const fixture = makeFixture({ running: true });
    // The account lookup falls back to a unique ID prefix.
    await expect(handleSessionArchiveCommand(['session-', '--json'], fixture.dependencies))
      .rejects.toThrow('Session "session-" was not found in this account. Use the exact session ID.');
    expect(fixture.client.callMachineRpc).not.toHaveBeenCalled();
    expect(fixture.client.killSession).not.toHaveBeenCalled();
    expect(fixture.client.deactivateSession).not.toHaveBeenCalled();
    expect(fixture.client.updateSessionMetadata).not.toHaveBeenCalled();
  });

  it('keeps the session open when its side chats do not all close', async () => {
    const fixture = makeFixture({
      running: true,
      closeAll: {
        ...closedNone,
        success: false,
        total: 2,
        closed: 1,
        failed: 1,
        children: [{ success: true }, { success: false }],
      },
    });
    await expect(handleSessionArchiveCommand(['session-1'], fixture.dependencies))
      .rejects.toThrow('its side chats did not all close (1 of 2 closed)');
    expect(fixture.client.killSession).not.toHaveBeenCalled();
    expect(fixture.client.deactivateSession).not.toHaveBeenCalled();
    expect(fixture.client.updateSessionMetadata).not.toHaveBeenCalled();
  });

  it('stops a bot only through its machine, without side chats or a server fallback', async () => {
    const fixture = makeFixture({ running: false, metadata: { bot: { id: 'bot-1' } } });
    await expect(handleSessionArchiveCommand(['session-1'], fixture.dependencies))
      .rejects.toThrow('To archive bot session session-1, connect the machine that owns it.');
    expect(fixture.client.killSession).toHaveBeenCalledTimes(1);
    expect(fixture.client.callMachineRpc).not.toHaveBeenCalled();
    expect(fixture.client.deactivateSession).not.toHaveBeenCalled();
    expect(fixture.client.updateSessionMetadata).not.toHaveBeenCalled();
  });

  it('does not ask a HappyHerd daemon to close side chats for a Rig session', async () => {
    const fixture = makeFixture({ running: true, metadata: { client: { id: 'rig' } } });
    await handleSessionArchiveCommand(['session-1', '--json'], fixture.dependencies);
    expect(fixture.client.callMachineRpc).not.toHaveBeenCalled();
    expect(fixture.client.killSession).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fixture.outputs[0])).toMatchObject({ archivedThrough: 'session-host', lifecycleState: 'archived' });
  });

  it('fails without a second fallback when a stopped host never shows the archived state', async () => {
    const fixture = makeFixture({ running: true, hostMarksArchived: false });
    await expect(handleSessionArchiveCommand(['session-1'], fixture.dependencies))
      .rejects.toThrow('accepted the stop but did not show the archived state within 30 seconds');
    expect(fixture.wait).toHaveBeenCalledTimes(59);
    expect(fixture.client.deactivateSession).not.toHaveBeenCalled();
    expect(fixture.client.updateSessionMetadata).not.toHaveBeenCalled();
  });

  it('is routed by the session command and listed in session help', async () => {
    const createClient = vi.fn();
    const output = vi.fn();
    await handleSessionCommand(['archive', '--help'], { createClient, output });
    expect(createClient).not.toHaveBeenCalled();
    expect(output.mock.calls[0][0]).toContain('happyherd session archive SESSION_ID');

    await handleSessionCommand(['--help'], { output });
    expect(output.mock.calls[1][0]).toContain('happyherd session archive <session-id> [--json]');
  });
});
