import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalHappyHerdHomeDir = process.env.HAPPYHERD_HOME_DIR;
const originalLegacyRoot = process.env.HAPPYHERD_AGENTCONTEXT_ROOT;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'happyherd-context-root-'));
  process.env.HAPPYHERD_HOME_DIR = path.join(root, '.happyherd');
  vi.resetModules();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (originalHappyHerdHomeDir === undefined) delete process.env.HAPPYHERD_HOME_DIR;
  else process.env.HAPPYHERD_HOME_DIR = originalHappyHerdHomeDir;
  if (originalLegacyRoot === undefined) delete process.env.HAPPYHERD_AGENTCONTEXT_ROOT;
  else process.env.HAPPYHERD_AGENTCONTEXT_ROOT = originalLegacyRoot;
  vi.resetModules();
  await rm(root, { recursive: true, force: true });
});

describe('AgentContext root', () => {
  it('seeds a tilde-configured home using the same expansion as the CLI', async () => {
    vi.stubEnv('HOME', root);
    process.env.HAPPYHERD_HOME_DIR = '~/custom home';
    const { agentContextRoot, prepareCommanderContext } = await import('./commanderContext');
    const expected = path.join(root, 'custom home');
    expect(agentContextRoot()).toBe(expected);
    const bundle = await prepareCommanderContext(null, root);
    expect(bundle.globalAgentsPath).toBe(path.join(expected, 'AGENTS.md'));
    expect(await readFile(path.join(expected, 'agentcontext', 'README.md'), 'utf8')).toContain('shared knowledge');
    await rm(path.dirname(bundle.bundlePath), { recursive: true, force: true });
  });

  it('uses the configured HappyHerd home by default', async () => {
    const { agentContextRoot } = await import('./commanderContext');

    expect(agentContextRoot()).toBe(path.join(root, '.happyherd'));
  });

  it('ignores the retired split AgentContext root override', async () => {
    process.env.HAPPYHERD_AGENTCONTEXT_ROOT = path.join(root, 'external-context');

    const { agentContextRoot } = await import('./commanderContext');

    expect(agentContextRoot()).toBe(path.join(root, '.happyherd'));
  });
});
