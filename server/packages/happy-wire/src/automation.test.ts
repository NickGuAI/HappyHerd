import { describe, expect, it } from 'vitest';

import {
  HappyHerdAutomationCreateInputSchema,
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
    expect(() => HappyHerdAutomationSchema.parse({ ...definition, providerTransport: 'herd' })).toThrow();
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

  it('records linked session starts and bounded attempts', () => {
    expect(HappyHerdAutomationRunSchema.parse({
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
    }).sessionId).toBe('session-one');
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
});
