import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), clear: vi.fn() }));
vi.mock('@/persistence', () => ({ readDaemonState: mocks.read, clearDaemonState: mocks.clear }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
import { checkIfDaemonRunningAndCleanupStaleState } from './controlClient';
import type { DaemonReadinessObservation } from './startupReadiness';

const cases = [
  { name: 'unavailable state', state: null, reason: 'state-unavailable', ready: false, cleanup: false, kill: 0, fetch: 0 },
  { name: 'process check throws', state: { pid: 4321, httpPort: 39001 }, reason: 'process-check-failed', ready: false, cleanup: true, kill: 1, fetch: 0 },
  { name: 'HTTP succeeds', state: { pid: 4321, httpPort: 39001 }, reason: 'http-ok', ready: true, cleanup: false, kill: 1, fetch: 1 },
  { name: 'HTTP throws', state: { pid: 4321, httpPort: 39001 }, reason: 'http-request-failed', ready: false, cleanup: true, kill: 1, fetch: 1 },
  { name: 'no port retains acceptance', state: { pid: 4321 }, reason: 'accepted-without-port', ready: true, cleanup: false, kill: 1, fetch: 0 },
  { name: 'HTTP non-OK retains acceptance', state: { pid: 4321, httpPort: 39001 }, reason: 'accepted-after-http-non-ok', ready: true, cleanup: false, kill: 1, fetch: 1 },
] as const;

beforeEach(() => { mocks.read.mockReset(); mocks.clear.mockReset(); mocks.clear.mockResolvedValue(undefined); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe.each(cases)('readiness observation: $name', row => {
  it.each(['absent', 'capture', 'throwing'] as const)('preserves the actual branch with %s observer', async mode => {
    const order: string[] = [];
    const secret = new Error('sentinel-token https://private.invalid/state');
    mocks.read.mockImplementation(async () => { order.push('read'); return row.state; });
    mocks.clear.mockImplementation(async () => { order.push('cleanup'); });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      order.push('kill');
      if (row.reason === 'process-check-failed') throw secret;
      return true;
    });
    const fetch = vi.fn(async () => {
      order.push('fetch');
      if (row.reason === 'http-request-failed') throw secret;
      return { ok: row.reason === 'http-ok' };
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
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledTimes(row.kill);
    if (row.kill) expect(kill).toHaveBeenCalledWith(4321, 0);
    expect(fetch).toHaveBeenCalledTimes(row.fetch);
    expect(timeout).toHaveBeenCalledTimes(row.fetch);
    if (row.fetch) {
      expect(timeout).toHaveBeenCalledWith(5000);
      expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:39001/list', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal,
      });
    }
    expect(mocks.clear).toHaveBeenCalledTimes(row.cleanup ? 1 : 0);
    expect(order).toEqual(['read', ...(row.kill ? ['kill'] : []), ...(row.fetch ? ['fetch'] : []),
      ...(row.cleanup ? ['cleanup'] : []), ...(mode === 'absent' ? [] : ['observe'])]);
    expect(observations).toEqual(mode === 'absent' ? [] : [{ reason: row.reason, ready: row.ready }]);
    expect(JSON.stringify(observations)).not.toContain('sentinel');
  });
});

it.each(['process', 'http'])('retains cleanup error swallowing on the %s branch without claiming cleanup succeeded', async branch => {
  mocks.read.mockResolvedValue({ pid: 4321, httpPort: 39001 });
  mocks.clear.mockRejectedValue(new Error('cleanup sentinel'));
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
  expect(mocks.clear).not.toHaveBeenCalled(); expect(observer).not.toHaveBeenCalled();
});
