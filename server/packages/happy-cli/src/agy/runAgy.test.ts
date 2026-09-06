import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let userMessageHandler: ((message: any) => void) | null = null;
  let killHandler: (() => Promise<void>) | null = null;
  let agentState: Record<string, any> = {};
  let metadata: Record<string, any> = {};

  const stateSnapshots: Array<Record<string, any>> = [];
  const inboundMessages: any[] = [];
  const prompts: string[] = [];
  const childSettings: Array<{ model?: string; effort?: string; permissionMode?: string }> = [];

  const reconnectResponse = {
    id: 'agy-side-chat',
    seq: 12,
    encryptionKey: new Uint8Array(32).fill(7),
    encryptionVariant: 'dataKey' as const,
    metadata: {
      flavor: 'agy',
      path: '/workspace',
      lifecycleState: 'archived',
    },
    metadataVersion: 4,
    agentState: {
      controlledByUser: false,
      messageQueue: {
        currentMessageIds: ['interrupted'],
        pendingMessageIds: ['pending'],
      },
    },
    agentStateVersion: 3,
  };

  const mockSession = {
    onUserMessage: vi.fn((handler: (message: any) => void) => {
      userMessageHandler = handler;
    }),
    keepAlive: vi.fn(),
    sendSessionProtocolMessage: vi.fn(),
    sendSessionEvent: vi.fn(),
    updateAgentState: vi.fn((update: (state: Record<string, any>) => Record<string, any>) => {
      agentState = update(agentState);
      stateSnapshots.push(structuredClone(agentState));
    }),
    updateMetadata: vi.fn((update: (current: Record<string, any>) => Record<string, any>) => {
      metadata = update(metadata);
      return metadata;
    }),
    suppressNextArchiveSignal: vi.fn(),
    skipExistingMessages: vi.fn(),
    sendSessionDeath: vi.fn(),
    flush: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    rpcHandlerManager: {
      registerHandler: vi.fn(),
    },
  };

  const api = {
    getOrCreateMachine: vi.fn(async () => ({})),
    getOrCreateSession: vi.fn(),
    refreshSessionForReconnect: vi.fn(async () => reconnectResponse),
  };

  return {
    api,
    inboundMessages,
    prompts,
    childSettings,
    reconnectResponse,
    stateSnapshots,
    mockSession,
    getUserMessageHandler: () => userMessageHandler,
    getKillHandler: () => killHandler,
    setKillHandler: (handler: (() => Promise<void>) | null) => {
      killHandler = handler;
    },
    resetState: () => {
      userMessageHandler = null;
      killHandler = null;
      agentState = structuredClone(reconnectResponse.agentState);
      metadata = structuredClone(reconnectResponse.metadata);
      inboundMessages.length = 0;
      prompts.length = 0;
      childSettings.length = 0;
      stateSnapshots.length = 0;
    },
  };
});

vi.mock('@/api/api', () => ({
  ApiClient: {
    create: vi.fn(async () => mocks.api),
  },
}));

vi.mock('@/persistence', () => ({
  readSettings: vi.fn(async () => ({ machineId: 'machine-1' })),
}));

vi.mock('@/daemon/run', () => ({
  initialMachineMetadata: {
    host: 'host',
    platform: 'linux',
    happyCliVersion: 'test',
    homeDir: '/home/test',
    happyHomeDir: '/home/test/.happy',
    happyLibDir: '/app',
  },
}));

vi.mock('@/utils/createSessionMetadata', () => ({
  createSessionMetadata: vi.fn((options: any) => ({
    state: { controlledByUser: false },
    metadata: {
      flavor: 'agy',
      path: '/workspace',
      spawnSettings: {
        provider: 'agy',
        ...options.spawnSettings,
      },
    },
  })),
}));

vi.mock('@/utils/setupOfflineReconnection', () => ({
  setupOfflineReconnection: vi.fn(() => ({
    session: mocks.mockSession,
    reconnectionHandle: null,
  })),
}));

vi.mock('@/daemon/controlClient', () => ({
  notifyDaemonSessionStarted: vi.fn(async () => ({ error: null })),
}));

vi.mock('@/claude/registerKillSessionHandler', () => ({
  registerKillSessionHandler: vi.fn((_manager: unknown, handler: () => Promise<void>) => {
    mocks.setKillHandler(handler);
  }),
}));

vi.mock('@/utils/serverConnectionErrors', () => ({
  connectionState: { setBackend: vi.fn() },
}));

vi.mock('@/ui/logger', () => ({
  logger: {
    debug: vi.fn(),
    getLogPath: vi.fn(() => '/tmp/happy.log'),
  },
}));

