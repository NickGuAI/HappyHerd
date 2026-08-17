import { describe, expect, it } from 'vitest';
import { runDoctor, type DoctorSpawn } from './doctor';
import type { BrokerClientInterface } from './broker';

const client: BrokerClientInterface = {
  ping: async () => ({ version: '1.2.1-beta.1', serviceIdentity: 'uid:901' }),
  status: async () => 'broker runtime and native secret store ready',
  connect: async () => { throw new Error('not used'); },
  installSkills: async () => { throw new Error('not used'); },
  disconnect: async () => 0,
  runTool: async () => { throw new Error('not used'); },
};

describe('doctor prerequisites', () => {
  it('distinguishes the bundled runtime from both external agent CLIs', async () => {
    const spawn: DoctorSpawn = (command) => {
      if (command === 'claude') return { status: 0, stdout: '2.1.0 (Claude Code)\n' };
      if (command === 'codex') return { status: 0, stdout: 'codex-cli 0.42.0\n' };
      return { status: 0, stdout: 'happy version: 9.9.9\n' };
    };
    const report = await runDoctor(client, { spawn, exists: () => true });
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Bundled Node runtime', ok: true, detail: expect.stringContaining('bundled Node.js') }),
      expect.objectContaining({ name: 'Claude Code CLI', ok: true, detail: expect.stringContaining('authentication') }),
      expect.objectContaining({ name: 'Codex CLI', ok: true, detail: expect.stringContaining('authentication') }),
    ]));
    expect(report.ok).toBe(true);
  });

  it('gives separate actionable installation guidance without claiming host Node is required', async () => {
    const spawn: DoctorSpawn = (command) => command === process.execPath
      ? { status: 0, stdout: 'happy version: 9.9.9\n' }
      : { status: null, error: new Error('ENOENT') };
    const report = await runDoctor(client, { spawn, exists: () => true });
    const claude = report.checks.find((check) => check.name === 'Claude Code CLI');
    const codex = report.checks.find((check) => check.name === 'Codex CLI');
    expect(claude).toMatchObject({ ok: false });
    expect(claude?.detail).toContain('docs.anthropic.com');
    expect(codex).toMatchObject({ ok: false });
    expect(codex?.detail).toContain('developers.openai.com');
    expect(report.checks.some((check) => check.name === 'Node.js')).toBe(false);
    expect(report.ok).toBe(false);
  });

  it('fails closed when a Linux Secret Service prerequisite is absent', async () => {
    const spawn: DoctorSpawn = (command) => command === process.execPath
      ? { status: 0, stdout: 'happy version: 9.9.9\n' }
      : { status: 0, stdout: `${command} fixture\n` };
    const report = await runDoctor(client, {
      spawn,
      exists: (path) => path !== '/usr/bin/gnome-keyring-daemon',
    });
    if (process.platform === 'linux') {
      expect(report.checks).toContainEqual(expect.objectContaining({
        name: 'Linux Secret Service',
        ok: false,
        detail: expect.stringContaining('/usr/bin/gnome-keyring-daemon'),
      }));
      expect(report.ok).toBe(false);
    }
  });

  it('supports an installer-only health gate without weakening full doctor', async () => {
    const commands: string[] = [];
    const spawn: DoctorSpawn = (command) => {
      commands.push(command);
      return command === process.execPath
        ? { status: 0, stdout: 'happy version: 9.9.9\n' }
        : { status: null, error: new Error('ENOENT') };
    };
    const report = await runDoctor(client, {
      spawn,
      exists: () => true,
      includeExternalAgents: false,
    });
    expect(report.ok).toBe(true);
    expect(commands).toEqual([process.execPath]);
    expect(report.checks.some((check) => check.name === 'Claude Code CLI')).toBe(false);
    expect(report.checks.some((check) => check.name === 'Codex CLI')).toBe(false);
  });
});
