import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { PmaiSkillBroker } from './broker';
import type { BridgeConfig } from './config';
import type { DiscordCommunityTransport } from './discord';
import type { BridgeStore } from './store';
import { PMAI_SKILL_FAMILIES, type PmaiSkillFamily, type SkillCallRequest } from './types';

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 262_144) {
      throw new Error('request_too_large');
    }
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid_json_object');
  }
  return parsed as Record<string, unknown>;
}

function bearerMatches(request: IncomingMessage, expected: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return false;
  }
  const candidate = Buffer.from(header.slice('Bearer '.length));
  const expectedBuffer = Buffer.from(expected);
  return candidate.length === expectedBuffer.length && timingSafeEqual(candidate, expectedBuffer);
}

function requiredString(body: Record<string, unknown>, key: string, maxLength = 4_000): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`invalid_${key}`);
  }
  return value;
}

function isSkillFamily(value: unknown): value is PmaiSkillFamily {
  return typeof value === 'string' && (PMAI_SKILL_FAMILIES as readonly string[]).includes(value);
}

export class BridgeHttpServer {
  private readonly server: Server;

  constructor(options: {
    config: BridgeConfig;
    broker: PmaiSkillBroker;
    store: BridgeStore;
    discord: DiscordCommunityTransport;
    transportSecret: string;
    readiness: () => Record<string, boolean> | Promise<Record<string, boolean>>;
  }) {
    const { config, broker, store, discord, transportSecret, readiness } = options;
    const channelAllowed = (channelId: string) => (
      config.allowedChannelIds.has(channelId) || store.hasChannelBinding(channelId)
    );

    this.server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
        if (request.method === 'GET' && url.pathname === '/healthz') {
          const checks = await readiness();
          const ready = Object.values(checks).every(Boolean);
          json(response, ready ? 200 : 503, { ready, checks });
          return;
        }

        if (request.method === 'POST' && url.pathname === '/mcp') {
          const authorization = request.headers.authorization;
          const capabilityId = authorization?.startsWith('Bearer ')
            ? authorization.slice('Bearer '.length)
            : '';
          if (!capabilityId) {
            json(response, 401, { code: 'capability_required' });
            return;
          }
          const body = await readJson(request);
          if (!isSkillFamily(body.family)) {
            json(response, 404, { code: 'skill_family_not_allowed' });
            return;
          }
          const operation = requiredString(body, 'operation', 64);
          const args = body.arguments;
          if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) {
            throw new Error('invalid_arguments');
          }
          const call: SkillCallRequest = {
            family: body.family,
            operation,
            arguments: (args ?? {}) as Record<string, unknown>,
          };
          const result = await broker.call(capabilityId, call);
          json(response, result.status, result.body);
          return;
        }

        if (request.method === 'POST' && url.pathname === '/internal/discord/execute') {
          if (!bearerMatches(request, transportSecret)) {
            json(response, 401, { code: 'service_auth_required' });
            return;
          }
          const body = await readJson(request);
          const operation = requiredString(body, 'operation', 64);
          const input = body.input;
          if (!input || typeof input !== 'object' || Array.isArray(input)) {
            throw new Error('invalid_input');
          }
          const args = input as Record<string, unknown>;

          if (operation === 'channels.list') {
            const channels = await discord.listChannels(config.allowedGuildIds, config.allowedChannelIds);
            json(response, 200, { channels });
            return;
          }

          const channelId = requiredString(args, 'channelId', 64);
          if (!channelAllowed(channelId)) {
            json(response, 403, { code: 'channel_not_allowed' });
            return;
          }
          if (operation === 'messages.list') {
            const requestedLimit = typeof args.limit === 'number' ? args.limit : 25;
            const messages = await discord.listMessages(channelId, requestedLimit);
            json(response, 200, { messages });
            return;
          }
          if (operation === 'messages.send') {
            const content = requiredString(args, 'content', 8_000);
            const sourceRequestId = requiredString(args, 'sourceRequestId', 128);
            const messageIds = await discord.sendReply(channelId, content, `transport:${sourceRequestId}`);
            json(response, 200, { messageIds });
            return;
          }
          if (operation === 'reactions.add') {
            const messageId = requiredString(args, 'messageId', 64);
            const reaction = requiredString(args, 'reaction', 64);
            await discord.addReaction(channelId, messageId, reaction);
            json(response, 200, { added: true });
            return;
          }
          json(response, 404, { code: 'discord_operation_not_allowed' });
          return;
        }

        json(response, 404, { code: 'not_found' });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'request_failed';
        const clientError = code.startsWith('invalid_') || code === 'request_too_large';
        json(response, clientError ? 400 : 500, { code: clientError ? code : 'internal_error' });
      }
    });
  }

  async listen(host: string, port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off('error', onError);
        resolve();
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(port, host);
    });
  }

  port(): number {
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Bridge HTTP server is not listening on a TCP port');
    }
    return address.port;
  }

  async close(): Promise<void> {
    if (!this.server.listening) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }
}
