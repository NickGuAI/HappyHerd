import { beforeEach, describe, expect, it, vi } from 'vitest';

const runHappy = vi.hoisted(() => vi.fn());

vi.mock('./runtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('./runtime')>(),
  runHappy,
}));

import { runCli } from './cli';
import type { BrokerClientInterface } from './broker';

function broker(overrides: Partial<BrokerClientInterface> = {}): BrokerClientInterface {
  return {
    ping: async () => ({ version: '1.2.1-beta.1', serviceIdentity: 'uid:999' }),
    status: async () => 'ready; no Skills; broker Node 20; Python 3.13 with tzdata',
    connect: async () => ({ expiresAt: '2027-01-01T00:00:00Z', scopes: ['guide.read'], skillBundleAvailable: true }),
    disconnect: async () => 0,
    installSkills: async () => ({ id: 'generic', version: '1', skills: ['generic-guide'], registry: 'ready' }),
    runTool: async () => ({ status: 0, stdout: '', stderr: '' }),
    ...overrides,
  };
}

describe('happyherd command surface', () => {
  beforeEach(() => {
    runHappy.mockReset();
  });

  it('documents governed workflows and the native fallback', async () => {
    const output: string[] = [];
    expect(await runCli([], { brokerClient: broker(), stdout: (line) => output.push(line) })).toBe(0);
    const help = output.join('\n');
    expect(help).toContain('happyherd doctor');
    expect(help).toContain('happyherd connect <issuer>');
    expect(help).toContain('happyherd disconnect <issuer|--all>');
    expect(help).toContain('happyherd install-skills --issuer');
    expect(help).toContain('happyherd run-tool');
    expect(help).toContain('happyherd upgrade');
    expect(help).toContain('OS-separated HappyHerd broker');
    expect(help).not.toContain('broker-service');
    expect(help).not.toContain('--sha256');
    expect(help).not.toContain('--root');
    expect(help).toContain('Every other invocation');
    expect(help).toContain('forwarded unchanged to the bundled native Happy CLI');
  });

  it('reports the immutable launcher version without broker or network access', async () => {
    const output: string[] = [];
    expect(await runCli(['--version'], { stdout: (line) => output.push(line) })).toBe(0);
    expect(output).toEqual(['happyherd version: 1.2.1-beta.1']);
  });

  it('routes connect, disconnect, install, and run only through the broker client', async () => {
    const calls: string[] = [];
    const fake = broker({
      connect: async (issuer) => { calls.push(`connect:${issuer}`); return { expiresAt: '2027-01-01T00:00:00Z', scopes: [], skillBundleAvailable: true }; },
      disconnect: async (issuer) => { calls.push(`disconnect:${issuer ?? 'all'}`); return 1; },
      installSkills: async (issuer) => { calls.push(`install:${issuer}`); return { id: 'bundle', version: '1', skills: ['guide'], registry: 'ready' }; },
      runTool: async (issuer, skill, script, args) => { calls.push(`run:${issuer}:${skill}:${script}:${args.join(',')}`); return { status: 7, stdout: '', stderr: '' }; },
    });
    const dependencies = { brokerClient: fake };
    expect(await runCli(['connect', 'https://issuer.example'], dependencies)).toBe(0);
    expect(await runCli(['disconnect', '--all'], dependencies)).toBe(0);
    expect(await runCli(['install-skills', '--issuer', 'https://issuer.example'], dependencies)).toBe(0);
    expect(await runCli(['run-tool', '--issuer', 'https://issuer.example', '--skill', 'guide', '--script', 'scripts/check.py', '--', 'x'], dependencies)).toBe(7);
    expect(calls).toEqual([
      'connect:https://issuer.example',
      'disconnect:all',
      'install:https://issuer.example',
      'run:https://issuer.example:guide:scripts/check.py:x',
    ]);
    expect(runHappy).not.toHaveBeenCalled();
  });

  it.each([
    [['automation', 'list', '--json'], 23],
    [['daemon', 'status'], 7],
    [['--started-by', 'daemon', '--no-sandbox'], 19],
  ] as const)('forwards an ungoverned invocation unchanged exactly once: %j', async (args, status) => {
    runHappy.mockReturnValue(status);

    expect(await runCli([...args])).toBe(status);
    expect(runHappy).toHaveBeenCalledOnce();
    expect(runHappy).toHaveBeenCalledWith([...args]);
  });

  it('streams device approval and a secret-free connected receipt as NDJSON', async () => {
    const output: string[] = [];
    const fake = broker({
      connect: async (_issuer, _version, onEvent) => {
        onEvent?.({
          type: 'approval',
          message: 'Approve this device',
          verificationUri: 'https://issuer.example/agent-toolkit?request=123',
          userCode: 'ABCD-EFGH',
        });
        onEvent?.({ type: 'connected', message: 'Connected' });
        return { expiresAt: '2027-01-01T00:00:00Z', scopes: ['guide.read'], skillBundleAvailable: true };
      },
    });
    expect(await runCli(
      ['connect', 'https://issuer.example', '--no-open', '--json'],
      { brokerClient: fake, stdout: (line) => output.push(line) },
    )).toBe(0);
    expect(output.map((line) => JSON.parse(line))).toEqual([
      {
        schemaVersion: 1,
        type: 'approval',
        message: 'Approve this device',
        verificationUri: 'https://issuer.example/agent-toolkit?request=123',
        userCode: 'ABCD-EFGH',
      },
      { schemaVersion: 1, type: 'connected', message: 'Connected' },
      {
        schemaVersion: 1,
        type: 'receipt',
        issuer: 'https://issuer.example',
        expiresAt: '2027-01-01T00:00:00Z',
        scopes: ['guide.read'],
        skillBundleAvailable: true,
      },
    ]);
    expect(output.join('\n')).not.toContain('token');
  });
});
