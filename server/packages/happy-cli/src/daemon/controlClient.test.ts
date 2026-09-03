import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readDaemonState: vi.fn(async () => ({ pid: 4321, httpPort: 39001 })),
}));

vi.mock('@/persistence', () => ({
  clearDaemonState: vi.fn(),
  readDaemonState: mocks.readDaemonState,
}));

vi.mock('@/ui/logger', () => ({
  logger: { debug: vi.fn() },
}));

import { manageDaemonSideChat, sideChatRequestTimeoutMs } from './controlClient';

const brief = {
  outcome: 'Deliver the delegated change.',
  scope: 'Owned files only.',
  dependencies: 'Parent context.',
  writeOwnership: '/srv/project/owned.ts',
  verification: 'Run focused tests.',
  handoff: 'Return result and evidence.',
} as const;

describe('side-chat daemon control client', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('budgets four sequential provider-stop waits before awaiting close-all read-back', async () => {
    vi.useFakeTimers();
    const parentSessionId = 'parent';
    const children = ['one', 'two', 'three', 'four'].map((sessionId) => ({
      sessionId,
      parentSessionId,
      status: 'running',
      providerRunning: true,
      active: true,
      resumable: false,
    }));
    const receipt = {
      schemaVersion: 1,
      type: 'side-chat-close-all',
      action: 'close-all',
      success: true,
      parentSessionId,
      total: children.length,
      closed: children.length,
      failed: 0,
      children: [],
    };
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => (
      new Promise<{ ok: true; json: () => Promise<typeof receipt> }>((resolve, reject) => {
        const completion = setTimeout(() => resolve({
          ok: true,
          json: async () => receipt,
        }), 4 * 15_000 + 1);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(completion);
          reject(new Error('client receipt budget expired'));
        }, { once: true });
      })
    ));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((timeoutMs) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), timeoutMs);
      return controller.signal;
    });

    const pending = manageDaemonSideChat({ action: 'close-all', parentSessionId });
    await vi.advanceTimersByTimeAsync(4 * 15_000 + 1);
    await expect(pending).resolves.toMatchObject({ success: true, total: 4 });

    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({
      action: 'close-all',
      parentSessionId,
    });
    expect(timeout).toHaveBeenCalledWith(300_000);
    expect(sideChatRequestTimeoutMs('close-all')).toBeGreaterThan(
      4 * 15_000 + sideChatRequestTimeoutMs('close'),
    );
    expect(sideChatRequestTimeoutMs('create')).toBe(240_000);
    expect(sideChatRequestTimeoutMs('create')).toBeGreaterThan(
      2 * 30_000 + 15_000 + 60_000 + 60_000,
    );
    expect(sideChatRequestTimeoutMs('list')).toBe(60_000);
    expect(sideChatRequestTimeoutMs('status')).toBe(60_000);
    expect(sideChatRequestTimeoutMs('stop')).toBe(60_000);
    expect(sideChatRequestTimeoutMs('close')).toBe(60_000);
    expect(sideChatRequestTimeoutMs('reopen')).toBe(60_000);
  });

  it('turns an old-daemon unbriefed create success into a failed receipt that retains the child', async () => {
    const legacyReceipt = {
      schemaVersion: 1,
      type: 'side-chat',
      action: 'create',
      success: true,
      parentSessionId: 'parent',
      sessionId: 'unbriefed-child',
      child: {
        sessionId: 'unbriefed-child',
        parentSessionId: 'parent',
        status: 'running',
        providerRunning: true,
        active: true,
        resumable: false,
      },
      phases: [
        { phase: 'resolve', status: 'succeeded' },
        { phase: 'readback', status: 'succeeded' },
      ],
    };
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
      ok: true,
      json: async () => legacyReceipt,
    }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    await expect(manageDaemonSideChat({ action: 'create', parentSessionId: 'parent', brief }))
      .resolves.toMatchObject({
        success: false,
        parentSessionId: 'parent',
        sessionId: 'unbriefed-child',
        child: { sessionId: 'unbriefed-child' },
        phases: expect.arrayContaining([{
          phase: 'deliver-brief',
          status: 'failed',
          message: expect.stringContaining('did not acknowledge bounded brief delivery'),
        }]),
      });
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({
      action: 'create',
      parentSessionId: 'parent',
      brief,
    });
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:39001/side-chat');
  });

  it('returns a schema-version-2 create receipt with owning-daemon resources unchanged', async () => {
    const receipt = {
      schemaVersion: 2,
      type: 'side-chat',
      action: 'create',
      success: true,
      parentSessionId: 'parent',
      sessionId: 'child',
      child: null,
      phases: [{ phase: 'deliver-brief', status: 'succeeded' }],
      resource: {
        status: 'ok',
        sampledAt: '2026-09-03T10:00:00.000Z',
        cpu: { busyPercent: 25, sampleWindowMs: 250 },
        loadAverage: { oneMinute: 1, fiveMinutes: 2, fifteenMinutes: 3 },
        memory: {
          usedBytes: 4,
          totalBytes: 10,
          availableBytes: 6,
          swapUsedBytes: 1,
        },
      },
    };
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
      ok: true,
      json: async () => receipt,
    }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    await expect(manageDaemonSideChat({
      action: 'create',
      parentSessionId: 'parent',
      brief,
      launch: { model: 'gpt-5.6-sol', effort: 'xhigh' },
    }))
      .resolves.toEqual(receipt);
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({
      action: 'create',
      parentSessionId: 'parent',
      brief,
      launch: { model: 'gpt-5.6-sol', effort: 'xhigh' },
    });
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:39001/side-chat-create-with-settings');
  });

  it('fails against an older daemon instead of dropping explicit launch settings', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request) => ({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Route POST:/side-chat-create-with-settings not found' }),
    }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    await expect(manageDaemonSideChat({
      action: 'create',
      parentSessionId: 'parent',
      brief,
      launch: { model: 'not-advertised', effort: 'xhigh' },
    })).rejects.toThrow('HTTP 404');
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:39001/side-chat-create-with-settings');
  });

  it('normalizes inspect, pause, and resume before crossing the daemon API boundary', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(init?.body as string) as { action: 'status' | 'stop' | 'reopen'; sessionId: string };
      return {
        ok: true,
        json: async () => ({
          schemaVersion: 1,
          type: 'side-chat',
          action: request.action,
          success: true,
          parentSessionId: 'parent',
          sessionId: request.sessionId,
          child: null,
          phases: [],
        }),
      };
    });
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    const inputs = [
      [{ action: 'inspect', sessionId: 'child' }, 'status'],
      [{ action: 'pause', sessionId: 'child' }, 'stop'],
      [{ action: 'resume', sessionId: 'child' }, 'reopen'],
    ] as const;
    for (const [input, canonicalAction] of inputs) {
      await expect(manageDaemonSideChat(input)).resolves.toMatchObject({ action: canonicalAction });
    }

    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init?.body as string))).toEqual([
      { action: 'status', sessionId: 'child' },
      { action: 'stop', sessionId: 'child' },
      { action: 'reopen', sessionId: 'child' },
    ]);
  });
});
