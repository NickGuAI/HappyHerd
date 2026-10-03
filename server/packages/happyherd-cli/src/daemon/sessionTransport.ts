import { randomUUID } from 'node:crypto';
import {
  sessionTransportEndpoint as transportEndpointLabel,
  type SessionTransportReport,
  type SessionTransportCommand,
  type SessionTransportStatus,
} from '@/api/sessionTransport';
export { sessionTransportEndpoint as transportEndpointLabel } from '@/api/sessionTransport';
export type { SessionTransportStatus } from '@/api/sessionTransport';

type Owner = { pid: number; isSuperSession: boolean; running: boolean };
type Entry = {
  report: SessionTransportReport;
  receivedAt: number;
  recovery?: SessionTransportCommand & { startedAt: number; state: 'pending' | 'succeeded' | 'failed'; errorCode?: string };
};

/** Coordinates an existing process only. It has no spawn, kill, or resume path. */
export class SessionTransportRecovery {
  private entries = new Map<string, Entry>();

  constructor(private readonly options: {
    endpoint: string;
    owner: (sessionId: string) => Owner | undefined;
    now?: () => number;
    recoveryId?: () => string;
  }) {}

  private now(): number { return this.options.now?.() ?? Date.now(); }

  exchange(report: SessionTransportReport): { recovery?: SessionTransportCommand } {
    const owner = this.options.owner(report.sessionId);
    if (!owner?.isSuperSession || !owner.running || owner.pid !== report.pid) {
      throw new Error('Super Session transport reporter is not the current live owner');
    }
    const previous = this.entries.get(report.sessionId);
    const entry: Entry = {
      report,
      receivedAt: this.now(),
      ...(previous?.report.pid === report.pid ? { recovery: previous.recovery } : {}),
    };
    const recovery = entry.recovery;
    if (recovery?.state === 'pending' && report.recovery?.id === recovery.id) {
      recovery.state = report.recovery.state;
      recovery.errorCode = report.recovery.errorCode;
    }
    this.entries.set(report.sessionId, entry);
    this.status(report.sessionId);
    return recovery?.state === 'pending'
      ? { recovery: { id: recovery.id, endpoint: recovery.endpoint } }
      : {};
  }

  status(sessionId: string): SessionTransportStatus {
    const owner = this.options.owner(sessionId);
    const entry = this.entries.get(sessionId);
    const currentEndpoint = transportEndpointLabel(this.options.endpoint);
    const base: SessionTransportStatus = {
      sessionId, providerRunning: owner?.running ?? false, state: 'disconnected',
      endpoint: null, currentEndpoint, pendingMessages: 'replay-on-reconnect', canRecover: false,
    };
    if (!owner) return { ...base, errorCode: 'unavailable' };
    if (!owner.running) return { ...base, errorCode: 'process-exited' };
    if (!owner.isSuperSession || !entry || entry.report.pid !== owner.pid
      || this.now() - entry.receivedAt > 10_000) {
      return { ...base, errorCode: 'unavailable' };
    }
    const recovery = entry.recovery;
    if (recovery?.state === 'pending' && this.now() - recovery.startedAt >= 30_000) {
      recovery.state = 'failed';
      recovery.errorCode = 'recovery-timeout';
    }
    const { transport } = entry.report;
    const result: SessionTransportStatus = {
      ...base, endpoint: transportEndpointLabel(transport.endpoint),
      state: transport.state, errorCode: transport.errorCode, canRecover: true,
      ...(transport.httpStatus ? { httpStatus: transport.httpStatus } : {}),
      ...(recovery ? { recoveryId: recovery.id } : {}),
    };
    if (recovery?.state === 'pending') return { ...result, state: 'reconnecting' };
    if (recovery?.state === 'failed' && !(transport.state === 'connected'
      && transportEndpointLabel(transport.endpoint) === currentEndpoint)) return { ...result, state: 'error', errorCode: recovery.errorCode ?? 'connect' };
    if (transportEndpointLabel(transport.endpoint) !== currentEndpoint) {
      return { ...result, state: 'disconnected', errorCode: 'stale-endpoint' };
    }
    return { ...result, canRecover: transport.state !== 'connected' };
  }

  recover(sessionId: string): SessionTransportStatus {
    const status = this.status(sessionId);
    const entry = this.entries.get(sessionId);
    if (!status.canRecover || !entry || entry.recovery?.state === 'pending') return status;
    entry.recovery = {
      id: this.options.recoveryId?.() ?? randomUUID(), endpoint: this.options.endpoint,
      startedAt: this.now(), state: 'pending',
    };
    return this.status(sessionId);
  }
}
