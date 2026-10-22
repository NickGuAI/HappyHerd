import { describe, expect, it, vi } from 'vitest';

import { handleSessionSettingsCommand } from './sessionSettings';

const catalog = (provider: 'codex' | 'grok' = 'codex') => ({
  detectedAt: 1,
  sources: { models: 'test', effortLevels: 'test', permissionModes: 'test' },
  models: [
    { code: 'model-one', value: 'Model One', isDefault: true, effortLevels: [
      { code: 'medium', value: 'Medium', isDefault: true },
      { code: 'high', value: 'High' },
    ] },
    { code: 'model-two', value: 'Model Two', effortLevels: [
      { code: 'low', value: 'Low', isDefault: true },
    ] },
  ],
  effortLevels: [
    { code: 'medium', value: 'Medium', isDefault: true },
    { code: 'high', value: 'High' },
    { code: 'low', value: 'Low' },
  ],
  permissionModes: [
    { code: provider === 'grok' ? 'allow' : 'default', value: 'Default', isDefault: true },
    { code: provider === 'grok' ? 'deny' : 'yolo', value: 'Alternative' },
  ],
});

function makeFixture(provider: 'codex' | 'grok' | 'dsh' = 'codex') {
  const session = {
    id: 'session-1',
    active: true,
    projectId: 'project-1',
    metadata: {
      machineId: 'machine-1',
      flavor: provider,
      commanderId: 'commander-1',
      projectId: 'project-1',
      modelMode: 'model-one',
      effortLevel: 'medium',
      permissionMode: provider === 'grok' ? 'allow' : 'default',
      spawnSettings: {
        provider,
        model: 'model-one',
        effort: 'medium',
        permission: provider === 'grok' ? 'allow' : 'default',
      },
    },
  } as any;
  const machine = {
    id: 'machine-1',
    active: true,
    metadata: {
      host: 'test-host',
      platform: 'linux',
      happyCliVersion: 'test',
      homeDir: '/home/test',
      happyHomeDir: '/home/test/.happyherd',
      happyLibDir: '/opt/happyherd',
      cliAvailability: {
        claude: true, codex: true, gemini: true, grok: true, dsh: true, agy: true,
        detectedAt: 1,
      },
      agentCapabilities: { [provider]: catalog(provider === 'grok' ? 'grok' : 'codex') },
    },
  } as any;
  const outputs: string[] = [];
  let persistedMetadata = session.metadata;
  const updateSessionMetadata = vi.fn(async (_selected: any, updater: (metadata: unknown) => unknown) => {
    persistedMetadata = updater(persistedMetadata) as typeof session.metadata;
    return { ...session, metadata: persistedMetadata };
  });
  const client = {
    resolveSession: vi.fn(async () => ({ ...session, metadata: persistedMetadata })),
    resolveMachine: vi.fn(async () => machine),
    callMachineRpc: vi.fn(async (_machine: unknown, _rpc: string, params: { permissionMode?: string }) => {
      if (provider === 'grok' && params.permissionMode) {
        persistedMetadata = {
          ...persistedMetadata,
          spawnSettings: {
            ...persistedMetadata.spawnSettings,
            permission: params.permissionMode,
          },
        } as typeof session.metadata;
      }
      return { type: 'success', sessionId: session.id, permissionMode: params.permissionMode ?? 'deny' };
    }),
    updateSessionMetadata,
  };
  return {
    session,
    machine,
    outputs,
    client,
    persisted: () => persistedMetadata,
    setPersisted: (metadata: typeof session.metadata) => { persistedMetadata = metadata; },
    dependencies: { createClient: async () => client as any, output: (line: string) => outputs.push(line) },
  };
}

