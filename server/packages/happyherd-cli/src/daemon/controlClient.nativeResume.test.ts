import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Metadata } from '@/api/types';

const mocks = vi.hoisted(() => ({
  readDaemonState: vi.fn(async () => ({ pid: 4321, httpPort: 39001 })),
  stopWatcher: vi.fn(),
  maintain: vi.fn(() => mocks.stopWatcher),
}));
vi.mock('@/persistence', () => ({ clearDaemonState: vi.fn(), readDaemonState: mocks.readDaemonState }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('./sessionRegistration', () => ({
  daemonInstanceKey: vi.fn(() => 'daemon'),
  maintainDaemonSessionRegistration: mocks.maintain,
}));

import { notifyDaemonSessionStarted } from './controlClient';

describe('native resume cancellation receipt', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('reports failure without replacing the existing session registration watcher', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ status: 'ok' }) }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(process, 'kill').mockReturnValue(true);
    const metadata = { hostPid: 123 } as Metadata;
    await notifyDaemonSessionStarted('session', metadata);
    await notifyDaemonSessionStarted('session', metadata, undefined, 'retained-native-id', true);
    expect(mocks.maintain).toHaveBeenCalledOnce();
    expect(mocks.stopWatcher).not.toHaveBeenCalled();
    expect(JSON.parse((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      sessionId: 'session', metadata, nativeResumeId: 'retained-native-id', nativeResumeFailed: true,
    });
  });
});
