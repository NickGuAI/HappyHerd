import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DaemonLocallyPersistedState } from '@/persistence';
import { daemonInstanceKey, maintainDaemonSessionRegistration } from './sessionRegistration';

function state(instanceId: string): DaemonLocallyPersistedState {
  return {
    pid: 10,
    httpPort: 20,
    startTime: 'now',
    startedWithCliVersion: 'test',
    instanceId,
  };
}

afterEach(() => vi.useRealTimers());

describe('daemon session re-registration', () => {
  it('uses the daemon instance id and supports legacy daemon state', () => {
    expect(daemonInstanceKey(state('daemon-a'))).toBe('daemon-a');
    expect(daemonInstanceKey({
      pid: 1,
      httpPort: 2,
      startTime: 'legacy',
      startedWithCliVersion: 'test',
    })).toBe('1:2:legacy');
  });

  it('registers only when a different daemon appears', async () => {
    vi.useFakeTimers();
    let current = state('daemon-a');
    const register = vi.fn().mockResolvedValue(true);
    const stop = maintainDaemonSessionRegistration({
      initialDaemonKey: 'daemon-a',
      readState: async () => current,
      register,
      intervalMs: 100,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(register).not.toHaveBeenCalled();

    current = state('daemon-b');
    await vi.advanceTimersByTimeAsync(100);
    expect(register).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(300);
    expect(register).toHaveBeenCalledTimes(1);
    stop();
  });

  it('keeps retrying registration without stopping the provider', async () => {
    vi.useFakeTimers();
    const register = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const stop = maintainDaemonSessionRegistration({
      initialDaemonKey: null,
      readState: async () => state('daemon-a'),
      register,
      intervalMs: 100,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(register).toHaveBeenCalledTimes(2);
    stop();
  });
});
