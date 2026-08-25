import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('HappyHerd automation session bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.HAPPYHERD_AUTOMATION_ID;
    delete process.env.HAPPYHERD_AUTOMATION_RUN_ID;
    delete process.env.HAPPYHERD_AUTOMATION_KIND;
    delete process.env.HAPPYHERD_AUTOMATION_TIMEOUT_MINUTES;
    delete process.env.HAPPYHERD_AUTOMATION_BOOTSTRAP_PATH;
    delete process.env.HAPPYHERD_AUTOMATION_BOOTSTRAP_HASH;
    delete process.env.HAPPY_HOME_DIR;
    vi.resetModules();
  });

  it('writes an integrity-checked instruction snapshot and restores provenance', async () => {
    process.env.HAPPY_HOME_DIR = await mkdtemp(path.join(os.tmpdir(), 'happyherd-bootstrap-'));
    const module = await import('./sessionBootstrap');
    const runId = crypto.randomUUID();
    const reference = await module.prepareAutomationBootstrap({
      schemaVersion: 1,
      automationId: crypto.randomUUID(),
      runId,
      kind: 'heartbeat',
      instruction: 'Check the live task list.',
      timeoutMinutes: 360,
    });
    Object.assign(process.env, module.automationBootstrapEnvironment(reference));
    await expect(module.readAutomationBootstrapFromEnvironment()).resolves.toMatchObject({
      automationId: reference.automationId,
      runId,
      kind: 'heartbeat',
      instruction: 'Check the live task list.',
      timeoutMinutes: 360,
    });
    expect(module.automationMetadataFromEnvironment()).toEqual({
      automationId: reference.automationId,
      automationRunId: runId,
      automationKind: 'heartbeat',
      automationTimeoutMinutes: 360,
    });
  });

  it('defaults legacy bootstrap snapshots to the 60-minute deadline', async () => {
    process.env.HAPPY_HOME_DIR = await mkdtemp(path.join(os.tmpdir(), 'happyherd-bootstrap-'));
    const module = await import('./sessionBootstrap');
    const reference = await module.prepareAutomationBootstrap({
      schemaVersion: 1,
      automationId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      kind: 'scheduled',
      instruction: 'Use the default deadline.',
    });
    expect(reference.timeoutMinutes).toBe(60);
  });

  it('round-trips an explicit unbounded timeout through signed bootstrap metadata', async () => {
    process.env.HAPPY_HOME_DIR = await mkdtemp(path.join(os.tmpdir(), 'happyherd-bootstrap-'));
    const module = await import('./sessionBootstrap');
    const runId = crypto.randomUUID();
    const reference = await module.prepareAutomationBootstrap({
      schemaVersion: 1,
      automationId: crypto.randomUUID(),
      runId,
      kind: 'memory-maintenance',
      instruction: 'Distill durable memory until the provider completes.',
      timeoutMinutes: null,
    });
    const environment = module.automationBootstrapEnvironment(reference);
    expect(environment.HAPPYHERD_AUTOMATION_TIMEOUT_MINUTES).toBe('unbounded');
    Object.assign(process.env, environment);

    await expect(module.readAutomationBootstrapFromEnvironment()).resolves.toMatchObject({
      automationId: reference.automationId,
      runId,
      timeoutMinutes: null,
    });
    expect(module.automationMetadataFromEnvironment()).toMatchObject({
      automationId: reference.automationId,
      automationRunId: runId,
      automationTimeoutMinutes: null,
    });

    delete process.env.HAPPYHERD_AUTOMATION_TIMEOUT_MINUTES;
    await expect(module.readAutomationBootstrapFromEnvironment()).rejects.toThrow(/timeout reference is incomplete/);
  });

  it('rejects a bootstrap changed after the daemon signed it', async () => {
    process.env.HAPPY_HOME_DIR = await mkdtemp(path.join(os.tmpdir(), 'happyherd-bootstrap-'));
    const module = await import('./sessionBootstrap');
    const reference = await module.prepareAutomationBootstrap({
      schemaVersion: 1,
      automationId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      kind: 'scheduled',
      instruction: 'Original instruction',
    });
    Object.assign(process.env, module.automationBootstrapEnvironment(reference));
    await writeFile(reference.path, '{}\n');
    await expect(module.readAutomationBootstrapFromEnvironment()).rejects.toThrow(/integrity validation/);
  });

  it('rejects a bootstrap without exact run provenance', async () => {
    process.env.HAPPY_HOME_DIR = await mkdtemp(path.join(os.tmpdir(), 'happyherd-bootstrap-'));
    const module = await import('./sessionBootstrap');

    await expect(module.prepareAutomationBootstrap({
      schemaVersion: 1,
      automationId: crypto.randomUUID(),
      kind: 'scheduled',
      instruction: 'Do not launch an unbound run.',
    } as never)).rejects.toThrow();
  });
});
