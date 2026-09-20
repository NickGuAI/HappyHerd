import type { TrackedSession } from './types';

interface SessionProcessLifecycleOptions {
  trackedSessions: Map<number, TrackedSession>;
  finishedSessions: Map<string, TrackedSession>;
  deactivateSession: (sessionId: string) => Promise<boolean>;
  log: (message: string) => void;
}

/**
 * Makes the provider process, rather than elapsed heartbeat time, authoritative
 * for session activity. Provider runners still send `session-end` themselves;
 * this daemon-observed path is the idempotent fallback for crashes and hard exits.
 */
export class SessionProcessLifecycle {
  private readonly pendingDeactivations = new Set<string>();

  constructor(private readonly options: SessionProcessLifecycleOptions) {}

  async recordExit(pid: number): Promise<void> {
    const session = this.options.trackedSessions.get(pid);
    if (!session) return;

    if (session.happySessionId && session.encryption) {
      this.options.finishedSessions.set(session.happySessionId, session);
      this.options.log(`Process PID ${pid} exited, preserved session ${session.happySessionId} for resume`);
    } else {
      this.options.log(`Removing exited process PID ${pid} from tracking`);
    }
    this.options.trackedSessions.delete(pid);

    if (session.happySessionId) {
      this.pendingDeactivations.add(session.happySessionId);
      await this.tryDeactivate(session.happySessionId);
    }
  }

  async retryPending(): Promise<void> {
    await Promise.all([...this.pendingDeactivations].map((sessionId) => this.tryDeactivate(sessionId)));
  }

  private async tryDeactivate(sessionId: string): Promise<void> {
    try {
      if (await this.options.deactivateSession(sessionId)) {
        this.pendingDeactivations.delete(sessionId);
        this.options.log(`Marked stopped session ${sessionId} inactive`);
      } else {
        this.options.log(`Could not mark stopped session ${sessionId} inactive; will retry`);
      }
    } catch (error) {
      this.options.log(`Could not mark stopped session ${sessionId} inactive; will retry: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
