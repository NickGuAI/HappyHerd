// Observation only: no clock, probes, lifecycle decisions, or readiness changes.
export type DaemonReadinessReason = 'state-unavailable' | 'process-check-failed'
  | 'http-ok' | 'http-request-failed' | 'accepted-without-port' | 'accepted-after-http-non-ok';
export type DaemonReadinessObservation = { reason: DaemonReadinessReason; ready: boolean };
type Attempt = DaemonReadinessObservation & { attempt: number };
export const DAEMON_READINESS_PREFIX = '[HAPPYHERD_DAEMON_START_READINESS] ';
const maximumAttempts = 50;
const expected = {
  'state-unavailable': false,
  'process-check-failed': false,
  'http-ok': true,
  'http-request-failed': false,
  'accepted-without-port': true,
  'accepted-after-http-non-ok': true,
} as const;

export function createDaemonReadinessRecorder() {
  const attempts: Attempt[] = [];
  return {
    observe(observation: DaemonReadinessObservation): void {
      try {
        if (attempts.length >= maximumAttempts) return;
        const { reason, ready } = observation;
        if (!Object.hasOwn(expected, reason) || ready !== expected[reason]) return;
        attempts.push({ attempt: attempts.length + 1, reason, ready });
      } catch { /* Never change the observed caller's result. */ }
    },
    summary() {
      return { schemaVersion: 1 as const, attempts: attempts.map(({ attempt, reason, ready }) => ({ attempt, reason, ready })) };
    },
  };
}

export function emitDaemonReadinessFailure(
  recorder: ReturnType<typeof createDaemonReadinessRecorder>,
  sink: (line: string) => void = line => console.error(line),
): void {
  try { sink(DAEMON_READINESS_PREFIX + JSON.stringify(recorder.summary())); }
  catch { /* The existing foreground failure and exit remain authoritative. */ }
}
