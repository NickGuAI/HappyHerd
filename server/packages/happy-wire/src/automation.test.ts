import { describe, expect, it } from 'vitest';

import {
  HappyHerdAutomationCreateInputSchema,
  HappyHerdAutomationProviderOutcomeSchema,
  HappyHerdAutomationRunSchema,
  HappyHerdAutomationSchema,
} from './automation';

const id = '8f0a5dd0-b7c0-4b60-a747-675b49ccfdc8';

describe('HappyHerd automation wire contract', () => {
  it('accepts the owned machine-local definition and rejects unknown fields', () => {
    const definition = {
      schemaVersion: 1 as const,
      runtimeOwner: 'happyherd' as const,
      id,
      machineId: 'machine-one',
      name: 'Memory maintenance',
      kind: 'memory-maintenance' as const,
      instruction: 'Distill durable memory.',
      schedule: '0 2 * * *',
      timezone: 'UTC',
      workspace: '/srv/app',
      rail: 'claude' as const,
      commanderId: 'athena',
      status: 'paused' as const,
      maxRetries: 1,
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
      lastScheduledAt: null,
      lastRunAt: null,
    };
    expect(HappyHerdAutomationSchema.parse(definition)).toEqual(definition);
    expect(() => HappyHerdAutomationSchema.parse({ ...definition, providerTransport: 'unsupported' })).toThrow();
  });

  it('requires an explicit rail, workspace, timezone, and paused/active state', () => {
    expect(() => HappyHerdAutomationCreateInputSchema.parse({
      name: 'Incomplete',
      kind: 'heartbeat',
      instruction: 'Check status.',
      schedule: '*/15 * * * *',
      commanderId: null,
      maxRetries: 0,
    })).toThrow();
  });

  it('records linked session starts as active until a terminal confirmation', () => {
    expect(HappyHerdAutomationRunSchema.parse({
      id: crypto.randomUUID(),
      automationId: id,
      source: 'manual',
      scheduledFor: '2026-08-03T00:00:00.000Z',
      startedAt: '2026-08-03T00:00:01.000Z',
      finishedAt: null,
      status: 'started',
      attempt: 1,
      sessionId: 'session-one',
      message: null,
    }).sessionId).toBe('session-one');
    expect(HappyHerdAutomationRunSchema.parse({
      id: crypto.randomUUID(),
      automationId: id,
      source: 'manual',
      scheduledFor: '2026-08-03T00:00:00.000Z',
      startedAt: '2026-08-03T00:00:01.000Z',
      finishedAt: '2026-08-03T00:05:00.000Z',
      status: 'completed',
      attempt: 1,
      sessionId: 'session-one',
      message: null,
    }).status).toBe('completed');
    for (const status of ['failed', 'timed-out'] as const) {
      expect(HappyHerdAutomationRunSchema.parse({
        id: crypto.randomUUID(),
        automationId: id,
        source: 'manual',
        scheduledFor: '2026-08-03T00:00:00.000Z',
        startedAt: '2026-08-03T00:00:01.000Z',
        finishedAt: '2026-08-03T00:05:00.000Z',
        status,
        attempt: 1,
        sessionId: 'session-one',
        message: null,
      }).status).toBe(status);
    }
    expect(() => HappyHerdAutomationRunSchema.parse({
      id: crypto.randomUUID(),
      automationId: id,
      source: 'manual',
      scheduledFor: '2026-08-03T00:00:00.000Z',
      startedAt: '2026-08-03T00:00:01.000Z',
      finishedAt: '2026-08-03T00:00:02.000Z',
      status: 'started',
      attempt: 1,
      sessionId: 'session-one',
      message: null,
    })).toThrow();
    expect(() => HappyHerdAutomationRunSchema.parse({
      id: crypto.randomUUID(),
      automationId: id,
      source: 'manual',
      scheduledFor: '2026-08-03T00:00:00.000Z',
      startedAt: '2026-08-03T00:00:01.000Z',
      finishedAt: null,
      status: 'running',
      attempt: 0,
      sessionId: null,
      message: null,
    })).toThrow();
  });

  it('carries a provider-owned one-shot outcome for daemon exit reconciliation', () => {
    expect(HappyHerdAutomationProviderOutcomeSchema.parse({
      schemaVersion: 1,
      automationId: id,
      runId: crypto.randomUUID(),
      status: 'completed',
      finishedAt: '2026-08-03T00:05:00.000Z',
      message: null,
    }).status).toBe('completed');
    expect(() => HappyHerdAutomationProviderOutcomeSchema.parse({
      schemaVersion: 1,
      automationId: id,
      runId: crypto.randomUUID(),
      status: 'timed-out',
      finishedAt: '2026-08-03T00:05:00.000Z',
      message: null,
    })).toThrow();
  });
});
