import type { UsageLimitsPatch } from '@/claude/utils/usageLimits';
import type { CredentialProvider } from './types';

export const UNKNOWN_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;

export type ProviderHardLimit = {
  provider: CredentialProvider;
  limitedUntil: number;
};

function epochMilliseconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string' && value.length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return epochMilliseconds(numeric);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nestedValues(value: unknown, depth = 0): unknown[] {
  if (depth > 6) return [];
  if (value instanceof Error) {
    return [value, value.message, ...nestedValues(value.cause, depth + 1)];
  }
  const object = record(value);
  if (!object) return [value];
  return [value, ...Object.values(object).flatMap((child) => nestedValues(child, depth + 1))];
}

function resetFrom(value: unknown, now: number): number {
  for (const candidate of nestedValues(value)) {
    const object = record(candidate);
    if (!object) continue;
    for (const key of ['resetsAt', 'resetAt', 'resets_at', 'reset_at']) {
      const parsed = epochMilliseconds(object[key]);
      if (parsed && parsed > now) return parsed;
    }
    for (const key of ['resetsInSeconds', 'resetAfterSeconds', 'retryAfterSeconds']) {
      const seconds = Number(object[key]);
      if (Number.isFinite(seconds) && seconds > 0) return now + seconds * 1000;
    }
  }
  return now + UNKNOWN_LIMIT_COOLDOWN_MS;
}

function normalizedStrings(value: unknown): string[] {
  return nestedValues(value)
    .filter((candidate): candidate is string => typeof candidate === 'string')
    .map((candidate) => candidate.toLowerCase().replace(/[^a-z0-9]+/g, ''));
}

export function classifyClaudeHardLimit(
  patch: UsageLimitsPatch,
  now: number = Date.now(),
): ProviderHardLimit | null {
  const rejected = [
    ...patch.windows.filter((window) => window.status === 'rejected'),
    ...(patch.unbound?.status === 'rejected' ? [patch.unbound] : []),
  ];
  if (rejected.length === 0) return null;
  const futureResets = rejected
    .map((window) => epochMilliseconds(window.resetsAt))
    .filter((value): value is number => value !== null && value > now);
  return {
    provider: 'claude',
    limitedUntil: futureResets.length > 0
      ? Math.min(...futureResets)
      : now + UNKNOWN_LIMIT_COOLDOWN_MS,
  };
}

function codexSnapshotExhausted(value: unknown): boolean {
  for (const candidate of nestedValues(value)) {
    const object = record(candidate);
    if (!object) continue;
    const usedPercent = Number(object.usedPercent ?? object.used_percent);
    if (Number.isFinite(usedPercent) && usedPercent >= 100) return true;
    if (object.remaining === 0 || object.remaining === '0') return true;
  }
  return false;
}

export function classifyCodexHardLimit(
  event: unknown,
  now: number = Date.now(),
): ProviderHardLimit | null {
  const object = record(event);
  const type = typeof object?.type === 'string' ? object.type : '';
  const isSnapshot = type === 'account_rate_limits_updated';
  const isTerminalFailure = (type === 'task_complete' || type === 'turn_aborted')
    && (object?.status === 'failed' || (object?.error !== null && object?.error !== undefined));
  const isErrorEvent = type === 'error' || type.endsWith('_error');
  if (!isSnapshot && !isTerminalFailure && !isErrorEvent) return null;
  const strings = normalizedStrings(event);
  const hardFailure = strings.some((value) => (
    value === 'usagelimitexceeded'
    || value === 'ratelimitexceeded'
    || value === 'usage_limit_exceeded'
    || value.includes('usagelimitexceeded')
  ));
  const status429 = nestedValues(event).some((candidate) => {
    const candidateRecord = record(candidate);
    return candidateRecord?.status === 429
      || candidateRecord?.statusCode === 429
      || candidateRecord?.code === 429;
  });
  if (!(hardFailure || status429 || (isSnapshot && codexSnapshotExhausted(event)))) return null;
  return { provider: 'codex', limitedUntil: resetFrom(event, now) };
}

export function classifyGrokHardLimit(
  error: unknown,
  now: number = Date.now(),
): ProviderHardLimit | null {
  const strings = normalizedStrings(error);
  const hardFailure = strings.some((value) => (
    value === 'ratelimit'
    || value === 'rate_limit'
    || value === 'ratelimitexceeded'
    || value.includes('ratelimit')
  ));
  const status429 = nestedValues(error).some((candidate) => {
    const candidateRecord = record(candidate);
    return candidateRecord?.status === 429
      || candidateRecord?.statusCode === 429
      || candidateRecord?.code === 429;
  });
  if (!hardFailure && !status429) return null;
  return { provider: 'grok', limitedUntil: resetFrom(error, now) };
}
