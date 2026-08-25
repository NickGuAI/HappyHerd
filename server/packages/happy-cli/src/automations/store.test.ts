import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { HappyHerdAutomationStore } from './store';

let root: string;
let originalRoot: string | undefined;

beforeAll(() => { originalRoot = process.env.HAPPY_HOME_DIR; });
afterAll(() => {
  if (originalRoot === undefined) delete process.env.HAPPY_HOME_DIR;
  else process.env.HAPPY_HOME_DIR = originalRoot;
});

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'happyherd-automation-'));
  process.env.HAPPY_HOME_DIR = path.join(root, '.happyherd');
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
    const automation = await store.create('machine-one', { ...input(), tags: [' Project Beacon ', 'Operations'] });
    expect(automation).toMatchObject({ schemaVersion: 2, tags: ['Operations', 'Project Beacon'] });
    expect(await store.list('machine-one')).toMatchObject({
      definitionSchemaVersion: 2,
      automations: [{ id: automation.id, tags: ['Operations', 'Project Beacon'] }],
    });
    expect((await store.list('machine-two')).automations).toHaveLength(0);
    await store.appendRun({
      id: crypto.randomUUID(),
      automationId: automation.id,
      source: 'manual',
      scheduledFor: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: 'started',
      attempt: 1,
      sessionId: 'session-one',
      message: null,
    });
    expect(await store.history(automation.id)).toHaveLength(1);
  });

  it('never evicts a nonterminal run when bounded history fills', async () => {
    const store = new HappyHerdAutomationStore();
    const automation = await store.create('machine-one', input());
    const active = {
      id: crypto.randomUUID(),
      automationId: automation.id,
      source: 'manual' as const,
      scheduledFor: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: 'started' as const,
      attempt: 1,
      sessionId: 'active-session',
      message: null,
    };
    await store.appendRun(active);
    for (let index = 0; index < 55; index += 1) {
      const now = new Date(Date.now() + index).toISOString();
      await store.appendRun({
        id: crypto.randomUUID(),
        automationId: automation.id,
        source: 'schedule',
        scheduledFor: now,
        startedAt: now,
        finishedAt: now,
        status: 'skipped',
        attempt: 1,
        sessionId: null,
        message: 'Previous run is active.',
      });
    }
    expect(await store.history(automation.id)).toHaveLength(50);
    expect(await store.activeRun(automation.id)).toMatchObject({ id: active.id, sessionId: 'active-session' });
  });

  it('allows only owned lifecycle transitions for an existing run', async () => {
    const store = new HappyHerdAutomationStore();
    const automation = await store.create('machine-one', input());
    const startedAt = new Date().toISOString();
    const started = {
      id: crypto.randomUUID(),
      automationId: automation.id,
      source: 'manual' as const,
      scheduledFor: startedAt,
      startedAt,
      finishedAt: null,
      status: 'started' as const,
      attempt: 1,
      sessionId: 'session-one',
      message: null,
    };
    await store.appendRun(started);
    await store.appendRun({
      ...started,
      status: 'completed',
      finishedAt: new Date().toISOString(),
    });
    expect(await store.activeRun(automation.id)).toBeNull();
    await expect(store.appendRun(started)).rejects.toThrow(/cannot transition from completed to started/);
  });

  it('normalizes pre-lifecycle started rows into persistent active runs', async () => {
    const store = new HappyHerdAutomationStore();
    const automation = await store.create('machine-one', input());
    const now = new Date().toISOString();
    const legacyRun = {
      id: crypto.randomUUID(),
      automationId: automation.id,
      source: 'schedule',
      scheduledFor: now,
      startedAt: now,
      finishedAt: now,
      status: 'started',
      attempt: 1,
      sessionId: 'legacy-session',
      message: 'Session accepted by the daemon.',
    };
    const runFile = path.join(
      root,
      '.happyherd',
      'agentcontext',
      'automations',
      'happyherd',
      automation.id,
      'runs.json',
    );
    await writeFile(runFile, JSON.stringify([legacyRun]));
    expect(await store.activeRun(automation.id)).toMatchObject({
      id: legacyRun.id,
      status: 'started',
      finishedAt: null,
    });
  });

  it('lists only manifests from its native namespace', async () => {
    const parentRoot = path.join(root, '.happyherd', 'agentcontext', 'automations');
    await mkdir(parentRoot, { recursive: true });
    await writeFile(path.join(parentRoot, 'unmanaged.json'), '{}');
    const store = new HappyHerdAutomationStore();
    await store.create('machine-one', input());
    const result = await store.list('machine-one');
    expect(result).toEqual({
      definitionSchemaVersion: 2,
      automations: [expect.objectContaining({ machineId: 'machine-one' })],
    });
  });

  it('reads strict v1 manifests as untagged and writes v2 on mutation', async () => {
    const store = new HappyHerdAutomationStore();
    const automation = await store.create('machine-one', input());
    const manifest = path.join(
      root,
      '.happyherd',
      'agentcontext',
      'automations',
      'happyherd',
      automation.id,
      'manifest.json',
    );
    const { tags: _tags, schemaVersion: _schemaVersion, ...fields } = JSON.parse(await readFile(manifest, 'utf8'));
    await writeFile(manifest, JSON.stringify({ schemaVersion: 1, ...fields }));

    const [legacy] = (await store.list('machine-one')).automations;
    expect(legacy).toMatchObject({ id: automation.id, schemaVersion: 2, tags: [] });

    await store.recordSchedule(automation.id, '2026-08-21T08:00:00.000Z');
    expect(JSON.parse(await readFile(manifest, 'utf8'))).toMatchObject({
      schemaVersion: 2,
      tags: [],
    });

    await store.update(automation.id, { tags: [' Zeta ', 'Alpha'] });
    expect(JSON.parse(await readFile(manifest, 'utf8'))).toMatchObject({
      schemaVersion: 2,
      tags: ['Alpha', 'Zeta'],
    });

    await store.update(automation.id, { tags: [] });
    expect(JSON.parse(await readFile(manifest, 'utf8'))).toMatchObject({
      schemaVersion: 2,
      tags: [],
    });
  });

  it('loads all 23 legacy definitions and clears their removed timeout field', async () => {
    const store = new HappyHerdAutomationStore();
    const automations = [];
    for (let index = 0; index < 23; index += 1) {
      automations.push(await store.create('machine-one', {
        ...input(),
        name: `Legacy automation ${index + 1}`,
      }));
    }

    for (const [index, automation] of automations.entries()) {
      const manifest = path.join(
        root,
        '.happyherd',
        'agentcontext',
        'automations',
        'happyherd',
        automation.id,
        'manifest.json',
      );
      const definition = JSON.parse(await readFile(manifest, 'utf8'));
      await writeFile(manifest, JSON.stringify({
        ...definition,
        timeoutMinutes: index % 2 === 0 ? 60 : null,
      }));
    }

    const listed = await store.list('machine-one');
    expect(listed.automations).toHaveLength(23);
    for (const automation of automations) {
      const manifest = path.join(
        root,
        '.happyherd',
        'agentcontext',
        'automations',
        'happyherd',
        automation.id,
        'manifest.json',
      );
      expect(JSON.parse(await readFile(manifest, 'utf8'))).not.toHaveProperty('timeoutMinutes');
    }
  });

  it('rejects tags that collide after trimming', async () => {
    const store = new HappyHerdAutomationStore();
    await expect(store.create('machine-one', {
      ...input(),
      tags: ['Project Beacon', ' Project Beacon '],
    })).rejects.toThrow(/Duplicate/);
    expect((await store.list('machine-one')).automations).toHaveLength(0);
  });

  it('rejects unsafe schedules without creating an artifact', async () => {
    const store = new HappyHerdAutomationStore();
    await expect(store.create('machine-one', { ...input(), schedule: '*/0 * * * *' })).rejects.toThrow();
    expect((await store.list('machine-one')).automations).toHaveLength(0);
  });
});
