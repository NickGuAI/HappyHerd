import {
  HappyHerdAutomationProviderOutcomeSchema,
  type HappyHerdAutomationProviderOutcome,
} from '@slopus/happy-wire';

import type { AgentGoalStatus, Metadata } from '@/api/types';
import type { HappyHerdAutomationBootstrap } from './sessionBootstrap';

const MAX_OUTCOME_MESSAGE_LENGTH = 10_000;

export interface AutomationOutcomeSession {
  updateMetadata: (handler: (metadata: Metadata) => Metadata) => Promise<void>;
  flush: () => Promise<void>;
}

export class AutomationGoalTerminalGate {
  private active = false;
  private waiters = new Set<() => void>();

  observe(status: AgentGoalStatus): void {
    if (status.status === 'active') {
      this.active = true;
      return;
    }
    if (status.status !== 'inactive') return;

    this.active = false;
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }

  async wait(): Promise<void> {
    if (!this.active) return;
    await new Promise<void>((resolve) => this.waiters.add(resolve));
  }
}

function boundedMessage(message?: string | null): string | null {
  if (!message) return null;
  return message.length <= MAX_OUTCOME_MESSAGE_LENGTH
    ? message
    : `${message.slice(0, MAX_OUTCOME_MESSAGE_LENGTH - 1)}…`;
}

export function buildAutomationProviderOutcome(
  bootstrap: HappyHerdAutomationBootstrap,
  status: HappyHerdAutomationProviderOutcome['status'],
  message?: string | null,
  finishedAt = new Date().toISOString(),
): HappyHerdAutomationProviderOutcome {
  if (!bootstrap.runId) {
    throw new Error('HappyHerd automation bootstrap is missing its run id');
  }
  return HappyHerdAutomationProviderOutcomeSchema.parse({
    schemaVersion: 1,
    automationId: bootstrap.automationId,
    runId: bootstrap.runId,
    status,
    finishedAt,
    message: boundedMessage(message),
  });
}

export async function persistAutomationProviderOutcome(
  session: AutomationOutcomeSession,
  bootstrap: HappyHerdAutomationBootstrap,
  status: HappyHerdAutomationProviderOutcome['status'],
  message?: string | null,
): Promise<HappyHerdAutomationProviderOutcome> {
  const outcome = buildAutomationProviderOutcome(bootstrap, status, message);
  await session.updateMetadata((metadata) => ({
    ...metadata,
    automationProviderOutcome: outcome,
  }));
  await session.flush();
  return outcome;
}
