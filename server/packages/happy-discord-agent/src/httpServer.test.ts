import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PmaiSkillBroker } from './broker';
import type { BridgeConfig } from './config';
import type { DiscordCommunityTransport } from './discord';
import { BridgeHttpServer } from './httpServer';
import { BridgeStore } from './store';

const directories: string[] = [];

function config(): BridgeConfig {
  return {
    discordApplicationId: 'app',
    discordBotTokenFile: '/var/lib/pmai/discord',
    pmaiApiBaseUrl: 'https://pmai.example',
    pmaiAuthorizationPath: '/api/internal/discord/authorize',
    pmaiBridgeId: 'bridge',
    pmaiServiceSigningSecretFile: '/var/lib/pmai/signing',
    bridgeTransportSecretFile: '/var/lib/pmai/transport',
    happyHomeDir: '/var/lib/pmai/happy',
    happyMachineId: 'machine',
    agentWorkspace: '/var/lib/pmai/workspace',
    commanderId: 'pmai-team-agent',
    stateDir: '/var/lib/pmai/state',
    allowedGuildIds: new Set(['guild-1']),
    allowedChannelIds: new Set(['channel-1']),
    listenHost: '127.0.0.1',
    listenPort: 3210,
    brokerUrl: 'http://127.0.0.1:3210/mcp',
    permissionMode: 'read-only',
    turnTimeoutMs: 1_000,
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('BridgeHttpServer', () => {
  it('separates session capabilities, service transport auth, and health', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pmai-http-'));
    directories.push(directory);
    const store = await BridgeStore.open(directory);
    const brokerCall = vi.fn(async () => ({ ok: true, status: 200, body: { ready: true } }));
    const discord: DiscordCommunityTransport = {
      sendReply: vi.fn(async () => ['message-1']),
      listChannels: vi.fn(async () => [{ id: 'channel-1', guildId: 'guild-1', name: 'team', parentId: null }]),
      listMessages: vi.fn(async () => []),
      addReaction: vi.fn(async () => {}),
    };
    const server = new BridgeHttpServer({
      config: config(),
      broker: { call: brokerCall } as unknown as PmaiSkillBroker,
      store,
      discord,
      transportSecret: 'transport-secret',
      readiness: () => ({ discord: true, state: true, broker: true }),
    });
    await server.listen('127.0.0.1', 0);
    const base = `http://127.0.0.1:${server.port()}`;
    try {
      const health = await fetch(`${base}/healthz`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toMatchObject({ ready: true });

      const unauthenticated = await fetch(`${base}/mcp`, { method: 'POST', body: '{}' });
      expect(unauthenticated.status).toBe(401);

      const skill = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { authorization: 'Bearer capability-1', 'content-type': 'application/json' },
        body: JSON.stringify({ family: 'pmai-guide', operation: 'capabilities', arguments: {} }),
      });
      expect(skill.status).toBe(200);
      expect(brokerCall).toHaveBeenCalledWith('capability-1', {
        family: 'pmai-guide', operation: 'capabilities', arguments: {},
      });

      const wrongService = await fetch(`${base}/internal/discord/execute`, {
        method: 'POST',
        headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'channels.list', input: {} }),
      });
      expect(wrongService.status).toBe(401);

      const channels = await fetch(`${base}/internal/discord/execute`, {
        method: 'POST',
        headers: { authorization: 'Bearer transport-secret', 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'channels.list', input: {} }),
      });
      expect(channels.status).toBe(200);
      await expect(channels.json()).resolves.toMatchObject({ channels: [{ id: 'channel-1' }] });
    } finally {
      await server.close();
    }
  });
});
