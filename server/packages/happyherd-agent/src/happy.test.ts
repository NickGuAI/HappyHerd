import { describe, expect, it, vi } from 'vitest';
import type { DecryptedSession } from 'happy-agent/control';
import type { BridgeConfig } from './config';
import { HappyHerdRuntime } from './happy';
import { TEST_AGENT_MANIFEST } from './testManifest';
import type { SurfaceBinding } from './types';

function config(): BridgeConfig {
  return {
    discordApplicationId: 'app-1',
    discordBotTokenFile: '/var/lib/example/secrets/discord',
    discordTokenRotationReceiptFile: null,
    discordTokenNotBefore: null,
    toolManifestFile: '/var/lib/example/agent-manifest.json',
    serviceApiBaseUrl: 'https://service.example',
    authorizationPath: '/api/internal/discord/authorize',
    agentId: 'example-agent',
    serviceSigningSecretFile: '/var/lib/example/secrets/signing',
    transportSecretFile: '/var/lib/example/secrets/transport',
    happyHomeDir: '/var/lib/example/happy',
    happyMachineId: 'machine-1',
    agentWorkspace: '/var/lib/example/workspace',
    commanderId: 'example-team-agent',
    stateDir: '/var/lib/example/state',
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
    metadata: { machineId: 'machine-1', happyHerdAgentSurfaceId: 'dm:123' },
    agentState: null,
    dataEncryptionKey: null,
    encryption: { key: new Uint8Array(32), variant: 'dataKey' },
  };
}

describe('HappyHerdRuntime', () => {
  it('starts a fresh governed session at max effort', async () => {
    const spawned = { ...inactiveSession(), active: true };
    const control = {
      listSessions: vi.fn(async () => []),
      resolveMachine: vi.fn(),
      resolveSession: vi.fn(),
      spawnCodexSession: vi.fn(async () => spawned),
      resumeSession: vi.fn(),
      sendTurn: vi.fn(),
      getSessionMessages: vi.fn(),
    };
    const binding: SurfaceBinding = {
      surfaceKey: 'dm:123',
      surfaceKind: 'dm',
      channelId: '456',
      guildId: null,
      threadId: null,
      subjectId: 'member-1',
      capabilityId: 'A_32-character-capability-id-value-123',
      happySessionId: null,
      createdAt: 1,
      updatedAt: 1,
    };

    const runtime = new HappyHerdRuntime(config(), TEST_AGENT_MANIFEST, control);
    await expect(runtime.ensureSession(binding)).resolves.toEqual({ sessionId: 'session-1', sequence: 12 });
    expect(control.spawnCodexSession).toHaveBeenCalledWith(expect.objectContaining({
      effortLevel: 'max',
      runtimeContext: expect.objectContaining({
        surfaceId: 'dm:123',
        capabilityId: 'A_32-character-capability-id-value-123',
      }),
    }));
  });

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
      subjectId: 'member-1',
      capabilityId: 'A_32-character-capability-id-value-123',
      happySessionId: 'session-1',
      createdAt: 1,
      updatedAt: 1,
    };

    const runtime = new HappyHerdRuntime(config(), TEST_AGENT_MANIFEST, control);
    await expect(runtime.ensureSession(binding)).resolves.toEqual({ sessionId: 'session-1', sequence: 12 });
    expect(control.resumeSession).toHaveBeenCalledWith('session-1', {
      surfaceId: 'dm:123',
      capabilityId: 'A_32-character-capability-id-value-123',
      brokerUrl: 'http://127.0.0.1:3210/mcp',
      tools: TEST_AGENT_MANIFEST.tools.map(({ name, family, description }) => ({ name, family, description })),
    });
    expect(control.spawnCodexSession).not.toHaveBeenCalled();
  });
});
