import type {
  SideChatDelegationBrief,
  SideChatCloseAllReceipt,
  SideChatListReceipt,
  SideChatLifecycleReceipt,
  SideChatLifecycleRequest,
  SideChatLaunchOptions,
  SideChatPhaseReceipt,
  SideChatResourceUsage,
  SideChatSingleReceipt,
  SideChatStatusReceipt,
} from '@/commands/sideChat';
import { failedHostResourceUsage } from './hostResourceUsage';

export type DaemonSideChatRecord = SideChatStatusReceipt;

export type SideChatOperationResult = {
  success: boolean;
  message?: string;
};

export type DaemonSideChatLifecycleDependencies = {
  create: (
    parentSessionId: string,
    brief: SideChatDelegationBrief | null,
    launch: SideChatLaunchOptions | undefined,
  ) => Promise<{ sessionId: string; briefDelivery: SideChatOperationResult | null }>;
  listSessionIds: (parentSessionId: string) => Promise<string[]>;
  read: (sessionId: string) => Promise<DaemonSideChatRecord>;
  stopProvider: (sessionId: string) => Promise<SideChatOperationResult>;
  archiveMetadata: (sessionId: string) => Promise<SideChatOperationResult>;
  deactivate: (sessionId: string) => Promise<SideChatOperationResult>;
  resumeProvider: (sessionId: string) => Promise<SideChatOperationResult>;
  sampleResources: () => Promise<SideChatResourceUsage>;
};

function phase(
  name: SideChatPhaseReceipt['phase'],
  status: SideChatPhaseReceipt['status'],
  message?: string,
): SideChatPhaseReceipt {
  return { phase: name, status, ...(message ? { message } : {}) };
}

function briefDeliveryPhase(result: SideChatOperationResult | null): SideChatPhaseReceipt {
  if (result === null) return phase('deliver-brief', 'skipped');
  return phase('deliver-brief', result.success ? 'succeeded' : 'failed', result.message);
}

function failedSingle(
  action: SideChatSingleReceipt['action'],
  sessionId: string | null,
  name: SideChatPhaseReceipt['phase'],
  error: unknown,
): SideChatSingleReceipt {
  return {
    schemaVersion: 1,
    type: 'side-chat',
    action,
    success: false,
    parentSessionId: null,
    sessionId,
    child: null,
    phases: [phase(name, 'failed', error instanceof Error ? error.message : String(error))],
  };
}

/**
 * Coordinates side-chat lifecycle phases while leaving process, encryption,
 * server, and read-back authority in the daemon-owned dependency boundary.
 */
export class DaemonSideChatLifecycle {
  constructor(private readonly dependencies: DaemonSideChatLifecycleDependencies) {}

  async execute(request: SideChatLifecycleRequest): Promise<SideChatLifecycleReceipt> {
    switch (request.action) {
      case 'create': return this.create(request.parentSessionId, request.brief, request.launch);
      case 'list': return this.list(request.parentSessionId);
      case 'status': return this.status(request.sessionId);
      case 'stop': return this.stop(request.sessionId);
      case 'close': return this.close(request.sessionId);
      case 'reopen': return this.reopen(request.sessionId);
      case 'close-all': return this.closeAll(request.parentSessionId);
    }
  }

  private async create(
    parentSessionId: string,
    brief: SideChatDelegationBrief | null,
    launch: SideChatLaunchOptions | undefined,
  ): Promise<SideChatSingleReceipt> {
    const resourcePromise = this.dependencies.sampleResources()
      .catch(() => failedHostResourceUsage());
    let created: Awaited<ReturnType<DaemonSideChatLifecycleDependencies['create']>>;
    try {
      created = await this.dependencies.create(parentSessionId, brief, launch);
    } catch (error) {
      return {
        ...failedSingle('create', null, 'resolve', error),
        schemaVersion: 2,
        resource: await resourcePromise,
      };
    }

    let child: DaemonSideChatRecord;
    try {
      child = await this.dependencies.read(created.sessionId);
    } catch (error) {
      return {
        schemaVersion: 2,
        type: 'side-chat',
        action: 'create',
        success: false,
        parentSessionId,
        sessionId: created.sessionId,
        child: null,
        phases: [
          phase('resolve', 'succeeded'),
          briefDeliveryPhase(created.briefDelivery),
          phase('readback', 'failed', error instanceof Error ? error.message : String(error)),
        ],
        resource: await resourcePromise,
      };
    }

    const lineageMatches = child.parentSessionId === parentSessionId;
    const childIsRunning = child.status === 'running';
    return {
      schemaVersion: 2,
      type: 'side-chat',
      action: 'create',
      success: lineageMatches && childIsRunning && (created.briefDelivery?.success ?? true),
      parentSessionId,
      sessionId: child.sessionId,
      child,
      phases: [
        phase('resolve', 'succeeded'),
        briefDeliveryPhase(created.briefDelivery),
        phase(
          'readback',
          lineageMatches && childIsRunning ? 'succeeded' : 'failed',
          !lineageMatches
            ? 'Created child lineage did not match the requested parent'
            : !childIsRunning
              ? 'Created child was not running at read-back'
              : undefined,
        ),
      ],
      resource: await resourcePromise,
    };
  }

