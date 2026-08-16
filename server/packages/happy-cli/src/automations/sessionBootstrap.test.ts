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
    delete process.env.HAPPYHERD_AUTOMATION_KIND;
    delete process.env.HAPPYHERD_AUTOMATION_BOOTSTRAP_PATH;
    delete process.env.HAPPYHERD_AUTOMATION_BOOTSTRAP_HASH;
    delete process.env.HAPPY_HOME_DIR;
    vi.resetModules();
  });

  it('writes an integrity-checked instruction snapshot and restores provenance', async () => {
    process.env.HAPPY_HOME_DIR = await mkdtemp(path.join(os.tmpdir(), 'happyherd-bootstrap-'));
    const module = await import('./sessionBootstrap');
    const reference = await module.prepareAutomationBootstrap({
      schemaVersion: 1,
      automationId: crypto.randomUUID(),
      kind: 'heartbeat',
      instruction: 'Check the live task list.',
    });
    Object.assign(process.env, module.automationBootstrapEnvironment(reference));
    await expect(module.readAutomationBootstrapFromEnvironment()).resolves.toMatchObject({
      automationId: reference.automationId,
      kind: 'heartbeat',
      instruction: 'Check the live task list.',
    });
    expect(module.automationMetadataFromEnvironment()).toEqual({
      automationId: reference.automationId,
      automationKind: 'heartbeat',
    });
  });

  it('rejects a bootstrap changed after the daemon signed it', async () => {
    process.env.HAPPY_HOME_DIR = await mkdtemp(path.join(os.tmpdir(), 'happyherd-bootstrap-'));
    const module = await import('./sessionBootstrap');
    const reference = await module.prepareAutomationBootstrap({
      schemaVersion: 1,
      automationId: crypto.randomUUID(),
      kind: 'scheduled',
      instruction: 'Original instruction',
    });
    Object.assign(process.env, module.automationBootstrapEnvironment(reference));
    await writeFile(reference.path, '{}\n');
    await expect(module.readAutomationBootstrapFromEnvironment()).rejects.toThrow(/integrity validation/);
  });
});
