import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawnHappyHerdCLI: vi.fn(), acquireDaemonLock: vi.fn() }));
vi.mock('@/utils/spawnHappyHerdCLI', () => ({ spawnHappyHerdCLI: mocks.spawnHappyHerdCLI }));
vi.mock('@/ui/logger', () => ({ logger: {
  debug: vi.fn(), debugLargeJson: vi.fn(), info: vi.fn(), warn: vi.fn(), logFilePath: '/tmp/busy-daemon-test.log',
} }));
vi.mock('@/persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/persistence')>(),
  acquireDaemonLock: mocks.acquireDaemonLock,
}));

import { configuration } from '@/configuration';
import { runDoctorDaemon } from '@/ui/doctor';
import { checkIfDaemonRunningAndCleanupStaleState, stopDaemon } from './controlClient';
import { ensureDaemonRunning } from './ensureDaemonRunning';
import { startDaemon } from './run';
import type { DaemonReadinessObservation } from './startupReadiness';

// A process that accepts control connections and never answers them, the way
// a daemon busy re-registering its sessions after a restart does.
const unansweredServer = "require('node:http').createServer(() => {}).listen(0, '127.0.0.1', function () { console.log(this.address().port); });";
const answeringServer = "require('node:http').createServer((q, s) => s.end('{}')).listen(0, '127.0.0.1', function () { console.log(this.address().port); });";
const fixtures: ChildProcess[] = [];

async function startProcess(args: string[], server = unansweredServer): Promise<{ pid: number; port: number; child: ChildProcess }> {
  const child = spawn(process.execPath, ['-e', server, ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
  fixtures.push(child);
  const [port] = await once(createInterface({ input: child.stdout! }), 'line') as [string];
  return { pid: child.pid!, port: Number(port), child };
}

/** A thread of a process, other than its main thread (Linux). */
async function threadOf(pid: number): Promise<number> {
  return vi.waitFor(() => {
    const id = readdirSync(`/proc/${pid}/task`).map(Number).find(task => task !== pid);
    if (!id) throw new Error('no thread yet');
    return id;
  });
}

/** A port on which nothing listens, like a daemon's old port after a reboot. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

/** Whether the process is still running after `ms`, or the signal that ended it. */
async function stateAfter(child: ChildProcess, ms: number): Promise<string> {
  if (child.exitCode !== null || child.signalCode !== null) return `ended ${child.signalCode ?? child.exitCode}`;
  const ended = once(child, 'exit').then(([code, signal]) => `ended ${signal ?? code}`);
  return Promise.race([ended, new Promise<string>(resolve => setTimeout(() => resolve('running'), ms))]);
}

function recordDaemon(pid: number, httpPort: number, instanceId = 'recorded-daemon', version = configuration.currentCliVersion): void {
  writeFileSync(configuration.daemonStateFile, JSON.stringify({
    pid, httpPort, startTime: new Date().toLocaleString(), startedWithCliVersion: version, instanceId,
  }));
  writeFileSync(configuration.daemonLockFile, String(pid));
}

function recordedState(): { pid: number; instanceId: string } {
  return JSON.parse(readFileSync(configuration.daemonStateFile, 'utf-8'));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Keep the real request and abort path, shortened from 5 seconds.
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => timeout(200));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const child of fixtures.splice(0)) child.kill('SIGKILL');
  rmSync(configuration.daemonStateFile, { force: true });
  rmSync(configuration.daemonLockFile, { force: true });
});

describe('a daemon too busy to answer within the request timeout', () => {
  it('is reported as running by `daemon status`, and its state and lock remain', async () => {
    const daemon = await startProcess(['daemon', 'start-sync']);
    recordDaemon(daemon.pid, daemon.port);

    await runDoctorDaemon();

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('Daemon is running');
    expect(output).toContain(`PID:     ${daemon.pid}`);
    expect(recordedState()).toMatchObject({ pid: daemon.pid, instanceId: 'recorded-daemon' });
    expect(readFileSync(configuration.daemonLockFile, 'utf-8')).toBe(String(daemon.pid));
  });

  it('gets no second daemon from session launches, automation commands or `daemon start`', async () => {
    const daemon = await startProcess(['daemon', 'start-sync']);
    recordDaemon(daemon.pid, daemon.port);

    // Session launches and `happyherd automation` commands ensure the daemon first.
    await ensureDaemonRunning();
    expect(mocks.spawnHappyHerdCLI).not.toHaveBeenCalled();

    // `happyherd daemon start` launches `daemon start-sync`, which runs this check.
    vi.spyOn(process, 'on').mockImplementation((() => process) as typeof process.on);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    await expect(startDaemon()).rejects.toThrow('process.exit(0)');
    expect(exit).toHaveBeenCalledOnce();
    expect(mocks.acquireDaemonLock).not.toHaveBeenCalled();

    expect(recordedState()).toMatchObject({ pid: daemon.pid, instanceId: 'recorded-daemon' });
    expect(readFileSync(configuration.daemonLockFile, 'utf-8')).toBe(String(daemon.pid));
  });
});

