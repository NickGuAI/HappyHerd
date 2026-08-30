import { describe, expect, it, vi } from 'vitest';

import type { SideChatDelegationBrief, SideChatLifecycleStatus } from '@/commands/sideChat';
import {
  DaemonSideChatLifecycle,
  type DaemonSideChatLifecycleDependencies,
  type DaemonSideChatRecord,
} from './sideChatLifecycle';

function child(
  sessionId: string,
  status: SideChatLifecycleStatus,
  options: Partial<DaemonSideChatRecord> = {},
): DaemonSideChatRecord {
  return {
    sessionId,
    parentSessionId: 'parent',
    status,
    providerRunning: status === 'running',
    active: status === 'running',
    resumable: status !== 'running',
    ...options,
  };
}

const brief: SideChatDelegationBrief = {
  outcome: 'Deliver the child result.',
  scope: 'One bounded workstream.',
  dependencies: 'Parent context.',
  writeOwnership: '/srv/project/owned.ts',
  verification: 'Run the focused test.',
  handoff: 'Return result, evidence, blockers, and remaining work.',
};

function harness(initial: DaemonSideChatRecord[]) {
  const records = new Map(initial.map((record) => [record.sessionId, { ...record }]));
  const calls: string[] = [];
  const dependencies: DaemonSideChatLifecycleDependencies = {
    create: vi.fn(async (parentSessionId, deliveredBrief) => {
      const created = child('created-child', 'running', { parentSessionId });
      records.set(created.sessionId, created);
      calls.push(`create:${parentSessionId}`);
      if (deliveredBrief === null) {
        return { sessionId: created.sessionId, briefDelivery: null };
      }
      calls.push(`brief:${deliveredBrief.outcome}`);
      return { sessionId: created.sessionId, briefDelivery: { success: true } };
    }),
    listSessionIds: vi.fn(async (parentSessionId) => [...records.values()]
      .filter((record) => record.parentSessionId === parentSessionId)
      .map((record) => record.sessionId)),
    read: vi.fn(async (sessionId) => {
      calls.push(`read:${sessionId}`);
      const record = records.get(sessionId);
      if (!record) throw new Error(`Side chat ${sessionId} not found`);
      return { ...record };
    }),
    stopProvider: vi.fn(async (sessionId) => {
      calls.push(`stop:${sessionId}`);
      const record = records.get(sessionId)!;
      record.providerRunning = false;
      record.status = record.status === 'archived' ? 'archived' : 'stopped';
      record.resumable = true;
      return { success: true };
    }),
    archiveMetadata: vi.fn(async (sessionId) => {
      calls.push(`archive:${sessionId}`);
      records.get(sessionId)!.status = 'archived';
      return { success: true };
    }),
    deactivate: vi.fn(async (sessionId) => {
      calls.push(`deactivate:${sessionId}`);
      records.get(sessionId)!.active = false;
      return { success: true };
    }),
    resumeProvider: vi.fn(async (sessionId) => {
      calls.push(`resume:${sessionId}`);
      const record = records.get(sessionId)!;
      record.status = 'running';
      record.providerRunning = true;
      record.active = true;
      record.resumable = false;
      return { success: true };
    }),
  };
  return { lifecycle: new DaemonSideChatLifecycle(dependencies), dependencies, records, calls };
}

