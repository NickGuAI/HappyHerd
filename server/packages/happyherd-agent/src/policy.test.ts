import { describe, expect, it } from 'vitest';
import { evaluateMessagePolicy, stripApplicationMention, surfaceKeyFor } from './policy';
import type { NormalizedDiscordMessage } from './types';

function message(overrides: Partial<NormalizedDiscordMessage> = {}): NormalizedDiscordMessage {
  return {
    sourceMessageId: 'message-1',
    authorDiscordId: 'user-1',
    channelId: 'channel-1',
    parentChannelId: null,
    guildId: null,
    threadId: null,
    surfaceKind: 'dm',
    surfaceKey: 'dm:user-1',
    content: 'hello',
    mentionsApplication: false,
    authorIsBot: false,
    createdAt: 1,
    ...overrides,
  };
}

describe('Discord message policy', () => {
  const config = {
    allowedGuildIds: new Set(['guild-1']),
    allowedChannelIds: new Set(['parent-1']),
  };

  it('accepts member DMs as personal surfaces', () => {
    expect(evaluateMessagePolicy(message(), config)).toEqual({ accepted: true, mode: 'personal' });
  });

  it('accepts only mentioned, allowlisted guild threads as shared read-only', () => {
    expect(evaluateMessagePolicy(message({
      channelId: 'thread-1',
      parentChannelId: 'parent-1',
      guildId: 'guild-1',
      threadId: 'thread-1',
      surfaceKind: 'guild-thread',
      surfaceKey: 'thread:guild-1:thread-1',
      mentionsApplication: true,
    }), config)).toEqual({ accepted: true, mode: 'shared-read-only' });
  });

  it('silently rejects bot loops, missing mentions, and wrong channels', () => {
    expect(evaluateMessagePolicy(message({ authorIsBot: true }), config)).toMatchObject({ accepted: false, code: 'bot_loop' });
    expect(evaluateMessagePolicy(message({ guildId: 'guild-1', surfaceKind: 'guild-channel' }), config)).toMatchObject({ accepted: false, code: 'channel_not_allowed' });
    expect(evaluateMessagePolicy(message({
      guildId: 'guild-1',
      surfaceKind: 'guild-channel',
      channelId: 'parent-1',
    }), config)).toMatchObject({ accepted: false, code: 'mention_required' });
  });
});

describe('Discord surface normalization', () => {
  it('builds per-user DM and per-thread keys', () => {
    expect(surfaceKeyFor({ authorDiscordId: 'u1', channelId: 'dm1', guildId: null, isThread: false }))
      .toEqual({ surfaceKey: 'dm:u1', surfaceKind: 'dm' });
    expect(surfaceKeyFor({ authorDiscordId: 'u1', channelId: 't1', guildId: 'g1', isThread: true }))
      .toEqual({ surfaceKey: 'thread:g1:t1', surfaceKind: 'guild-thread' });
  });

  it('removes only the organization application mention', () => {
    expect(stripApplicationMention('<@123> hello <@456>', '123')).toBe('hello <@456>');
  });
});
