import { rmSync, utimesSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), clear: vi.fn(), identity: vi.fn() }));
vi.mock('@/persistence', () => ({ readDaemonState: mocks.read, clearDaemonState: mocks.clear }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('./processStatus', () => ({ readProcessIdentity: mocks.identity }));
import { configuration } from '@/configuration';
import { checkIfDaemonRunningAndCleanupStaleState } from './controlClient';
import type { ProcessIdentity } from './processStatus';
import type { DaemonReadinessObservation } from './startupReadiness';

// When the recorded daemon last wrote its state file.
const stateWrittenAtMs = Date.UTC(2026, 10, 21, 23, 3, 0);
const daemonCommand = 'node --no-warnings --no-deprecation /opt/happyherd/dist/index.mjs daemon start-sync';
const earlierDaemon: ProcessIdentity = { status: 'process', commandLine: daemonCommand, earliestStartMs: stateWrittenAtMs - 60_000 };
const otherProgram: ProcessIdentity = { status: 'process', commandLine: '/usr/sbin/sshd -D', earliestStartMs: stateWrittenAtMs - 60_000 };
const laterDaemon: ProcessIdentity = { status: 'process', commandLine: daemonCommand, earliestStartMs: stateWrittenAtMs + 60_000 };

type Row = {
  name: string; state: { pid: number; httpPort?: number; instanceId?: string } | null;
  http?: 'ok' | 'non-ok' | 'throws'; identity?: ProcessIdentity;
  reason: DaemonReadinessObservation['reason']; ready: boolean; cleanup: boolean; kill: number;
};
const live = { pid: 4321, httpPort: 39001, instanceId: 'recorded-daemon' };
const cases: Row[] = [
  { name: 'unavailable state', state: null, reason: 'state-unavailable', ready: false, cleanup: false, kill: 0 },
  { name: 'process check throws', state: live, reason: 'process-check-failed', ready: false, cleanup: true, kill: 1 },
  { name: 'HTTP succeeds', state: live, http: 'ok', reason: 'http-ok', ready: true, cleanup: false, kill: 1 },
  { name: 'HTTP throws while the OS shows the daemon', state: live, http: 'throws', identity: earlierDaemon,
    reason: 'accepted-after-http-request-failed', ready: true, cleanup: false, kill: 1 },
  // On Linux, a thread ID of another process passes kill(pid, 0) but ps finds no process.
  { name: 'HTTP throws while ps finds no such process', state: live, http: 'throws', identity: { status: 'absent' },
    reason: 'http-request-failed', ready: false, cleanup: true, kill: 1 },
  { name: 'HTTP throws while ps cannot run', state: live, http: 'throws', identity: { status: 'unavailable' },
    reason: 'accepted-without-process-identity', ready: true, cleanup: false, kill: 1 },
  { name: 'HTTP throws while another program holds the PID', state: live, http: 'throws', identity: otherProgram,
    reason: 'http-request-failed', ready: false, cleanup: true, kill: 1 },
  { name: 'HTTP throws while a process started after the state write holds the PID', state: live, http: 'throws',
    identity: laterDaemon, reason: 'http-request-failed', ready: false, cleanup: true, kill: 1 },
  { name: 'no port retains acceptance', state: { pid: 4321 }, reason: 'accepted-without-port', ready: true, cleanup: false, kill: 1 },
  { name: 'HTTP non-OK retains acceptance', state: live, http: 'non-ok', reason: 'accepted-after-http-non-ok', ready: true, cleanup: false, kill: 1 },
];

beforeEach(() => {
  mocks.read.mockReset(); mocks.clear.mockReset(); mocks.identity.mockReset();
  mocks.clear.mockResolvedValue(undefined);
  writeFileSync(configuration.daemonStateFile, '{}');
  utimesSync(configuration.daemonStateFile, new Date(stateWrittenAtMs), new Date(stateWrittenAtMs));
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  rmSync(configuration.daemonStateFile, { force: true });
});

describe.each(cases)('readiness observation: $name', row => {
  it.each(['absent', 'capture', 'throwing'] as const)('preserves the actual branch with %s observer', async mode => {
    const order: string[] = [];
    const secret = new Error('sentinel-token https://private.invalid/state');
    mocks.read.mockImplementation(async () => { order.push('read'); return row.state; });
    mocks.clear.mockImplementation(async () => { order.push('cleanup'); });
    mocks.identity.mockImplementation(async () => { order.push('identity'); return row.identity; });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      order.push('kill');
      if (row.reason === 'process-check-failed') throw secret;
      return true;
    });
    const fetch = vi.fn(async () => {
      order.push('fetch');
      if (row.http === 'throws') throw secret;
      return { ok: row.http === 'ok' };
    });
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    const observations: DaemonReadinessObservation[] = [];
    const observer = mode === 'absent' ? undefined : (observation: DaemonReadinessObservation) => {
      order.push('observe'); observations.push(observation);
      if (mode === 'throwing') throw secret;
    };

    expect(await checkIfDaemonRunningAndCleanupStaleState(observer)).toBe(row.ready);
    const fetched = row.http ? 1 : 0;
    const identified = row.identity !== undefined ? 1 : 0;
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledTimes(row.kill);
    if (row.kill) expect(kill).toHaveBeenCalledWith(4321, 0);
    expect(fetch).toHaveBeenCalledTimes(fetched);
    expect(timeout).toHaveBeenCalledTimes(fetched);
    if (fetched) {
      expect(timeout).toHaveBeenCalledWith(5000);
      expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:39001/list', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal,
      });
    }
    expect(mocks.identity).toHaveBeenCalledTimes(identified);
    if (identified) expect(mocks.identity).toHaveBeenCalledWith(4321);
    expect(mocks.clear).toHaveBeenCalledTimes(row.cleanup ? 1 : 0);
    // Cleanup removes only the files that still record the daemon that was read.
    if (row.cleanup) expect(mocks.clear).toHaveBeenCalledWith({ pid: 4321, instanceId: 'recorded-daemon' });
    expect(order).toEqual(['read', ...(row.kill ? ['kill'] : []), ...(fetched ? ['fetch'] : []),
      ...(identified ? ['identity'] : []), ...(row.cleanup ? ['cleanup'] : []), ...(mode === 'absent' ? [] : ['observe'])]);
    expect(observations).toEqual(mode === 'absent' ? [] : [{ reason: row.reason, ready: row.ready }]);
    expect(JSON.stringify(observations)).not.toContain('sentinel');
  });
});

