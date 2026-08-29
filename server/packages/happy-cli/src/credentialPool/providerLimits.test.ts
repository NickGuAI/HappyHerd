import { describe, expect, it } from 'vitest';

import {
  UNKNOWN_LIMIT_COOLDOWN_MS,
  classifyClaudeHardLimit,
  classifyCodexHardLimit,
  classifyGrokHardLimit,
} from './providerLimits';

describe('provider hard-limit classifiers', () => {
  const now = 1_800_000_000_000;

  it('accepts only rejected Claude rate-limit patches and preserves reset time', () => {
    expect(classifyClaudeHardLimit({
      capturedAt: now,
      windows: [{ id: 'five_hour', status: 'allowed_warning', utilization: 95, resetsAt: now + 1000 }],
    }, now)).toBeNull();
    expect(classifyClaudeHardLimit({
      capturedAt: now,
      windows: [{ id: 'five_hour', status: 'rejected', utilization: 100, resetsAt: now + 2000 }],
    }, now)).toEqual({ provider: 'claude', limitedUntil: now + 2000 });
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
});
