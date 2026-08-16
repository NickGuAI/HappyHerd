import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ServiceAuthorizationClient, verifyRequestSignature } from './authorization';
import type { NormalizedDiscordMessage } from './types';

const NOW = 1_786_800_000_000;

function message(): NormalizedDiscordMessage {
  return {
    sourceMessageId: 'discord-message-1',
    authorDiscordId: '123456789012345678',
    channelId: 'dm-channel-1',
    parentChannelId: null,
    guildId: null,
    threadId: null,
    surfaceKind: 'dm',
    surfaceKey: 'dm:123456789012345678',
    content: 'hello',
    mentionsApplication: false,
    authorIsBot: false,
    createdAt: NOW,
  };
}

function allowResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decision: 'allow',
    actor: {
      subjectId: 'member-1',
      discordUserId: '123456789012345678',
    },
    mode: 'personal',
    scopes: ['crm.contacts.read'],
    resources: { crm: { profile: 'assigned_only' } },
    delegation: { token: 'delegation-token', expiresAt: NOW + 60_000 },
    ...overrides,
  };
}

describe('ServiceAuthorizationClient', () => {
  it('signs source metadata and accepts a source-bound short-lived grant', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const body = String(init?.body);
      const bodyHash = createHash('sha256').update(body).digest('hex');
      expect(headers.get('x-happyherd-agent-content-sha256')).toBe(bodyHash);
      expect(verifyRequestSignature(
        'service-secret',
        headers.get('x-happyherd-agent-id')!,
        headers.get('x-happyherd-agent-timestamp')!,
        headers.get('x-happyherd-agent-nonce')!,
        bodyHash,
        headers.get('x-happyherd-agent-signature')!,
      )).toBe(true);
      expect(verifyRequestSignature(
        'service-secret',
        'different-agent',
        headers.get('x-happyherd-agent-timestamp')!,
        headers.get('x-happyherd-agent-nonce')!,
        bodyHash,
        headers.get('x-happyherd-agent-signature')!,
      )).toBe(false);
      expect(JSON.parse(body)).toMatchObject({
        requestedMode: 'personal',
        source: {
          messageId: 'discord-message-1',
          discordUserId: '123456789012345678',
          parentChannelId: null,
        },
      });
      return new Response(JSON.stringify(allowResponse()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = new ServiceAuthorizationClient({
      baseUrl: 'https://service.example',
      authorizationPath: '/api/internal/discord/authorize',
      agentId: 'example-agent',
      signingSecret: 'service-secret',
      fetchImpl,
      now: () => NOW,
    });

    await expect(client.authorize(message(), 'personal')).resolves.toMatchObject({
      decision: 'allow',
      actor: { subjectId: 'member-1' },
      delegation: { token: 'delegation-token' },
    });
  });

  it('sends an exact link code only through the signed link capability', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        requestedCapability: 'discord-agent.link',
        linkCode: 'EXAMPLE-CODE-1234',
        source: {
          discordUserId: '123456789012345678',
          channelId: 'dm-channel-1',
        },
      });
      return new Response(JSON.stringify({
        decision: 'linked',
        safeMessage: 'Account connected.',
      }), { headers: { 'content-type': 'application/json' } });
    });
    const client = new ServiceAuthorizationClient({
      baseUrl: 'https://service.example',
      authorizationPath: '/api/internal/discord/authorize',
      agentId: 'example-agent',
      signingSecret: 'service-secret',
      fetchImpl,
      now: () => NOW,
    });

    await expect(client.link(message(), 'EXAMPLE-CODE-1234')).resolves.toEqual({
      decision: 'linked',
      safeMessage: 'Account connected.',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('returns a bounded denial', async () => {
    const client = new ServiceAuthorizationClient({
      baseUrl: 'https://service.example',
      authorizationPath: '/api/internal/discord/authorize',
      agentId: 'example-agent',
      signingSecret: 'service-secret',
      fetchImpl: async () => new Response(JSON.stringify({
        decision: 'deny',
        code: 'not_team',
        safeMessage: 'Link your service account first.',
      })),
      now: () => NOW,
    });
    await expect(client.authorize(message(), 'personal')).resolves.toEqual({
      decision: 'deny',
      code: 'not_team',
      safeMessage: 'Link your service account first.',
    });
  });

  it('fails closed on actor mismatch, long delegation, or upstream errors', async () => {
    for (const response of [
      allowResponse({ actor: { subjectId: 'member-1', discordUserId: 'someone-else' } }),
      allowResponse({ delegation: { token: 'token', expiresAt: NOW + 30 * 60_000 } }),
    ]) {
      const client = new ServiceAuthorizationClient({
        baseUrl: 'https://service.example',
        authorizationPath: '/api/internal/discord/authorize',
        agentId: 'example-agent',
        signingSecret: 'service-secret',
        fetchImpl: async () => new Response(JSON.stringify(response)),
        now: () => NOW,
      });
      await expect(client.authorize(message(), 'personal')).rejects.toThrow('Invalid service authorization response');
    }

    const unavailable = new ServiceAuthorizationClient({
      baseUrl: 'https://service.example',
      authorizationPath: '/api/internal/discord/authorize',
      agentId: 'example-agent',
      signingSecret: 'service-secret',
      fetchImpl: async () => new Response('error', { status: 500 }),
      now: () => NOW,
    });
    await expect(unavailable.authorize(message(), 'personal')).rejects.toThrow('failed closed');
  });
});