it.each(['process', 'http'])('retains cleanup error swallowing on the %s branch without claiming cleanup succeeded', async branch => {
  mocks.read.mockResolvedValue({ pid: 4321, httpPort: 39001 });
  mocks.clear.mockRejectedValue(new Error('cleanup sentinel'));
  mocks.identity.mockResolvedValue(otherProgram);
  vi.spyOn(process, 'kill').mockImplementation(() => {
    if (branch === 'process') throw new Error('process sentinel');
    return true;
  });
  const fetch = vi.fn().mockRejectedValue(new Error('HTTP sentinel'));
  vi.stubGlobal('fetch', fetch);
  const observer = vi.fn();
  expect(await checkIfDaemonRunningAndCleanupStaleState(observer)).toBe(false);
  expect(mocks.clear).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(branch === 'http' ? 1 : 0);
  expect(observer).toHaveBeenCalledWith({ reason: branch === 'process' ? 'process-check-failed' : 'http-request-failed', ready: false });
});

it('preserves the original rejected state read and does not probe or notify', async () => {
  const original = new Error('original read failure');
  mocks.read.mockRejectedValue(original);
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const observer = vi.fn();
  await expect(checkIfDaemonRunningAndCleanupStaleState(observer)).rejects.toBe(original);
  expect(kill).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  expect(mocks.identity).not.toHaveBeenCalled();
  expect(mocks.clear).not.toHaveBeenCalled(); expect(observer).not.toHaveBeenCalled();
});
