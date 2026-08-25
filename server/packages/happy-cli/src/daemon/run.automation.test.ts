import { describe, expect, it, vi } from 'vitest';

import type { Metadata } from '@/api/types';
import type { HappyHerdAutomationRun } from '@slopus/happy-wire';
import {
  automationRunDeadlineAt,
  automationRunTimeoutMinutes,
  scheduleAutomationRunDeadline,
  automationSessionMatchesRun,
  automationProviderCommandMatches,
  automationWebhookMatchesTrackedSession,
  exactAutomationProviderOutcome,
  resolveExitedAutomationProviderOutcome,
  terminateAutomationProviderBeforeTimeoutConfirmation,
} from './run';

const automationId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';

function activeRun(): HappyHerdAutomationRun {
  return {
    id: runId,
    automationId,
    source: 'schedule',
    scheduledFor: '2026-08-16T00:00:00.000Z',
    startedAt: '2026-08-16T00:00:01.000Z',
    finishedAt: null,
    status: 'started',
    attempt: 1,
    sessionId: 'session-one',
    message: null,
  };
}

function automationMetadata(overrides: Partial<Metadata> = {}): Metadata {
  return {
    path: '/srv/app',
    host: 'host',
    homeDir: '/home/test',
    happyHomeDir: '/home/test/.happy',
    happyLibDir: '/srv/happy',
    happyToolsDir: '/srv/happy/tools',
    startedFromDaemon: true,
    hostPid: 42,
    automationId,
    automationRunId: runId,
    automationProviderOutcome: {
      schemaVersion: 1,
      automationId,
      runId,
      status: 'completed',
      finishedAt: '2026-08-16T00:05:00.000Z',
      message: null,
    },
    ...overrides,
  };
}

function trackedSession(metadata = automationMetadata()) {
  return {
    startedBy: 'daemon',
    happySessionId: 'session-one',
    happySessionMetadataFromLocalWebhook: metadata,
    pid: 42,
    automationId,
    automationRunId: runId,
  };
}

