import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureHappySessionReconnect, loadOrCreateHappySession } from './sessionReconnect';

describe('session reconnect initialization', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('creates an ordinary new Happy session without reconnect behavior', async () => {
    const response = { id: 'new-session' };
    const api = {
      getOrCreateSession: vi.fn(async () => response),
      refreshSessionForReconnect: vi.fn(),
    };
    const metadata = { flavor: 'agy', path: '/srv/project' } as any;
    const state = { controlledByUser: false };

    await expect(loadOrCreateHappySession({ api: api as any, sessionTag: 'tag', metadata, state }))
      .resolves.toEqual({
        response,
        reconnecting: false,
        queueMessageIds: [],
        priorityQueueMessageId: null,
      });
    expect(api.refreshSessionForReconnect).not.toHaveBeenCalled();
  });

  it('refreshes the exact encrypted Happy session and restores queued replay ids', async () => {
    vi.stubEnv('HAPPY_RECONNECT_SESSION_ID', 'existing-session');
    vi.stubEnv('HAPPY_RECONNECT_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
    vi.stubEnv('HAPPY_RECONNECT_ENCRYPTION_VARIANT', 'dataKey');
    vi.stubEnv('HAPPY_RECONNECT_SEQ', '9');
    vi.stubEnv('HAPPY_RECONNECT_METADATA_VERSION', '4');
    vi.stubEnv('HAPPY_RECONNECT_AGENT_STATE_VERSION', '3');
    vi.stubEnv('HAPPY_RECONNECT_QUEUE_MESSAGE_ID', 'resume-seed');
    vi.stubEnv('HAPPYHERD_FRESH_PROVIDER_RECONNECT', '1');
    const response = {
      id: 'existing-session',
      seq: 10,
      metadata: { flavor: 'agy', path: '/srv/project', lifecycleState: 'archived' },
      agentState: { messageQueue: { currentMessageIds: ['interrupted'], pendingMessageIds: ['pending'] } },
    };
    const api = {
      getOrCreateSession: vi.fn(),
      refreshSessionForReconnect: vi.fn(async () => response),
    };
    const metadata = {
      flavor: 'agy',
      path: '/srv/project',
      spawnSettings: { provider: 'agy', model: 'gemini-2.5-pro', effort: null, permission: 'default' },
    } as any;

    const result = await loadOrCreateHappySession({
      api: api as any,
      sessionTag: 'ignored',
      metadata,
      state: { controlledByUser: false },
    });

    expect(api.getOrCreateSession).not.toHaveBeenCalled();
    expect(api.refreshSessionForReconnect).toHaveBeenCalledWith(expect.objectContaining({
      id: 'existing-session',
      seq: 9,
      encryptionVariant: 'dataKey',
      metadataVersion: 4,
      agentStateVersion: 3,
    }));
    expect(result.queueMessageIds).toEqual(['interrupted', 'pending', 'resume-seed']);
    expect(result.priorityQueueMessageId).toBe('resume-seed');
    expect(metadata.spawnSettings).toEqual({
      provider: 'agy', model: 'gemini-2.5-pro', effort: null, permission: 'default',
    });

    const session = {
      suppressNextArchiveSignal: vi.fn(),
      skipExistingMessages: vi.fn(),
      updateMetadata: vi.fn((update) => update(response.metadata)),
    };
    configureHappySessionReconnect(session as any, result as any);
    expect(session.suppressNextArchiveSignal).toHaveBeenCalledOnce();
    expect(session.skipExistingMessages).toHaveBeenCalledWith(
      ['interrupted', 'pending', 'resume-seed'],
      10,
      'resume-seed',
    );
    expect(session.updateMetadata).toHaveReturnedWith(expect.objectContaining({
      lifecycleState: 'running',
      archivedBy: undefined,
    }));
  });
});
