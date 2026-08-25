import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  HAPPYHERD_AUTOMATION_DEFINITION_SCHEMA_VERSION,
  HappyHerdAutomationCreateInputSchema,
  HappyHerdAutomationRunSchema,
  HappyHerdAutomationSchema,
  HappyHerdAutomationUpdateInputSchema,
  type HappyHerdAutomation,
  type HappyHerdAutomationCreateInput,
  type HappyHerdAutomationListResponse,
  type HappyHerdAutomationRun,
  type HappyHerdAutomationUpdateInput,
} from '@slopus/happy-wire';
import { agentContextRoot } from '@/agentContext/commanderContext';
import { assertValidCron, assertValidTimezone } from './cronValidation';

const HISTORY_CAP = 50;
const ACTIVE_RUN_STATUSES = new Set<HappyHerdAutomationRun['status']>(['running', 'started']);

function normalizeStoredRun(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const run = value as Record<string, unknown>;
  if (run.status === 'timed-out') {
    return { ...run, status: 'failed' };
  }
  // Before the one-shot terminal contract, `started` meant only that the daemon
  // accepted the provider and was incorrectly written with a finishedAt.
  // Treat those rows as active until process reconciliation proves otherwise.
  if (run.status === 'started' && typeof run.finishedAt === 'string') {
    return { ...run, finishedAt: null };
  }
  return value;
}

function retainBoundedHistory(runs: HappyHerdAutomationRun[]): HappyHerdAutomationRun[] {
  const activeCount = runs.filter((run) => ACTIVE_RUN_STATUSES.has(run.status)).length;
  let remainingTerminalSlots = Math.max(0, HISTORY_CAP - activeCount);
  return runs.filter((run) => {
    if (ACTIVE_RUN_STATUSES.has(run.status)) return true;
    if (remainingTerminalSlots === 0) return false;
    remainingTerminalSlots -= 1;
    return true;
  });
}

function assertValidRunTransition(
  current: HappyHerdAutomationRun,
  next: HappyHerdAutomationRun,
): void {
  for (const field of ['automationId', 'source', 'scheduledFor', 'startedAt'] as const) {
    if (current[field] !== next[field]) {
      throw new Error(`Automation run ${current.id} cannot change ${field}`);
    }
  }
  if (next.attempt < current.attempt) {
    throw new Error(`Automation run ${current.id} cannot decrease its attempt`);
  }
  if (current.sessionId !== null && current.sessionId !== next.sessionId) {
    throw new Error(`Automation run ${current.id} cannot change its linked session`);
  }
  if (current.status === next.status) {
    if (!ACTIVE_RUN_STATUSES.has(current.status) && JSON.stringify(current) !== JSON.stringify(next)) {
      throw new Error(`Terminal automation run ${current.id} is immutable`);
    }
    return;
  }
  const allowed = current.status === 'running'
    ? next.status === 'started' || next.status === 'failed'
    : current.status === 'started'
      ? next.status === 'completed' || next.status === 'failed'
      : false;
  if (!allowed) {
    throw new Error(`Automation run ${current.id} cannot transition from ${current.status} to ${next.status}`);
  }
}

function automationsParent(): string {
  return path.join(agentContextRoot(), 'agentcontext', 'automations');
}

function storeRoot(): string {
  return path.join(automationsParent(), 'happyherd');
}

function manifestPath(id: string): string {
  return path.join(storeRoot(), id, 'manifest.json');
}

function runsPath(id: string): string {
  return path.join(storeRoot(), id, 'runs.json');
}

