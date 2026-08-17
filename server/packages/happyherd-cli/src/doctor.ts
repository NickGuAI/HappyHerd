/** User-visible installation and security-boundary diagnostics. */

import spawnCommand from 'cross-spawn';
import { existsSync } from 'node:fs';
import { resolveHappyBinary } from './runtime';
import type { BrokerClientInterface } from './broker';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  target: string;
  checks: DoctorCheck[];
}

export function currentTarget(): string {
  const targets: Record<string, string[]> = {
    darwin: ['arm64', 'x64'],
    linux: ['arm64', 'x64'],
    win32: ['x64'],
  };
  if (!targets[process.platform]?.includes(process.arch)) return `unsupported-${process.platform}-${process.arch}`;
  return `${process.platform}-${process.arch}`;
}

interface DoctorSpawnResult {
  status: number | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  error?: Error;
}

export type DoctorSpawn = (
  command: string,
  args: string[],
  options: { encoding: 'utf8'; timeout: number; windowsHide: boolean },
) => DoctorSpawnResult;

export interface DoctorDependencies {
  spawn?: DoctorSpawn;
  exists?: (path: string) => boolean;
  includeExternalAgents?: boolean;
}

function externalAgentCheck(
  name: string,
  command: 'claude' | 'codex',
  installUrl: string,
  spawn: DoctorSpawn,
): DoctorCheck {
  const result = spawn(command, ['--version'], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
  const output = String(result.stdout ?? result.stderr ?? '').trim().split('\n')[0];
  if (!result.error && result.status === 0 && output) {
    return {
      name,
      ok: true,
      detail: `${output}; launch ${command} once to complete or verify account authentication`,
    };
  }
  return {
    name,
    ok: false,
    detail: `${name} is required. Install from ${installUrl}, then launch ${command} once to authenticate.`,
  };
}

export async function runDoctor(
  client: BrokerClientInterface,
  dependencies: DoctorDependencies = {},
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const spawn: DoctorSpawn = dependencies.spawn ?? ((command, args, options) => spawnCommand.sync(command, args, options));
  const exists = dependencies.exists ?? existsSync;
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: 'Bundled Node runtime',
    ok: nodeMajor >= 20,
    detail: nodeMajor >= 20
      ? `bundled Node.js ${process.versions.node}`
      : 'the verified HappyHerd asset must be repaired; installing host Node.js will not fix this bundled runtime',
  });
  const target = currentTarget();
  checks.push({ name: 'Platform', ok: !target.startsWith('unsupported-'), detail: target });
  if (process.platform === 'linux') {
    const required = [
      '/usr/bin/dbus-run-session',
      '/usr/bin/gnome-keyring-daemon',
      '/usr/bin/systemd-creds',
    ];
    const missing = required.filter((path) => !exists(path));
    checks.push({
      name: 'Linux Secret Service',
      ok: missing.length === 0,
      detail: missing.length === 0
        ? 'dbus-run-session, gnome-keyring-daemon, and systemd-creds are ready'
        : `required native component${missing.length === 1 ? '' : 's'} missing: ${missing.join(', ')}`,
    });
  }
  try {
    const happy = resolveHappyBinary();
    const version = spawn(process.execPath, [happy, '--version'], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
    const output = String(version.stdout ?? '').trim();
    checks.push({
      name: 'Agent runtime',
      ok: version.status === 0 && output.startsWith('happy version:'),
      detail: version.status === 0 ? output.split('\n')[0] : 'bundled Happy runtime did not start',
    });
  } catch (error) {
    checks.push({ name: 'Agent runtime', ok: false, detail: error instanceof Error ? error.message : 'bundled Happy runtime is unavailable' });
  }
  if (dependencies.includeExternalAgents !== false) {
    checks.push(externalAgentCheck(
      'Claude Code CLI',
      'claude',
      'https://docs.anthropic.com/en/docs/claude-code/getting-started',
      spawn,
    ));
    checks.push(externalAgentCheck(
      'Codex CLI',
      'codex',
      'https://developers.openai.com/codex/cli',
      spawn,
    ));
  }
  try {
    const attestation = await client.ping();
    checks.push({
      name: 'Broker identity',
      ok: true,
      detail: `signed broker ${attestation.version} running as ${attestation.serviceIdentity}`,
    });
  } catch (error) {
    checks.push({ name: 'Broker identity', ok: false, detail: error instanceof Error ? error.message : 'broker attestation failed' });
  }
  try {
    const status = await client.status();
    checks.push({ name: 'Broker runtime', ok: true, detail: status });
  } catch (error) {
    checks.push({ name: 'Broker runtime', ok: false, detail: error instanceof Error ? error.message : 'broker status failed' });
  }
  return { ok: checks.every((check) => check.ok), target, checks };
}