describe('session set-settings', () => {
  it('prints usage without a client and rejects missing, duplicate, and unknown settings', async () => {
    const outputs: string[] = [];
    await handleSessionSettingsCommand(['--help'], { output: (line) => outputs.push(line) });
    expect(outputs[0]).toContain('set-settings SESSION_ID');
    expect(outputs[0]).toContain('advertised default code');
    expect(outputs[0]).not.toContain('--effort default');

    const fixture = makeFixture();
    await expect(handleSessionSettingsCommand(['session-1', '--json'], fixture.dependencies))
      .rejects.toThrow('At least one');
    await expect(handleSessionSettingsCommand(['session-1', '--model', 'a', '--model', 'b'], fixture.dependencies))
      .rejects.toThrow('may only be specified once');
    await expect(handleSessionSettingsCommand(['session-1', '--unsafe', 'x'], fixture.dependencies))
      .rejects.toThrow('Unknown option');
    expect(fixture.client.resolveSession).not.toHaveBeenCalled();
  });

  it('validates the combined tuple, preserves unrelated metadata, and verifies authoritative readback', async () => {
    const fixture = makeFixture();
    await handleSessionSettingsCommand([
      'session-1', '--model', 'model-two', '--effort', 'low', '--permission', 'yolo', '--json',
    ], fixture.dependencies);

    expect(fixture.persisted()).toMatchObject({
      machineId: 'machine-1',
      commanderId: 'commander-1',
      projectId: 'project-1',
      modelMode: 'model-two',
      effortLevel: 'low',
      permissionMode: 'yolo',
    });
    expect(JSON.parse(fixture.outputs[0])).toMatchObject({
      type: 'session-settings-updated',
      sessionId: 'session-1',
      provider: 'codex',
      settings: { model: 'model-two', effort: 'low', permission: 'yolo' },
      takesEffect: 'next-message-or-resume',
    });
    expect(fixture.client.updateSessionMetadata).toHaveBeenCalledTimes(1);
  });

  it('does not write a model whose retained effort is unsupported', async () => {
    const fixture = makeFixture();
    await expect(handleSessionSettingsCommand(['session-1', '--model', 'model-two'], fixture.dependencies))
      .rejects.toThrow('Set a compatible --effort');
    expect(fixture.client.updateSessionMetadata).not.toHaveBeenCalled();
  });

  it('preserves a newer compatible unrequested pick after metadata version retry and reports readback', async () => {
    const fixture = makeFixture();
    const original = fixture.persisted();
    const latest = {
      ...original,
      modelMode: 'model-two',
      effortLevel: 'low',
    };
    fixture.client.updateSessionMetadata.mockImplementationOnce(async (_selected: any, updater: (metadata: unknown) => unknown) => {
      updater(original);
      const updatedMetadata = updater(latest) as typeof fixture.session.metadata;
      fixture.setPersisted(updatedMetadata);
      return { ...fixture.session, metadata: updatedMetadata };
    });

    await handleSessionSettingsCommand(['session-1', '--permission', 'yolo', '--json'], fixture.dependencies);

    expect(fixture.persisted()).toMatchObject({ modelMode: 'model-two', effortLevel: 'low', permissionMode: 'yolo' });
    expect(JSON.parse(fixture.outputs[0]).settings).toEqual({
      provider: 'codex',
      model: 'model-two',
      effort: 'low',
      permission: 'yolo',
    });
  });

  it('revalidates requested effort against a newer model before merging metadata', async () => {
    const fixture = makeFixture();
    const original = fixture.persisted();
    fixture.client.updateSessionMetadata.mockImplementationOnce(async (_selected: any, updater: (metadata: unknown) => unknown) => {
      updater(original);
      updater({ ...original, modelMode: 'model-two', effortLevel: 'low' });
      throw new Error('update must not proceed after invalid latest tuple');
    });

    await expect(handleSessionSettingsCommand(['session-1', '--effort', 'high'], fixture.dependencies))
      .rejects.toThrow('does not advertise effort level "high"');
    expect(fixture.persisted()).toBe(original);
  });

  it.each([
    { dimension: 'model', override: null, launch: 'model-two', expected: 'model-one', request: ['--permission', 'yolo'] },
    { dimension: 'model', override: undefined, launch: 'model-two', expected: 'model-two', request: ['--permission', 'yolo'] },
    { dimension: 'effort', override: null, launch: 'high', expected: 'medium', request: ['--permission', 'yolo'] },
    { dimension: 'effort', override: undefined, launch: 'high', expected: 'high', request: ['--permission', 'yolo'] },
    { dimension: 'permission', override: null, launch: 'yolo', expected: 'default', request: ['--model', 'model-one'] },
    { dimension: 'permission', override: undefined, launch: 'yolo', expected: 'yolo', request: ['--model', 'model-one'] },
  ])('$dimension metadata $override selects its documented fallback', async ({ dimension, override, launch, expected, request }) => {
    const fixture = makeFixture();
    const metadata = { ...fixture.persisted() } as any;
    const launchSettings = { ...metadata.spawnSettings };
    const field = dimension === 'model' ? 'modelMode' : dimension === 'effort' ? 'effortLevel' : 'permissionMode';
    const launchField = dimension;
    metadata[field] = override;
    launchSettings[launchField] = launch;
    if (dimension === 'model' && launch === 'model-two') {
      metadata.effortLevel = override === null ? null : 'low';
      launchSettings.effort = 'low';
    }
    metadata.spawnSettings = launchSettings;
    fixture.setPersisted(metadata);

    await handleSessionSettingsCommand(['session-1', ...request, '--json'], fixture.dependencies);

    const receipt = JSON.parse(fixture.outputs[0]);
    const receiptKey = dimension === 'model' ? 'model' : dimension === 'effort' ? 'effort' : 'permission';
    expect(receipt.settings[receiptKey]).toBe(expected);
  });

  it('uses the exact owning machine and rejects mismatched targets before writing', async () => {
    const fixture = makeFixture();
    fixture.client.resolveMachine.mockResolvedValue({ ...fixture.machine, id: 'another-machine' } as any);
    await expect(handleSessionSettingsCommand(['session-1', '--model', 'model-two', '--effort', 'low'], fixture.dependencies))
      .rejects.toThrow('could not be refreshed exactly');
    expect(fixture.client.updateSessionMetadata).not.toHaveBeenCalled();
  });

  it('fails when authoritative readback does not retain the requested value', async () => {
    const fixture = makeFixture();
    fixture.client.updateSessionMetadata.mockResolvedValue({
      ...fixture.session,
      metadata: { ...fixture.session.metadata, modelMode: 'model-one' },
    } as any);
    await expect(handleSessionSettingsCommand(['session-1', '--model', 'model-two', '--effort', 'low'], fixture.dependencies))
      .rejects.toThrow('did not confirm modelMode');
  });

  it('confirms Grok permission through its existing daemon transition before writing metadata', async () => {
    const fixture = makeFixture('grok');
    await handleSessionSettingsCommand(['session-1', '--permission', 'deny', '--json'], fixture.dependencies);
    expect(fixture.client.callMachineRpc).toHaveBeenCalledWith(
      fixture.machine,
      'grok-permission-mode-transition',
      { sessionId: 'session-1', permissionMode: 'deny' },
    );
    expect(fixture.client.updateSessionMetadata).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fixture.outputs[0])).toMatchObject({
      settings: { permission: 'deny' },
      takesEffect: 'confirmed-resume',
      permissionTakesEffect: 'confirmed-resume',
    });
  });

  it('fails when Grok transition succeeds but authoritative launch receipt retains the old permission', async () => {
    const fixture = makeFixture('grok');
    fixture.client.callMachineRpc.mockResolvedValue({
      type: 'success', sessionId: 'session-1', permissionMode: 'deny',
    } as any);

    await expect(handleSessionSettingsCommand(
      ['session-1', '--permission', 'deny', '--json'],
      fixture.dependencies,
    )).rejects.toThrow('authoritative permission setting resolved to allow instead of requested deny');

    expect(fixture.client.updateSessionMetadata).toHaveBeenCalledTimes(1);
    expect(fixture.persisted()).toMatchObject({
      permissionMode: 'deny',
      spawnSettings: { provider: 'grok', permission: 'allow' },
    });
    expect(fixture.outputs).toEqual([]);
  });

  it('does not claim liveness when the saved Grok permission already matches', async () => {
    const fixture = makeFixture('grok');
    fixture.session.active = false;
    await handleSessionSettingsCommand(['session-1', '--permission', 'allow', '--json'], fixture.dependencies);
    expect(fixture.session.active).toBe(false);
    expect(fixture.client.callMachineRpc).not.toHaveBeenCalled();
    expect(JSON.parse(fixture.outputs[0])).toMatchObject({
      takesEffect: 'unchanged',
      permissionTakesEffect: 'unchanged',
    });

    const readable = makeFixture('grok');
    await handleSessionSettingsCommand(['session-1', '--permission', 'allow'], readable.dependencies);
    expect(readable.outputs[1]).toContain('already matches');
    expect(readable.outputs[1]).not.toContain('active');
    expect(readable.client.callMachineRpc).not.toHaveBeenCalled();
  });

  it('reports Grok permission resume separately from combined model and effort picks', async () => {
    const fixture = makeFixture('grok');
    await handleSessionSettingsCommand([
      'session-1', '--permission', 'deny', '--model', 'model-two', '--effort', 'low', '--json',
    ], fixture.dependencies);

    const receipt = JSON.parse(fixture.outputs[0]);
    expect(receipt).toMatchObject({
      settings: { model: 'model-two', effort: 'low', permission: 'deny' },
      takesEffect: 'next-message-or-resume',
      permissionTakesEffect: 'confirmed-resume',
    });
    const readable = makeFixture('grok');
    await handleSessionSettingsCommand([
      'session-1', '--permission', 'deny', '--model', 'model-two', '--effort', 'low',
    ], readable.dependencies);
    expect(readable.outputs[1]).toContain('permission was confirmed through resume');
    expect(readable.outputs[1]).toContain('model and effort selections take effect');
  });

  it.each([
    { provider: 'grok' as const, spawnSettings: { provider: 'grok', permission: 'allow' }, stalePermission: 'deny', expected: 'allow' },
    { provider: 'dsh' as const, spawnSettings: { provider: 'dsh', permission: 'default' }, stalePermission: 'yolo', expected: 'default' },
    { provider: 'grok' as const, spawnSettings: undefined, stalePermission: 'deny', expected: 'deny' },
  ])('$provider retained permission follows its launch receipt ownership', async ({ provider, spawnSettings, stalePermission, expected }) => {
    const fixture = makeFixture(provider);
    const metadata = { ...fixture.persisted() } as any;
    metadata.permissionMode = stalePermission;
    metadata.spawnSettings = spawnSettings
      ? { ...metadata.spawnSettings, ...spawnSettings }
      : undefined;
    fixture.setPersisted(metadata);

    await handleSessionSettingsCommand(['session-1', '--model', 'model-one', '--json'], fixture.dependencies);

    expect(JSON.parse(fixture.outputs[0]).settings.permission).toBe(expected);
    expect(fixture.client.callMachineRpc).not.toHaveBeenCalled();
  });

  it('does not update Grok metadata when the daemon fails to confirm its transition', async () => {
    const fixture = makeFixture('grok');
    fixture.client.callMachineRpc.mockResolvedValue({
      type: 'success', sessionId: 'different-session', permissionMode: 'deny',
    } as any);
    await expect(handleSessionSettingsCommand(['session-1', '--permission', 'deny'], fixture.dependencies))
      .rejects.toThrow();
    expect(fixture.client.updateSessionMetadata).not.toHaveBeenCalled();
  });

  it('keeps DSH launch-only permission settings immutable', async () => {
    const fixture = makeFixture('dsh');
    await expect(handleSessionSettingsCommand(['session-1', '--permission', 'default'], fixture.dependencies))
      .rejects.toThrow('selected at launch');
    expect(fixture.client.updateSessionMetadata).not.toHaveBeenCalled();
  });

  it('translates expired account-control auth into the public machine login command', async () => {
    await expect(handleSessionSettingsCommand(['session-1', '--model', 'model-one'], {
      createClient: async () => { throw new Error('Auth expired; run happyherd-control-agent auth login'); },
    })).rejects.toThrow('Run `happyherd machine auth login`');
  });
});
