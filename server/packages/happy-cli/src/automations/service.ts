import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CronExpressionParser } from 'cron-parser';
import cron, { type ScheduledTask } from 'node-cron';
import {
  HAPPYHERD_HEARTBEAT_STANDARD_INSTRUCTION,
  HappyHerdAutomationCreateInputSchema,
  HappyHerdHeartbeatControlInputSchema,
  HappyHerdAutomationTerminalRunStatusSchema,
  HappyHerdAutomationUpdateInputSchema,
  type HappyHerdAutomation,
  type HappyHerdAutomationCreateInput,
  type HappyHerdAutomationHistoryResponse,
  type HappyHerdAutomationListResponse,
  type HappyHerdAutomationRun,
  type HappyHerdAutomationTerminalRunStatus,
  type HappyHerdAutomationUpdateInput,
  type HappyHerdHeartbeatAutomation,
  type HappyHerdHeartbeatControlInput,
  type HappyHerdHeartbeatControlResponse,
} from '@slopus/happy-wire';
import type { Session } from '@/api/types';
import type { SpawnSessionOptions, SpawnSessionResult } from '@/modules/common/registerCommonHandlers';
import { logger } from '@/ui/logger';
import { agentContextRoot, listCommanders } from '@/agentContext/commanderContext';
import { HappyHerdAutomationStore } from './store';
import { automationUnattendedPermissionMode } from './unattendedPolicy';

const SCHEDULER_HEARTBEAT_MS = 30_000;
const MAX_OFFLINE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1_000;
const HEARTBEAT_DUE = 'Heartbeat is due.';
const HEARTBEAT_WAITING_DAEMON = 'Heartbeat is waiting for the target session runtime.';
const HEARTBEAT_WAITING_QUEUE = 'Heartbeat is waiting for the resumed runtime queue snapshot.';
const HEARTBEAT_PERSISTED = 'Heartbeat message is persisted; waiting for runtime queue acknowledgement.';
const HEARTBEAT_PERSISTED_RETRY = 'Heartbeat message was retried with the same ID; waiting for runtime queue acknowledgement.';
const HEARTBEAT_QUEUED = 'Heartbeat is queued in the target session.';
const HEARTBEAT_DELIVERY_RETRY = 'Heartbeat delivery acknowledgement was ambiguous; one retry remains.';
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

export interface HappyHerdHeartbeatTarget {
  session: Session;
  running: boolean;
}

export interface HappyHerdHeartbeatDependencies {
  loadTarget: (sessionId: string) => Promise<HappyHerdHeartbeatTarget>;
  postMessage: (target: Session, input: {
    localId: string;
    text: string;
    displayText: string;
    automationId: string;
  }) => Promise<void>;
  resumeTarget: (sessionId: string, options?: { replayQueueMessageId?: string }) => Promise<SpawnSessionResult>;
}

export interface HappyHerdAutomationRunRecoveryDependencies {
  hasExactTrackedRun: (run: HappyHerdAutomationRun) => boolean;
  stopExactTrackedRun: (run: HappyHerdAutomationRun) => boolean;
}

export interface HappyHerdAutomationRunTarget {
  automationId: string;
  runId: string;
}

