import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { HappyHerdAutomationStore } from './store';

let root: string;
let originalRoot: string | undefined;

beforeAll(() => { originalRoot = process.env.HAPPYHERD_AGENTCONTEXT_ROOT; });
afterAll(() => {
  if (originalRoot === undefined) delete process.env.HAPPYHERD_AGENTCONTEXT_ROOT;
  else process.env.HAPPYHERD_AGENTCONTEXT_ROOT = originalRoot;
});

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'happyherd-automation-'));
  process.env.HAPPYHERD_AGENTCONTEXT_ROOT = path.join(root, '.herd');
});

function input() {
  return {
    name: 'Heartbeat',
    kind: 'heartbeat' as const,
    instruction: 'Check the active task list.',
    schedule: '*/15 * * * *',
    timezone: 'UTC',
    workspace: '/srv/app',
    rail: 'codex' as const,
    commanderId: null,
    status: 'active' as const,
    maxRetries: 1,
  };
}

describe('HappyHerdAutomationStore', () => {
  it('persists machine-scoped definitions and bounded history', async () => {
    const store = new HappyHerdAutomationStore();
    const automation = await store.create('machine-one', input());
    expect((await store.list('machine-one')).automations).toHaveLength(1);
    expect((await store.list('machine-two')).automations).toHaveLength(0);
    await store.appendRun({
      id: crypto.randomUUID(),
      automationId: automation.id,
      source: 'manual',
      scheduledFor: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'started',
      attempt: 1,
      sessionId: 'session-one',
      message: null,
    });
    expect(await store.history(automation.id)).toHaveLength(1);
  });

  it('keeps legacy Herd automation artifacts outside its namespace', async () => {
    const legacyRoot = path.join(root, '.herd', 'agentcontext', 'automations');
    await mkdir(legacyRoot, { recursive: true });
    await writeFile(path.join(legacyRoot, 'legacy-herd.json'), '{}');
    const store = new HappyHerdAutomationStore();
    await store.create('machine-one', input());
    expect((await store.list('machine-one')).legacyCount).toBe(1);
  });

  it('rejects unsafe schedules without creating an artifact', async () => {
    const store = new HappyHerdAutomationStore();
    await expect(store.create('machine-one', { ...input(), schedule: '*/0 * * * *' })).rejects.toThrow();
    expect((await store.list('machine-one')).automations).toHaveLength(0);
  });
});
