/**
 * Keeps an independent provider visible to whichever daemon instance is
 * currently running. Registration failure never affects the provider turn.
 */

import type { DaemonLocallyPersistedState } from '@/persistence';

export function daemonInstanceKey(state: DaemonLocallyPersistedState | null): string | null {
  if (!state) return null;
  return state.instanceId ?? `${state.pid}:${state.httpPort}:${state.startTime}`;
}

export function maintainDaemonSessionRegistration(options: {
  initialDaemonKey: string | null;
  readState: () => Promise<DaemonLocallyPersistedState | null>;
  register: () => Promise<boolean>;
  intervalMs?: number;
}): () => void {
  let lastRegisteredDaemonKey = options.initialDaemonKey;
  let refreshRunning = false;

  const refresh = async (): Promise<void> => {
    if (refreshRunning) return;
    refreshRunning = true;
    try {
      const currentDaemonKey = daemonInstanceKey(await options.readState());
      if (!currentDaemonKey || currentDaemonKey === lastRegisteredDaemonKey) return;
      if (await options.register()) lastRegisteredDaemonKey = currentDaemonKey;
    } finally {
      refreshRunning = false;
    }
  };

  const interval = setInterval(() => void refresh(), options.intervalMs ?? 5_000);
  interval.unref?.();
  void refresh();
  return () => clearInterval(interval);
}
