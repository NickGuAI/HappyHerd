import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalHappyHomeDir = process.env.HAPPY_HOME_DIR;
const originalAgentContextRoot = process.env.HAPPYHERD_AGENTCONTEXT_ROOT;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'happyherd-context-root-'));
  process.env.HAPPY_HOME_DIR = path.join(root, '.happyherd');
  delete process.env.HAPPYHERD_AGENTCONTEXT_ROOT;
  vi.resetModules();
});

afterEach(() => {
  if (originalHappyHomeDir === undefined) delete process.env.HAPPY_HOME_DIR;
  else process.env.HAPPY_HOME_DIR = originalHappyHomeDir;
  if (originalAgentContextRoot === undefined) delete process.env.HAPPYHERD_AGENTCONTEXT_ROOT;
  else process.env.HAPPYHERD_AGENTCONTEXT_ROOT = originalAgentContextRoot;
  vi.resetModules();
});

describe('AgentContext root', () => {
  it('uses the configured HappyHerd home by default', async () => {
    const { agentContextRoot } = await import('./commanderContext');

    expect(agentContextRoot()).toBe(path.join(root, '.happyherd'));
  });

  it('honors an explicit AgentContext root override', async () => {
    process.env.HAPPYHERD_AGENTCONTEXT_ROOT = path.join(root, 'external-context');

    const { agentContextRoot } = await import('./commanderContext');

    expect(agentContextRoot()).toBe(path.join(root, 'external-context'));
  });
});