  private async list(parentSessionId: string): Promise<SideChatListReceipt> {
    const children: SideChatStatusReceipt[] = [];
    const failures: Array<{ sessionId: string; phase: 'readback'; message: string }> = [];
    let ids: string[];
    try {
      ids = await this.dependencies.listSessionIds(parentSessionId);
    } catch (error) {
      return {
        schemaVersion: 1,
        type: 'side-chat-list',
        action: 'list',
        success: false,
        parentSessionId,
        count: 0,
        openCount: 0,
        archivedCount: 0,
        children,
        failures: [{
          sessionId: parentSessionId,
          phase: 'readback',
          message: error instanceof Error ? error.message : String(error),
        }],
      };
    }
    for (const sessionId of ids) {
      try {
        const child = await this.dependencies.read(sessionId);
        if (child.parentSessionId !== parentSessionId) {
          throw new Error(`Side chat ${sessionId} no longer belongs to parent ${parentSessionId}`);
        }
        children.push(child);
      } catch (error) {
        failures.push({
          sessionId,
          phase: 'readback',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    children.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
    const archivedCount = children.filter((child) => child.status === 'archived').length;
    return {
      schemaVersion: 1,
      type: 'side-chat-list',
      action: 'list',
      success: failures.length === 0,
      parentSessionId,
      count: children.length,
      openCount: children.length - archivedCount,
      archivedCount,
      children,
      failures,
    };
  }

  private async status(sessionId: string): Promise<SideChatSingleReceipt> {
    try {
      const child = await this.dependencies.read(sessionId);
      return {
        schemaVersion: 1,
        type: 'side-chat',
        action: 'status',
        success: true,
        parentSessionId: child.parentSessionId,
        sessionId: child.sessionId,
        child,
        phases: [phase('resolve', 'succeeded'), phase('readback', 'succeeded')],
      };
    } catch (error) {
      return failedSingle('status', sessionId, 'resolve', error);
    }
  }

  private async stop(sessionId: string): Promise<SideChatSingleReceipt> {
    return this.stopOrClose(sessionId, 'stop');
  }

  private async close(sessionId: string): Promise<SideChatSingleReceipt> {
    return this.stopOrClose(sessionId, 'close');
  }

  private async stopOrClose(
    sessionId: string,
    action: 'stop' | 'close',
  ): Promise<SideChatSingleReceipt> {
    const phases: SideChatPhaseReceipt[] = [];
    let child: DaemonSideChatRecord;
    try {
      child = await this.dependencies.read(sessionId);
      phases.push(phase('resolve', 'succeeded'));
    } catch (error) {
      return failedSingle(action, sessionId, 'resolve', error);
    }

    let stopConfirmed = true;
    if (child.providerRunning) {
      const stopped = await this.dependencies.stopProvider(sessionId);
      phases.push(phase('stop', stopped.success ? 'succeeded' : 'failed', stopped.message));
      stopConfirmed = stopped.success;
    } else if (child.active) {
      // The durable server says the child is active but this daemon has no
      // OS-confirmed process registration. Never call a stale persisted PID
      // "stopped"; repair server state, but keep the receipt failed so the
      // unowned-process condition remains visible to operators.
      phases.push(phase('stop', 'failed', 'process-unowned: active session has no live daemon-owned provider process'));
    } else {
      phases.push(phase('stop', 'skipped', 'Provider already stopped'));
    }

    let deactivationConfirmed = !child.active;
    if (!stopConfirmed) {
      phases.push(phase('deactivate', 'skipped', 'Provider stop was not confirmed'));
    } else if (child.active) {
      const deactivated = await this.dependencies.deactivate(sessionId);
      phases.push(phase('deactivate', deactivated.success ? 'succeeded' : 'failed', deactivated.message));
      deactivationConfirmed = deactivated.success;
    } else {
      phases.push(phase('deactivate', 'skipped', 'Server session already inactive'));
    }

    if (action === 'close') {
      if (!stopConfirmed) {
        phases.push(phase('archive-metadata', 'skipped', 'Provider stop was not confirmed'));
      } else if (!deactivationConfirmed) {
        phases.push(phase('archive-metadata', 'skipped', 'Server deactivation was not confirmed'));
      } else if (child.status === 'archived') {
        phases.push(phase('archive-metadata', 'skipped', 'Lifecycle metadata already archived'));
      } else {
        const archived = await this.dependencies.archiveMetadata(sessionId);
        phases.push(phase('archive-metadata', archived.success ? 'succeeded' : 'failed', archived.message));
      }
    }

    try {
      child = await this.dependencies.read(sessionId);
      const finalMatches = !child.providerRunning
        && !child.active
        && (action === 'stop' || child.status === 'archived');
      if (action === 'close' && finalMatches) {
        const archivePhaseIndex = phases.findIndex((entry) => (
          entry.phase === 'archive-metadata' && entry.status === 'failed'
        ));
        if (archivePhaseIndex >= 0) {
          // A bounded Socket.IO acknowledgement can be lost after the server
          // commits the encrypted update. The exact decrypted read-back is
          // authoritative: reconcile only that archive phase, and only when
          // the complete closed invariant is visible. If the write truly did
          // not land, status remains non-archived and both phases stay failed.
          phases[archivePhaseIndex] = phase(
            'archive-metadata',
            'succeeded',
            'Authoritative read-back confirmed the encrypted archive update',
          );
        }
      }
      phases.push(phase('readback', finalMatches ? 'succeeded' : 'failed', finalMatches
        ? undefined
        : `Final state is ${child.status}, providerRunning=${child.providerRunning}, active=${child.active}`));
    } catch (error) {
      phases.push(phase('readback', 'failed', error instanceof Error ? error.message : String(error)));
      return {
        schemaVersion: 1,
        type: 'side-chat',
        action,
        success: false,
        parentSessionId: child.parentSessionId,
        sessionId: child.sessionId,
        child: null,
        phases,
      };
    }

    return {
      schemaVersion: 1,
      type: 'side-chat',
      action,
      success: phases.every((entry) => entry.status !== 'failed'),
      parentSessionId: child.parentSessionId,
      sessionId: child.sessionId,
      child,
      phases,
    };
  }

  private async reopen(sessionId: string): Promise<SideChatSingleReceipt> {
    const phases: SideChatPhaseReceipt[] = [];
    let child: DaemonSideChatRecord;
    try {
      child = await this.dependencies.read(sessionId);
      phases.push(phase('resolve', 'succeeded'));
    } catch (error) {
      return failedSingle('reopen', sessionId, 'resolve', error);
    }

    if (child.providerRunning && child.status === 'running') {
      phases.push(phase('resume', 'skipped', 'Provider already running'));
    } else {
      const resumed = await this.dependencies.resumeProvider(sessionId);
      phases.push(phase('resume', resumed.success ? 'succeeded' : 'failed', resumed.message));
    }

    try {
      child = await this.dependencies.read(sessionId);
      const finalMatches = child.providerRunning && child.active && child.status === 'running';
      phases.push(phase('readback', finalMatches ? 'succeeded' : 'failed', finalMatches
        ? undefined
        : `Final state is ${child.status}, providerRunning=${child.providerRunning}, active=${child.active}`));
    } catch (error) {
      phases.push(phase('readback', 'failed', error instanceof Error ? error.message : String(error)));
      return {
        schemaVersion: 1,
        type: 'side-chat',
        action: 'reopen',
        success: false,
        parentSessionId: child.parentSessionId,
        sessionId: child.sessionId,
        child: null,
        phases,
      };
    }

    return {
      schemaVersion: 1,
      type: 'side-chat',
      action: 'reopen',
      success: phases.every((entry) => entry.status !== 'failed'),
      parentSessionId: child.parentSessionId,
      sessionId: child.sessionId,
      child,
      phases,
    };
  }

  private async closeAll(parentSessionId: string): Promise<SideChatCloseAllReceipt> {
    let ids: string[];
    try {
      ids = await this.dependencies.listSessionIds(parentSessionId);
    } catch (error) {
      const failed = failedSingle('close', null, 'resolve', error);
      return {
        schemaVersion: 1,
        type: 'side-chat-close-all',
        action: 'close-all',
        success: false,
        parentSessionId,
        total: 1,
        closed: 0,
        failed: 1,
        children: [failed],
      };
    }
    // Snapshot first, then close in order. This avoids concurrent provider
    // shutdowns contending for the daemon's process/session bookkeeping and
    // makes partial receipts deterministic.
    const children: SideChatSingleReceipt[] = [];
    for (const sessionId of ids) {
      children.push(await this.close(sessionId));
    }
    const closed = children.filter((child) => child.success).length;
    return {
      schemaVersion: 1,
      type: 'side-chat-close-all',
      action: 'close-all',
      success: closed === children.length,
      parentSessionId,
      total: children.length,
      closed,
      failed: children.length - closed,
      children,
    };
  }
}
