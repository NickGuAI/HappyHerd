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

import { notifyDaemonSessionStarted, setDaemonSessionRegistrationSnapshot } from './controlClient';

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

  it('sends current metadata and its receipt on the existing re-registration', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ status: 'ok' }) }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(process, 'kill').mockReturnValue(true);
    const initial = { hostPid: 123, providerAccountCredentialVersion: 1 } as Metadata;
    let current = initial;
    let version = 2;
    const encryption = { encryptionKey: 'synthetic', encryptionVariant: 'dataKey' as const, seq: 1, metadataVersion: version, agentStateVersion: 1 };
    await notifyDaemonSessionStarted('refresh-session', initial, encryption);
    setDaemonSessionRegistrationSnapshot('refresh-session', () => ({ metadata: current, metadataVersion: version }));
    current = { ...initial, providerAccountCredentialVersion: 2 };
    version = 3;
    const watcher = (mocks.maintain.mock.calls.at(-1) as unknown as [{ register: () => Promise<boolean> }])[0];
    expect(await watcher.register()).toBe(true);
    expect(JSON.parse((fetch.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body as string)).toMatchObject({
      sessionId: 'refresh-session', metadata: { providerAccountCredentialVersion: 2 }, encryption: { metadataVersion: 3 },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
