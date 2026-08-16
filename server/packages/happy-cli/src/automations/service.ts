import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CronExpressionParser } from 'cron-parser';
import cron, { type ScheduledTask } from 'node-cron';
import {
  HappyHerdAutomationCreateInputSchema,
  HappyHerdAutomationTerminalRunStatusSchema,
  HappyHerdAutomationUpdateInputSchema,
  type HappyHerdAutomation,
  type HappyHerdAutomationCreateInput,
  type HappyHerdAutomationHistoryResponse,
  type HappyHerdAutomationListResponse,
  type HappyHerdAutomationRun,
  type HappyHerdAutomationTerminalRunStatus,
  type HappyHerdAutomationUpdateInput,
} from '@slopus/happy-wire';
import type { SpawnSessionOptions, SpawnSessionResult } from '@/modules/common/registerCommonHandlers';
import { logger } from '@/ui/logger';
import { agentContextRoot, listCommanders } from '@/agentContext/commanderContext';
import { HappyHerdAutomationStore } from './store';

const SCHEDULER_HEARTBEAT_MS = 30_000;
const MAX_OFFLINE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1_000;
export const HAPPYHERD_AUTOMATION_RUN_TIMEOUT_MS = 60 * 60 * 1_000;

type AutomationSpawnSessionOptions = Omit<SpawnSessionOptions, 'automation'> & {
  automation: NonNullable<SpawnSessionOptions['automation']> & { runId: string };
};

export interface HappyHerdAutomationTerminationConfirmation {
  automationId: string;
  runId: string;
  sessionId: string;
  status: HappyHerdAutomationTerminalRunStatus;
  message?: string | null;
}

export interface HappyHerdAutomationNoProviderConfirmation {
  automationId: string;
  runId: string;
  message: string;
}

