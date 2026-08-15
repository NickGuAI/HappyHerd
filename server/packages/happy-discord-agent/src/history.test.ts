import { describe, expect, it } from 'vitest';
import type { DecryptedMessage } from 'happy-agent/control';
import { findHistoricalTurnResult, hasInboundUserMessage } from './history';

function message(
  id: string,
  seq: number,
  content: unknown,
  localId: string | null = null,
): DecryptedMessage {
  return { id, seq, content, localId, createdAt: seq, updatedAt: seq };
}

describe('HappyHerd history recovery', () => {
  it('recovers only the root result after the deduplicated inbound message', () => {
    const messages = [
      message('old', 3, { role: 'user' }, 'discord:older'),
      message('user', 6, { role: 'user', content: { type: 'text', text: 'secret' } }, 'discord:source-1'),
      message('start', 7, { role: 'session', content: { role: 'agent', turn: 'turn-1', ev: { t: 'turn-start' } } }),
      message('thinking', 8, { role: 'session', content: { role: 'agent', turn: 'turn-1', ev: { t: 'text', text: 'reasoning', thinking: true } } }),
      message('child', 9, { role: 'session', content: { role: 'agent', turn: 'turn-1', subagent: 'child', ev: { t: 'text', text: 'child' } } }),
      message('root', 10, { role: 'session', content: { role: 'agent', turn: 'turn-1', ev: { t: 'text', text: 'Final answer' } } }),
      message('end', 11, { role: 'session', content: { role: 'agent', turn: 'turn-1', ev: { t: 'turn-end', status: 'completed' } } }),
    ];
    expect(hasInboundUserMessage(messages, 'discord:source-1', 5)).toBe(true);
    expect(findHistoricalTurnResult(messages, { localId: 'discord:source-1', afterSeq: 5 }))
      .toEqual({
        turnId: 'turn-1',
        status: 'completed',
        text: 'Final answer',
        messageIds: ['root'],
      });
  });

  it('returns null until the correlated turn ends', () => {
    const messages = [
      message('user', 1, { role: 'user' }, 'discord:source-1'),
      message('start', 2, { role: 'session', content: { role: 'agent', turn: 'turn-1', ev: { t: 'turn-start' } } }),
      message('root', 3, { role: 'session', content: { role: 'agent', turn: 'turn-1', ev: { t: 'text', text: 'partial' } } }),
    ];
    expect(findHistoricalTurnResult(messages, { localId: 'discord:source-1', afterSeq: 0 })).toBeNull();
  });
});