describe('DaemonSideChatLifecycle', () => {
  it('creates an unbriefed Human child and records brief delivery as skipped', async () => {
    const { lifecycle, dependencies, calls } = harness([]);

    await expect(lifecycle.execute({ action: 'create', parentSessionId: 'parent', brief: null }))
      .resolves.toMatchObject({
        schemaVersion: 1,
        type: 'side-chat',
        action: 'create',
        success: true,
        parentSessionId: 'parent',
        sessionId: 'created-child',
        child: { status: 'running', providerRunning: true, active: true },
        phases: [
          { phase: 'resolve', status: 'succeeded' },
          { phase: 'deliver-brief', status: 'skipped' },
          { phase: 'readback', status: 'succeeded' },
        ],
      });
    expect(dependencies.create).toHaveBeenCalledWith('parent', null);
    expect(calls).toEqual(['create:parent', 'read:created-child']);
  });

  it('creates a child and returns daemon-read lineage and running state', async () => {
    const { lifecycle } = harness([]);

    await expect(lifecycle.execute({ action: 'create', parentSessionId: 'parent', brief }))
      .resolves.toMatchObject({
        schemaVersion: 1,
        type: 'side-chat',
        action: 'create',
        success: true,
        parentSessionId: 'parent',
        sessionId: 'created-child',
        child: { status: 'running', providerRunning: true, active: true },
        phases: [
          { phase: 'resolve', status: 'succeeded' },
          { phase: 'deliver-brief', status: 'succeeded' },
          { phase: 'readback', status: 'succeeded' },
        ],
      });
  });

  it('retains the created child and exact failed phase when brief delivery fails', async () => {
    const { lifecycle, dependencies, records } = harness([]);
    vi.mocked(dependencies.create).mockImplementation(async (parentSessionId) => {
      records.set('created-child', child('created-child', 'running', { parentSessionId }));
      return {
        sessionId: 'created-child',
        briefDelivery: { success: false, message: 'message persistence failed' },
      };
    });

    await expect(lifecycle.execute({ action: 'create', parentSessionId: 'parent', brief }))
      .resolves.toMatchObject({
        success: false,
        parentSessionId: 'parent',
        sessionId: 'created-child',
        child: { sessionId: 'created-child', parentSessionId: 'parent' },
        phases: expect.arrayContaining([
          { phase: 'deliver-brief', status: 'failed', message: 'message persistence failed' },
        ]),
      });
  });

  it('retains the created child ID when authoritative read-back fails', async () => {
    const { lifecycle, dependencies } = harness([]);
    vi.mocked(dependencies.read).mockRejectedValueOnce(new Error('read-back unavailable'));

    await expect(lifecycle.execute({ action: 'create', parentSessionId: 'parent', brief }))
      .resolves.toMatchObject({
        success: false,
        parentSessionId: 'parent',
        sessionId: 'created-child',
        child: null,
        phases: [
          { phase: 'resolve', status: 'succeeded' },
          { phase: 'deliver-brief', status: 'succeeded' },
          { phase: 'readback', status: 'failed', message: 'read-back unavailable' },
        ],
      });
  });

  it('keeps brief delivery skipped when unbriefed Human creation fails read-back', async () => {
    const { lifecycle, dependencies } = harness([]);
    vi.mocked(dependencies.read).mockRejectedValueOnce(new Error('read-back unavailable'));

    await expect(lifecycle.execute({ action: 'create', parentSessionId: 'parent', brief: null }))
      .resolves.toMatchObject({
        success: false,
        parentSessionId: 'parent',
        sessionId: 'created-child',
        child: null,
        phases: [
          { phase: 'resolve', status: 'succeeded' },
          { phase: 'deliver-brief', status: 'skipped' },
          { phase: 'readback', status: 'failed', message: 'read-back unavailable' },
        ],
      });
  });

  it('lists running, stopped/resumable, and archived children from read-back', async () => {
    const { lifecycle } = harness([
      child('running', 'running'),
      child('stopped', 'stopped'),
      child('archived', 'archived', { active: false, providerRunning: false }),
    ]);

    await expect(lifecycle.execute({ action: 'list', parentSessionId: 'parent' }))
      .resolves.toMatchObject({
        type: 'side-chat-list',
        success: true,
        count: 3,
        openCount: 2,
        archivedCount: 1,
        children: [
          { sessionId: 'archived', status: 'archived', resumable: true },
          { sessionId: 'running', status: 'running', resumable: false },
          { sessionId: 'stopped', status: 'stopped', resumable: true },
        ],
      });
  });

  it('reports each Orchestrating Agent direct children without flattening a delegated subtree', async () => {
    const { lifecycle } = harness([
      child('worker', 'running', { parentSessionId: 'parent' }),
      child('nested-worker', 'running', { parentSessionId: 'worker' }),
    ]);

    await expect(lifecycle.execute({ action: 'list', parentSessionId: 'parent' }))
      .resolves.toMatchObject({
        success: true,
        children: [{ sessionId: 'worker', parentSessionId: 'parent' }],
      });
    await expect(lifecycle.execute({ action: 'list', parentSessionId: 'worker' }))
      .resolves.toMatchObject({
        success: true,
        children: [{ sessionId: 'nested-worker', parentSessionId: 'worker' }],
      });
  });

  it('stops a running provider, deactivates it, and verifies the final state', async () => {
    const { lifecycle, calls } = harness([child('worker', 'running')]);

    await expect(lifecycle.execute({ action: 'stop', sessionId: 'worker' }))
      .resolves.toMatchObject({
        success: true,
        child: { status: 'stopped', providerRunning: false, active: false },
        phases: [
          { phase: 'resolve', status: 'succeeded' },
          { phase: 'stop', status: 'succeeded' },
          { phase: 'deactivate', status: 'succeeded' },
          { phase: 'readback', status: 'succeeded' },
        ],
      });
    expect(calls).toEqual([
      'read:worker',
      'stop:worker',
      'deactivate:worker',
      'read:worker',
    ]);
  });

  it('treats an already-stopped child as an idempotent stop', async () => {
    const { lifecycle, dependencies } = harness([
      child('worker', 'stopped', { active: false, providerRunning: false }),
    ]);

    await expect(lifecycle.execute({ action: 'stop', sessionId: 'worker' }))
      .resolves.toMatchObject({ success: true, child: { status: 'stopped' } });
    expect(dependencies.stopProvider).not.toHaveBeenCalled();
    expect(dependencies.deactivate).not.toHaveBeenCalled();
  });

  it('closes an offline/stopped inactive child using encrypted archive metadata', async () => {
    const { lifecycle, dependencies } = harness([
      child('worker', 'stopped', { active: false, providerRunning: false }),
    ]);

    await expect(lifecycle.execute({ action: 'close', sessionId: 'worker' }))
      .resolves.toMatchObject({
        success: true,
        child: { status: 'archived', providerRunning: false, active: false },
        phases: [
          { phase: 'resolve', status: 'succeeded' },
          { phase: 'stop', status: 'skipped' },
          { phase: 'deactivate', status: 'skipped' },
          { phase: 'archive-metadata', status: 'succeeded' },
          { phase: 'readback', status: 'succeeded' },
        ],
      });
    expect(dependencies.stopProvider).not.toHaveBeenCalled();
  });

  it('keeps an already-archived but unowned active child visible as a failed repair', async () => {
    const { lifecycle, dependencies } = harness([
      child('worker', 'archived', { active: true, providerRunning: false }),
    ]);

    await expect(lifecycle.execute({ action: 'close', sessionId: 'worker' }))
      .resolves.toMatchObject({ success: false, child: { status: 'archived', active: false } });
    expect(dependencies.archiveMetadata).not.toHaveBeenCalled();
    expect(dependencies.deactivate).toHaveBeenCalledWith('worker');
  });

  it('reports the exact failed phases when provider stop is not confirmed', async () => {
    const { lifecycle, dependencies } = harness([child('worker', 'running')]);
    vi.mocked(dependencies.stopProvider).mockResolvedValue({
      success: false,
      message: 'Provider exit was not confirmed',
    });

    await expect(lifecycle.execute({ action: 'close', sessionId: 'worker' }))
      .resolves.toMatchObject({
        success: false,
        child: { status: 'running', providerRunning: true, active: true },
        phases: expect.arrayContaining([
          { phase: 'stop', status: 'failed', message: 'Provider exit was not confirmed' },
          { phase: 'deactivate', status: 'skipped', message: 'Provider stop was not confirmed' },
          { phase: 'archive-metadata', status: 'skipped', message: 'Provider stop was not confirmed' },
          expect.objectContaining({ phase: 'readback', status: 'failed' }),
        ]),
      });
  });

  it('reconciles a lost archive acknowledgement only when exact read-back proves the commit', async () => {
    const { lifecycle, dependencies, records } = harness([
      child('worker', 'stopped', { active: false, providerRunning: false }),
    ]);
    vi.mocked(dependencies.archiveMetadata).mockImplementation(async (sessionId) => {
      // Model a server commit followed by a bounded Socket.IO ACK timeout.
      records.get(sessionId)!.status = 'archived';
      return { success: false, message: 'ack timeout' };
    });

    await expect(lifecycle.execute({ action: 'close', sessionId: 'worker' }))
      .resolves.toMatchObject({
        success: true,
        child: { status: 'archived', providerRunning: false, active: false },
        phases: [
          { phase: 'resolve', status: 'succeeded' },
          { phase: 'stop', status: 'skipped' },
          { phase: 'deactivate', status: 'skipped' },
          {
            phase: 'archive-metadata',
            status: 'succeeded',
            message: 'Authoritative read-back confirmed the encrypted archive update',
          },
          { phase: 'readback', status: 'succeeded' },
        ],
      });
  });

  it('reports process-unowned when server active state has no live tracked provider', async () => {
    const { lifecycle, dependencies } = harness([
      child('worker', 'stopped', { active: true, providerRunning: false }),
    ]);

    await expect(lifecycle.execute({ action: 'close', sessionId: 'worker' }))
      .resolves.toMatchObject({
        success: false,
        child: { status: 'archived', providerRunning: false, active: false },
        phases: expect.arrayContaining([
          expect.objectContaining({ phase: 'stop', status: 'failed', message: expect.stringContaining('process-unowned') }),
          { phase: 'deactivate', status: 'succeeded' },
          { phase: 'archive-metadata', status: 'succeeded' },
        ]),
      });
    expect(dependencies.stopProvider).not.toHaveBeenCalled();
  });

  it('closes every exact child and preserves per-child partial failures', async () => {
    const { lifecycle, dependencies, records } = harness([
      child('one', 'running'),
      child('two', 'stopped', { active: true, providerRunning: false }),
      child('other-parent', 'running', { parentSessionId: 'other' }),
    ]);
    vi.mocked(dependencies.archiveMetadata).mockImplementation(async (sessionId) => {
      if (sessionId === 'two') return { success: false, message: 'metadata conflict' };
      records.get(sessionId)!.status = 'archived';
      return { success: true };
    });

    await expect(lifecycle.execute({ action: 'close-all', parentSessionId: 'parent' }))
      .resolves.toMatchObject({
        type: 'side-chat-close-all',
        success: false,
        parentSessionId: 'parent',
        total: 2,
        closed: 1,
        failed: 1,
        children: [
          expect.objectContaining({ sessionId: 'one', success: true }),
          expect.objectContaining({ sessionId: 'two', success: false }),
        ],
      });
  });

  it('reopens an archived child in place and verifies lineage is unchanged', async () => {
    const { lifecycle } = harness([
      child('worker', 'archived', { active: false, providerRunning: false }),
    ]);

    await expect(lifecycle.execute({ action: 'reopen', sessionId: 'worker' }))
      .resolves.toMatchObject({
        success: true,
        parentSessionId: 'parent',
        sessionId: 'worker',
        child: {
          parentSessionId: 'parent',
          status: 'running',
          providerRunning: true,
          active: true,
        },
      });
  });

  it('uses persisted post-restart read-back rather than requiring a live process entry', async () => {
    const { lifecycle } = harness([
      child('persisted-worker', 'stopped', { active: false, providerRunning: false }),
    ]);

    await expect(lifecycle.execute({ action: 'status', sessionId: 'persisted-worker' }))
      .resolves.toMatchObject({
        success: true,
        child: { status: 'stopped', providerRunning: false, active: false, resumable: true },
      });
  });
});
