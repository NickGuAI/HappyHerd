import { createHash } from 'node:crypto';
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  Routes,
  type Message,
} from 'discord.js';
import { stripApplicationMention, surfaceKeyFor } from './policy';
import type { NormalizedDiscordMessage } from './types';

export interface DiscordReplyTransport {
  sendReply(channelId: string, content: string, sourceMessageId: string): Promise<string[]>;
  fetchMessage(channelId: string, sourceMessageId: string): Promise<NormalizedDiscordMessage>;
}

export type CommunityChannel = {
  id: string;
  guildId: string;
  name: string;
  parentId: string | null;
};

export type CommunityMessage = {
  id: string;
  channelId: string;
  authorDiscordId: string;
  authorDisplayName: string;
  content: string;
  createdAt: number;
};

export interface DiscordCommunityTransport extends DiscordReplyTransport {
  listChannels(guildIds: Set<string>, channelIds: Set<string>): Promise<CommunityChannel[]>;
  listMessages(channelId: string, limit: number): Promise<CommunityMessage[]>;
  addReaction(channelId: string, messageId: string, reaction: string): Promise<void>;
}

export function chunkDiscordMessage(content: string, limit = 1_900): string[] {
  const remaining = Array.from(content.trim());
  if (remaining.length === 0) {
    return ['No response was produced.'];
  }
  const chunks: string[] = [];
  while (remaining.length > limit) {
    let splitAt = remaining.slice(0, limit + 1).lastIndexOf('\n');
    if (splitAt < Math.floor(limit * 0.6)) {
      splitAt = limit;
    }
    chunks.push(remaining.splice(0, splitAt).join('').trimEnd());
    while (remaining[0] === '\n') {
      remaining.shift();
    }
  }
  if (remaining.length > 0) {
    chunks.push(remaining.join(''));
  }
  return chunks;
}

function nonceFor(sourceMessageId: string, index: number): string {
  const hex = createHash('sha256').update(`${sourceMessageId}:${index}`).digest('hex').slice(0, 16);
  return BigInt(`0x${hex}`).toString(10);
}

export function normalizeDiscordMessage(
  message: Message,
  applicationId: string,
): NormalizedDiscordMessage {
  const isThread = message.channel.isThread();
  const { surfaceKey, surfaceKind } = surfaceKeyFor({
    authorDiscordId: message.author.id,
    channelId: message.channelId,
    guildId: message.guildId,
    isThread,
  });
  return {
    sourceMessageId: message.id,
    authorDiscordId: message.author.id,
    channelId: message.channelId,
    parentChannelId: isThread ? message.channel.parentId : null,
    guildId: message.guildId,
    threadId: isThread ? message.channelId : null,
    surfaceKind,
    surfaceKey,
    content: stripApplicationMention(message.content, applicationId),
    mentionsApplication: message.mentions.has(applicationId),
    authorIsBot: message.author.bot,
    createdAt: message.createdTimestamp,
  };
}

export class DiscordGateway implements DiscordCommunityTransport {
  private readonly applicationId: string;
  private readonly client: Client;
  private ready = false;

  constructor(applicationId: string, onError: (error: Error) => void = () => {}) {
    this.applicationId = applicationId;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });
    this.client.once(Events.ClientReady, () => {
      this.ready = true;
    });
    this.client.on(Events.ShardReady, () => {
      this.ready = true;
    });
    this.client.on(Events.ShardResume, () => {
      this.ready = true;
    });
    this.client.on(Events.ShardDisconnect, () => {
      this.ready = false;
    });
    this.client.on(Events.Error, onError);
    this.client.on(Events.ShardError, onError);
  }

  onMessage(handler: (message: NormalizedDiscordMessage) => Promise<void>): void {
    this.client.on(Events.MessageCreate, (message) => {
      void handler(normalizeDiscordMessage(message, this.applicationId));
    });
  }

  async start(token: string): Promise<void> {
    await this.client.login(token);
  }

  isReady(): boolean {
    return this.ready && this.client.isReady();
  }

  async sendReply(channelId: string, content: string, sourceMessageId: string): Promise<string[]> {
    const chunks = chunkDiscordMessage(content);
    const messageIds: string[] = [];
    for (const [index, chunk] of chunks.entries()) {
      const response = await this.client.rest.post(Routes.channelMessages(channelId), {
        body: {
          content: chunk,
          nonce: nonceFor(sourceMessageId, index),
          enforce_nonce: true,
          allowed_mentions: { parse: [] },
        },
      }) as { id?: unknown };
      if (typeof response.id !== 'string') {
        throw new Error('Discord create-message response did not contain an id');
      }
      messageIds.push(response.id);
    }
    return messageIds;
  }

  async fetchMessage(channelId: string, sourceMessageId: string): Promise<NormalizedDiscordMessage> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) {
      throw new Error('Discord source channel is not message-readable');
    }
    const message = await channel.messages.fetch(sourceMessageId);
    return normalizeDiscordMessage(message, this.applicationId);
  }

  async listChannels(guildIds: Set<string>, channelIds: Set<string>): Promise<CommunityChannel[]> {
    const result: CommunityChannel[] = [];
    for (const guildId of guildIds) {
      const guild = await this.client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();
      for (const channel of channels.values()) {
        if (!channel || !channel.isTextBased() || channel.isDMBased()) {
          continue;
        }
        if (channelIds.size > 0 && !channelIds.has(channel.id) && !channel.parentId) {
          continue;
        }
        const parentAllowed = channel.parentId !== null && channelIds.has(channel.parentId);
        if (channelIds.size > 0 && !channelIds.has(channel.id) && !parentAllowed) {
          continue;
        }
        result.push({
          id: channel.id,
          guildId,
          name: 'name' in channel && typeof channel.name === 'string' ? channel.name : channel.id,
          parentId: channel.parentId,
        });
      }
    }
    return result.sort((left, right) => left.name.localeCompare(right.name));
  }

  async listMessages(channelId: string, limit: number): Promise<CommunityMessage[]> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) {
      throw new Error('Discord channel is not message-readable');
    }
    const messages = await channel.messages.fetch({ limit: Math.max(1, Math.min(limit, 50)) });
    return [...messages.values()]
      .sort((left, right) => left.createdTimestamp - right.createdTimestamp)
      .map((message) => ({
        id: message.id,
        channelId: message.channelId,
        authorDiscordId: message.author.id,
        authorDisplayName: message.member?.displayName ?? message.author.displayName,
        content: message.content,
        createdAt: message.createdTimestamp,
      }));
  }

  async addReaction(channelId: string, messageId: string, reaction: string): Promise<void> {
    if (!reaction || reaction.length > 64) {
      throw new Error('Discord reaction is invalid');
    }
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) {
      throw new Error('Discord channel is not message-readable');
    }
    const message = await channel.messages.fetch(messageId);
    await message.react(reaction);
  }

  async stop(): Promise<void> {
    this.ready = false;
    await this.client.destroy();
  }
}
