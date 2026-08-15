import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PmaiAuthorizationClient, verifyRequestSignature } from './authorization';
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
      pmaiUserId: 'pmai-user-1',
      discordUserId: '123456789012345678',
    },
    mode: 'personal',
    scopes: ['crm.contacts.read'],
    resources: { crm: { profile: 'assigned_only' } },
    delegation: { token: 'delegation-token', expiresAt: NOW + 60_000 },
    ...overrides,
  };
}

describe('PmaiAuthorizationClient', () => {
  it('signs source metadata and accepts a source-bound short-lived grant', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const body = String(init?.body);
      const bodyHash = createHash('sha256').update(body).digest('hex');
      expect(headers.get('x-pmai-content-sha256')).toBe(bodyHash);
      expect(verifyRequestSignature(
        'service-secret',
        headers.get('x-pmai-timestamp')!,
        headers.get('x-pmai-nonce')!,
        bodyHash,
        headers.get('x-pmai-signature')!,
      )).toBe(true);
      expect(JSON.parse(body)).toMatchObject({
        requestedMode: 'personal',
        source: {
          messageId: 'discord-message-1',
          discordUserId: '123456789012345678',
        },
      });
      return new Response(JSON.stringify(allowResponse()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = new PmaiAuthorizationClient({
      baseUrl: 'https://www.pioneeringminds.ai',
      authorizationPath: '/api/internal/discord/authorize',
      bridgeId: 'pmai-discord',
      signingSecret: 'service-secret',
      fetchImpl,
      now: () => NOW,
    });

    await expect(client.authorize(message(), 'personal')).resolves.toMatchObject({
      decision: 'allow',
      actor: { pmaiUserId: 'pmai-user-1' },
      delegation: { token: 'delegation-token' },
    });
  });

  it('returns a bounded denial', async () => {
    const client = new PmaiAuthorizationClient({
      baseUrl: 'https://www.pioneeringminds.ai',
      authorizationPath: '/api/internal/discord/authorize',
      bridgeId: 'pmai-discord',
      signingSecret: 'service-secret',
      fetchImpl: async () => new Response(JSON.stringify({
        decision: 'deny',
        code: 'not_team',
        safeMessage: 'Link your PMAI team account first.',
      })),
      now: () => NOW,
    });
    await expect(client.authorize(message(), 'personal')).resolves.toEqual({
      decision: 'deny',
      code: 'not_team',
      safeMessage: 'Link your PMAI team account first.',
    });
  });

  it('fails closed on actor mismatch, long delegation, or upstream errors', async () => {
    for (const response of [
      allowResponse({ actor: { pmaiUserId: 'pmai-user-1', discordUserId: 'someone-else' } }),
      allowResponse({ delegation: { token: 'token', expiresAt: NOW + 30 * 60_000 } }),
    ]) {
      const client = new PmaiAuthorizationClient({
        baseUrl: 'https://www.pioneeringminds.ai',
        authorizationPath: '/api/internal/discord/authorize',
        bridgeId: 'pmai-discord',
        signingSecret: 'service-secret',
        fetchImpl: async () => new Response(JSON.stringify(response)),
        now: () => NOW,
      });
      await expect(client.authorize(message(), 'personal')).rejects.toThrow('Invalid PMAI authorization response');
    }

    const unavailable = new PmaiAuthorizationClient({
      baseUrl: 'https://www.pioneeringminds.ai',
      authorizationPath: '/api/internal/discord/authorize',
      bridgeId: 'pmai-discord',
      signingSecret: 'service-secret',
      fetchImpl: async () => new Response('error', { status: 500 }),
      now: () => NOW,
    });
    await expect(unavailable.authorize(message(), 'personal')).rejects.toThrow('failed closed');
  });
});
