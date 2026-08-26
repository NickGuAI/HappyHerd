import { describe, expect, it } from 'vitest';

import type { Metadata } from '@/api/types';
import {
  HAPPYHERD_MACHINE_SESSION_PROTOCOL_VERSION,
  type HappyHerdAutomationRun,
} from '@slopus/happy-wire';
import {
  automationSessionMatchesRun,
  automationWebhookMatchesTrackedSession,
  exactAutomationProviderOutcome,
  initialMachineMetadata,
  resolveExitedAutomationProviderOutcome,
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
  it('advertises the target-confirmed machine-session protocol', () => {
    expect(initialMachineMetadata.machineSessionProtocolVersion)
      .toBe(HAPPYHERD_MACHINE_SESSION_PROTOCOL_VERSION);
  });

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

});
