import { describe, expect, it } from 'vitest';

import {
  UNKNOWN_LIMIT_COOLDOWN_MS,
  classifyClaudeApiHardLimit,
  classifyClaudeHardLimit,
  classifyCodexHardLimit,
  classifyDshHardLimit,
  classifyGrokHardLimit,
} from './providerLimits';

describe('provider hard-limit classifiers', () => {
  const now = 1_800_000_000_000;

  it.each([
    'five_hour',
    'seven_day',
    'seven_day_overage_included',
    'seven_day_opus',
    'future_window_from_claude',
  ])('classifies rejected Claude %s windows and preserves reset time', (id) => {
    expect(classifyClaudeHardLimit({
      providerAccount: 'personal',
      capturedAt: now,
      windows: [{ id, status: 'rejected', utilization: 100, resetsAt: now + 2000 }],
    }, now)).toEqual({ provider: 'claude', limitedUntil: now + 2000 });
  });

  it('classifies an unbound rejected Claude event with the bounded fallback cooldown', () => {
    expect(classifyClaudeHardLimit({
      providerAccount: 'personal',
      capturedAt: now,
      windows: [],
      unbound: { status: 'rejected' },
    }, now)).toEqual({ provider: 'claude', limitedUntil: now + UNKNOWN_LIMIT_COOLDOWN_MS });
  });

  it('does not rotate for a Claude allowed_warning event', () => {
    expect(classifyClaudeHardLimit({
      capturedAt: now,
      windows: [{ id: 'five_hour', status: 'allowed_warning', utilization: 95, resetsAt: now + 1000 }],
    }, now)).toBeNull();
  });

  it('uses only provider-marked Claude API-error text for the compatibility fallback', () => {
    const providerError = {
      type: 'assistant',
      error: 'rate_limit',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: "You've reached your Fable 5 limit." }],
      },
    };
    expect(classifyClaudeApiHardLimit(providerError, now)).toEqual({
      provider: 'claude',
      limitedUntil: now + UNKNOWN_LIMIT_COOLDOWN_MS,
    });
    expect(classifyClaudeApiHardLimit({
      ...providerError,
      error: undefined,
    }, now)).toBeNull();
    expect(classifyClaudeApiHardLimit({
      type: 'user',
      error: 'rate_limit',
      message: providerError.message,
    }, now)).toBeNull();
    expect(classifyClaudeApiHardLimit({
      ...providerError,
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', input: { quote: "You've hit your limit" } }],
      },
    }, now)).toBeNull();
    expect(classifyClaudeApiHardLimit({
      ...providerError,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: "You're close to your limit" }],
      },
    }, now)).toBeNull();
  });

  it('classifies Codex usageLimitExceeded failures and exhausted snapshots', () => {
    expect(classifyCodexHardLimit({
      type: 'task_complete',
      status: 'failed',
      error: { code: 'usageLimitExceeded', resetsAt: (now + 3000) / 1000 },
    }, now)).toEqual({ provider: 'codex', limitedUntil: now + 3000 });
    expect(classifyCodexHardLimit({
      type: 'account_rate_limits_updated',
      rateLimits: { primary: { usedPercent: 100, resetsAt: (now + 4000) / 1000 } },
    }, now)).toEqual({ provider: 'codex', limitedUntil: now + 4000 });
    expect(classifyCodexHardLimit({ type: 'task_complete', status: 'completed' }, now)).toBeNull();
    expect(classifyCodexHardLimit({ type: 'agent_message', message: 'The phrase usage limit exceeded is user content.' }, now)).toBeNull();
  });

  it('classifies Grok ACP rate_limit failures with a bounded fallback cooldown', () => {
    expect(classifyGrokHardLimit(new Error('rate_limit'), now)).toEqual({
      provider: 'grok',
      limitedUntil: now + UNKNOWN_LIMIT_COOLDOWN_MS,
    });
    expect(classifyGrokHardLimit({ code: 'other_error' }, now)).toBeNull();
  });

  it('classifies dsh ACP quota failures without treating ordinary errors as quota exhaustion', () => {
    expect(classifyDshHardLimit(new Error('DeepSeek API error: quota exhausted for this account'), now)).toEqual({
      provider: 'dsh',
      limitedUntil: now + UNKNOWN_LIMIT_COOLDOWN_MS,
    });
    expect(classifyDshHardLimit({ statusCode: 429, retryAfterSeconds: 30 }, now)).toEqual({
      provider: 'dsh',
      limitedUntil: now + 30_000,
    });
    expect(classifyDshHardLimit(new Error('provider session ended'), now)).toBeNull();
  });
});