export interface HappyHerdAutomationStartedConfirmation {
  automationId: string;
  runId: string;
  sessionId: string;
}

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
    private readonly spawnSession: (options: AutomationSpawnSessionOptions) => Promise<SpawnSessionResult>,
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
      return this.recordSkipped(id, source, scheduledFor);
    }

    this.inFlight.add(id);
    try {
      if (await this.store.activeRun(id)) {
        return this.recordSkipped(id, source, scheduledFor);
      }
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
            effortLevel: 'max',
            commanderId: automation.commanderId ?? undefined,
            automation: {
              id: automation.id,
              runId,
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
        const currentAfterSpawn = await this.store.getRun(id, runId);
        if (currentAfterSpawn && currentAfterSpawn.status !== 'running') {
          return currentAfterSpawn;
        }
        if (result.type === 'success') {
          latest = {
            ...latest,
            status: 'started',
            attempt,
            sessionId: result.sessionId,
            finishedAt: null,
            message: 'Session accepted by the daemon and remains active until its provider exits.',
          };
          await this.store.appendRun(latest);
          return latest;
        }
        const errorMessage = result.type === 'error'
          ? result.errorMessage
          : `Workspace does not exist: ${result.directory}`;
        if (attempt <= automation.maxRetries && result.type === 'error' && result.retrySafe === true) {
          latest = { ...latest, attempt, message: errorMessage };
          await this.store.appendRun(latest);
          await new Promise((resolve) => setTimeout(resolve, Math.min(4_000, 1_000 * (2 ** (attempt - 1)))));
          continue;
        }
        if (result.type === 'error' && result.retrySafe !== true) {
          latest = {
            ...latest,
            attempt,
            message: `${errorMessage} Provider start could not be disproved; the run remains active pending reconciliation.`,
          };
          try {
            await this.store.appendRun(latest);
          } catch (error) {
            const concurrentlyReconciled = await this.store.getRun(id, runId);
            if (concurrentlyReconciled && concurrentlyReconciled.status !== 'running') {
              return concurrentlyReconciled;
            }
            throw error;
          }
          return latest;
        }
        latest = {
          ...latest,
          status: 'failed',
          attempt,
          finishedAt: new Date().toISOString(),
          message: errorMessage,
        };
        await this.store.appendRun(latest);
        break;
      }
      return latest;
    } finally {
      this.inFlight.delete(id);
    }
  }

  private async recordSkipped(
    id: string,
    source: 'schedule' | 'manual',
    scheduledFor: Date,
  ): Promise<HappyHerdAutomationRun> {
    const now = new Date().toISOString();
    const skipped: HappyHerdAutomationRun = {
      id: randomUUID(),
      automationId: id,
      source,
      scheduledFor: scheduledFor.toISOString(),
      startedAt: now,
      finishedAt: now,
      status: 'skipped',
      attempt: 1,
      sessionId: null,
      message: 'Skipped because the previous run is still active.',
    };
    await this.store.appendRun(skipped);
    return skipped;
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
    if (this.inFlight.has(id) || await this.store.activeRun(id)) {
      throw new Error('Automation is currently running; stop or wait for the run before deleting it');
    }
    await this.store.delete(id);
    await this.reconcile();
  }

  async runNow(id: string): Promise<HappyHerdAutomationRun> {
    return this.execute(id, 'manual', new Date());
  }

  async listActiveRuns(): Promise<HappyHerdAutomationRun[]> {
    const { automations } = await this.store.list(this.machineId);
    return (await Promise.all(automations.map((automation) => this.store.activeRuns(automation.id)))).flat();
  }

  /**
   * Close a started run only after the observing daemon has confirmed provider
   * exit and resolved its one-shot root/child outcome. This method deliberately
   * does not infer liveness from session history or transport presence.
   */
  async confirmRunTermination(
    raw: HappyHerdAutomationTerminationConfirmation,
  ): Promise<HappyHerdAutomationRun> {
    const automation = await this.store.get(raw.automationId);
    if (automation.machineId !== this.machineId) throw new Error('Automation belongs to another machine');
    const status = HappyHerdAutomationTerminalRunStatusSchema.parse(raw.status);
    const current = await this.store.getRun(raw.automationId, raw.runId);
    if (!current) throw new Error(`Automation run ${raw.runId} was not found`);
    if (current.status === status && current.sessionId === raw.sessionId && current.finishedAt !== null) {
      return current;
    }
    if (current.status !== 'started') {
      throw new Error(`Automation run ${raw.runId} is ${current.status}, not started`);
    }
    if (current.sessionId !== raw.sessionId) {
      throw new Error(`Automation run ${raw.runId} belongs to another session`);
    }
    const terminal: HappyHerdAutomationRun = {
      ...current,
      status,
      finishedAt: new Date().toISOString(),
      message: raw.message ?? null,
    };
    await this.store.appendRun(terminal);
    return terminal;
  }

  /** Close a running spawn only after the caller proves no provider exists. */
  async confirmRunDidNotStart(
    raw: HappyHerdAutomationNoProviderConfirmation,
  ): Promise<HappyHerdAutomationRun> {
    const automation = await this.store.get(raw.automationId);
    if (automation.machineId !== this.machineId) throw new Error('Automation belongs to another machine');
    const current = await this.store.getRun(raw.automationId, raw.runId);
    if (!current) throw new Error(`Automation run ${raw.runId} was not found`);
    if (current.status === 'failed' && current.sessionId === null && current.finishedAt !== null) {
      return current;
    }
    if (current.status !== 'running') {
      throw new Error(`Automation run ${raw.runId} is ${current.status}, not running`);
    }
    const failed: HappyHerdAutomationRun = {
      ...current,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      message: raw.message,
    };
    await this.store.appendRun(failed);
    return failed;
  }

  /** Bind an exact late daemon webhook to a spawn that is still running. */
  async confirmRunStarted(
    raw: HappyHerdAutomationStartedConfirmation,
  ): Promise<HappyHerdAutomationRun> {
    const automation = await this.store.get(raw.automationId);
    if (automation.machineId !== this.machineId) throw new Error('Automation belongs to another machine');
    const current = await this.store.getRun(raw.automationId, raw.runId);
    if (!current) throw new Error(`Automation run ${raw.runId} was not found`);
    if (current.status === 'started' && current.sessionId === raw.sessionId) return current;
    if (current.status !== 'running' || current.sessionId !== null) {
      throw new Error(`Automation run ${raw.runId} cannot bind session ${raw.sessionId} from ${current.status}`);
    }
    const started: HappyHerdAutomationRun = {
      ...current,
      status: 'started',
      sessionId: raw.sessionId,
      finishedAt: null,
      message: 'Late provider registration was verified and bound to this automation run.',
    };
    await this.store.appendRun(started);
    return started;
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
