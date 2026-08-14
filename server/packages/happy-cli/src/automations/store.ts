import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
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
        const automation = HappyHerdAutomationSchema.parse(await readJson(manifestPath(entry.name)));
        if (automation.machineId === machineId) automations.push(automation);
      } catch {
        // Invalid artifacts are isolated in place and never scheduled. They
        // remain inspectable rather than being silently rewritten or deleted.
      }
    }
    automations.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
    return { automations };
  }

  async get(id: string): Promise<HappyHerdAutomation> {
    assertUuid(id);
    try {
      return HappyHerdAutomationSchema.parse(await readJson(manifestPath(id)));
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
        schemaVersion: 1,
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
        schemaVersion: 1,
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
    try {
      const raw = await readJson(runsPath(id));
      if (!Array.isArray(raw)) return [];
      return raw
        .map((entry) => HappyHerdAutomationRunSchema.safeParse(entry))
        .filter((entry) => entry.success)
        .map((entry) => entry.data)
        .slice(0, HISTORY_CAP);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async appendRun(run: HappyHerdAutomationRun): Promise<void> {
    await this.serialize(async () => {
      const parsed = HappyHerdAutomationRunSchema.parse(run);
      const history = await this.history(parsed.automationId);
      await writeJsonAtomic(runsPath(parsed.automationId), [parsed, ...history.filter((entry) => entry.id !== parsed.id)].slice(0, HISTORY_CAP));
    });
  }
}
