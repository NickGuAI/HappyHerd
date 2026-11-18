import { describe, expect, it, vi } from 'vitest';
import type { Metadata, MachineMetadata, Session } from '@/api/types';
import { DefaultAssistantBootstrap, defaultAssistantSettings, hasAssistantProviderIdentity } from './defaultAssistant';

const commander = {
  id: 'custom-assistant', name: 'HappyHerd Assistant', workspace: '/home/test',
  commanderPath: '/home/test/.happyherd/commanders/custom-assistant/COMMANDER.md',
  agentContextPath: '/home/test/.happyherd/commanders/custom-assistant/agentcontext',
};
const metadata: Metadata = {
  path: '/home/test', host: 'test', homeDir: '/home/test', happyHomeDir: '/home/test/.happyherd',
  happyLibDir: '/app', happyToolsDir: '/app/tools', machineId: 'machine-one',
  commanderId: commander.id, flavor: 'codex', isSuperSession: true,
};
const catalog = {
  detectedAt: 1, sources: { models: 'provider', effortLevels: 'provider', permissionModes: 'provider' },
  models: [{ code: 'catalog-default', value: 'Default model', isDefault: true }],
  effortLevels: [{ code: 'medium', value: 'Medium', isDefault: true }],
  permissionModes: [{ code: 'safe-yolo', value: 'Safe', isDefault: true }],
};
function fixture() {
  const sessions: Session[] = [];
  const prepared: Session = {
    id: 'prepared-id', seq: 0, metadata: { ...metadata }, metadataVersion: 0, agentState: null,
    agentStateVersion: 0, encryptionVariant: 'dataKey', encryptionKey: new Uint8Array(32).fill(7),
  };
  const machine: MachineMetadata = {
    host: 'test', platform: 'linux', happyCliVersion: 'test', homeDir: '/home/test',
    happyHomeDir: '/home/test/.happyherd', happyLibDir: '/app',
    cliAvailability: { codex: true, claude: false, gemini: false, grok: false, dsh: false, agy: false, detectedAt: 1 },
    agentCapabilities: { codex: catalog },
  };
  let winner: any = null;
  let running = false;
  const dependencies = {
    machineId: 'machine-one',
    api: {
      get: vi.fn(async () => winner),
      prepare: vi.fn((_metadata: Metadata) => prepared),
      publish: vi.fn(async (session: Session) => {
        expect(sessions.find(item => item.id === session.id)?.encryptionKey).toEqual(session.encryptionKey);
        winner = { id: session.id };
        return { session: winner, isRequestedSession: true };
      }),
      hydrate: vi.fn((_record: any, saved: Session) => saved),
      retire: vi.fn(async (_sessionId: string) => {
        winner = null;
        return { retired: true, session: null };
      }),
    },
    sessions: () => sessions,
    persist: vi.fn((session: Session) => {
      const index = sessions.findIndex(item => item.id === session.id);
      if (index < 0) sessions.push(session);
      else sessions[index] = session;
    }),
    ensureCommander: vi.fn(async () => commander),
    machineMetadata: () => machine,
    createMetadata: vi.fn(() => metadata),
    isRunning: vi.fn(() => running),
    start: vi.fn(async () => { running = true; }),
    stop: vi.fn(async (_session: Session) => { running = false; }),
    archive: vi.fn(async (session: Session) => ({
      ...session, metadata: { ...session.metadata, isSuperSession: false, lifecycleState: 'archived' },
    })),
  };
  return { dependencies, sessions, prepared, machine, setWinner: (value: any) => { winner = value; } };
}

