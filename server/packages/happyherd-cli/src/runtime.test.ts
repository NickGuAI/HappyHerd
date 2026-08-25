import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ spawnSync }));

import { runHappy } from './runtime';

describe('bundled Happy runtime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    spawnSync.mockReset();
  });

  it('passes argv through unchanged and returns the native exit status', () => {
    spawnSync.mockReturnValue({ status: 23, signal: null });
    const args = ['automation', 'list', '--json'];

    expect(runHappy(args)).toBe(23);
    expect(spawnSync).toHaveBeenCalledTimes(1);
    expect(spawnSync).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringMatching(/happy\/bin\/happy\.mjs$/), ...args],
      expect.objectContaining({ stdio: 'inherit' }),
    );
  });

  it('relays native signal termination to the launcher process', () => {
    spawnSync.mockReturnValue({ status: null, signal: 'SIGTERM' });
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);

    expect(runHappy(['daemon', 'status'])).toBe(1);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  });
});