function assertUuid(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Automation id must be a UUID');
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readStoredAutomation(id: string): Promise<HappyHerdAutomation> {
  const raw = await readJson(manifestPath(id));
  const hasLegacyTimeout = Boolean(
    raw
    && typeof raw === 'object'
    && !Array.isArray(raw)
    && Object.prototype.hasOwnProperty.call(raw, 'timeoutMinutes'),
  );
  if (hasLegacyTimeout) {
    delete (raw as Record<string, unknown>).timeoutMinutes;
  }
  const automation = HappyHerdAutomationSchema.parse(raw);
  if (hasLegacyTimeout) {
    await writeJsonAtomic(manifestPath(id), automation);
  }
  return automation;
}

function validateSchedule(input: { schedule: string; timezone: string }): void {
  assertValidCron(input.schedule);
  assertValidTimezone(input.timezone);
}

export class HappyHerdAutomationStore {
  private mutationTail: Promise<void> = Promise.resolve();

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async list(machineId: string): Promise<HappyHerdAutomationListResponse> {
    await mkdir(storeRoot(), { recursive: true, mode: 0o700 });
    const entries = await readdir(storeRoot(), { withFileTypes: true });
    const automations: HappyHerdAutomation[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const automation = await readStoredAutomation(entry.name);
        if (automation.machineId === machineId) automations.push(automation);
      } catch {
        // Invalid artifacts are isolated in place and never scheduled. They
        // remain inspectable rather than being silently rewritten or deleted.
      }
    }
    automations.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
    return {
      definitionSchemaVersion: HAPPYHERD_AUTOMATION_DEFINITION_SCHEMA_VERSION,
      automations,
    };
  }

  async get(id: string): Promise<HappyHerdAutomation> {
    assertUuid(id);
    try {
      return await readStoredAutomation(id);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Automation ${id} was not found`);
      throw error;
    }
  }

  async create(machineId: string, raw: HappyHerdAutomationCreateInput): Promise<HappyHerdAutomation> {
    return this.serialize(async () => {
      const input = HappyHerdAutomationCreateInputSchema.parse(raw);
      validateSchedule(input);
      const now = new Date().toISOString();
      const automation = HappyHerdAutomationSchema.parse({
        ...input,
        schemaVersion: HAPPYHERD_AUTOMATION_DEFINITION_SCHEMA_VERSION,
        runtimeOwner: 'happyherd',
        id: randomUUID(),
        machineId,
        createdAt: now,
        updatedAt: now,
        lastScheduledAt: null,
        lastRunAt: null,
      });
      await writeJsonAtomic(manifestPath(automation.id), automation);
      await writeJsonAtomic(runsPath(automation.id), []);
      return automation;
    });
  }

  async update(id: string, raw: HappyHerdAutomationUpdateInput): Promise<HappyHerdAutomation> {
    return this.serialize(async () => {
      const current = await this.get(id);
      const patch = HappyHerdAutomationUpdateInputSchema.parse(raw);
      const next = HappyHerdAutomationSchema.parse({
        ...current,
        ...patch,
        id: current.id,
        machineId: current.machineId,
        runtimeOwner: 'happyherd',
        schemaVersion: HAPPYHERD_AUTOMATION_DEFINITION_SCHEMA_VERSION,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      });
      validateSchedule(next);
      await writeJsonAtomic(manifestPath(id), next);
      return next;
    });
  }

  async recordSchedule(id: string, scheduledAt: string): Promise<HappyHerdAutomation> {
    return this.serialize(async () => {
      const current = await this.get(id);
      const next = HappyHerdAutomationSchema.parse({
        ...current,
        lastScheduledAt: scheduledAt,
        lastRunAt: scheduledAt,
        updatedAt: new Date().toISOString(),
      });
      await writeJsonAtomic(manifestPath(id), next);
      return next;
    });
  }

  async delete(id: string): Promise<void> {
    await this.serialize(async () => {
      assertUuid(id);
      await rm(path.join(storeRoot(), id), { recursive: true, force: true });
    });
  }

  async history(id: string): Promise<HappyHerdAutomationRun[]> {
    assertUuid(id);
    return retainBoundedHistory(await this.readRuns(id));
  }

  async activeRun(id: string): Promise<HappyHerdAutomationRun | null> {
    return (await this.activeRuns(id))[0] ?? null;
  }

  async activeRuns(id: string): Promise<HappyHerdAutomationRun[]> {
    assertUuid(id);
    return (await this.readRuns(id)).filter((run) => ACTIVE_RUN_STATUSES.has(run.status));
  }

  async getRun(automationId: string, runId: string): Promise<HappyHerdAutomationRun | null> {
    assertUuid(automationId);
    assertUuid(runId);
    return (await this.readRuns(automationId)).find((run) => run.id === runId) ?? null;
  }

  private async readRuns(id: string): Promise<HappyHerdAutomationRun[]> {
    try {
      const raw = await readJson(runsPath(id));
      if (!Array.isArray(raw)) return [];
      return raw
        .map((entry) => HappyHerdAutomationRunSchema.safeParse(normalizeStoredRun(entry)))
        .filter((entry) => entry.success)
        .map((entry) => entry.data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async appendRun(run: HappyHerdAutomationRun): Promise<void> {
    await this.serialize(async () => {
      const parsed = HappyHerdAutomationRunSchema.parse(run);
      const history = await this.readRuns(parsed.automationId);
      const current = history.find((entry) => entry.id === parsed.id);
      if (current) assertValidRunTransition(current, parsed);
      const next = [parsed, ...history.filter((entry) => entry.id !== parsed.id)];
      await writeJsonAtomic(runsPath(parsed.automationId), retainBoundedHistory(next));
    });
  }
}
