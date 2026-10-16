import { describe, expect, it, vi } from 'vitest';
import { createDaemonReadinessRecorder, DAEMON_READINESS_PREFIX, emitDaemonReadinessFailure } from './startupReadiness';
const observation = { reason: 'state-unavailable', ready: false } as const;

describe('foreground-only readiness receipt', () => {
  it('records attempt order, strips extra input fields, and isolates returned snapshots', () => {
    const recorder = createDaemonReadinessRecorder();
    recorder.observe({ ...observation, secret: 'sentinel-private-token' } as any);
    recorder.observe({ reason: 'http-request-failed', ready: false });
    expect(recorder.summary()).toEqual({ schemaVersion: 1, attempts: [
      { ...observation, attempt: 1 }, { reason: 'http-request-failed', ready: false, attempt: 2 },
    ] });
    const snapshot = recorder.summary(); snapshot.attempts[0].attempt = 999;
    expect(recorder.summary().attempts[0].attempt).toBe(1);
    const sink = vi.fn(); emitDaemonReadinessFailure(recorder, sink);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toBe(DAEMON_READINESS_PREFIX + JSON.stringify(recorder.summary()));
    expect(sink.mock.calls[0][0]).not.toContain('sentinel');
  });

  it('hard-bounds recorded attempts at 50', () => {
    const recorder = createDaemonReadinessRecorder();
    for (let index = 0; index < 500; index++) recorder.observe(observation);
    expect(recorder.summary().attempts).toHaveLength(50);
    expect(recorder.summary().attempts.map(row => row.attempt)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('never propagates observer-input, serialization or stderr sink failures', () => {
    const recorder = createDaemonReadinessRecorder();
    expect(() => recorder.observe(null as any)).not.toThrow();
    expect(recorder.summary().attempts).toEqual([]);
    expect(() => emitDaemonReadinessFailure(recorder, () => { throw new Error('stderr sentinel'); })).not.toThrow();
    expect(() => emitDaemonReadinessFailure({ summary() { throw new Error('summary sentinel'); } } as any)).not.toThrow();
  });

  it('does not record unknown reasons or inconsistent readiness booleans', () => {
    const recorder = createDaemonReadinessRecorder();
    recorder.observe({ ...observation, reason: 'sentinel' } as any);
    recorder.observe({ ...observation, ready: true });
    recorder.observe(observation);
    expect(recorder.summary().attempts).toEqual([{ ...observation, attempt: 1 }]);
  });
});