describe('default Assistant bootstrap', () => {
  it('retires in order, keeps the old conversation, and creates then reuses a fresh Assistant', async () => {
    const { dependencies: d, sessions, prepared, setWinner } = fixture();
    const old: Session = {
      ...prepared, id: 'old-assistant', seq: 900,
      metadata: { ...metadata, codexThreadId: 'old-thread', commanderName: 'Earlier name' },
    };
    sessions.push(old);
    setWinner({ id: old.id });
    const currentCommander = { ...commander, name: 'Current Assistant' };
    d.ensureCommander.mockResolvedValue(currentCommander);
    d.createMetadata.mockReturnValue({ ...metadata, commanderName: currentCommander.name });
    d.api.prepare.mockImplementation(value => ({ ...prepared, metadata: value }));

    const bootstrap = new DefaultAssistantBootstrap(d);
    await expect(bootstrap.ensure(true)).resolves.toEqual({
      schemaVersion: 1, type: 'default-assistant', status: 'created', sessionId: prepared.id,
      retiredSessionId: old.id, commanderId: commander.id, machineId: 'machine-one',
    });
    const calls = [d.api.get, d.stop, d.api.retire, d.archive, d.ensureCommander, d.api.prepare, d.api.publish, d.start];
    const order = calls.map(call => call.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(d.api.retire).toHaveBeenCalledExactlyOnceWith(old.id);
    expect(d.createMetadata).toHaveBeenCalledWith(currentCommander, expect.anything());
    expect(d.start).toHaveBeenCalledWith(expect.objectContaining({
      id: prepared.id, seq: 0, metadata: { ...metadata, commanderName: currentCommander.name },
    }));
    expect(sessions.find(session => session.id === old.id)).toEqual({
      ...old, metadata: { ...old.metadata, isSuperSession: false, lifecycleState: 'archived' },
    });
    expect(sessions.filter(session => session.metadata.isSuperSession).map(session => session.id)).toEqual([prepared.id]);
    await expect(bootstrap.ensure()).resolves.toMatchObject({ status: 'existing', sessionId: prepared.id });
    expect(d.api.prepare).toHaveBeenCalledOnce();
    expect(d.start).toHaveBeenCalledOnce();
  });

  it('changes nothing when the Assistant lives on another machine', async () => {
    const { dependencies: d, setWinner } = fixture();
    setWinner({ id: 'remote-assistant' });
    await expect(new DefaultAssistantBootstrap(d).ensure(true)).rejects.toThrow('Assistant session remote-assistant lives on another machine');
    for (const call of [d.stop, d.api.retire, d.archive, d.persist, d.api.prepare, d.api.publish, d.start]) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it('normal ensure adopts the old session after a failure between retirement and clearing its marker', async () => {
    const { dependencies: d, sessions, prepared, setWinner } = fixture();
    const old = { ...prepared, id: 'old-assistant', seq: 900, metadata: { ...metadata, codexThreadId: 'old-thread' } };
    sessions.push(old);
    setWinner({ id: old.id });
    d.archive.mockRejectedValueOnce(new Error('metadata unavailable'));
    await expect(new DefaultAssistantBootstrap(d).ensure(true)).rejects.toThrow('metadata unavailable');
    expect(await d.api.get()).toBeNull();
    expect(sessions).toEqual([old]);

    await expect(new DefaultAssistantBootstrap(d).ensure()).resolves.toMatchObject({ sessionId: old.id, status: 'existing' });
    expect(await d.api.get()).toEqual({ id: old.id });
    expect(sessions.filter(session => session.metadata.isSuperSession)).toEqual([old]);
    expect(d.api.publish).toHaveBeenCalledExactlyOnceWith(old);
    expect(d.api.prepare).not.toHaveBeenCalled();
    expect(d.start).not.toHaveBeenCalled();
  });

  it('persists first, creates once, and reuses its identity across repeated calls and a daemon restart', async () => {
    const { dependencies: d } = fixture();
    const bootstrap = new DefaultAssistantBootstrap(d);
    const first = bootstrap.ensure();
    expect(bootstrap.ensure()).toBe(first);
    await expect(first).resolves.toMatchObject({ status: 'created', sessionId: 'prepared-id' });
    await expect(bootstrap.ensure()).resolves.toMatchObject({ status: 'existing', sessionId: 'prepared-id' });
    await expect(new DefaultAssistantBootstrap(d).ensure()).resolves.toMatchObject({ status: 'existing', sessionId: 'prepared-id' });
    expect(d.api.prepare).toHaveBeenCalledOnce();
    expect(d.api.publish).toHaveBeenCalledOnce();
    expect(d.start).toHaveBeenCalledOnce();
  });

  it('reuses a manually created Assistant and its custom Commander without replacing history', async () => {
    const { dependencies: d, sessions, prepared } = fixture();
    sessions.push({ ...prepared, id: 'manual', seq: 900, metadata: { ...metadata, codexThreadId: 'existing-thread' } });
    await expect(new DefaultAssistantBootstrap(d).ensure()).resolves.toMatchObject({ status: 'existing', sessionId: 'manual' });
    expect(d.api.publish).toHaveBeenCalledWith(sessions[0]);
    expect(d.api.prepare).not.toHaveBeenCalled();
    expect(d.ensureCommander).not.toHaveBeenCalled();
    expect(d.start).not.toHaveBeenCalled();
    expect(sessions[0].seq).toBe(900);
  });

  it('recovers a lost publish response from the prepared ID and original key', async () => {
    const { dependencies: d } = fixture();
    d.api.publish.mockRejectedValueOnce(new Error('connection dropped'));
    await expect(new DefaultAssistantBootstrap(d).ensure()).rejects.toThrow('connection dropped');
    await expect(new DefaultAssistantBootstrap(d).ensure()).resolves.toMatchObject({ sessionId: 'prepared-id' });
    expect(d.api.prepare).toHaveBeenCalledOnce();
    expect(d.api.publish.mock.calls[0][0].encryptionKey).toEqual(d.api.publish.mock.calls[1][0].encryptionKey);
    expect(d.start).toHaveBeenCalledOnce();
  });

  it('recovers a committed publish after its acknowledgement was lost', async () => {
    const { dependencies: d, setWinner } = fixture();
    d.api.publish.mockImplementationOnce(async () => {
      setWinner({ id: 'prepared-id' });
      throw new Error('lost acknowledgement');
    });
    await expect(new DefaultAssistantBootstrap(d).ensure()).rejects.toThrow('lost acknowledgement');
    await expect(new DefaultAssistantBootstrap(d).ensure()).resolves.toMatchObject({ sessionId: 'prepared-id' });
    expect(d.api.publish).toHaveBeenCalledOnce();
    expect(d.api.prepare).toHaveBeenCalledOnce();
    expect(d.start).toHaveBeenCalledOnce();
  });

  it.each(['already exists', 'wins a race'])('does not decrypt or launch another machine winner that %s', async (kind) => {
    const { dependencies: d, setWinner } = fixture();
    if (kind === 'already exists') setWinner({ id: 'remote-winner' });
    else d.api.publish.mockResolvedValueOnce({ session: { id: 'remote-winner' }, isRequestedSession: false });
    await expect(new DefaultAssistantBootstrap(d).ensure()).resolves.toMatchObject({ status: 'existing', sessionId: 'remote-winner' });
    expect(d.api.hydrate).not.toHaveBeenCalled();
    expect(d.start).not.toHaveBeenCalled();
  });

  it('waits for an advertised provider and then uses that catalog without a hardcoded model', async () => {
    const { dependencies: d, machine } = fixture();
    machine.cliAvailability!.codex = false;
    const bootstrap = new DefaultAssistantBootstrap(d);
    await expect(bootstrap.ensure()).resolves.toMatchObject({ status: 'waiting-for-provider', sessionId: null });
    expect(d.ensureCommander).not.toHaveBeenCalled();
    machine.cliAvailability!.codex = true;
    await bootstrap.ensure();
    expect(d.createMetadata).toHaveBeenCalledWith(commander, {
      provider: 'codex', model: 'catalog-default', effort: 'medium', permission: 'safe-yolo',
    });
  });

  it('does not publish when durable reconnect persistence fails', async () => {
    const { dependencies: d } = fixture();
    d.persist.mockImplementation(() => { throw new Error('disk unavailable'); });
    await expect(new DefaultAssistantBootstrap(d).ensure()).rejects.toThrow('disk unavailable');
    expect(d.api.publish).not.toHaveBeenCalled();
    expect(d.start).not.toHaveBeenCalled();
  });

  it('waits for the prepared session provider instead of switching to another installed provider', async () => {
    const { dependencies: d, machine, prepared, sessions, setWinner } = fixture();
    sessions.push(prepared);
    setWinner({ id: prepared.id });
    machine.cliAvailability!.codex = false;
    machine.cliAvailability!.claude = true;
    machine.agentCapabilities!.claude = catalog;
    await expect(new DefaultAssistantBootstrap(d).ensure()).resolves.toMatchObject({ status: 'waiting-for-provider', sessionId: prepared.id });
    expect(d.start).not.toHaveBeenCalled();
    expect(prepared.metadata.flavor).toBe('codex');
  });

  it('prefers Codex and does not claim unsupported-only catalogs are ready', () => {
    const { machine } = fixture();
    machine.agentCapabilities!.claude = catalog;
    machine.cliAvailability!.claude = true;
    expect(defaultAssistantSettings(machine, 'machine-one')?.provider).toBe('codex');
    expect(defaultAssistantSettings({ ...machine, agentCapabilities: {}, cliAvailability: {
      ...machine.cliAvailability!, codex: false, claude: false, gemini: true,
    } }, 'machine-one')).toBeNull();
    expect(hasAssistantProviderIdentity({ ...metadata, codexThreadId: 'thread' })).toBe(true);
    expect(hasAssistantProviderIdentity(metadata)).toBe(false);
  });
});