export interface HappyHerdAutomationRunAbandonment extends HappyHerdAutomationRunTarget {
  sessionId: string | null;
  confirmation: 'ABANDON';
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
  if (automation.kind === 'heartbeat') return null;
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

export function formatHeartbeatInterval(intervalSeconds: number): string {
  if (intervalSeconds % 86_400 === 0) return `${intervalSeconds / 86_400}d`;
  if (intervalSeconds % 3_600 === 0) return `${intervalSeconds / 3_600}h`;
  if (intervalSeconds % 60 === 0) return `${intervalSeconds / 60}m`;
  return `${intervalSeconds}s`;
}

function heartbeatPrompt(automation: HappyHerdHeartbeatAutomation, metadata: Session['metadata']): string {
  const interval = formatHeartbeatInterval(automation.intervalSeconds);
  const commander = metadata.commanderId
    ? `${metadata.commanderName ?? 'none'} (${metadata.commanderId})`
    : 'none';
  const contextLines = [
    `- Session: ${automation.targetSessionId}`,
    `- Commander: ${commander}`,
    ...(metadata.commanderId ? [
      `- Commander definition: ${metadata.commanderPath ?? 'none'}`,
      `- Commander AgentContext: ${metadata.commanderAgentContextPath ?? 'none'}`,
    ] : []),
    `- Global AgentContext: ${metadata.globalAgentContextPath ?? 'none'}`,
    `- Closest project guidance: ${metadata.projectGuidancePath ?? 'none'}`,
  ];
  const refreshLines = metadata.commanderId
    ? [
      '- COMMANDER.md for identity and scope',
      '- memory/1-working-memory.md for current state',
      '- relevant sections of memory/2-long-term-memory.md for durable constraints',
      '- memory/0-observations.jsonl only when dated prior-run evidence is needed',
      '- the closest project guide before changing project files',
    ]
    : ['- the closest project guide before changing project files'];
  return `[Heartbeat — recurring instruction, every ${interval}]

Session context:
${contextLines.join('\n')}

Refresh only what the active task needs:
${refreshLines.join('\n')}

Recurring instruction:
${automation.instruction}

Continue meaningful unfinished work from this session's existing conversation,
goal or plan, and workspace artifacts. Preserve accepted scope and completed
work. Do not restart completed work, create a new task, or broaden authority.

If nothing meaningful and authorized can be done, the task is complete, or
progress requires user input or an external-state change, say so briefly and
stop. Do not invent work.`;
}

function heartbeatDisplayText(automation: HappyHerdHeartbeatAutomation): string {
  const instruction = automation.instruction === HAPPYHERD_HEARTBEAT_STANDARD_INSTRUCTION
    ? 'Standard continuation'
    : automation.instruction;
  const compact = instruction.length > 80 ? `${instruction.slice(0, 79)}…` : instruction;
  return `♥ Heartbeat · every ${formatHeartbeatInterval(automation.intervalSeconds)} · ${compact}`;
}

export class HappyHerdAutomationService {
  private readonly store = new HappyHerdAutomationStore();
  private readonly tasks = new Map<string, ScheduledTask>();
  private readonly inFlight = new Set<string>();
  private heartbeatMutationTail: Promise<void> = Promise.resolve();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(
    private readonly machineId: string,
    private readonly spawnSession: (options: AutomationSpawnSessionOptions) => Promise<SpawnSessionResult>,
    private readonly heartbeatDependencies?: HappyHerdHeartbeatDependencies,
    private readonly runRecoveryDependencies?: HappyHerdAutomationRunRecoveryDependencies,
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
    await writeJsonAtomic(schedulerStatePath(), { schemaVersion: 1, lastSeenAt: new Date().toISOString() });
    this.started = false;
  }

  private async serializeHeartbeatMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.heartbeatMutationTail;
    let release!: () => void;
    this.heartbeatMutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async writeHeartbeat(now: Date): Promise<void> {
    await writeJsonAtomic(schedulerStatePath(), { schemaVersion: 1, lastSeenAt: now.toISOString() });
    await this.reconcileHeartbeats(now);
  }

