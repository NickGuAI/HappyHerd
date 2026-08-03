import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { HappyHerdAutomationService } from './service';

let root: string;
let service: HappyHerdAutomationService | null = null;
const originalEnvironment: Record<string, string | undefined> = {};
const TEST_ENV_KEYS = [
  'HAPPYHERD_HOME_DIR',
  'HAPPYHERD_AGENTCONTEXT_ROOT',
  'HAPPYHERD_AGENTS_FILE',
  'HAPPYHERD_CLAUDE_FILE',
  'HAPPY_HOME_DIR',
] as const;

beforeAll(() => {
  for (const key of TEST_ENV_KEYS) originalEnvironment[key] = process.env[key];
});

afterAll(() => {
  for (const key of TEST_ENV_KEYS) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'happyherd-service-'));
  process.env.HAPPYHERD_HOME_DIR = root;
  process.env.HAPPYHERD_AGENTCONTEXT_ROOT = path.join(root, '.herd');
  process.env.HAPPYHERD_AGENTS_FILE = path.join(root, 'AGENTS.md');
  process.env.HAPPYHERD_CLAUDE_FILE = path.join(root, 'CLAUDE.md');
  process.env.HAPPY_HOME_DIR = path.join(root, '.happy');
  await writeFile(path.join(root, 'AGENTS.md'), '# Test');
  await mkdir(path.join(root, 'workspace'), { recursive: true });
});

afterEach(async () => {
  await service?.stop();
  service = null;
  vi.restoreAllMocks();
});

function input() {
  return {
    name: 'Daily check',
    kind: 'scheduled' as const,
    instruction: 'Review the task list.',
    schedule: '0 8 * * *',
    timezone: 'UTC',
    workspace: path.join(root, 'workspace'),
    rail: 'codex' as const,
    commanderId: null,
    status: 'paused' as const,
    maxRetries: 0,
  };
}

describe('HappyHerdAutomationService', () => {
  it('creates, pauses, resumes, and deletes durable definitions', async () => {
    service = new HappyHerdAutomationService('machine-one', vi.fn());
    await service.start();
    const created = await service.create(input());
    expect((await service.list()).automations[0]?.status).toBe('paused');
    await service.resume(created.id);
    expect((await service.list()).automations[0]?.status).toBe('active');
    await service.pause(created.id);
    await service.delete(created.id);
    expect((await service.list()).automations).toHaveLength(0);
  });

  it('runs now through the same daemon session adapter and records history', async () => {
    const spawn = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'session-one' });
    service = new HappyHerdAutomationService('machine-one', spawn);
    await service.start();
    const created = await service.create(input());
    const run = await service.runNow(created.id);
    expect(run).toMatchObject({ status: 'started', sessionId: 'session-one' });
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'machine-one',
      directory: path.join(root, 'workspace'),
      agent: 'codex',
      automation: expect.objectContaining({
        id: created.id,
        kind: 'scheduled',
        instruction: 'Review the task list.',
      }),
    }));
    expect((await service.history(created.id)).runs[0]).toMatchObject({ status: 'started' });
  });

  it('does not execute missed runs automatically after downtime', async () => {
    const spawn = vi.fn();
    service = new HappyHerdAutomationService('machine-one', spawn);
    await service.start();
    const created = await service.create({ ...input(), schedule: '* * * * *', status: 'active' });
    await service.stop();
    service = null;
    const statePath = path.join(root, '.herd', 'agentcontext', 'automations', 'happyherd', 'scheduler-state.json');
    await writeFile(statePath, JSON.stringify({
      schemaVersion: 1,
      lastSeenAt: new Date(Date.now() - 120_000).toISOString(),
    }));
    service = new HappyHerdAutomationService('machine-one', spawn);
    await service.start();
    expect(spawn).not.toHaveBeenCalled();
    expect((await service.history(created.id)).runs[0]?.status).toBe('missed');
  });

  it('records a skipped run instead of overlapping one automation', async () => {
    let release!: (result: { type: 'success'; sessionId: string }) => void;
    const spawn = vi.fn(() => new Promise<{ type: 'success'; sessionId: string }>((resolve) => { release = resolve; }));
    service = new HappyHerdAutomationService('machine-one', spawn);
    await service.start();
    const created = await service.create(input());
    const first = service.runNow(created.id);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    const overlapping = await service.runNow(created.id);
    expect(overlapping.status).toBe('skipped');
    release({ type: 'success', sessionId: 'session-one' });
    await expect(first).resolves.toMatchObject({ status: 'started' });
  });

  it('records thrown spawn failures instead of leaving a running history row', async () => {
    const spawn = vi.fn().mockRejectedValue(new Error('provider unavailable'));
    service = new HappyHerdAutomationService('machine-one', spawn);
    await service.start();
    const created = await service.create(input());
    const run = await service.runNow(created.id);
    expect(run).toMatchObject({ status: 'failed', message: 'provider unavailable' });
    expect((await service.history(created.id)).runs[0]).toMatchObject({ status: 'failed' });
  });

  it('retries only failures that prove no provider process was started', async () => {
    const spawn = vi.fn()
      .mockResolvedValueOnce({ type: 'error', errorMessage: 'no pid', retrySafe: true })
      .mockResolvedValueOnce({ type: 'success', sessionId: 'session-two' });
    service = new HappyHerdAutomationService('machine-one', spawn);
    await service.start();
    const created = await service.create({ ...input(), maxRetries: 1 });
    const run = await service.runNow(created.id);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(run).toMatchObject({ status: 'started', attempt: 2, sessionId: 'session-two' });
  });

  it('never retries ambiguous failures that may already have started a session', async () => {
    const spawn = vi.fn().mockResolvedValue({ type: 'error', errorMessage: 'webhook timeout' });
    service = new HappyHerdAutomationService('machine-one', spawn);
    await service.start();
    const created = await service.create({ ...input(), maxRetries: 3 });
    const run = await service.runNow(created.id);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(run).toMatchObject({ status: 'failed', attempt: 1, message: 'webhook timeout' });
  });

  it('enforces the selected Commander workspace', async () => {
    const commanderRoot = path.join(root, '.herd', 'commanders', 'athena');
    await mkdir(path.join(commanderRoot, 'agentcontext'), { recursive: true });
    await writeFile(path.join(commanderRoot, 'COMMANDER.md'), `---\nidentity_and_scope:\n  name: Athena\n  commander_id: athena\n  workspace: ${path.join(root, 'workspace')}\n---\n`);
    service = new HappyHerdAutomationService('machine-one', vi.fn());
    await service.start();
    await expect(service.create({
      ...input(),
      commanderId: 'athena',
      workspace: path.join(root, 'other-workspace'),
    })).rejects.toThrow(/bound to workspace/);
    await expect(service.create({
      ...input(),
      commanderId: 'athena',
    })).resolves.toMatchObject({ commanderId: 'athena' });
  });
});