describe('daemon automation lifecycle guardrails', () => {
  it('requires exact automation, run, session, PID, and daemon provenance', () => {
    const run = activeRun();
    const session = trackedSession();
    expect(automationSessionMatchesRun(run, session)).toBe(true);
    expect(automationSessionMatchesRun(run, {
      ...session,
      happySessionId: 'ordinary-session',
    })).toBe(false);
    expect(automationSessionMatchesRun(run, trackedSession(automationMetadata({ hostPid: 43 })))).toBe(false);
    expect(automationSessionMatchesRun(run, trackedSession(automationMetadata({ startedFromDaemon: false })))).toBe(false);
  });

  it('accepts only an exact late automation webhook and ignores ordinary sessions', () => {
    const session = trackedSession();
    expect(automationWebhookMatchesTrackedSession(session, automationMetadata())).toBe(true);
    expect(automationWebhookMatchesTrackedSession(session, automationMetadata({ automationRunId: crypto.randomUUID() }))).toBe(false);
    expect(automationWebhookMatchesTrackedSession({
      startedBy: 'daemon',
      pid: 42,
    }, automationMetadata())).toBe(false);
    expect(automationWebhookMatchesTrackedSession(session, automationMetadata({
      startedFromDaemon: false,
    }))).toBe(false);
  });

  it('accepts only the exact provider-written outcome for the matched run', () => {
    const run = activeRun();
    const session = trackedSession();
    expect(exactAutomationProviderOutcome(run, session, automationMetadata())).toMatchObject({
      automationId,
      runId,
      status: 'completed',
    });
    expect(exactAutomationProviderOutcome(run, session, automationMetadata({
      automationProviderOutcome: {
        ...automationMetadata().automationProviderOutcome!,
        runId: '33333333-3333-4333-8333-333333333333',
      },
    }))).toBeNull();
  });

  it('fails a post-webhook provider crash that never recorded an outcome', () => {
    const run = activeRun();
    const metadata = automationMetadata({ automationProviderOutcome: undefined });
    expect(resolveExitedAutomationProviderOutcome(run, trackedSession(metadata), metadata)).toEqual({
      status: 'failed',
      message: 'Provider exited before recording an exact one-shot outcome.',
    });
  });

  it('sends SIGTERM before SIGKILL and reports success only after confirmed exit', async () => {
    const signal = vi.fn();
    const waitForExit = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await expect(terminateAutomationProviderBeforeTimeoutConfirmation(42, {
      signal,
      waitForExit,
      platform: 'linux',
    })).resolves.toBe(true);
    expect(signal.mock.calls).toEqual([[-42, 'SIGTERM'], [-42, 'SIGKILL']]);
    expect(waitForExit.mock.calls).toEqual([[-42, 5_000], [-42, 5_000]]);

    await expect(terminateAutomationProviderBeforeTimeoutConfirmation(42, {
      signal: vi.fn(),
      waitForExit: vi.fn().mockResolvedValue(false),
      platform: 'linux',
    })).resolves.toBe(false);
  });

  it('falls back to the parent PID when Unix process-group signalling is unavailable', async () => {
    const signal = vi.fn((targetPid: number) => {
      if (targetPid < 0) throw Object.assign(new Error('missing group'), { code: 'ESRCH' });
    });
    const waitForExit = vi.fn().mockResolvedValue(true);
    await expect(terminateAutomationProviderBeforeTimeoutConfirmation(42, {
      signal,
      waitForExit,
      platform: 'linux',
    })).resolves.toBe(true);
    expect(signal.mock.calls).toEqual([[-42, 'SIGTERM'], [42, 'SIGTERM']]);
    expect(waitForExit).toHaveBeenCalledWith(42, 5_000);
  });

  it('uses the snapshotted timeout, preserves the 60-minute default, and keeps null unbounded', () => {
    const run = activeRun();
    const startedAt = Date.parse(run.startedAt);
    expect(automationRunTimeoutMinutes(automationMetadata())).toBe(60);
    expect(automationRunDeadlineAt(run, automationMetadata())).toBe(startedAt + 60 * 60_000);
    const custom = automationMetadata({ automationTimeoutMinutes: 360 });
    expect(automationRunTimeoutMinutes(custom)).toBe(360);
    expect(automationRunDeadlineAt(run, custom)).toBe(startedAt + 360 * 60_000);
    expect(automationRunTimeoutMinutes(automationMetadata({ automationTimeoutMinutes: 0 }))).toBe(60);
    const unbounded = automationMetadata({ automationTimeoutMinutes: null });
    expect(automationRunTimeoutMinutes(unbounded)).toBeNull();
    expect(automationRunDeadlineAt(run, unbounded)).toBeNull();
    expect(resolveExitedAutomationProviderOutcome(run, trackedSession(unbounded), unbounded)).toMatchObject({
      status: 'completed',
      message: null,
    });
  });

  it('does not arm an unbounded deadline and lets bounded deadline cleanup cancel firing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(activeRun().startedAt));
    try {
      const onDeadline = vi.fn();
      expect(scheduleAutomationRunDeadline(
        activeRun(),
        automationMetadata({ automationTimeoutMinutes: null }),
        onDeadline,
      )).toBeNull();
      vi.advanceTimersByTime(7 * 24 * 60 * 60_000);
      expect(onDeadline).not.toHaveBeenCalled();

      vi.setSystemTime(Date.parse(activeRun().startedAt));
      const timer = scheduleAutomationRunDeadline(
        activeRun(),
        automationMetadata({ automationTimeoutMinutes: 1 }),
        onDeadline,
      );
      expect(timer).not.toBeNull();
      clearTimeout(timer!);
      vi.advanceTimersByTime(60_000);
      expect(onDeadline).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('matches only the expected daemon-started Happy provider command', () => {
    const entrypoint = '/srv/happy/dist/index.mjs';
    expect(automationProviderCommandMatches(
      `node ${entrypoint} codex --happy-starting-mode remote --started-by daemon --effort max`,
      'codex',
      entrypoint,
    )).toBe(true);
    expect(automationProviderCommandMatches(
      `node ${entrypoint} claude --happy-starting-mode remote --started-by terminal`,
      'claude',
      entrypoint,
    )).toBe(false);
    expect(automationProviderCommandMatches('node unrelated.js codex --started-by daemon', 'codex', entrypoint)).toBe(false);
  });
});
