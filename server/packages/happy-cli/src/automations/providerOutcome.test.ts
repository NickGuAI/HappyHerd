import { describe, expect, it, vi } from 'vitest';

import type { AgentGoalStatus, Metadata } from '@/api/types';
import {
  AutomationGoalTerminalGate,
  buildAutomationProviderOutcome,
  persistAutomationProviderOutcome,
} from './providerOutcome';

const bootstrap = {
  schemaVersion: 1 as const,
  automationId: '11111111-1111-4111-8111-111111111111',
  runId: '22222222-2222-4222-8222-222222222222',
  kind: 'scheduled' as const,
  instruction: 'ship it',
};

describe('automation provider outcome', () => {
  it('binds a terminal outcome to one automation run', () => {
    expect(buildAutomationProviderOutcome(
      bootstrap,
      'completed',
      'done',
      '2026-08-16T00:00:00.000Z',
    )).toEqual({
      schemaVersion: 1,
      automationId: bootstrap.automationId,
      runId: bootstrap.runId,
      status: 'completed',
      finishedAt: '2026-08-16T00:00:00.000Z',
      message: 'done',
    });
  });

  it('persists and flushes the outcome before returning', async () => {
    let metadata = { path: '/tmp' } as Metadata;
    const order: string[] = [];
    const session = {
      updateMetadata: vi.fn(async (handler: (value: Metadata) => Metadata) => {
        metadata = handler(metadata);
        order.push('metadata');
      }),
      flush: vi.fn(async () => { order.push('flush'); }),
    };

    await persistAutomationProviderOutcome(session, bootstrap, 'failed', 'boom');

    expect(metadata.automationProviderOutcome).toMatchObject({
      automationId: bootstrap.automationId,
      runId: bootstrap.runId,
      status: 'failed',
      message: 'boom',
    });
    expect(order).toEqual(['metadata', 'flush']);
  });

  it('waits only when a provider goal is observed active', async () => {
    const gate = new AutomationGoalTerminalGate();
    await expect(gate.wait()).resolves.toBeUndefined();

    gate.observe({
      source: 'codex',
      status: 'active',
      observedAt: 1,
      sourceSessionId: 'thread-1',
      text: 'finish',
    });
    let settled = false;
    const waiting = gate.wait().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    gate.observe({
      source: 'codex',
      status: 'unavailable',
      observedAt: 2,
      reason: 'stale',
    } as AgentGoalStatus);
    await Promise.resolve();
    expect(settled).toBe(false);

    gate.observe({
      source: 'codex',
      status: 'inactive',
      observedAt: 3,
      sourceSessionId: 'thread-1',
      reason: 'completed',
    });
    await waiting;
    expect(settled).toBe(true);
  });
});
