import { beforeEach, describe, expect, it, vi } from 'vitest';

const runHappy = vi.hoisted(() => vi.fn());

vi.mock('./runtime', () => ({ runHappy }));

import { runCli } from './cli';

describe('happyherd passthrough', () => {
  beforeEach(() => {
    runHappy.mockReset();
  });

  it.each([
    [[], 3],
    [['--help'], 5],
    [['--version'], 7],
    [['server', '--help'], 11],
    [['daemon', 'start'], 13],
    [['machine', 'list', '--json'], 17],
    [[
      'session', 'create',
      '--machine', 'workstation',
      '--path', '/srv/project',
      '--provider', 'codex',
      '--json',
    ], 19],
    [[
      'session', 'side-chat', 'create', 'parent-session',
      '--outcome', 'Deliver the bounded change',
      '--scope', 'Owned files only',
      '--dependencies', 'Parent context',
      '--write-ownership', '/srv/project/owned.ts',
      '--verification', 'Run focused tests',
      '--handoff', 'Return result and evidence',
      '--json',
    ], 21],
    [['codex', '--sandbox', 'workspace-write'], 23],
    [['--started-by', 'daemon', '--no-sandbox'], 29],
  ] as const)('forwards one invocation unchanged: %j', async (args, status) => {
    runHappy.mockReturnValue(status);

    await expect(runCli([...args])).resolves.toBe(status);
    expect(runHappy).toHaveBeenCalledOnce();
    expect(runHappy).toHaveBeenCalledWith([...args]);
  });
});
