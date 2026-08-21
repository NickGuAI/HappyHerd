import { describe, expect, it } from 'vitest';

import {
  HAPPYHERD_AUTOMATION_MAX_TAG_LENGTH,
  HAPPYHERD_AUTOMATION_MAX_TAGS,
  HappyHerdAutomationCreateInputSchema,
  HappyHerdAutomationListResponseSchema,
  HappyHerdAutomationProviderOutcomeSchema,
  HappyHerdAutomationRunSchema,
  HappyHerdAutomationSchema,
  HappyHerdAutomationUpdateInputSchema,
} from './automation';

const id = '8f0a5dd0-b7c0-4b60-a747-675b49ccfdc8';

describe('HappyHerd automation wire contract', () => {
  it('normalizes strict v1 definitions to v2 with no tags', () => {
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
    expect(HappyHerdAutomationSchema.parse(definition)).toEqual({
      ...definition,
      schemaVersion: 2,
      tags: [],
    });
    expect(() => HappyHerdAutomationSchema.parse({ ...definition, providerTransport: 'unsupported' })).toThrow();
  });

  it('accepts normalized v2 tags and enforces bounded unique values', () => {
    const definition = {
      schemaVersion: 2 as const,
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
      tags: [' Operations ', 'Project Beacon'],
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
      lastScheduledAt: null,
      lastRunAt: null,
    };

    expect(HappyHerdAutomationSchema.parse(definition).tags).toEqual(['Operations', 'Project Beacon']);
    expect(() => HappyHerdAutomationSchema.parse({ ...definition, tags: ['same', ' same '] })).toThrow(/Duplicate/);
    expect(() => HappyHerdAutomationSchema.parse({
      ...definition,
      tags: Array.from({ length: HAPPYHERD_AUTOMATION_MAX_TAGS + 1 }, (_, index) => `tag-${index}`),
    })).toThrow();
    expect(() => HappyHerdAutomationSchema.parse({
      ...definition,
      tags: ['x'.repeat(HAPPYHERD_AUTOMATION_MAX_TAG_LENGTH + 1)],
    })).toThrow();
    expect(() => HappyHerdAutomationSchema.parse({ ...definition, schedulerHint: true })).toThrow();
  });

  it('defaults create tags, keeps update tags optional, and advertises list capability safely', () => {
    const createInput = {
      name: 'Heartbeat',
      kind: 'heartbeat' as const,
      instruction: 'Check status.',
      schedule: '*/15 * * * *',
      timezone: 'UTC',
      workspace: '/srv/app',
      rail: 'codex' as const,
      commanderId: null,
      status: 'active' as const,
      maxRetries: 0,
    };
    expect(HappyHerdAutomationCreateInputSchema.parse(createInput).tags).toEqual([]);
    expect(HappyHerdAutomationUpdateInputSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    expect(HappyHerdAutomationUpdateInputSchema.parse({ tags: [' z ', 'a'] }).tags).toEqual(['a', 'z']);
    expect(HappyHerdAutomationListResponseSchema.parse({ automations: [] })).toEqual({
      definitionSchemaVersion: 1,
      automations: [],
    });
    expect(HappyHerdAutomationListResponseSchema.parse({
      definitionSchemaVersion: 2,
      automations: [],
    }).definitionSchemaVersion).toBe(2);
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