vi.mock('./AgyBackend', () => ({
  AgyBackend: class MockAgyBackend {
    private mode: { model?: string; effort?: string; permissionMode?: string } = {};
    onMessage() {}
    offMessage() {}

    async startSession() {
      const handler = mocks.getUserMessageHandler();
      if (!handler) throw new Error('runAgy did not register its user-message handler');
      for (const message of mocks.inboundMessages) handler(message);
    }

    setPermissionMode(permissionMode: string) { this.mode.permissionMode = permissionMode; }
    setModel(model: string | undefined) { this.mode.model = model; }
    setEffort(effort: string | undefined) { this.mode.effort = effort; }

    async sendPrompt(_cwd: string, prompt: string) {
      mocks.prompts.push(prompt);
      mocks.childSettings.push({ ...this.mode });
      if (mocks.prompts.length === 2) {
        const handler = mocks.getKillHandler();
        if (!handler) throw new Error('runAgy did not register its kill handler');
        await handler();
      }
    }

    async cancel() {}
    async dispose() {}
  },
}));

import { formatFreshSideChatResumePrompt } from '@/commands/sideChatContext';
import { runAgy } from './runAgy';
import { notifyDaemonSessionStarted } from '@/daemon/controlClient';

describe('runAgy fresh reconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetState();
    vi.stubEnv('HAPPY_RECONNECT_SESSION_ID', 'agy-side-chat');
    vi.stubEnv('HAPPY_RECONNECT_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
    vi.stubEnv('HAPPY_RECONNECT_ENCRYPTION_VARIANT', 'dataKey');
    vi.stubEnv('HAPPY_RECONNECT_SEQ', '11');
    vi.stubEnv('HAPPY_RECONNECT_METADATA_VERSION', '4');
    vi.stubEnv('HAPPY_RECONNECT_AGENT_STATE_VERSION', '3');
    vi.stubEnv('HAPPY_RECONNECT_QUEUE_MESSAGE_ID', 'resume-seed');
    vi.stubEnv('HAPPYHERD_FRESH_PROVIDER_RECONNECT', '1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('applies queued model and effort together and preserves the launch receipt', async () => {
    mocks.inboundMessages.push(
      { content: { text: 'first' }, meta: { model: 'Gemini 3.8 Flash', effort: 'low' }, localKey: 'resume-seed' },
      { content: { text: 'second' }, meta: { model: 'Gemini 3.8 Flash', effort: 'high' }, localKey: 'interrupted' },
    );
    await runAgy({ credentials: {} as any, startedBy: 'daemon', model: 'Gemini 3.8 Flash', effort: 'medium' });
    expect(mocks.childSettings).toEqual([
      { model: 'Gemini 3.8 Flash', effort: 'low', permissionMode: 'default' },
      { model: 'Gemini 3.8 Flash', effort: 'high', permissionMode: 'default' },
    ]);
    expect(notifyDaemonSessionStarted).toHaveBeenCalledWith('agy-side-chat', expect.objectContaining({
      spawnSettings: { provider: 'agy', model: 'Gemini 3.8 Flash', effort: 'medium', permission: 'default' },
      modelMode: 'Gemini 3.8 Flash', effortLevel: 'medium',
    }), expect.anything());
  });

  it('runs the generated handoff before restored work and clears every queue id', async () => {
    const handoff = formatFreshSideChatResumePrompt(
      'agy',
      'Recent visible conversation context (chronological):\n\nUser:\nfinish the task',
    );
    mocks.inboundMessages.push(
      { content: { text: 'interrupted work' }, meta: {}, localKey: 'interrupted' },
      { content: { text: 'pending work' }, meta: {}, localKey: 'pending' },
      {
        content: { text: handoff },
        meta: { providerContinuationHandoff: true },
        localKey: 'resume-seed',
      },
    );

    await runAgy({ credentials: {} as any, startedBy: 'daemon' });

    expect(mocks.api.refreshSessionForReconnect).toHaveBeenCalledWith(expect.objectContaining({
      id: 'agy-side-chat',
      seq: 11,
      metadataVersion: 4,
      agentStateVersion: 3,
    }));
    expect(mocks.mockSession.skipExistingMessages).toHaveBeenCalledWith(
      ['interrupted', 'pending', 'resume-seed'],
      12,
      'resume-seed',
    );
    expect(mocks.prompts).toEqual([
      handoff,
      'interrupted work\npending work',
    ]);
    expect(mocks.stateSnapshots.at(-1)?.messageQueue).toEqual({
      pendingMessageIds: [],
      currentMessageIds: [],
    });
  });
});