describe('a recorded daemon that is gone', () => {
  let started: { pid: number; port: number };

  beforeEach(async () => {
    // The daemon that a spawn starts records itself in the state file and answers.
    started = await startProcess(['daemon', 'start-sync'], answeringServer);
    mocks.spawnHappyHerdCLI.mockImplementation(() => {
      writeFileSync(configuration.daemonStateFile, JSON.stringify({
        pid: started.pid, httpPort: started.port, startTime: new Date().toLocaleString(),
        startedWithCliVersion: configuration.currentCliVersion, instanceId: 'started-daemon',
      }));
      return { unref: vi.fn() };
    });
  });

  async function expectClearedAndStarted(): Promise<void> {
    await ensureDaemonRunning();

    expect(mocks.spawnHappyHerdCLI).toHaveBeenCalledOnce();
    expect(mocks.spawnHappyHerdCLI).toHaveBeenCalledWith(['daemon', 'start-sync'], expect.objectContaining({ detached: true }));
    expect(recordedState()).toMatchObject({ pid: started.pid, instanceId: 'started-daemon' });
    expect(existsSync(configuration.daemonLockFile)).toBe(false);
  }

  it('is cleared and replaced when its process exited', async () => {
    const daemon = await startProcess(['daemon', 'start-sync']);
    recordDaemon(daemon.pid, daemon.port);
    const child = fixtures.find(fixture => fixture.pid === daemon.pid)!;
    child.kill('SIGKILL');
    await once(child, 'exit');

    await expectClearedAndStarted();
  });

  it('is cleared and replaced when another program now holds its PID', async () => {
    const other = await startProcess([]);
    recordDaemon(other.pid, other.port);

    await expectClearedAndStarted();
  });

  it('is cleared and replaced when a process started after its last state write holds its PID', async () => {
    const later = await startProcess(['daemon', 'start-sync']);
    recordDaemon(later.pid, later.port);
    const lastWrite = new Date(Date.now() - 60_000);
    utimesSync(configuration.daemonStateFile, lastWrite, lastWrite);

    await expectClearedAndStarted();
  });

  it.runIf(process.platform === 'linux')('is cleared and replaced when its PID now names a thread of another program', async () => {
    const other = await startProcess([]);
    recordDaemon(await threadOf(other.pid), await closedPort());

    await expectClearedAndStarted();
    expect(await stateAfter(other.child, 100)).toBe('running');
  });
});

describe('a recorded PID that is not identified as the daemon is never signalled', () => {
  it('by `daemon stop` when another program now holds it', { timeout: 15_000 }, async () => {
    const other = await startProcess([]);
    recordDaemon(other.pid, await closedPort());

    await stopDaemon();

    expect(await stateAfter(other.child, 500)).toBe('running');
  });

  it.runIf(process.platform === 'linux')('by `daemon stop` when it names a thread of another program', { timeout: 15_000 }, async () => {
    const other = await startProcess([]);
    recordDaemon(await threadOf(other.pid), await closedPort());

    await stopDaemon();

    expect(await stateAfter(other.child, 500)).toBe('running');
  });

  it('by `daemon stop` when ps cannot run, even for a process that looks like the daemon', { timeout: 15_000 }, async () => {
    const daemon = await startProcess(['daemon', 'start-sync']);
    recordDaemon(daemon.pid, daemon.port);
    vi.stubEnv('PATH', '/nonexistent');
    try {
      await stopDaemon();
    } finally {
      vi.unstubAllEnvs();
    }

    expect(await stateAfter(daemon.child, 500)).toBe('running');
  });

  it.runIf(process.platform === 'linux')('by an upgraded daemon start when the old PID names a thread of another program', { timeout: 15_000 }, async () => {
    const other = await startProcess([]);
    recordDaemon(await threadOf(other.pid), await closedPort(), 'old-daemon', '0.0.0-old');
    mocks.acquireDaemonLock.mockResolvedValue(null);
    vi.spyOn(process, 'on').mockImplementation((() => process) as typeof process.on);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);

    await expect(startDaemon()).rejects.toThrow('process.exit(1)');

    expect(await stateAfter(other.child, 500)).toBe('running');
    expect(existsSync(configuration.daemonStateFile)).toBe(false);
  });

  it('while `daemon stop` still force-stops the identified daemon when it does not answer', { timeout: 15_000 }, async () => {
    const daemon = await startProcess(['daemon', 'start-sync']);
    recordDaemon(daemon.pid, daemon.port);

    await stopDaemon();

    expect(await stateAfter(daemon.child, 2000)).toBe('ended SIGKILL');
  });
});

describe('a recorded PID when ps cannot run', () => {
  it('keeps the state with an explicit unverified outcome and starts no daemon', async () => {
    const other = await startProcess([]);
    recordDaemon(other.pid, await closedPort());
    const observations: DaemonReadinessObservation[] = [];
    vi.stubEnv('PATH', '/nonexistent');
    try {
      expect(await checkIfDaemonRunningAndCleanupStaleState(observation => observations.push(observation))).toBe(true);
      await ensureDaemonRunning();
    } finally {
      vi.unstubAllEnvs();
    }

    expect(observations).toEqual([{ reason: 'accepted-without-process-identity', ready: true }]);
    expect(mocks.spawnHappyHerdCLI).not.toHaveBeenCalled();
    expect(recordedState()).toMatchObject({ pid: other.pid, instanceId: 'recorded-daemon' });
  });
});
