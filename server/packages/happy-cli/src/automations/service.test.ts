import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { HappyHerdAutomationService } from './service';
import type { Session } from '@/api/types';

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
  try {
    await service?.stop();
  } finally {
    service = null;
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
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

function heartbeatTarget(agentState: Session['agentState'] = {
  messageQueue: { pendingMessageIds: [], currentMessageIds: [] },
}): Session {
  return {
    id: 'session-heartbeat',
    seq: 1,
    encryptionKey: new Uint8Array(32),
    encryptionVariant: 'legacy',
    metadata: {
      path: path.join(root, 'workspace'),
      host: 'test-host',
      homeDir: root,
      happyHomeDir: path.join(root, '.happy'),
      happyLibDir: path.join(root, '.happy', 'lib'),
      happyToolsDir: path.join(root, '.happy', 'tools'),
      machineId: 'machine-one',
      flavor: 'codex',
      codexThreadId: 'thread-one',
      commanderId: 'commander-one',
      commanderName: 'Athena',
      commanderPath: '/context/COMMANDER.md',
      commanderAgentContextPath: '/context/commander',
      globalAgentContextPath: '/context/global',
      projectGuidancePath: '/workspace/AGENTS.md',
    },
    metadataVersion: 1,
    agentState,
    agentStateVersion: 1,
  };
}

describe('HappyHerdAutomationService', () => {
  it('delivers one exact queued turn and anchors cadence only to the provider receipt', async () => {
    let target = { session: heartbeatTarget(), running: true };
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const resumeTarget = vi.fn();
    service = new HappyHerdAutomationService('machine-one', vi.fn(), {
      loadTarget: vi.fn(async () => target),
      postMessage,
      resumeTarget,
    });
    const configured = await service.controlHeartbeat({
      action: 'set',
      targetSessionId: target.session.id,
      intervalSeconds: 2_700,
      instruction: 'Check the deployment.',
    });
    const heartbeat = configured.heartbeat!;
    const dueAt = '2026-08-25T00:00:00.000Z';
    await (service as any).store.updateHeartbeat(heartbeat.id, { nextDueAt: dueAt });

    await (service as any).reconcileHeartbeats(new Date(dueAt));
    const [persisted] = (await service.history(heartbeat.id)).runs;
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(target.session, expect.objectContaining({
      localId: persisted.id,
      automationId: heartbeat.id,
      displayText: expect.stringContaining('every 45m'),
      text: expect.stringContaining('Recurring instruction:\nCheck the deployment.'),
    }));
    expect(postMessage.mock.calls[0][1].text).toContain('- Commander definition: /context/COMMANDER.md');
    expect(resumeTarget).not.toHaveBeenCalled();

    target = {
      ...target,
      session: heartbeatTarget({
        messageQueue: { pendingMessageIds: [persisted.id], currentMessageIds: [] },
      }),
    };
    await (service as any).reconcileHeartbeats(new Date('2026-08-25T00:00:30.000Z'));
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect((await service.controlHeartbeat({ action: 'status', targetSessionId: target.session.id })).deliveryState).toBe('queued');

    target = {
      ...target,
      session: heartbeatTarget({
        messageQueue: { pendingMessageIds: [], currentMessageIds: [persisted.id] },
      }),
    };
    await (service as any).reconcileHeartbeats(new Date('2026-08-25T00:01:00.000Z'));
    expect((await service.history(heartbeat.id)).runs[0].status).toBe('running');

    const firedAt = '2026-08-25T00:01:05.000Z';
    target = {
      ...target,
      session: heartbeatTarget({
        messageQueue: { pendingMessageIds: [], currentMessageIds: [persisted.id] },
        heartbeatDelivery: {
          schemaVersion: 1,
          automationId: heartbeat.id,
          occurrenceId: persisted.id,
          status: 'started',
          startedAt: firedAt,
          finishedAt: null,
          message: null,
        },
      }),
    };
    await (service as any).reconcileHeartbeats(new Date('2026-08-25T00:01:30.000Z'));
    expect((await service.history(heartbeat.id)).runs[0]).toMatchObject({ status: 'started', startedAt: firedAt });
    expect((await service.list()).automations[0]).toMatchObject({ nextDueAt: '2026-08-25T00:46:05.000Z' });

    target = {
      ...target,
      session: heartbeatTarget({
        messageQueue: { pendingMessageIds: [], currentMessageIds: [] },
        heartbeatDelivery: {
          schemaVersion: 1,
          automationId: heartbeat.id,
          occurrenceId: persisted.id,
          status: 'completed',
          startedAt: firedAt,
          finishedAt: '2026-08-25T00:02:00.000Z',
          message: null,
        },
      }),
    };
    await (service as any).reconcileHeartbeats(new Date('2026-08-25T00:02:30.000Z'));
    expect((await service.history(heartbeat.id)).runs[0]).toMatchObject({ status: 'completed' });
  });

  it.each(['due', 'pending', 'current'] as const)('exact-resumes a stopped target with a %s ID once and waits for runtime readiness', async (queueState) => {
    let target = { session: heartbeatTarget(), running: true };
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const resumeTarget = vi.fn().mockResolvedValue({ type: 'success', sessionId: target.session.id });
    service = new HappyHerdAutomationService('machine-one', vi.fn(), {
      loadTarget: vi.fn(async () => target),
      postMessage,
      resumeTarget,
    });
    const heartbeat = (await service.controlHeartbeat({
      action: 'set', targetSessionId: target.session.id, intervalSeconds: 60, instruction: null,
    })).heartbeat!;
    await (service as any).store.updateHeartbeat(heartbeat.id, { nextDueAt: '2026-08-25T00:00:00.000Z' });
    if (queueState === 'due') target = { ...target, running: false };
    await (service as any).reconcileHeartbeats(new Date('2026-08-25T00:00:00.000Z'));
    const run = (await service.history(heartbeat.id)).runs[0];
    target = {
      running: false,
      session: heartbeatTarget({
        messageQueue: queueState === 'pending'
          ? { pendingMessageIds: [run.id], currentMessageIds: [] }
          : queueState === 'current'
            ? { pendingMessageIds: [], currentMessageIds: [run.id] }
            : { pendingMessageIds: [], currentMessageIds: [] },
      }),
    };

    await (service as any).reconcileHeartbeats(new Date('2026-08-25T00:00:30.000Z'));
    await (service as any).reconcileHeartbeats(new Date('2026-08-25T00:01:00.000Z'));
    await (service as any).reconcileHeartbeats(new Date('2026-08-25T00:01:30.000Z'));
    expect(resumeTarget).toHaveBeenCalledTimes(1);
    expect(resumeTarget).toHaveBeenCalledWith(target.session.id, { replayQueueMessageId: run.id });
    expect((await service.history(heartbeat.id)).runs[0]).toMatchObject({ status: 'running' });
    expect((await service.list()).automations[0]).toMatchObject({ status: 'active' });

    target = { running: true, session: heartbeatTarget(null) };
    await (service as any).reconcileHeartbeats(new Date('2026-08-25T00:02:00.000Z'));
    await (service as any).reconcileHeartbeats(new Date('2026-08-25T00:02:30.000Z'));
    expect(resumeTarget).toHaveBeenCalledTimes(1);
    expect((await service.controlHeartbeat({ action: 'status', targetSessionId: target.session.id })).deliveryState)
      .toBe('waiting-daemon');

    target = { running: true, session: heartbeatTarget() };
    await (service as any).reconcileHeartbeats(new Date('2026-08-25T00:03:00.000Z'));
    expect(postMessage).toHaveBeenCalledTimes(queueState === 'due' ? 1 : 2);
    expect(postMessage.mock.calls.at(-1)?.[1].localId).toBe(run.id);
    if (queueState !== 'due') {
      expect(postMessage.mock.calls[0][1].text).toBe(postMessage.mock.calls[1][1].text);
    }
    expect((await service.history(heartbeat.id)).runs[0]).toMatchObject({ status: 'running' });
    expect((await service.list()).automations[0]).toMatchObject({ status: 'active' });
  });

  it('allows one same-ID persistence retry and then records a material failure', async () => {
    const target = { session: heartbeatTarget(), running: true };
    const postMessage = vi.fn().mockResolvedValue(undefined);
    service = new HappyHerdAutomationService('machine-one', vi.fn(), {
      loadTarget: vi.fn(async () => target),
      postMessage,
      resumeTarget: vi.fn(),
    });
    const heartbeat = (await service.controlHeartbeat({
      action: 'set', targetSessionId: target.session.id, intervalSeconds: 60, instruction: null,
    })).heartbeat!;
    await (service as any).store.updateHeartbeat(heartbeat.id, { nextDueAt: '2026-08-25T00:00:00.000Z' });

    await (service as any).reconcileHeartbeats(new Date('2026-08-25T00:00:00.000Z'));
    await expect(service.controlHeartbeat({
      action: 'set', targetSessionId: target.session.id, intervalSeconds: 120, instruction: 'Changed.',
    })).rejects.toThrow('current occurrence is in progress');
    expect((await service.list()).automations[0]).toMatchObject({
      id: heartbeat.id,
      intervalSeconds: 60,
      instruction: heartbeat.instruction,
    });
    await (service as any).reconcileHeartbeats(new Date('2026-08-25T00:00:30.000Z'));
    await (service as any).reconcileHeartbeats(new Date('2026-08-25T00:01:00.000Z'));
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[0][1].localId).toBe(postMessage.mock.calls[1][1].localId);
    expect(postMessage.mock.calls[0][1].text).toBe(postMessage.mock.calls[1][1].text);
    expect((await service.history(heartbeat.id)).runs[0]).toMatchObject({ status: 'failed' });
  });

  it('serializes control before delivery and replaces only an unaccepted due occurrence', async () => {
    const target = { session: heartbeatTarget(null), running: true };
    const postMessage = vi.fn();
    service = new HappyHerdAutomationService('machine-one', vi.fn(), {
      loadTarget: vi.fn(async () => target),
      postMessage,
      resumeTarget: vi.fn(),
    });
    const first = (await service.controlHeartbeat({
      action: 'set', targetSessionId: target.session.id, intervalSeconds: 60, instruction: 'Old.',
    })).heartbeat!;
    await (service as any).store.updateHeartbeat(first.id, { nextDueAt: '2026-08-25T00:00:00.000Z' });
    await (service as any).reconcileHeartbeats(new Date('2026-08-25T00:00:00.000Z'));
    expect((await service.history(first.id)).runs).toHaveLength(1);

    const replaced = await service.controlHeartbeat({
      action: 'set', targetSessionId: target.session.id, intervalSeconds: 120, instruction: 'New.',
    });
    expect((await service.history(first.id)).runs).toHaveLength(0);
    expect(replaced.heartbeat).toMatchObject({ id: first.id, intervalSeconds: 120, instruction: 'New.' });
    await service.controlHeartbeat({ action: 'pause', targetSessionId: target.session.id });
    await (service as any).reconcileHeartbeats(new Date('2026-08-25T00:03:00.000Z'));
    expect(postMessage).not.toHaveBeenCalled();
  });

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

  it.each([
    ['claude', 'bypassPermissions'],
    ['codex', 'yolo'],
  ] as const)('spawns %s automations with an explicit unattended permission policy', async (rail, permissionMode) => {
    const spawn = vi.fn().mockResolvedValue({ type: 'success', sessionId: `${rail}-session` });
    service = new HappyHerdAutomationService('machine-one', spawn);
    await service.start();
    const created = await service.create({ ...input(), rail });

    await service.runNow(created.id);

    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      agent: rail,
      permissionMode,
    }));
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

  it('stops only the exact tracked run and waits for confirmed provider exit', async () => {
    const spawn = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'session-one' });
    const stopExactTrackedRun = vi.fn(() => true);
    service = new HappyHerdAutomationService('machine-one', spawn, undefined, {
      hasExactTrackedRun: vi.fn(() => true),
      stopExactTrackedRun,
    });
    await service.start();
    const created = await service.create(input());
    const started = await service.runNow(created.id);

    await expect(service.stopRun({
      automationId: created.id,
      runId: started.id,
    })).resolves.toMatchObject({ status: 'started', sessionId: 'session-one' });
    expect(stopExactTrackedRun).toHaveBeenCalledWith(started);
    expect((await service.history(created.id)).runs[0]).toMatchObject({
      status: 'started',
      finishedAt: null,
    });

    await service.confirmRunTermination({
      automationId: created.id,
      runId: started.id,
      sessionId: 'session-one',
      status: 'failed',
      message: 'Operator stopped the exact tracked run.',
    });
    await expect(service.runNow(created.id)).resolves.toMatchObject({ status: 'started' });
  });

  it('abandons only an explicitly confirmed orphan and preserves its history', async () => {
    const spawn = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'legacy-session' });
    let tracked = true;
    service = new HappyHerdAutomationService('machine-one', spawn, undefined, {
      hasExactTrackedRun: vi.fn(() => tracked),
      stopExactTrackedRun: vi.fn(() => false),
    });
    await service.start();
    const created = await service.create(input());
    const started = await service.runNow(created.id);

    await expect(service.abandonRun({
      automationId: created.id,
      runId: started.id,
      sessionId: 'legacy-session',
      confirmation: 'ABANDON',
    })).rejects.toThrow(/still tracked/);

    tracked = false;
    await expect(service.abandonRun({
      automationId: created.id,
      runId: started.id,
      sessionId: 'wrong-session',
      confirmation: 'ABANDON',
    })).rejects.toThrow(/session confirmation/);

    const abandoned = await service.abandonRun({
      automationId: created.id,
      runId: started.id,
      sessionId: 'legacy-session',
      confirmation: 'ABANDON',
    });
    expect(abandoned).toMatchObject({
      id: started.id,
      status: 'failed',
      sessionId: 'legacy-session',
      message: expect.stringContaining('explicitly abandoned'),
    });
    expect((await service.history(created.id)).runs).toContainEqual(abandoned);
    await expect(service.runNow(created.id)).resolves.toMatchObject({ status: 'started' });
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
