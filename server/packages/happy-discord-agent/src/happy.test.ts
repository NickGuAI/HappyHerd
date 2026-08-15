import { describe, expect, it, vi } from 'vitest';
import type { DecryptedSession } from 'happy-agent/control';
import type { BridgeConfig } from './config';
import { HappyHerdRuntime } from './happy';
import type { SurfaceBinding } from './types';

function config(): BridgeConfig {
  return {
    discordApplicationId: 'app-1',
    discordBotTokenFile: '/var/lib/pmai/secrets/discord',
    discordTokenRotationReceiptFile: null,
    pmaiApiBaseUrl: 'https://pmai.example',
    pmaiAuthorizationPath: '/api/internal/discord/authorize',
    pmaiBridgeId: 'pmai-discord',
    pmaiServiceSigningSecretFile: '/var/lib/pmai/secrets/signing',
    bridgeTransportSecretFile: '/var/lib/pmai/secrets/transport',
    happyHomeDir: '/var/lib/pmai/happy',
    happyMachineId: 'machine-1',
    agentWorkspace: '/var/lib/pmai/workspace',
    commanderId: 'pmai-team-agent',
    stateDir: '/var/lib/pmai/state',
    allowedGuildIds: new Set(),
    allowedChannelIds: new Set(),
    listenHost: '127.0.0.1',
    listenPort: 3210,
    brokerUrl: 'http://127.0.0.1:3210/mcp',
    permissionMode: 'read-only',
    turnTimeoutMs: 1_000,
  };
}

function inactiveSession(): DecryptedSession {
  return {
    id: 'session-1',
    seq: 12,
    createdAt: 1,
    updatedAt: 1,
    active: false,
    activeAt: 1,
    metadata: { machineId: 'machine-1', pmaiDiscordSurfaceId: 'dm:123' },
    agentState: null,
    dataEncryptionKey: null,
    encryption: { key: new Uint8Array(32), variant: 'dataKey' },
  };
}

describe('HappyHerdRuntime', () => {
  it('reinjects the current surface capability when resuming an inactive session', async () => {
    const resumed = { ...inactiveSession(), active: true };
    const control = {
      listSessions: vi.fn(async () => []),
      resolveMachine: vi.fn(),
      resolveSession: vi.fn(async () => inactiveSession()),
      spawnCodexSession: vi.fn(),
      resumeSession: vi.fn(async () => resumed),
      sendTurn: vi.fn(),
      getSessionMessages: vi.fn(),
    };
    const binding: SurfaceBinding = {
      surfaceKey: 'dm:123',
      surfaceKind: 'dm',
      channelId: '456',
      guildId: null,
      threadId: null,
      pmaiUserId: 'pmai-user-1',
      capabilityId: 'A_32-character-capability-id-value-123',
      happySessionId: 'session-1',
      createdAt: 1,
      updatedAt: 1,
    };

    const runtime = new HappyHerdRuntime(config(), control);
    await expect(runtime.ensureSession(binding)).resolves.toEqual({ sessionId: 'session-1', sequence: 12 });
    expect(control.resumeSession).toHaveBeenCalledWith('session-1', {
      discordSurfaceId: 'dm:123',
      pmaiCapabilityId: 'A_32-character-capability-id-value-123',
      pmaiBrokerUrl: 'http://127.0.0.1:3210/mcp',
    });
    expect(control.spawnCodexSession).not.toHaveBeenCalled();
  });
});
