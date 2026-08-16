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
      subjectId: `example-${input.authorDiscordId}`,
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
  readonly sourceMessages = new Map<string, NormalizedDiscordMessage>();
  failuresRemaining = 0;

  async sendReply(channelId: string, content: string, sourceMessageId: string): Promise<string[]> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('transient Discord delivery failure');
    }
    this.replies.push({ channelId, content, sourceMessageId });
    return [`reply-${this.replies.length}`];
  }

  async fetchMessage(channelId: string, sourceMessageId: string): Promise<NormalizedDiscordMessage> {
    const recovered = this.sourceMessages.get(`${channelId}:${sourceMessageId}`);
    if (!recovered) throw new Error('source message unavailable');
    return recovered;
  }
}

async function store(): Promise<BridgeStore> {
  const directory = await mkdtemp(join(tmpdir(), 'example-bridge-test-'));
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
      subjectId: 'example-discord-user-1',
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
    expect(first.subjectId).not.toBe(second.subjectId);
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

  it('refetches and submits a claimed source after a pre-send process restart', async () => {
    const state = await store();
    const input = message();
    await state.claimInbound(input);
    const happy = new FakeHappy();
    const discord = new FakeDiscord();
    discord.sourceMessages.set(`${input.channelId}:${input.sourceMessageId}`, input);
    const bridge = new DiscordAgentBridge({
      config: config(),
      store: state,
      authorizer: { authorize: async (candidate, mode) => allowed(candidate, mode) },
      capabilities: new CapabilityRegistry(),
      happy,
      discord,
    });

    await bridge.reconcile();

    expect(happy.turns).toHaveLength(1);
    expect(discord.replies[0]).toMatchObject({ content: 'Ready.', sourceMessageId: 'source-1' });
    expect(state.getInbound('source-1')).toMatchObject({ status: 'delivered', deliveryKind: 'answer' });
  });

  it('keeps a recoverable claim pending while Discord refetch is transiently unavailable', async () => {
    const state = await store();
    await state.claimInbound(message());
    const discord = new FakeDiscord();
    const bridge = new DiscordAgentBridge({
      config: config(),
      store: state,
      authorizer: { authorize: async (candidate, mode) => allowed(candidate, mode) },
      capabilities: new CapabilityRegistry(),
      happy: new FakeHappy(),
      discord,
    });

    await bridge.reconcile();

    expect(state.getInbound('source-1')?.status).toBe('claimed');
    expect(discord.replies).toHaveLength(0);
  });

  it('settles a denial interrupted during Discord delivery without starting Codex', async () => {
    const state = await store();
    const input = message();
    await state.claimInbound(input);
    await state.updateInbound(input.sourceMessageId, {
      status: 'delivering',
      deliveryKind: 'denial',
    });
    const happy = new FakeHappy();
    const discord = new FakeDiscord();
    const authorize = vi.fn(async (candidate: NormalizedDiscordMessage, mode: 'personal' | 'shared-read-only') => (
      allowed(candidate, mode)
    ));
    const bridge = new DiscordAgentBridge({
      config: config(),
      store: state,
      authorizer: { authorize },
      capabilities: new CapabilityRegistry(),
      happy,
      discord,
    });

    await bridge.reconcile();

    expect(authorize).not.toHaveBeenCalled();
    expect(happy.turns).toHaveLength(0);
    expect(discord.replies[0].sourceMessageId).toBe('source-1:denied');
    expect(state.getInbound('source-1')).toMatchObject({ status: 'denied', deliveryKind: 'denial' });
  });

  it('retries an answer interrupted during Discord delivery without replacing it with a failure', async () => {
    const state = await store();
    const happy = new FakeHappy();
    happy.recovered = {
      result: { turnId: 'turn:source-1', status: 'completed', text: 'Ready.', messageIds: ['root-1'] },
      userMessageExists: true,
    };
    const discord = new FakeDiscord();
    discord.failuresRemaining = 1;
    const bridge = new DiscordAgentBridge({
      config: config(),
      store: state,
      authorizer: { authorize: async (candidate, mode) => allowed(candidate, mode) },
      capabilities: new CapabilityRegistry(),
      happy,
      discord,
    });

    await bridge.handle(message());
    expect(state.getInbound('source-1')).toMatchObject({ status: 'delivering', deliveryKind: 'answer' });
    expect(discord.replies).toHaveLength(0);

    await bridge.reconcile();
    expect(discord.replies).toEqual([{
      channelId: 'dm-channel-1',
      content: 'Ready.',
      sourceMessageId: 'source-1',
    }]);
    expect(state.getInbound('source-1')).toMatchObject({ status: 'delivered', deliveryKind: 'answer' });
  });

  it('retries an interrupted deterministic failure notice', async () => {
    const state = await store();
    const input = message();
    await state.claimInbound(input);
    await state.updateInbound(input.sourceMessageId, {
      status: 'delivering',
      deliveryKind: 'failure',
      failureReference: 'failure-reference',
    });
    const discord = new FakeDiscord();
    const bridge = new DiscordAgentBridge({
      config: config(),
      store: state,
      authorizer: { authorize: async (candidate, mode) => allowed(candidate, mode) },
      capabilities: new CapabilityRegistry(),
      happy: new FakeHappy(),
      discord,
    });

    await bridge.reconcile();

    expect(discord.replies[0]).toMatchObject({
      content: 'I couldn’t complete that request safely. Reference: failure-reference',
      sourceMessageId: 'source-1:failure',
    });
    expect(state.getInbound('source-1')).toMatchObject({ status: 'failed', deliveryKind: 'failure' });
  });

  it('never delivers partial text from a failed recovered Codex turn', async () => {
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
      result: { turnId: 'turn-1', status: 'failed', text: 'Unverified partial text.', messageIds: ['root'] },
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

    expect(discord.replies).toHaveLength(1);
    expect(discord.replies[0].content).not.toContain('Unverified partial text.');
    expect(discord.replies[0].content).toContain('Reference:');
    expect(state.getInbound('source-1')).toMatchObject({ status: 'failed', deliveryKind: 'failure' });
  });
});
