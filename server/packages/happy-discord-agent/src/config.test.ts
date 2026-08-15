import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBridgeConfig, readSecretFile } from './config';

const tempDirs: string[] = [];

function baseEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    PMAI_DISCORD_APPLICATION_ID: '1234567890',
    PMAI_DISCORD_TOKEN_FILE: '/var/lib/pmai-discord-agent/secrets/discord-token',
    PMAI_ACCESS_API_URL: 'https://www.pioneeringminds.ai',
    PMAI_SERVICE_SIGNING_SECRET_FILE: '/var/lib/pmai-discord-agent/secrets/signing-key',
    PMAI_BRIDGE_TRANSPORT_SECRET_FILE: '/var/lib/pmai-discord-agent/secrets/transport-key',
    HAPPY_HOME_DIR: '/var/lib/pmai-discord-agent/happy-home',
    PMAI_HAPPY_MACHINE_ID: 'machine-1',
    PMAI_AGENT_WORKSPACE: '/var/lib/pmai-discord-agent/workspace',
    PMAI_BRIDGE_STATE_DIR: '/var/lib/pmai-discord-agent/state',
    PMAI_BRIDGE_PORT: '3210',
    PMAI_BROKER_URL: 'http://127.0.0.1:3210/mcp',
  };
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('loadBridgeConfig', () => {
  it('loads isolated service paths and defaults to read-only Codex', () => {
    const config = loadBridgeConfig(baseEnvironment());
    expect(config.permissionMode).toBe('read-only');
    expect(config.commanderId).toBe('pmai-team-agent');
    expect(config.brokerUrl).toBe('http://127.0.0.1:3210/mcp');
  });

  it('rejects Nick personal runtime paths', () => {
    expect(() => loadBridgeConfig({
      ...baseEnvironment(),
      HAPPY_HOME_DIR: '/home/ec2-user/.happyherd',
    })).toThrow('dedicated PMAI service path');
  });

  it('requires explicit guild and channel allowlists in production', () => {
    expect(() => loadBridgeConfig({
      ...baseEnvironment(),
      NODE_ENV: 'production',
    })).toThrow('explicit PMAI guild and channel allowlists');
  });

  it('rejects a remote or mismatched broker endpoint', () => {
    expect(() => loadBridgeConfig({
      ...baseEnvironment(),
      PMAI_BROKER_URL: 'https://broker.example/mcp',
    })).toThrow('loopback /mcp endpoint');
  });
});

describe('readSecretFile', () => {
  it('reads a non-empty mode-0600 secret', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pmai-secret-'));
    tempDirs.push(directory);
    const path = join(directory, 'secret');
    await writeFile(path, 'secret-value\n', { mode: 0o600 });
    await expect(readSecretFile(path, 'test secret')).resolves.toBe('secret-value');
  });

  it('rejects group-readable material', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pmai-secret-'));
    tempDirs.push(directory);
    const path = join(directory, 'secret');
    await writeFile(path, 'secret-value', { mode: 0o600 });
    await chmod(path, 0o640);
    await expect(readSecretFile(path, 'test secret')).rejects.toThrow('group or other');
  });
});
