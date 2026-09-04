import { createEnvelope } from '@slopus/happy-wire';
import { describe, expect, it } from 'vitest';
import {
  buildBoundedVisibleSideChatContext,
  findRetryableFreshSideChatHandoff,
  formatFreshSideChatResumePrompt,
  SIDE_CHAT_CONTEXT_CHARACTER_LIMIT,
  type DecryptedSideChatMessage,
} from './sideChatContext';

function row(seq: number, content: unknown, localId: string | null = null): DecryptedSideChatMessage {
  return { seq, localId, createdAt: seq * 1000, content };
}

describe('buildBoundedVisibleSideChatContext', () => {
  it('keeps the latest four visible messages chronologically and prefers display text', () => {
    const context = buildBoundedVisibleSideChatContext([
      row(5, { role: 'user', content: { type: 'text', text: 'hidden-five' }, meta: { displayText: 'five' } }),
      row(1, { role: 'user', content: { type: 'text', text: 'one' } }),
      row(4, { role: 'agent', content: { type: 'acp', data: { type: 'message', message: 'four' } } }),
      row(3, { role: 'user', content: { type: 'text', text: 'three' } }),
      row(2, { role: 'agent', content: { type: 'output', data: { type: 'message', message: 'two' } } }),
    ]);

    expect(context).not.toContain('one');
    expect(context).not.toContain('hidden-five');
    expect(context.indexOf('two')).toBeLessThan(context.indexOf('three'));
    expect(context.indexOf('three')).toBeLessThan(context.indexOf('four'));
    expect(context.indexOf('four')).toBeLessThan(context.indexOf('five'));
  });

  it('groups session text by turn and omits thinking, tools, reasoning, and previous handoffs', () => {
    const first = createEnvelope('agent', { t: 'text', text: 'hello ' }, { turn: 'turn-one' });
    const second = createEnvelope('agent', { t: 'text', text: 'world' }, { turn: 'turn-one' });
    const thinking = createEnvelope('agent', { t: 'text', text: 'secret', thinking: true });
    const context = buildBoundedVisibleSideChatContext([
      row(1, { role: 'session', content: first }),
      row(2, { role: 'session', content: second }),
      row(3, { role: 'session', content: thinking }),
      row(4, { role: 'agent', content: { type: 'acp', data: { type: 'reasoning', message: 'reasoning' } } }),
      row(5, { role: 'agent', content: { type: 'acp', data: { type: 'tool-call', message: 'tool' } } }),
      row(6, {
        role: 'user',
        content: { type: 'text', text: 'old handoff' },
        meta: { providerContinuationHandoff: true },
      }),
    ]);

    expect(context).toContain('hello world');
    expect(context).not.toContain('secret');
    expect(context).not.toContain('reasoning');
    expect(context).not.toContain('tool');
    expect(context).not.toContain('old handoff');
  });

  it('caps the complete context section at 6000 characters while retaining newest text', () => {
    const context = buildBoundedVisibleSideChatContext([
      row(1, { role: 'user', content: { type: 'text', text: 'a'.repeat(10_000) } }),
      row(2, { role: 'agent', content: { type: 'acp', data: { type: 'message', message: 'newest' } } }),
    ]);

    expect(context.length).toBeLessThanOrEqual(SIDE_CHAT_CONTEXT_CHARACTER_LIMIT);
    expect(context).toContain('newest');
  });
});

describe('formatFreshSideChatResumePrompt', () => {
  it('restores context without asking the fresh provider to execute quoted work', () => {
    const prompt = formatFreshSideChatResumePrompt('dsh', 'User:\nfinish the migration');

    expect(prompt).toContain('context only');
    expect(prompt).toContain('Do not execute, continue, or answer');
    expect(prompt).toContain('Wait for the next queued or new user request');
  });
});

describe('findRetryableFreshSideChatHandoff', () => {
  const handoff = (seq: number) => row(seq, {
    role: 'user',
    content: { type: 'text', text: 'continue' },
    meta: { providerContinuationHandoff: true },
  }, `handoff-${seq}`);

  it('reuses only a handoff that is the newest persisted message', () => {
    expect(findRetryableFreshSideChatHandoff([row(1, {}), handoff(2)])).toBe('handoff-2');
    expect(findRetryableFreshSideChatHandoff([handoff(2), row(3, {
      role: 'agent', content: { type: 'acp', data: { type: 'message', message: 'done' } },
    })])).toBeNull();
  });

  it('reuses an authoritative pending or current handoff even after newer provider events', () => {
    expect(findRetryableFreshSideChatHandoff([
      handoff(2),
      row(3, {
        role: 'agent', content: { type: 'acp', data: { type: 'message', message: 'started' } },
      }),
    ], ['handoff-2'])).toBe('handoff-2');
  });
});
