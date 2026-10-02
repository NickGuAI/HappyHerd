import { describe, expect, it } from 'vitest';
import { SessionTransportRecovery, transportEndpointLabel } from './sessionTransport';
import type { SessionTransportReport } from '@/api/sessionTransport';

function setup() {
  let now = 1000;
  let owner: { pid: number; isSuperSession: boolean; running: boolean } | undefined = {
    pid: 10, isSuperSession: true, running: true,
  };
  let next = 0;
  const service = new SessionTransportRecovery({
    endpoint: 'https://current.example', owner: () => owner,
    now: () => now, recoveryId: () => `recovery-${++next}`,
  });
  const report: SessionTransportReport = {
    sessionId: 'same-conversation', pid: 10,
    transport: { state: 'error', endpoint: 'https://old.example', errorCode: 'dns', updatedAt: now },
  };
  return { service, report, tick: (ms: number) => { now += ms; }, setOwner: (value: typeof owner) => { owner = value; } };
}

describe('owning daemon transport recovery', () => {
  it('reports a live stale endpoint truthfully and coalesces repeated recovery gestures', () => {
    const { service, report } = setup();
    service.exchange(report);
    expect(service.status(report.sessionId)).toMatchObject({
      providerRunning: true, state: 'disconnected', errorCode: 'stale-endpoint', canRecover: true,
      pendingMessages: 'replay-on-reconnect',
    });
    const first = service.recover(report.sessionId);
    expect(first).toMatchObject({ state: 'reconnecting', recoveryId: 'recovery-1' });
    expect(service.recover(report.sessionId)).toEqual(first);
    expect(service.exchange(report)).toEqual({ recovery: { id: 'recovery-1', endpoint: 'https://current.example' } });
    service.exchange({ ...report, transport: { ...report.transport, endpoint: 'https://current.example', state: 'connected', errorCode: undefined },
      recovery: { id: 'recovery-1', state: 'succeeded' } });
    expect(service.status(report.sessionId)).toMatchObject({ state: 'connected', canRecover: false, providerRunning: true });
    expect(service.recover(report.sessionId).recoveryId).toBe('recovery-1');
  });

  it.each(['dns', 'http', 'connect', 'closed'] as const)('retains %s failure and allows a new retry without a spawn', (errorCode) => {
    const { service, report } = setup();
    service.exchange(report);
    service.recover(report.sessionId);
    service.exchange({ ...report, recovery: { id: 'recovery-1', state: 'failed', errorCode } });
    expect(service.status(report.sessionId)).toMatchObject({ state: 'error', errorCode, canRecover: true });
    expect(service.recover(report.sessionId)).toMatchObject({ state: 'reconnecting', recoveryId: 'recovery-2' });
    service.exchange({ ...report, recovery: { id: 'recovery-1', state: 'succeeded' } });
    expect(service.status(report.sessionId)).toMatchObject({ state: 'reconnecting', recoveryId: 'recovery-2' });
  });

  it('does not mistake absent, stopped or replaced process ownership for a usable connection', () => {
    const { service, report, setOwner } = setup();
    service.exchange(report);
    service.recover(report.sessionId);
    setOwner({ pid: 11, isSuperSession: true, running: true });
    expect(service.status(report.sessionId)).toMatchObject({ state: 'disconnected', canRecover: false, errorCode: 'unavailable' });
    expect(() => service.exchange(report)).toThrow('current live owner');
    setOwner({ pid: 10, isSuperSession: true, running: false });
    expect(service.status(report.sessionId)).toMatchObject({ providerRunning: false, errorCode: 'process-exited' });
    expect(() => service.exchange(report)).toThrow('current live owner');
    setOwner(undefined);
    expect(service.status(report.sessionId).errorCode).toBe('unavailable');
  });

  it('rejects ordinary sessions and never claims unknown transport is connected', () => {
    const { service, report, setOwner } = setup();
    expect(service.status(report.sessionId)).toMatchObject({ state: 'disconnected', canRecover: false });
    setOwner({ pid: 10, isSuperSession: false, running: true });
    expect(() => service.exchange(report)).toThrow('current live owner');
    expect(service.recover(report.sessionId).recoveryId).toBeUndefined();
  });

  it('expires stale telemetry and times out recovery with a retryable receipt', () => {
    const { service, report, tick } = setup();
    service.exchange(report);
    service.recover(report.sessionId);
    tick(10_001);
    expect(service.status(report.sessionId)).toMatchObject({ state: 'disconnected', errorCode: 'unavailable', canRecover: false });
    tick(20_000);
    expect(service.exchange(report)).toEqual({});
    expect(service.status(report.sessionId)).toMatchObject({ state: 'error', errorCode: 'recovery-timeout', canRecover: true });
    expect(service.recover(report.sessionId).recoveryId).toBe('recovery-2');
  });

  it('keeps saved URL credentials and query strings out of status receipts', () => {
    expect(transportEndpointLabel('https://user:secret@host.example/base/?token=secret#secret')).toBe('https://host.example/base');
    expect(transportEndpointLabel('invalid secret')).toBe('invalid-endpoint');
  });
});
