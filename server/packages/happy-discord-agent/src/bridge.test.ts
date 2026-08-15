import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActorAuthorizer } from './authorization';
import { DiscordAgentBridge } from './bridge';
import { CapabilityRegistry } from './capabilities';
import type { BridgeConfig } from './config';
import type { DiscordReplyTransport } from './discord';
import type { HappySessionRuntime } from './happy';
import { BridgeStore } from './store';
import type { AuthorizationDecision, NormalizedDiscordMessage, SurfaceBinding } from './types';

const directories: string[] = [];

function config(): BridgeConfig {
  return {
    discordApplicationId: 'app-1',
    discordBotTokenFile: '/var/lib/pmai/secrets/discord',
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
    allowedGuildIds: new Set(['guild-1']),
    allowedChannelIds: new Set(['channel-1']),
    listenHost: '127.0.0.1',
    listenPort: 3210,
    brokerUrl: 'http://127.0.0.1:3210/mcp',
    permissionMode: 'read-only',
    turnTimeoutMs: 200,
  };
}

function message(overrides: Partial<NormalizedDiscordMessage> = {}): NormalizedDiscordMessage {
  return {
    sourceMessageId: 'source-1',
    authorDiscordId: 'discord-user-1',
    channelId: 'dm-channel-1',
    parentChannelId: null,
    guildId: null,
    threadId: null,
    surfaceKind: 'dm',
    surfaceKey: 'dm:discord-user-1',
    content: 'What is my onboarding status?',
    mentionsApplication: false,
    authorIsBot: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

function allowed(input: NormalizedDiscordMessage, mode: 'personal' | 'shared-read-only'): AuthorizationDecision {
  return {
    decision: 'allow',
    actor: {
      pmaiUserId: `pmai-${input.authorDiscordId}`,
      discordUserId: input.authorDiscordId,
    },
    mode,
    scopes: ['crm.contacts.read'],
    resources: {},
    delegation: { token: `delegation-${input.authorDiscordId}`, expiresAt: Date.now() + 60_000 },
  };
}

class FakeHappy implements HappySessionRuntime {
  readonly bindings: SurfaceBinding[] = [];
  readonly turns: Array<{ sessionId: string; localId: string; text: string; sourceMessageId: string }> = [];
  recovered: Awaited<ReturnType<HappySessionRuntime['recoverTurn']>> = { result: null, userMessageExists: false };

  async ensureSession(binding: SurfaceBinding) {
    this.bindings.push(binding);
    return { sessionId: `session:${binding.surfaceKey}`, sequence: 0 };
  }

  async history() {
    return [];
  }

  async sendTurn(input: { sessionId: string; localId: string; text: string; sourceMessageId: string }) {
    this.turns.push(input);
    return { turnId: `turn:${input.sourceMessageId}`, status: 'completed' as const, text: 'Ready.', messageIds: ['root-1'] };
  }

  async recoverTurn() {
    return this.recovered;
  }
}

class FakeDiscord implements DiscordReplyTransport {
  readonly replies: Array<{ channelId: string; content: string; sourceMessageId: string }> = [];

  async sendReply(channelId: string, content: string, sourceMessageId: string): Promise<string[]> {
    this.replies.push({ channelId, content, sourceMessageId });
    return [`reply-${this.replies.length}`];
  }
}

async function store(): Promise<BridgeStore> {
  const directory = await mkdtemp(join(tmpdir(), 'pmai-bridge-test-'));
  directories.push(directory);
  return BridgeStore.open(directory);
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('DiscordAgentBridge', () => {
  it('routes one inbound message through one isolated HappyHerd turn and delivers once', async () => {
    const state = await store();
    const happy = new FakeHappy();
    const discord = new FakeDiscord();
    const authorizer: ActorAuthorizer = {
      authorize: vi.fn(async (input, mode) => allowed(input, mode)),
    };
    const bridge = new DiscordAgentBridge({
      config: config(),
      store: state,
      authorizer,
      capabilities: new CapabilityRegistry(),
      happy,
      discord,
    });
    const input = message();

    await bridge.handle(input);
    await bridge.handle(input);

    expect(happy.turns).toHaveLength(1);
    expect(happy.turns[0]).toMatchObject({
      sessionId: 'session:dm:discord-user-1',
      localId: 'discord:source-1',
    });
    expect(happy.turns[0].text).toContain('untrusted user input');
    expect(happy.turns[0].text).toContain('What is my onboarding status?');
    expect(discord.replies).toEqual([{ channelId: 'dm-channel-1', content: 'Ready.', sourceMessageId: 'source-1' }]);
    expect(state.getInbound('source-1')).toMatchObject({ status: 'delivered', replyMessageIds: ['reply-1'] });
    expect(state.getSurface('dm:discord-user-1')).toMatchObject({
      pmaiUserId: 'pmai-discord-user-1',
      happySessionId: 'session:dm:discord-user-1',
    });
  });

  it('keeps two members in separate DM surfaces, sessions, and capabilities', async () => {
    const state = await store();
    const happy = new FakeHappy();
    const discord = new FakeDiscord();
    const bridge = new DiscordAgentBridge({
      config: config(),
      store: state,
      authorizer: { authorize: async (input, mode) => allowed(input, mode) },
      capabilities: new CapabilityRegistry(),
      happy,
      discord,
    });
    await bridge.handle(message());
    await bridge.handle(message({
      sourceMessageId: 'source-2',
      authorDiscordId: 'discord-user-2',
      channelId: 'dm-channel-2',
      surfaceKey: 'dm:discord-user-2',
    }));

    expect(happy.turns.map((turn) => turn.sessionId)).toEqual([
      'session:dm:discord-user-1',
      'session:dm:discord-user-2',
    ]);
    const first = state.getSurface('dm:discord-user-1')!;
    const second = state.getSurface('dm:discord-user-2')!;
    expect(first.capabilityId).not.toBe(second.capabilityId);
    expect(first.pmaiUserId).not.toBe(second.pmaiUserId);
  });

  it('denies an unlinked member before HappyHerd session creation', async () => {
    const state = await store();
    const happy = new FakeHappy();
    const discord = new FakeDiscord();
    const bridge = new DiscordAgentBridge({
      config: config(),
      store: state,
      authorizer: { authorize: async () => ({ decision: 'deny', code: 'not_linked', safeMessage: 'Link first.' }) },
      capabilities: new CapabilityRegistry(),
      happy,
      discord,
    });
    await bridge.handle(message());
    expect(happy.bindings).toHaveLength(0);
    expect(discord.replies[0].content).toBe('Link first.');
    expect(state.getInbound('source-1')?.status).toBe('denied');
  });

  it('recovers a completed encrypted turn after restart without storing answer text', async () => {
    const state = await store();
    const input = message();
    await state.claimInbound(input);
    await state.updateInbound(input.sourceMessageId, {
      status: 'turn-pending',
      happySessionId: 'session-1',
      baselineSequence: 5,
    });
    const happy = new FakeHappy();
    happy.recovered = {
      result: { turnId: 'turn-1', status: 'completed', text: 'Recovered.', messageIds: ['root'] },
      userMessageExists: true,
    };
    const discord = new FakeDiscord();
    const bridge = new DiscordAgentBridge({
      config: config(),
      store: state,
      authorizer: { authorize: async (candidate, mode) => allowed(candidate, mode) },
      capabilities: new CapabilityRegistry(),
      happy,
      discord,
    });
    await bridge.reconcile();
    expect(discord.replies[0]).toMatchObject({ content: 'Recovered.', sourceMessageId: 'source-1' });
    expect(state.getInbound('source-1')?.status).toBe('delivered');
  });
});
