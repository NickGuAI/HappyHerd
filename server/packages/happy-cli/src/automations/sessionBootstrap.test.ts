import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('HappyHerd automation session bootstrap', () => {
  let root: string | null = null;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    delete process.env.HAPPYHERD_AUTOMATION_ID;
    delete process.env.HAPPYHERD_AUTOMATION_RUN_ID;
    delete process.env.HAPPYHERD_AUTOMATION_KIND;
    delete process.env.HAPPYHERD_AUTOMATION_BOOTSTRAP_PATH;
    delete process.env.HAPPYHERD_AUTOMATION_BOOTSTRAP_HASH;
    delete process.env.HAPPY_HOME_DIR;
    vi.resetModules();
    if (root !== null) {
      await rm(root, { recursive: true, force: true });
      root = null;
    }
  });

  it('writes an integrity-checked instruction snapshot and restores provenance', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'happyherd-bootstrap-'));
    process.env.HAPPY_HOME_DIR = root;
    const module = await import('./sessionBootstrap');
    const runId = crypto.randomUUID();
    const reference = await module.prepareAutomationBootstrap({
      schemaVersion: 1,
      automationId: crypto.randomUUID(),
      runId,
      kind: 'heartbeat',
      instruction: 'Check the live task list.',
    });
    Object.assign(process.env, module.automationBootstrapEnvironment(reference));
    await expect(module.readAutomationBootstrapFromEnvironment()).resolves.toMatchObject({
      automationId: reference.automationId,
      runId,
      kind: 'heartbeat',
      instruction: 'Check the live task list.',
    });
    expect(module.automationMetadataFromEnvironment()).toEqual({
      automationId: reference.automationId,
      automationRunId: runId,
      automationKind: 'heartbeat',
    });
  });

  it('rejects a bootstrap changed after the daemon signed it', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'happyherd-bootstrap-'));
    process.env.HAPPY_HOME_DIR = root;
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
    root = await mkdtemp(path.join(os.tmpdir(), 'happyherd-bootstrap-'));
    process.env.HAPPY_HOME_DIR = root;
    const module = await import('./sessionBootstrap');

    await expect(module.prepareAutomationBootstrap({
      schemaVersion: 1,
      automationId: crypto.randomUUID(),
      kind: 'scheduled',
      instruction: 'Do not launch an unbound run.',
    } as never)).rejects.toThrow();
  });
});
