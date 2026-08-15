import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  AuthorizationDecision,
  AuthorizationGrant,
  CapabilityMode,
  NormalizedDiscordMessage,
} from './types';

export interface ActorAuthorizer {
  authorize(message: NormalizedDiscordMessage, requestedMode: CapabilityMode): Promise<AuthorizationDecision>;
}

export type PmaiAuthorizationClientOptions = {
  baseUrl: string;
  authorizationPath: string;
  bridgeId: string;
  signingSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

function nonEmptyString(value: unknown, label: string, maxLength = 8_192): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`Invalid PMAI authorization response: ${label}`);
  }
  return value;
}

function parseExpiry(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : (typeof value === 'string' ? Date.parse(value) : Number.NaN);
  if (!Number.isFinite(parsed)) {
    throw new Error('Invalid PMAI authorization response: delegation.expiresAt');
  }
  return parsed;
}

function parseGrant(
  raw: Record<string, unknown>,
  message: NormalizedDiscordMessage,
  requestedMode: CapabilityMode,
  now: number,
): AuthorizationGrant {
  const actor = raw.actor;
  const delegation = raw.delegation;
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
    throw new Error('Invalid PMAI authorization response: actor');
  }
  if (!delegation || typeof delegation !== 'object' || Array.isArray(delegation)) {
    throw new Error('Invalid PMAI authorization response: delegation');
  }
  const actorRecord = actor as Record<string, unknown>;
  const delegationRecord = delegation as Record<string, unknown>;
  const discordUserId = nonEmptyString(actorRecord.discordUserId, 'actor.discordUserId', 64);
  if (discordUserId !== message.authorDiscordId) {
    throw new Error('Invalid PMAI authorization response: actor/source mismatch');
  }
  if (raw.mode !== requestedMode) {
    throw new Error('Invalid PMAI authorization response: mode mismatch');
  }
  if (!Array.isArray(raw.scopes) || raw.scopes.some((scope) => typeof scope !== 'string')) {
    throw new Error('Invalid PMAI authorization response: scopes');
  }
  const expiresAt = parseExpiry(delegationRecord.expiresAt);
  if (expiresAt <= now || expiresAt > now + 15 * 60_000) {
    throw new Error('Invalid PMAI authorization response: delegation expiry');
  }
  const resources = raw.resources;
  if (!resources || typeof resources !== 'object' || Array.isArray(resources)) {
    throw new Error('Invalid PMAI authorization response: resources');
  }

  return {
    decision: 'allow',
    actor: {
      pmaiUserId: nonEmptyString(actorRecord.pmaiUserId, 'actor.pmaiUserId', 128),
      discordUserId,
    },
    mode: requestedMode,
    scopes: [...new Set(raw.scopes as string[])],
    resources: resources as Record<string, unknown>,
    delegation: {
      token: nonEmptyString(delegationRecord.token, 'delegation.token'),
      expiresAt,
    },
  };
}

export function verifyRequestSignature(
  secret: string,
  timestamp: string,
  nonce: string,
  bodyHash: string,
  candidate: string,
): boolean {
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\n${bodyHash}`)
    .digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(candidate, 'hex');
  } catch {
    return false;
  }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export class PmaiAuthorizationClient implements ActorAuthorizer {
  private readonly options: Required<Pick<PmaiAuthorizationClientOptions, 'fetchImpl' | 'now'>>
    & Omit<PmaiAuthorizationClientOptions, 'fetchImpl' | 'now'>;

  constructor(options: PmaiAuthorizationClientOptions) {
    this.options = {
      ...options,
      fetchImpl: options.fetchImpl ?? fetch,
      now: options.now ?? Date.now,
    };
  }

  async authorize(
    message: NormalizedDiscordMessage,
    requestedMode: CapabilityMode,
  ): Promise<AuthorizationDecision> {
    const body = JSON.stringify({
      schemaVersion: 1,
      requestedCapability: 'discord-agent.turn',
      requestedMode,
      source: {
        messageId: message.sourceMessageId,
        discordUserId: message.authorDiscordId,
        guildId: message.guildId,
        channelId: message.channelId,
        threadId: message.threadId,
        surfaceKind: message.surfaceKind,
      },
    });
    const timestamp = String(this.options.now());
    const nonce = randomUUID();
    const bodyHash = createHash('sha256').update(body).digest('hex');
    const signature = createHmac('sha256', this.options.signingSecret)
      .update(`${timestamp}\n${nonce}\n${bodyHash}`)
      .digest('hex');
    const url = new URL(this.options.authorizationPath, `${this.options.baseUrl}/`);

    let response: Response;
    try {
      response = await this.options.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-pmai-bridge-id': this.options.bridgeId,
          'x-pmai-timestamp': timestamp,
          'x-pmai-nonce': nonce,
          'x-pmai-content-sha256': bodyHash,
          'x-pmai-signature': signature,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new Error(`PMAI authorization unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!response.ok) {
      throw new Error(`PMAI authorization failed closed with HTTP ${response.status}`);
    }
    const raw = await response.json() as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Invalid PMAI authorization response');
    }
    const record = raw as Record<string, unknown>;
    if (record.decision === 'deny') {
      return {
        decision: 'deny',
        code: nonEmptyString(record.code, 'denial code', 128),
        ...(typeof record.safeMessage === 'string' && record.safeMessage.length <= 500
          ? { safeMessage: record.safeMessage }
          : {}),
      };
    }
    if (record.decision !== 'allow') {
      throw new Error('Invalid PMAI authorization response: decision');
    }
    return parseGrant(record, message, requestedMode, this.options.now());
  }
}
