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
    expect(sideChatRequestTimeoutMs('create')).toBe(60_000);
    expect(sideChatRequestTimeoutMs('list')).toBe(60_000);
    expect(sideChatRequestTimeoutMs('status')).toBe(60_000);
    expect(sideChatRequestTimeoutMs('stop')).toBe(60_000);
    expect(sideChatRequestTimeoutMs('close')).toBe(60_000);
    expect(sideChatRequestTimeoutMs('reopen')).toBe(60_000);
  });
});
