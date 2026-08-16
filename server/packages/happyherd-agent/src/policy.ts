import type { BridgeConfig } from './config';
import type { CapabilityMode, NormalizedDiscordMessage } from './types';

export type MessagePolicyDecision =
  | { accepted: true; mode: CapabilityMode }
  | { accepted: false; code: string; reply: boolean };

export function evaluateMessagePolicy(
  message: NormalizedDiscordMessage,
  config: Pick<BridgeConfig, 'allowedGuildIds' | 'allowedChannelIds'>,
): MessagePolicyDecision {
  if (message.authorIsBot) {
    return { accepted: false, code: 'bot_loop', reply: false };
  }
  if (!message.content.trim()) {
    return { accepted: false, code: 'empty_message', reply: false };
  }

  if (message.surfaceKind === 'dm') {
    return { accepted: true, mode: 'personal' };
  }

  if (!message.guildId) {
    return { accepted: false, code: 'invalid_guild_surface', reply: false };
  }
  if (config.allowedGuildIds.size > 0 && !config.allowedGuildIds.has(message.guildId)) {
    return { accepted: false, code: 'guild_not_allowed', reply: false };
  }
  const channelAllowed = config.allowedChannelIds.size === 0
    || config.allowedChannelIds.has(message.channelId)
    || (message.parentChannelId !== null && config.allowedChannelIds.has(message.parentChannelId));
  if (!channelAllowed) {
    return { accepted: false, code: 'channel_not_allowed', reply: false };
  }
  if (!message.mentionsApplication) {
    return { accepted: false, code: 'mention_required', reply: false };
  }

  return { accepted: true, mode: 'shared-read-only' };
}

export function surfaceKeyFor(input: {
  authorDiscordId: string;
  channelId: string;
  guildId: string | null;
  isThread: boolean;
}): { surfaceKey: string; surfaceKind: NormalizedDiscordMessage['surfaceKind'] } {
  if (!input.guildId) {
    return { surfaceKey: `dm:${input.authorDiscordId}`, surfaceKind: 'dm' };
  }
  if (input.isThread) {
    return {
      surfaceKey: `thread:${input.guildId}:${input.channelId}`,
      surfaceKind: 'guild-thread',
    };
  }
  return {
    surfaceKey: `channel:${input.guildId}:${input.channelId}`,
    surfaceKind: 'guild-channel',
  };
}

export function stripApplicationMention(content: string, applicationId: string): string {
  return content
    .replaceAll(`<@${applicationId}>`, '')
    .replaceAll(`<@!${applicationId}>`, '')
    .trim();
}
