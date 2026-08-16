import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { HappyHerdAutomationService } from './service';

let root: string;
let service: HappyHerdAutomationService | null = null;
const originalEnvironment: Record<string, string | undefined> = {};
const TEST_ENV_KEYS = [
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
  process.env.HAPPY_HOME_DIR = path.join(root, '.happyherd');
  await mkdir(process.env.HAPPY_HOME_DIR, { recursive: true });
  await writeFile(path.join(process.env.HAPPY_HOME_DIR, 'AGENTS.md'), '# Test');
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
    expect(run).toMatchObject({ status: 'started', sessionId: 'session-one', finishedAt: null });
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'machine-one',
      directory: path.join(root, 'workspace'),
      agent: 'codex',
      effortLevel: 'max',
      automation: expect.objectContaining({
        id: created.id,
        runId: run.id,
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
    const statePath = path.join(root, '.happyherd', 'agentcontext', 'automations', 'happyherd', 'scheduler-state.json');
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
    await expect(first).resolves.toMatchObject({ status: 'started', finishedAt: null });
    await expect(service.runNow(created.id)).resolves.toMatchObject({ status: 'skipped' });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('keeps ambiguous thrown spawn failures active for process reconciliation', async () => {
    const spawn = vi.fn().mockRejectedValue(new Error('provider unavailable'));
    service = new HappyHerdAutomationService('machine-one', spawn);
    await service.start();
    const created = await service.create(input());
    const run = await service.runNow(created.id);
    expect(run).toMatchObject({ status: 'running', finishedAt: null });
    expect(run.message).toContain('provider unavailable');
    expect((await service.history(created.id)).runs[0]).toMatchObject({ status: 'running' });
    await expect(service.confirmRunDidNotStart({
      automationId: created.id,
      runId: run.id,
      message: 'Process reconciliation confirmed that no provider exists.',
    })).resolves.toMatchObject({ status: 'failed', sessionId: null });
    const recycled = await service.runNow(created.id);
    expect(recycled.id).not.toBe(run.id);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('returns the terminal row when OS exit is confirmed before the spawn webhook', async () => {
    let spawnCount = 0;
    const spawn = vi.fn(async (options: { automation: { id: string; runId: string } }) => {
      spawnCount += 1;
      if (spawnCount === 1) {
        await service!.confirmRunDidNotStart({
          automationId: options.automation.id,
          runId: options.automation.runId,
          message: 'OS confirmed provider exit before webhook.',
        });
        return { type: 'error' as const, errorMessage: 'provider exited before webhook' };
      }
      return { type: 'success' as const, sessionId: 'recycled-session' };
    });
    service = new HappyHerdAutomationService('machine-one', spawn);
    await service.start();
    const created = await service.create(input());
    const failed = await service.runNow(created.id);
    expect(failed).toMatchObject({ status: 'failed', sessionId: null });
    const recycled = await service.runNow(created.id);
    expect(recycled).toMatchObject({ status: 'started', sessionId: 'recycled-session' });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('binds an exact late webhook to a running spawn and restores normal lifecycle', async () => {
    const spawn = vi.fn().mockResolvedValue({ type: 'error', errorMessage: 'webhook timeout' });
    service = new HappyHerdAutomationService('machine-one', spawn);
    await service.start();
    const created = await service.create(input());
    const running = await service.runNow(created.id);
    const started = await service.confirmRunStarted({
      automationId: created.id,
      runId: running.id,
      sessionId: 'late-session',
    });
    expect(started).toMatchObject({
      status: 'started',
      sessionId: 'late-session',
      finishedAt: null,
    });
    await expect(service.runNow(created.id)).resolves.toMatchObject({ status: 'skipped' });
    await expect(service.confirmRunStarted({
      automationId: created.id,
      runId: running.id,
      sessionId: 'wrong-session',
    })).rejects.toThrow(/cannot bind/);
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

  it('closes a retry-safe spawn failure when no provider process exists', async () => {
    const spawn = vi.fn().mockResolvedValue({
      type: 'error',
      errorMessage: 'provider executable missing',
      retrySafe: true,
    });
    service = new HappyHerdAutomationService('machine-one', spawn);
    await service.start();
    const created = await service.create(input());
    const run = await service.runNow(created.id);
    expect(run).toMatchObject({ status: 'failed', attempt: 1, sessionId: null });
    expect(run.finishedAt).not.toBeNull();
  });

  it('never retries ambiguous failures that may already have started a session', async () => {
    const spawn = vi.fn().mockResolvedValue({ type: 'error', errorMessage: 'webhook timeout' });
    service = new HappyHerdAutomationService('machine-one', spawn);
    await service.start();
    const created = await service.create({ ...input(), maxRetries: 3 });
    const run = await service.runNow(created.id);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(run).toMatchObject({ status: 'running', attempt: 1, finishedAt: null });
    expect(run.message).toContain('webhook timeout');
  });

  it('closes a started run only through a matching termination confirmation', async () => {
    const spawn = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'session-one' });
    service = new HappyHerdAutomationService('machine-one', spawn);
    await service.start();
    const created = await service.create(input());
    const started = await service.runNow(created.id);
    await expect(service.confirmRunTermination({
      automationId: created.id,
      runId: started.id,
      sessionId: 'another-session',
      status: 'completed',
    })).rejects.toThrow(/another session/);
    const completed = await service.confirmRunTermination({
      automationId: created.id,
      runId: started.id,
      sessionId: 'session-one',
      status: 'completed',
      message: 'Root turn and child tasks completed.',
    });
    expect(completed).toMatchObject({ status: 'completed', sessionId: 'session-one' });
    expect(completed.finishedAt).not.toBeNull();
    await expect(service.confirmRunTermination({
      automationId: created.id,
      runId: started.id,
      sessionId: 'session-one',
      status: 'completed',
    })).resolves.toEqual(completed);
    await expect(service.runNow(created.id)).resolves.toMatchObject({ status: 'started' });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('uses persisted nonterminal history as the overlap and delete authority after restart', async () => {
    const firstSpawn = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'session-one' });
    service = new HappyHerdAutomationService('machine-one', firstSpawn);
    await service.start();
    const created = await service.create(input());
    await service.runNow(created.id);
    await service.stop();
    service = null;

    const replacementSpawn = vi.fn();
    service = new HappyHerdAutomationService('machine-one', replacementSpawn);
    await service.start();
    await expect(service.listActiveRuns()).resolves.toEqual([
      expect.objectContaining({ automationId: created.id, sessionId: 'session-one', status: 'started' }),
    ]);
    await expect(service.runNow(created.id)).resolves.toMatchObject({ status: 'skipped' });
    await expect(service.pause(created.id)).resolves.toMatchObject({ status: 'paused' });
    await expect(service.delete(created.id)).rejects.toThrow(/currently running/);
    expect(replacementSpawn).not.toHaveBeenCalled();
  });

  it('enforces the selected Commander workspace', async () => {
    const commanderRoot = path.join(root, '.happyherd', 'commanders', 'athena');
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
