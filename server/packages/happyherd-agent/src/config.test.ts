import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { loadBridgeConfig, readSecretFile, verifyDiscordTokenRotationReceipt } from './config';

const tempDirs: string[] = [];

function baseEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    HAPPYHERD_AGENT_DISCORD_APPLICATION_ID: '1234567890',
    HAPPYHERD_AGENT_DISCORD_TOKEN_FILE: '/var/lib/happyherd-agent/secrets/discord-token',
    HAPPYHERD_AGENT_DISCORD_TOKEN_ROTATION_RECEIPT_FILE: '/var/lib/happyherd-agent/secrets/discord-token-rotation.json',
    HAPPYHERD_AGENT_SERVICE_API_URL: 'https://service.example',
    HAPPYHERD_AGENT_TOOL_MANIFEST_FILE: '/var/lib/happyherd-agent/agent-manifest.json',
    HAPPYHERD_AGENT_SERVICE_SIGNING_SECRET_FILE: '/var/lib/happyherd-agent/secrets/signing-key',
    HAPPYHERD_AGENT_TRANSPORT_SECRET_FILE: '/var/lib/happyherd-agent/secrets/transport-key',
    HAPPY_HOME_DIR: '/var/lib/happyherd-agent/happy-home',
    HAPPYHERD_AGENT_MACHINE_ID: 'machine-1',
    HAPPYHERD_AGENT_WORKSPACE: '/var/lib/happyherd-agent/workspace',
    HAPPYHERD_AGENT_STATE_DIR: '/var/lib/happyherd-agent/state',
    HAPPYHERD_AGENT_PORT: '3210',
    HAPPYHERD_AGENT_BROKER_URL: 'http://127.0.0.1:3210/mcp',
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
    expect(config.commanderId).toBe('team-agent');
    expect(config.brokerUrl).toBe('http://127.0.0.1:3210/mcp');
  });

  it('rejects personal runtime paths on every host', () => {
    expect(() => loadBridgeConfig({
      ...baseEnvironment(),
      HAPPY_HOME_DIR: join(homedir(), '.happyherd'),
    })).toThrow('dedicated service path');
    expect(() => loadBridgeConfig({
      ...baseEnvironment(),
      HAPPYHERD_AGENT_WORKSPACE: '/home/example-user/workspace',
    })).toThrow('dedicated service path');
  });

  it('requires explicit guild and channel allowlists in production', () => {
    expect(() => loadBridgeConfig({
      ...baseEnvironment(),
      NODE_ENV: 'production',
    })).toThrow('explicit Discord guild and channel allowlists');
  });

  it('rejects a remote or mismatched broker endpoint', () => {
    expect(() => loadBridgeConfig({
      ...baseEnvironment(),
      HAPPYHERD_AGENT_BROKER_URL: 'https://broker.example/mcp',
    })).toThrow('loopback /mcp endpoint');
  });

  it('requires separate token, receipt, signing, and transport files', () => {
    expect(() => loadBridgeConfig({
      ...baseEnvironment(),
      HAPPYHERD_AGENT_DISCORD_TOKEN_ROTATION_RECEIPT_FILE: '/var/lib/happyherd-agent/secrets/discord-token',
    })).toThrow('must use separate files');
  });

  it('requires the sandbox-proxied broker alias in production', () => {
    expect(() => loadBridgeConfig({
      ...baseEnvironment(),
      NODE_ENV: 'production',
      HAPPYHERD_AGENT_ALLOWED_GUILD_IDS: '123',
      HAPPYHERD_AGENT_ALLOWED_CHANNEL_IDS: '456',
      HAPPYHERD_AGENT_DISCORD_TOKEN_NOT_BEFORE: '2026-01-01T00:00:00.000Z',
    })).toThrow('sandbox-proxied loopback alias');
  });

  it('keeps signed authorization requests on the configured organization origin', () => {
    expect(() => loadBridgeConfig({
      ...baseEnvironment(),
      HAPPYHERD_AGENT_AUTHORIZATION_PATH: 'https://attacker.example/collect',
    })).toThrow('origin-relative path');
    expect(() => loadBridgeConfig({
      ...baseEnvironment(),
      HAPPYHERD_AGENT_AUTHORIZATION_PATH: '//attacker.example/collect',
    })).toThrow('origin-relative path');
  });
});

describe('readSecretFile', () => {
  it('reads a non-empty mode-0600 secret', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'example-secret-'));
    tempDirs.push(directory);
    const path = join(directory, 'secret');
    await writeFile(path, 'secret-value\n', { mode: 0o600 });
    await expect(readSecretFile(path, 'test secret')).resolves.toBe('secret-value');
  });

  it('rejects group-readable material', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'example-secret-'));
    tempDirs.push(directory);
    const path = join(directory, 'secret');
    await writeFile(path, 'secret-value', { mode: 0o600 });
    await chmod(path, 0o640);
    await expect(readSecretFile(path, 'test secret')).rejects.toThrow('group or other');
  });
});

describe('verifyDiscordTokenRotationReceipt', () => {
  it('accepts only a post-incident receipt bound to the installed token', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'example-token-receipt-'));
    tempDirs.push(directory);
    const path = join(directory, 'receipt.json');
    const token = 'rotated-discord-token';
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      applicationId: '1234567890',
      rotatedAt: '2026-08-15T12:00:00.000Z',
      tokenSha256: createHash('sha256').update(token).digest('hex'),
    }), { mode: 0o600 });

    await expect(verifyDiscordTokenRotationReceipt({
      receiptPath: path,
      token,
      applicationId: '1234567890',
      production: true,
      notBefore: Date.parse('2026-08-15T00:00:00.000Z'),
      now: Date.parse('2026-08-15T12:01:00.000Z'),
    })).resolves.toBeUndefined();
    await expect(verifyDiscordTokenRotationReceipt({
      receiptPath: path,
      token: 'old-token',
      applicationId: '1234567890',
      production: true,
      notBefore: Date.parse('2026-08-15T00:00:00.000Z'),
      now: Date.parse('2026-08-15T12:01:00.000Z'),
    })).rejects.toThrow('does not match the installed token');
  });
});
