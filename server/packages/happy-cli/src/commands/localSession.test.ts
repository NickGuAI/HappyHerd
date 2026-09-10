import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  handleLocalSessionInspectCommand, handleLocalSessionSendCommand,
  parseLocalSessionInspectOptions,
} from './localSession';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const sendArgs = ['session-one', '--text-file', '/tmp/task.md', '--message-id', 'task-one', '--json'];
const queued = { schemaVersion: 1 as const, type: 'session-message' as const, success: true, status: 'queued' as const, sessionId: 'session-one', messageId: 'task-one', seq: 3 };

describe('local session task commands', () => {
  it.each([
    [], ['--json'], ['session-one', '--text-file', '/tmp/task.md'],
    ['session-one', '--text-file', 'task.md', '--message-id', 'task-one'],
    [...sendArgs, '--machine', 'machine-one'], [...sendArgs, '--message-id', 'second'],
  ].map(args => ({ args })))('rejects malformed send arguments before reading a file or contacting a daemon: $args', async ({ args }) => {
    const readTextFile = vi.fn(); const send = vi.fn();
    await expect(handleLocalSessionSendCommand(args, { readTextFile, send })).rejects.toThrow();
    expect(readTextFile).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it('reads the actual UTF-8 task file byte-faithfully and returns the exact acknowledged IDs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'happy-local-session-command-')); directories.push(directory);
    const file = join(directory, 'task.md'); const text = '# Task\n\n  Read the selected Commander. 验证结果。\n';
    await writeFile(file, text);
    const send = vi.fn(async () => queued); const output = vi.fn(); const setExitCode = vi.fn();
    await handleLocalSessionSendCommand(['session-one', '--text-file', file, '--message-id', 'task-one', '--json'], { send, output, setExitCode });
    expect(send).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session-one', messageId: 'task-one', text });
    expect(JSON.parse(output.mock.calls[0][0])).toEqual(queued); expect(setExitCode).not.toHaveBeenCalled();
  });

  it.each(['read', 'send', 'empty'] as const)('returns stable IDs and a nonzero error when %s fails', async (failure) => {
    const send = vi.fn(async () => { throw new Error('daemon unavailable'); });
    const output = vi.fn(); const setExitCode = vi.fn();
    await handleLocalSessionSendCommand(sendArgs, {
      readTextFile: async () => { if (failure === 'read') throw new Error('file unavailable'); return failure === 'empty' ? '  \n' : 'task'; },
      send, output, setExitCode,
    });
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({ sessionId: 'session-one', messageId: 'task-one', success: false, status: 'failed', error: expect.any(String) });
    expect(setExitCode).toHaveBeenCalledWith(1);
    if (failure !== 'send') expect(send).not.toHaveBeenCalled();
  });

  it('retains the queued acknowledgement when provider resumption fails', async () => {
    const output = vi.fn(); const setExitCode = vi.fn();
    await handleLocalSessionSendCommand(sendArgs, {
      readTextFile: async () => 'task', send: async () => ({ ...queued, success: false, error: 'Provider failed to resume' }), output, setExitCode,
    });
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({ ...queued, success: false, error: 'Provider failed to resume' });
    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it.each(['0', '101', '1.5', 'wat'])('rejects an invalid inspect bound %s before contacting the daemon', async (limit) => {
    const inspect = vi.fn();
    await expect(handleLocalSessionInspectCommand(['session-one', '--limit', limit], { inspect })).rejects.toThrow();
    expect(inspect).not.toHaveBeenCalled();
  });

  it('reads a bounded recent page and does not expose unsupported cursor options', async () => {
    expect(parseLocalSessionInspectOptions(['session-one'])).toEqual({ sessionId: 'session-one', limit: 20, json: false });
    expect(() => parseLocalSessionInspectOptions(['session-one', '--after', '20'])).toThrow('Unknown option');
    const receipt = { schemaVersion: 1 as const, type: 'session-inspection' as const, recent: true as const, limit: 5,
      session: { id: 'session-one', active: true, providerRunning: true, seq: 3, metadata: { path: '/project', commanderId: 'selected' } }, messages: [] };
    const inspect = vi.fn(async () => receipt); const output = vi.fn();
    await handleLocalSessionInspectCommand(['session-one', '--limit', '5', '--json'], { inspect, output });
    expect(inspect).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session-one', limit: 5 });
    expect(JSON.parse(output.mock.calls[0][0])).toEqual(receipt);
  });
});
