import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hasProviderProcessExited, parseProcessIdentity, readProcessIdentity } from './processStatus';

function probeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe('hasProviderProcessExited', () => {
  it('reports exit only when the operating system says the PID is missing', () => {
    const probe = vi.fn(() => {
      throw probeError('ESRCH');
    });

    expect(hasProviderProcessExited(42, probe)).toBe(true);
    expect(probe).toHaveBeenCalledWith(42, 0);
  });

  it('keeps the session active when the process exists', () => {
    expect(hasProviderProcessExited(42, vi.fn())).toBe(false);
  });

  it('does not treat permission or unknown probe failures as process exit', () => {
    const deniedProbe = vi.fn(() => {
      throw probeError('EPERM');
    });
    const unknownProbe = vi.fn(() => {
      throw new Error('probe failed');
    });

    expect(hasProviderProcessExited(42, deniedProbe)).toBe(false);
    expect(hasProviderProcessExited(42, unknownProbe)).toBe(false);
  });
});

describe('readProcessIdentity', () => {
  let child: ChildProcess | undefined;
  afterEach(() => { child?.kill('SIGKILL'); child = undefined; });

  async function startIdleProcess(...args: string[]): Promise<ChildProcess> {
    child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', ...args], { stdio: 'ignore' });
    await once(child, 'spawn');
    return child;
  }

  it('reads a live process command line and a start time no later than its launch', async () => {
    const launchedAtMs = Date.now();
    const { pid } = await startIdleProcess('daemon', 'start-sync');
    const spawnedAtMs = Date.now();

    const identity = await readProcessIdentity(pid!);

    expect(identity.status).toBe('process');
    if (identity.status !== 'process') return;
    expect(identity.commandLine).toContain(process.execPath);
    expect(identity.commandLine).toMatch(/ daemon start-sync$/);
    expect(identity.earliestStartMs).toBeLessThanOrEqual(spawnedAtMs);
    expect(identity.earliestStartMs).toBeGreaterThan(launchedAtMs - 5000);
  });

  it('finds no process for an exited PID or an invalid PID', async () => {
    child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    const pid = child.pid!;
    await once(child, 'exit');

    expect(await readProcessIdentity(pid)).toEqual({ status: 'absent' });
    expect(await readProcessIdentity(0)).toEqual({ status: 'absent' });
  });

  it.runIf(process.platform === 'linux')('finds no process for a thread ID, which kill(id, 0) accepts', async () => {
    const { pid } = await startIdleProcess();
    const threadId = await vi.waitFor(() => {
      const id = readdirSync(`/proc/${pid}/task`).map(Number).find(task => task !== pid);
      if (!id) throw new Error('no thread yet');
      return id;
    });

    expect(() => process.kill(threadId, 0)).not.toThrow();
    expect(await readProcessIdentity(threadId)).toEqual({ status: 'absent' });
  });

  it('reports that ps could not run, separately from a missing process', async () => {
    const { pid } = await startIdleProcess();
    vi.stubEnv('PATH', '/nonexistent');
    try {
      expect(await readProcessIdentity(pid!)).toEqual({ status: 'unavailable' });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('parseProcessIdentity', () => {
  it.each([
    ['   00:07 node /x/dist/index.mjs daemon start-sync\n', 7],
    ['   05:23 node /x/dist/index.mjs daemon start-sync\n', 5 * 60 + 23],
    ['01:02:03 node /x/dist/index.mjs daemon start-sync\n', 3723],
    ['  2-01:02:03 node /x/dist/index.mjs daemon start-sync\n', 2 * 86400 + 3723],
    ['412-23:59:59 /Applications/Node Runtime.app/node /x/dist/index.mjs daemon start-sync\n', 412 * 86400 + 86399],
  ])('reads the elapsed time and command line in %j', (stdout, elapsedSeconds) => {
    const identity = parseProcessIdentity(stdout, 1_000_000_000_000);

    expect(identity).toEqual({
      status: 'process',
      commandLine: stdout.trim().replace(/^\S+\s+/, ''),
      earliestStartMs: 1_000_000_000_000 - (elapsedSeconds + 1) * 1000,
    });
  });

  it('does not read output that is not one process line', () => {
    expect(parseProcessIdentity('', 0)).toBeNull();
    expect(parseProcessIdentity('error: unsupported option\n', 0)).toBeNull();
  });
});
