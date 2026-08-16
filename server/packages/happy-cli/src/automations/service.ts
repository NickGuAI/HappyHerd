import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CronExpressionParser } from 'cron-parser';
import cron, { type ScheduledTask } from 'node-cron';
import {
  HappyHerdAutomationCreateInputSchema,
  HappyHerdAutomationUpdateInputSchema,
  type HappyHerdAutomation,
  type HappyHerdAutomationCreateInput,
  type HappyHerdAutomationHistoryResponse,
  type HappyHerdAutomationListResponse,
  type HappyHerdAutomationRun,
  type HappyHerdAutomationUpdateInput,
} from '@slopus/happy-wire';
import type { SpawnSessionOptions, SpawnSessionResult } from '@/modules/common/registerCommonHandlers';
import { logger } from '@/ui/logger';
import { agentContextRoot, listCommanders } from '@/agentContext/commanderContext';
import { HappyHerdAutomationStore } from './store';

const SCHEDULER_HEARTBEAT_MS = 30_000;
const MAX_OFFLINE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1_000;

interface SchedulerState {
  schemaVersion: 1;
  lastSeenAt: string;
}

function schedulerStatePath(): string {
  return path.join(agentContextRoot(), 'agentcontext', 'automations', 'happyherd', 'scheduler-state.json');
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

async function readSchedulerState(): Promise<SchedulerState | null> {
  try {
    const parsed = JSON.parse(await readFile(schedulerStatePath(), 'utf8')) as Partial<SchedulerState>;
    if (parsed.schemaVersion === 1 && typeof parsed.lastSeenAt === 'string' && Number.isFinite(Date.parse(parsed.lastSeenAt))) {
      return parsed as SchedulerState;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('[AUTOMATIONS] Ignoring invalid scheduler state', error);
    }
  }
  return null;
}

function latestOccurrenceBetween(automation: HappyHerdAutomation, from: Date, until: Date): Date | null {
  const boundedFrom = new Date(Math.max(from.getTime(), until.getTime() - MAX_OFFLINE_LOOKBACK_MS));
  try {
    const expression = CronExpressionParser.parse(automation.schedule, {
      currentDate: boundedFrom,
      endDate: until,
      tz: automation.timezone,
    });
    let latest: Date | null = null;
    while (true) {
      try {
        latest = expression.next().toDate();
      } catch {
        return latest;
      }
    }
  } catch {
    return null;
  }
}

export class HappyHerdAutomationService {
  private readonly store = new HappyHerdAutomationStore();
  private readonly tasks = new Map<string, ScheduledTask>();
  private readonly inFlight = new Set<string>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(
    private readonly machineId: string,
    private readonly spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>,
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      const now = new Date();
      const previous = await readSchedulerState();
      if (previous) await this.recordOfflineWindows(new Date(previous.lastSeenAt), now);
      await this.reconcile();
      await this.writeHeartbeat(now);
      this.heartbeat = setInterval(() => {
        void this.writeHeartbeat(new Date()).catch((error) => logger.warn('[AUTOMATIONS] Failed to write scheduler heartbeat', error));
      }, SCHEDULER_HEARTBEAT_MS);
      this.heartbeat.unref?.();
    } catch (error) {
      this.started = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await Promise.all([...this.tasks.values()].map((task) => task.destroy()));
    this.tasks.clear();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    await this.writeHeartbeat(new Date());
    this.started = false;
  }

  private async writeHeartbeat(now: Date): Promise<void> {
    await writeJsonAtomic(schedulerStatePath(), { schemaVersion: 1, lastSeenAt: now.toISOString() });
  }

  private async recordOfflineWindows(from: Date, until: Date): Promise<void> {
    if (until.getTime() - from.getTime() <= SCHEDULER_HEARTBEAT_MS * 2) return;
    const { automations } = await this.store.list(this.machineId);
    for (const automation of automations.filter((candidate) => candidate.status === 'active')) {
      const missedAt = latestOccurrenceBetween(automation, from, until);
      if (!missedAt) continue;
      await this.store.appendRun({
        id: randomUUID(),
        automationId: automation.id,
        source: 'schedule',
        scheduledFor: missedAt.toISOString(),
        startedAt: until.toISOString(),
        finishedAt: until.toISOString(),
        status: 'missed',
        attempt: 1,
        sessionId: null,
        message: `Daemon was offline between ${from.toISOString()} and ${until.toISOString()}; the run was not executed automatically.`,
      });
    }
  }

  private async reconcile(): Promise<void> {
    await Promise.all([...this.tasks.values()].map((task) => task.destroy()));
    this.tasks.clear();
    const { automations } = await this.store.list(this.machineId);
    for (const automation of automations) {
      if (automation.status !== 'active') continue;
      try {
        const task = cron.schedule(automation.schedule, () => {
          void this.execute(automation.id, 'schedule', new Date()).catch((error) => {
            logger.warn(`[AUTOMATIONS] Scheduled run failed for ${automation.id}`, error);
          });
        }, { timezone: automation.timezone });
        this.tasks.set(automation.id, task);
      } catch (error) {
        logger.warn(`[AUTOMATIONS] Isolated invalid persisted automation ${automation.id}`, error);
      }
    }
  }

  private async execute(id: string, source: 'schedule' | 'manual', scheduledFor: Date): Promise<HappyHerdAutomationRun> {
    const automation = await this.store.get(id);
    if (automation.machineId !== this.machineId) throw new Error('Automation belongs to another machine');

    if (this.inFlight.has(id)) {
      const skipped: HappyHerdAutomationRun = {
        id: randomUUID(),
        automationId: id,
        source,
        scheduledFor: scheduledFor.toISOString(),
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        status: 'skipped',
        attempt: 1,
        sessionId: null,
        message: 'Skipped because the previous run is still active.',
      };
      await this.store.appendRun(skipped);
      return skipped;
    }

    this.inFlight.add(id);
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    let latest: HappyHerdAutomationRun = {
      id: runId,
      automationId: id,
      source,
      scheduledFor: scheduledFor.toISOString(),
      startedAt,
      finishedAt: null,
      status: 'running',
      attempt: 1,
      sessionId: null,
      message: null,
    };
    try {
      await this.store.recordSchedule(id, scheduledFor.toISOString());
      await this.store.appendRun(latest);
      for (let attempt = 1; attempt <= automation.maxRetries + 1; attempt += 1) {
        let result: SpawnSessionResult;
        try {
          result = await this.spawnSession({
            machineId: this.machineId,
            directory: automation.workspace,
            approvedNewDirectoryCreation: false,
            agent: automation.rail,
            commanderId: automation.commanderId ?? undefined,
            automation: {
              id: automation.id,
              kind: automation.kind,
              instruction: automation.instruction,
            },
          });
        } catch (error) {
          result = {
            type: 'error',
            errorMessage: error instanceof Error ? error.message : String(error),
          };
        }
        if (result.type === 'success') {
          latest = {
            ...latest,
            status: 'started',
            attempt,
            sessionId: result.sessionId,
            finishedAt: new Date().toISOString(),
            message: 'Session accepted by the daemon; open the linked session to follow completion.',
          };
          await this.store.appendRun(latest);
          return latest;
        }
        const errorMessage = result.type === 'error'
          ? result.errorMessage
          : `Workspace does not exist: ${result.directory}`;
        latest = {
          ...latest,
          status: 'failed',
          attempt,
          finishedAt: new Date().toISOString(),
          message: errorMessage,
        };
        await this.store.appendRun(latest);
        if (attempt <= automation.maxRetries && result.type === 'error' && result.retrySafe === true) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(4_000, 1_000 * (2 ** (attempt - 1)))));
          continue;
        }
        break;
      }
      return latest;
    } finally {
      this.inFlight.delete(id);
    }
  }

  async list(): Promise<HappyHerdAutomationListResponse> {
    return this.store.list(this.machineId);
  }

  async create(raw: HappyHerdAutomationCreateInput): Promise<HappyHerdAutomation> {
    const input = HappyHerdAutomationCreateInputSchema.parse(raw);
    await this.assertCommanderWorkspace(input.commanderId, input.workspace);
    const automation = await this.store.create(this.machineId, input);
    await this.reconcile();
    return automation;
  }

  async update(id: string, raw: HappyHerdAutomationUpdateInput): Promise<HappyHerdAutomation> {
    const current = await this.store.get(id);
    if (current.machineId !== this.machineId) throw new Error('Automation belongs to another machine');
    const patch = HappyHerdAutomationUpdateInputSchema.parse(raw);
    await this.assertCommanderWorkspace(
      patch.commanderId === undefined ? current.commanderId : patch.commanderId,
      patch.workspace ?? current.workspace,
    );
    const automation = await this.store.update(id, patch);
    await this.reconcile();
    return automation;
  }

  async pause(id: string): Promise<HappyHerdAutomation> {
    return this.update(id, { status: 'paused' });
  }

  async resume(id: string): Promise<HappyHerdAutomation> {
    return this.update(id, { status: 'active' });
  }

  async delete(id: string): Promise<void> {
    const current = await this.store.get(id);
    if (current.machineId !== this.machineId) throw new Error('Automation belongs to another machine');
    if (this.inFlight.has(id)) throw new Error('Automation is currently running; stop or wait for the run before deleting it');
    await this.store.delete(id);
    await this.reconcile();
  }

  async runNow(id: string): Promise<HappyHerdAutomationRun> {
    return this.execute(id, 'manual', new Date());
  }

  async history(id: string): Promise<HappyHerdAutomationHistoryResponse> {
    const current = await this.store.get(id);
    if (current.machineId !== this.machineId) throw new Error('Automation belongs to another machine');
    return { runs: await this.store.history(id) };
  }

  private async assertCommanderWorkspace(commanderId: string | null, workspace: string): Promise<void> {
    if (!commanderId) return;
    const { commanders } = await listCommanders();
    const commander = commanders.find((candidate) => candidate.id === commanderId);
    if (!commander) {
      throw new Error(`Commander "${commanderId}" was not found on this machine`);
    }
    if (path.resolve(workspace) !== path.resolve(commander.workspace)) {
      throw new Error(`Commander "${commander.name}" is bound to workspace ${commander.workspace}`);
    }
  }
}
