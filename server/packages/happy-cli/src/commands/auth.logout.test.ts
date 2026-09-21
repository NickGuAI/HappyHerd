import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixture = vi.hoisted(() => ({
  configuration: { happyHomeDir: '', privateKeyFile: '', settingsFile: '' },
  answer: 'yes',
  stopDaemon: vi.fn(),
}));
vi.mock('@/configuration', () => ({ configuration: fixture.configuration }));
vi.mock('@/ui/auth', () => ({ authAndSetupMachineIfNeeded: vi.fn() }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/daemon/controlClient', () => ({ stopDaemon: fixture.stopDaemon, checkIfDaemonRunningAndCleanupStaleState: vi.fn() }));
vi.mock('node:readline', () => ({ createInterface: () => ({
  question: (_prompt: string, receive: (answer: string) => void) => receive(fixture.answer), close() {},
}) }));

import { handleAuthCommand } from './auth';

describe('CLI-only logout', () => {
  beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), 'logout-'));
    Object.assign(fixture.configuration, { happyHomeDir: home, privateKeyFile: join(home, 'access.key'), settingsFile: join(home, 'settings.json') });
    await writeFile(fixture.configuration.privateKeyFile, JSON.stringify({ token: 'test', secret: Buffer.alloc(32).toString('base64') }));
    await writeFile(fixture.configuration.settingsFile, JSON.stringify({ machineId: 'original-machine', onboardingCompleted: true }));
    await writeFile(join(home, 'sessions.json'), 'encrypted retained history');
    await writeFile(join(home, 'agent.key'), 'independent agent credentials');
    fixture.answer = 'yes';
    fixture.stopDaemon.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(async () => {
    await rm(fixture.configuration.happyHomeDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });
  it.each([false, true])('clears only CLI identity even when daemon stop fails=%s', async (stopFails) => {
    if (stopFails) fixture.stopDaemon.mockRejectedValue(new Error('already stopped'));
    await handleAuthCommand(['logout']);
    expect(existsSync(fixture.configuration.privateKeyFile)).toBe(false);
    expect(JSON.parse(await readFile(fixture.configuration.settingsFile, 'utf8'))).not.toHaveProperty('machineId');
    expect(await readFile(join(fixture.configuration.happyHomeDir, 'sessions.json'), 'utf8')).toBe('encrypted retained history');
    expect(await readFile(join(fixture.configuration.happyHomeDir, 'agent.key'), 'utf8')).toBe('independent agent credentials');
  });
  it('retains authentication and the home when cancelled', async () => {
    fixture.answer = 'n';
    await handleAuthCommand(['logout']);
    expect(existsSync(fixture.configuration.privateKeyFile)).toBe(true);
    expect(fixture.stopDaemon).not.toHaveBeenCalled();
  });
});
