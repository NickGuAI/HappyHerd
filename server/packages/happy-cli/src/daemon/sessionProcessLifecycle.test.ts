import { describe, expect, it, vi } from 'vitest';

import type { TrackedSession } from './types';
import { SessionProcessLifecycle } from './sessionProcessLifecycle';

function trackedSession(): TrackedSession {
  return {
    startedBy: 'daemon',
    pid: 42,
    happySessionId: 'session-1',
    encryption: {
      encryptionKey: new Uint8Array([1, 2, 3]),
      encryptionVariant: 'dataKey',
      seq: 1,
      metadataVersion: 1,
      agentStateVersion: 1,
    },
  };
}

describe('SessionProcessLifecycle', () => {
  it('marks a session inactive only after its provider process exits', async () => {
    const session = trackedSession();
    const trackedSessions = new Map([[session.pid, session]]);
    const finishedSessions = new Map<string, TrackedSession>();
    const deactivateSession = vi.fn().mockResolvedValue(true);
    const lifecycle = new SessionProcessLifecycle({
      trackedSessions,
      finishedSessions,
      deactivateSession,
      log: vi.fn(),
    });

    expect(deactivateSession).not.toHaveBeenCalled();
    await lifecycle.recordExit(session.pid);

    expect(trackedSessions.has(session.pid)).toBe(false);
    expect(finishedSessions.get('session-1')).toBe(session);
    expect(deactivateSession).toHaveBeenCalledWith('session-1');
  });

  it('retries process-exit deactivation after a transient server failure', async () => {
    const session = trackedSession();
    const deactivateSession = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const lifecycle = new SessionProcessLifecycle({
      trackedSessions: new Map([[session.pid, session]]),
      finishedSessions: new Map(),
      deactivateSession,
      log: vi.fn(),
    });

    await lifecycle.recordExit(session.pid);
    await lifecycle.retryPending();
    await lifecycle.retryPending();

    expect(deactivateSession).toHaveBeenCalledTimes(2);
  });
});