  private async recordOfflineWindows(from: Date, until: Date): Promise<void> {
    if (until.getTime() - from.getTime() <= SCHEDULER_HEARTBEAT_MS * 2) return;
    const { automations } = await this.store.list(this.machineId);
    for (const automation of automations.filter((candidate) => candidate.status === 'active' && candidate.kind !== 'heartbeat')) {
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
      if (automation.status !== 'active' || automation.kind === 'heartbeat') continue;
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
    if (automation.kind === 'heartbeat') throw new Error('Session heartbeats run only through their target session queue');

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
            permissionMode: automationUnattendedPermissionMode(automation.rail),
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

  private assertHeartbeatTarget(
    heartbeat: Pick<HappyHerdHeartbeatAutomation, 'rail' | 'targetSessionId'>,
    target: HappyHerdHeartbeatTarget,
  ): void {
    if (target.session.id !== heartbeat.targetSessionId) {
      throw new Error(`Heartbeat resolved the wrong target session ${target.session.id}`);
    }
    if (target.session.metadata.machineId && target.session.metadata.machineId !== this.machineId) {
      throw new Error('Heartbeat target belongs to another machine');
    }
    const flavor = target.session.metadata.flavor ?? 'claude';
    if (flavor !== 'claude' && flavor !== 'codex') {
      throw new Error(`Heartbeat target provider "${flavor}" is not supported`);
    }
    if (heartbeat.rail !== flavor) {
      throw new Error(`Heartbeat target provider changed from ${heartbeat.rail} to ${flavor}`);
    }
    if (flavor === 'claude' && !target.session.metadata.claudeSessionId) {
      throw new Error('Heartbeat target is not a resumable Claude session');
    }
    if (flavor === 'codex' && !target.session.metadata.codexThreadId) {
      throw new Error('Heartbeat target is not a resumable Codex session');
    }
  }

  private async failHeartbeat(
    heartbeat: HappyHerdHeartbeatAutomation,
    run: HappyHerdAutomationRun,
    message: string,
    now = new Date(),
  ): Promise<void> {
    await this.store.appendRun({
      ...run,
      status: 'failed',
      finishedAt: now.toISOString(),
      message,
    });
    await this.store.updateHeartbeat(heartbeat.id, { status: 'paused', nextDueAt: null });
  }

  private async markHeartbeatStarted(
    heartbeat: HappyHerdHeartbeatAutomation,
    run: HappyHerdAutomationRun,
    startedAt: string,
  ): Promise<HappyHerdAutomationRun> {
    const started: HappyHerdAutomationRun = run.status === 'started'
      ? run
      : {
        ...run,
        status: 'started',
        startedAt,
        finishedAt: null,
        sessionId: heartbeat.targetSessionId,
        message: 'Heartbeat started in the target provider runtime.',
      };
    if (run.status !== 'started') await this.store.appendRun(started);
    await this.store.updateHeartbeat(heartbeat.id, {
      lastRunAt: startedAt,
      nextDueAt: heartbeat.status === 'paused'
        ? null
        : new Date(Date.parse(startedAt) + heartbeat.intervalSeconds * 1_000).toISOString(),
    });
    return started;
  }

  private async reconcileHeartbeat(heartbeat: HappyHerdHeartbeatAutomation, now: Date): Promise<void> {
    if (!this.heartbeatDependencies) return;
    let run = await this.store.activeRun(heartbeat.id);
    if (!run) {
      if (heartbeat.status !== 'active' || !heartbeat.nextDueAt || Date.parse(heartbeat.nextDueAt) > now.getTime()) return;
      run = {
        id: randomUUID(),
        automationId: heartbeat.id,
        source: 'schedule',
        scheduledFor: heartbeat.nextDueAt,
        startedAt: now.toISOString(),
        finishedAt: null,
        status: 'running',
        attempt: 1,
        sessionId: null,
        message: HEARTBEAT_DUE,
      };
      await this.store.recordSchedule(heartbeat.id, heartbeat.nextDueAt);
      await this.store.appendRun(run);
    }

    let target: HappyHerdHeartbeatTarget;
    try {
      target = await this.heartbeatDependencies.loadTarget(heartbeat.targetSessionId);
      this.assertHeartbeatTarget(heartbeat, target);
    } catch (error) {
      await this.failHeartbeat(
        heartbeat,
        run,
        error instanceof Error ? error.message : String(error),
        now,
      );
      return;
    }

    const queue = target.session.agentState?.messageQueue;
    const receipt = target.session.agentState?.heartbeatDelivery;
    const receiptMatches = receipt?.automationId === heartbeat.id && receipt.occurrenceId === run.id;
    if (receiptMatches && receipt.status !== 'started') {
      run = await this.markHeartbeatStarted(heartbeat, run, receipt.startedAt);
      await this.store.appendRun({
        ...run,
        status: receipt.status === 'completed' ? 'completed' : 'failed',
        finishedAt: receipt.finishedAt,
        message: receipt.message,
      });
      return;
    }

    if (!target.running) {
      if (run.attempt >= 2) {
        if (run.message !== HEARTBEAT_WAITING_DAEMON) {
          await this.store.appendRun({ ...run, message: HEARTBEAT_WAITING_DAEMON });
        }
        return;
      }
      const waiting = { ...run, attempt: Math.max(run.attempt, 2), message: HEARTBEAT_WAITING_DAEMON };
      await this.store.appendRun(waiting);
      const result = await this.heartbeatDependencies.resumeTarget(heartbeat.targetSessionId, {
        replayQueueMessageId: run.id,
      });
      if (result.type !== 'success' || result.sessionId !== heartbeat.targetSessionId) {
        const message = result.type === 'error'
          ? result.errorMessage
          : result.type === 'requestToApproveDirectoryCreation'
            ? `Heartbeat target workspace does not exist: ${result.directory}`
            : `Heartbeat resume returned the wrong session ${result.sessionId}`;
        await this.failHeartbeat(heartbeat, waiting, message, now);
      }
      return;
    }

    if (receiptMatches) {
      await this.markHeartbeatStarted(heartbeat, run, receipt.startedAt);
      return;
    }

    if (queue?.currentMessageIds.includes(run.id)) {
      // Queue-current is useful presentation state, but the provider-owned
      // receipt is the sole authority for actual fire time and cadence.
      return;
    }
    if (queue?.pendingMessageIds.includes(run.id)) {
      if (run.status === 'running' && run.message !== HEARTBEAT_QUEUED) {
        await this.store.appendRun({ ...run, message: HEARTBEAT_QUEUED });
      }
      return;
    }
    // Losing sight of an ID after runtime acceptance is not a provider result.
    if (run.status === 'started' || run.message === HEARTBEAT_QUEUED) return;

    // Runtime registration alone is insufficient: wait for its durable queue snapshot.
    if (!queue) {
      if (run.message !== HEARTBEAT_WAITING_QUEUE) {
        await this.store.appendRun({ ...run, message: HEARTBEAT_WAITING_QUEUE });
      }
      return;
    }

    if (run.message === HEARTBEAT_PERSISTED_RETRY) {
      await this.failHeartbeat(heartbeat, run, 'Heartbeat was not accepted by the runtime after one same-ID retry.', now);
      return;
    }

    try {
      await this.heartbeatDependencies.postMessage(target.session, {
        localId: run.id,
        text: heartbeatPrompt(heartbeat, target.session.metadata),
        displayText: heartbeatDisplayText(heartbeat),
        automationId: heartbeat.id,
      });
      await this.store.appendRun({
        ...run,
        message: run.message === HEARTBEAT_PERSISTED || run.message === HEARTBEAT_DELIVERY_RETRY
          ? HEARTBEAT_PERSISTED_RETRY
          : HEARTBEAT_PERSISTED,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (run.message === HEARTBEAT_DELIVERY_RETRY) {
        await this.failHeartbeat(heartbeat, run, `Heartbeat delivery failed after one retry: ${message}`, now);
      } else {
        await this.store.appendRun({ ...run, message: HEARTBEAT_DELIVERY_RETRY });
      }
    }
  }

  private async reconcileHeartbeats(now: Date): Promise<void> {
    if (!this.heartbeatDependencies) return;
    await this.serializeHeartbeatMutation(async () => {
      const { automations } = await this.store.list(this.machineId);
      for (const heartbeat of automations.filter((candidate): candidate is HappyHerdHeartbeatAutomation => candidate.kind === 'heartbeat')) {
        if (heartbeat.status !== 'active' && !(await this.store.activeRun(heartbeat.id))) continue;
        try {
          await this.reconcileHeartbeat(heartbeat, now);
        } catch (error) {
          logger.warn(`[AUTOMATIONS] Failed to reconcile session heartbeat ${heartbeat.id}`, error);
        }
      }
    });
  }

  private async discardUnacceptedHeartbeatRun(heartbeat: HappyHerdHeartbeatAutomation): Promise<void> {
    const run = await this.store.activeRun(heartbeat.id);
    if (!run || run.status !== 'running') return;
    if (run.message === HEARTBEAT_PERSISTED || run.message === HEARTBEAT_PERSISTED_RETRY || run.message === HEARTBEAT_QUEUED) return;
    try {
      const target = await this.heartbeatDependencies?.loadTarget(heartbeat.targetSessionId);
      const queue = target?.session.agentState?.messageQueue;
      if (queue?.pendingMessageIds.includes(run.id) || queue?.currentMessageIds.includes(run.id)) return;
    } catch {
      // A merely due occurrence has not entered the runtime queue and is safe to remove.
    }
    await this.store.discardUnacceptedRun(heartbeat.id, run.id);
  }

  private async heartbeatStatus(targetSessionId: string, now = new Date()): Promise<HappyHerdHeartbeatControlResponse> {
    const heartbeat = await this.store.heartbeatForSession(this.machineId, targetSessionId);
    if (!heartbeat) {
      return {
        heartbeat: null,
        currentRun: null,
        lastRun: null,
        deliveryState: null,
        queuedAhead: null,
        observedAt: now.toISOString(),
      };
    }
    const history = await this.store.history(heartbeat.id);
    const currentRun = history.find((run) => run.status === 'running' || run.status === 'started') ?? null;
    let deliveryState: HappyHerdHeartbeatControlResponse['deliveryState'] = currentRun
      ? currentRun.status === 'started'
        ? 'running'
        : currentRun.message === HEARTBEAT_WAITING_DAEMON || currentRun.message === HEARTBEAT_WAITING_QUEUE
          ? 'waiting-daemon'
          : currentRun.message === HEARTBEAT_PERSISTED || currentRun.message === HEARTBEAT_PERSISTED_RETRY
            ? 'persisted'
            : currentRun.message === HEARTBEAT_QUEUED
              ? 'queued'
              : 'due'
      : history[0]?.status === 'failed'
        ? 'failed'
        : 'idle';
    let queuedAhead: number | null = null;
    if (currentRun && this.heartbeatDependencies) {
      try {
        const target = await this.heartbeatDependencies.loadTarget(targetSessionId);
        const pending = target.session.agentState?.messageQueue?.pendingMessageIds ?? [];
        const index = pending.indexOf(currentRun.id);
        if (index >= 0) {
          deliveryState = 'queued';
          queuedAhead = index;
        } else if (target.session.agentState?.messageQueue?.currentMessageIds.includes(currentRun.id)) {
          deliveryState = 'running';
          queuedAhead = 0;
        }
      } catch {
        // Durable automation state still provides status while the target is unavailable.
      }
    }
    return {
      heartbeat,
      currentRun,
      lastRun: history.find((run) => run.status !== 'running' && run.status !== 'started') ?? null,
      deliveryState,
      queuedAhead,
      observedAt: now.toISOString(),
    };
  }

  async controlHeartbeat(raw: HappyHerdHeartbeatControlInput): Promise<HappyHerdHeartbeatControlResponse> {
    if (!this.heartbeatDependencies) throw new Error('Session heartbeat delivery is unavailable');
    const input = HappyHerdHeartbeatControlInputSchema.parse(raw);
    const now = new Date();
    return this.serializeHeartbeatMutation(async () => {
      if (input.action === 'status') return this.heartbeatStatus(input.targetSessionId, now);

      const existing = await this.store.heartbeatForSession(this.machineId, input.targetSessionId);
      if (input.action === 'set') {
        const target = await this.heartbeatDependencies!.loadTarget(input.targetSessionId);
        const flavor = target.session.metadata.flavor ?? 'claude';
        if (flavor !== 'claude' && flavor !== 'codex') {
          throw new Error(`Heartbeat target provider "${flavor}" is not supported`);
        }
        const provisional: Pick<HappyHerdHeartbeatAutomation, 'targetSessionId' | 'rail'> = {
          targetSessionId: input.targetSessionId,
          rail: flavor,
        };
        this.assertHeartbeatTarget(provisional, target);
        if (existing) {
          await this.discardUnacceptedHeartbeatRun(existing);
          if (await this.store.activeRun(existing.id)) {
            throw new Error('Heartbeat cannot be changed while its current occurrence is in progress');
          }
        }
        await this.store.upsertHeartbeat(this.machineId, {
          targetSessionId: input.targetSessionId,
          name: 'Session heartbeat',
          instruction: input.instruction ?? HAPPYHERD_HEARTBEAT_STANDARD_INSTRUCTION,
          intervalSeconds: input.intervalSeconds,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          workspace: target.session.metadata.path,
          rail: flavor,
          commanderId: target.session.metadata.commanderId ?? null,
        }, now);
        return this.heartbeatStatus(input.targetSessionId, now);
      }
      if (!existing) throw new Error('No heartbeat is configured for this session');
      if (input.action === 'pause') {
        await this.discardUnacceptedHeartbeatRun(existing);
        await this.store.updateHeartbeat(existing.id, { status: 'paused', nextDueAt: null });
      } else if (input.action === 'resume') {
        await this.store.updateHeartbeat(existing.id, {
          status: 'active',
          nextDueAt: new Date(now.getTime() + existing.intervalSeconds * 1_000).toISOString(),
        });
      } else {
        await this.discardUnacceptedHeartbeatRun(existing);
        await this.store.delete(existing.id);
      }
      return this.heartbeatStatus(input.targetSessionId, now);
    });
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

  /** Ask the daemon to stop only the live process whose full run provenance matches. */
  async stopRun(raw: HappyHerdAutomationRunTarget): Promise<HappyHerdAutomationRun> {
    const automation = await this.store.get(raw.automationId);
    if (automation.machineId !== this.machineId) throw new Error('Automation belongs to another machine');
    const current = await this.store.getRun(raw.automationId, raw.runId);
    if (!current) throw new Error(`Automation run ${raw.runId} was not found`);
    if (current.status !== 'started' || !current.sessionId) {
      throw new Error(`Automation run ${raw.runId} has no exact started session to stop`);
    }
    if (!this.runRecoveryDependencies?.stopExactTrackedRun(current)) {
      throw new Error(`Automation run ${raw.runId} is not an exact live session tracked by this daemon`);
    }
    // Process signalling is not terminal evidence. The row remains active
    // until the normal provider-exit reconciler confirms the exact PID exited.
    return current;
  }

  /**
   * Explicitly close a legacy active row only when no exact live run is
   * tracked. This never signals a process and preserves the historical row.
   */
  async abandonRun(raw: HappyHerdAutomationRunAbandonment): Promise<HappyHerdAutomationRun> {
    if (raw.confirmation !== 'ABANDON') {
      throw new Error('Explicit ABANDON confirmation is required');
    }
    const automation = await this.store.get(raw.automationId);
    if (automation.machineId !== this.machineId) throw new Error('Automation belongs to another machine');
    const current = await this.store.getRun(raw.automationId, raw.runId);
    if (!current) throw new Error(`Automation run ${raw.runId} was not found`);
    if (current.status !== 'running' && current.status !== 'started') {
      throw new Error(`Automation run ${raw.runId} is already ${current.status}`);
    }
    if (current.sessionId !== raw.sessionId) {
      throw new Error(`Automation run ${raw.runId} session confirmation does not match`);
    }
    if (!this.runRecoveryDependencies) {
      throw new Error('Automation run recovery is unavailable on this daemon');
    }
    if (this.runRecoveryDependencies.hasExactTrackedRun(current)) {
      throw new Error(`Automation run ${raw.runId} is still tracked; stop the exact run instead`);
    }
    const abandoned: HappyHerdAutomationRun = {
      ...current,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      message: 'Operator explicitly abandoned this untracked legacy automation run.',
    };
    await this.store.appendRun(abandoned);
    return abandoned;
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
