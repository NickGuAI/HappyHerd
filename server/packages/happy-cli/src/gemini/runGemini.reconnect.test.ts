import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let userMessageHandler: ((message: any) => void) | null = null;
  let exitHandler: (() => Promise<void>) | null = null;
  let agentState: Record<string, any> = {};
  let metadata: Record<string, any> = {};

  const backend = {
    onMessage: vi.fn(),
    startSession: vi.fn(async () => ({ sessionId: 'gemini-provider-session' })),
    sendPrompt: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };

  const session = {
    sessionId: 'gemini-side-chat',
    rpcHandlerManager: { registerHandler: vi.fn() },
    onUserMessage: vi.fn((handler: (message: any) => void) => {
      userMessageHandler = handler;
    }),
    suppressNextArchiveSignal: vi.fn(),
    skipExistingMessages: vi.fn(),
    updateMetadata: vi.fn((update: (current: Record<string, any>) => Record<string, any>) => {
      metadata = update(metadata);
    }),
    getMetadata: vi.fn(() => metadata),
    updateAgentState: vi.fn((update: (current: Record<string, any>) => Record<string, any>) => {
      agentState = update(agentState);
    }),
    keepAlive: vi.fn(),
    sendSessionEvent: vi.fn(),
    sendAgentMessage: vi.fn(),
    sendSessionDeath: vi.fn(),
    flush: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };

  return {
    backend,
    session,
    getUserMessageHandler: () => userMessageHandler,
    setUserMessageHandler: (handler: ((message: any) => void) | null) => {
      userMessageHandler = handler;
    },
    getExitHandler: () => exitHandler,
    setExitHandler: (handler: (() => Promise<void>) | null) => {
      exitHandler = handler;
    },
    getAgentState: () => agentState,
    resetState: () => {
      agentState = {};
      metadata = {};
    },
    apiCreate: vi.fn(),
    refreshSessionForReconnect: vi.fn(),
    setupOfflineReconnection: vi.fn(),
    startHappyServer: vi.fn(),
  };
});

vi.mock('ink', () => ({
  render: vi.fn((element: { type?: () => { props?: { onExit?: () => Promise<void> } } }) => {
    const displayElement = typeof element.type === 'function' ? element.type() : null;
    mocks.setExitHandler(displayElement?.props?.onExit ?? null);
    return { unmount: vi.fn() };
  }),
}));

vi.mock('@/api/api', () => ({
  ApiClient: { create: mocks.apiCreate },
}));

vi.mock('@/persistence', () => ({
  readSettings: vi.fn(async () => ({ machineId: 'machine-1', sandboxConfig: undefined })),
}));

vi.mock('@/daemon/run', () => ({
  initialMachineMetadata: {},
}));

vi.mock('@/utils/createSessionMetadata', () => ({
  createSessionMetadata: vi.fn(() => ({
    metadata: { flavor: 'gemini', path: '/srv/app' },
    state: { controlledByUser: false },
  })),
}));

vi.mock('@/utils/setupOfflineReconnection', () => ({
  setupOfflineReconnection: mocks.setupOfflineReconnection,
}));

vi.mock('@/daemon/controlClient', () => ({
  notifyDaemonSessionStarted: vi.fn(async () => ({ error: null })),
}));

vi.mock('@/claude/utils/startHappyServer', () => ({
  startHappyServer: mocks.startHappyServer,
}));

vi.mock('@/projectPath', () => ({
  projectPath: vi.fn(() => '/tmp/happy'),
}));

vi.mock('@/utils/serverConnectionErrors', () => ({
  connectionState: { setBackend: vi.fn() },
}));

vi.mock('@/ui/logger', () => ({
  logger: { debug: vi.fn(), getLogPath: vi.fn(() => '/tmp/happy.log') },
}));

vi.mock('@/claude/registerKillSessionHandler', () => ({
  registerKillSessionHandler: vi.fn(),
}));

vi.mock('@/agent/factories/gemini', () => ({
  createGeminiBackend: vi.fn(() => ({
    backend: mocks.backend,
    model: 'gemini-test',
    modelSource: 'explicit',
  })),
}));

vi.mock('@/gemini/utils/config', () => ({
  readGeminiLocalConfig: vi.fn(() => ({})),
  saveGeminiModelToConfig: vi.fn(),
  getInitialGeminiModel: vi.fn(() => 'gemini-test'),
}));

vi.mock('@/gemini/utils/permissionHandler', () => ({
  GeminiPermissionHandler: class {
    updateSession = vi.fn();
    setPermissionMode = vi.fn();
    reset = vi.fn();
    abortAll = vi.fn();
  },
}));

vi.mock('@/gemini/utils/reasoningProcessor', () => ({
  GeminiReasoningProcessor: class {
    processChunk = vi.fn();
    complete = vi.fn();
    abort = vi.fn();
  },
}));

vi.mock('@/gemini/utils/diffProcessor', () => ({
  GeminiDiffProcessor: class {
    processToolResult = vi.fn();
    processFsEdit = vi.fn();
    reset = vi.fn();
  },
}));

vi.mock('@/ui/ink/GeminiDisplay', () => ({
  GeminiDisplay: vi.fn(() => null),
}));

import { formatFreshSideChatResumePrompt } from '@/commands/sideChatContext';
import { runGemini } from './runGemini';

describe('runGemini fresh-provider reconnect', () => {
  const stdoutIsTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  const stdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const stdinSetRawMode = Object.getOwnPropertyDescriptor(process.stdin, 'setRawMode');

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setUserMessageHandler(null);
    mocks.setExitHandler(null);
    mocks.resetState();

    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdin, 'setRawMode', { configurable: true, value: vi.fn() });
    vi.spyOn(process.stdin, 'resume').mockImplementation(() => process.stdin);
    vi.spyOn(process.stdin, 'pause').mockImplementation(() => process.stdin);
    vi.spyOn(process.stdin, 'setEncoding').mockImplementation(() => process.stdin);
    vi.spyOn(console, 'clear').mockImplementation(() => undefined);

    mocks.apiCreate.mockResolvedValue({
      getOrCreateMachine: vi.fn(async () => ({})),
      getVendorToken: vi.fn(async () => null),
      refreshSessionForReconnect: mocks.refreshSessionForReconnect,
      push: vi.fn(() => ({ sendSessionNotification: vi.fn() })),
    });
    mocks.refreshSessionForReconnect.mockResolvedValue({
      id: 'gemini-side-chat',
      metadata: { flavor: 'gemini', isSideChat: true, parentSessionId: 'parent-session' },
      agentState: {
        messageQueue: {
          currentMessageIds: ['restored-current'],
          pendingMessageIds: ['restored-pending'],
        },
      },
      seq: 12,
      encryptionKey: new Uint8Array(32),
      encryptionVariant: 'legacy',
      metadataVersion: 4,
      agentStateVersion: 5,
    });
    mocks.setupOfflineReconnection.mockReturnValue({
      session: mocks.session,
      reconnectionHandle: { cancel: vi.fn() },
      isOffline: false,
    });
    mocks.startHappyServer.mockResolvedValue({
      url: 'http://127.0.0.1:9876',
      stop: vi.fn(),
    });

    vi.stubEnv('HAPPY_RECONNECT_SESSION_ID', 'gemini-side-chat');
    vi.stubEnv('HAPPY_RECONNECT_ENCRYPTION_KEY', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    vi.stubEnv('HAPPY_RECONNECT_ENCRYPTION_VARIANT', 'legacy');
    vi.stubEnv('HAPPY_RECONNECT_SEQ', '12');
    vi.stubEnv('HAPPY_RECONNECT_METADATA_VERSION', '4');
    vi.stubEnv('HAPPY_RECONNECT_AGENT_STATE_VERSION', '5');
    vi.stubEnv('HAPPY_RECONNECT_QUEUE_MESSAGE_ID', 'gemini-resume-handoff');
    vi.stubEnv('HAPPYHERD_FRESH_PROVIDER_RECONNECT', '1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (stdoutIsTty) Object.defineProperty(process.stdout, 'isTTY', stdoutIsTty);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
    if (stdinIsTty) Object.defineProperty(process.stdin, 'isTTY', stdinIsTty);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
    if (stdinSetRawMode) Object.defineProperty(process.stdin, 'setRawMode', stdinSetRawMode);
    else delete (process.stdin as { setRawMode?: (mode: boolean) => void }).setRawMode;
  });

  it('executes the generated priority handoff before restored work and clears queue state', async () => {
    const handoff = formatFreshSideChatResumePrompt(
      'gemini',
      'user:\nContinue the migration\n\nassistant:\nThe first edit is complete.',
    );
    const runPromise = runGemini({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      startedBy: 'daemon',
    });

    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));
    expect(mocks.session.skipExistingMessages).toHaveBeenCalledWith(
      ['restored-current', 'restored-pending', 'gemini-resume-handoff'],
      12,
      'gemini-resume-handoff',
    );

    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Interrupted work' },
      localKey: 'restored-current',
      meta: { deliveryMode: 'queue', queueMessageId: 'restored-current' },
    });
    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Pending work' },
      localKey: 'restored-pending',
      meta: { deliveryMode: 'queue', queueMessageId: 'restored-pending' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.backend.sendPrompt).not.toHaveBeenCalled();

    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: handoff },
      localKey: 'gemini-resume-handoff',
      meta: {
        deliveryMode: 'queue',
        queueMessageId: 'gemini-resume-handoff',
        providerContinuationHandoff: true,
      },
    });

    await vi.waitFor(() => expect(mocks.backend.sendPrompt.mock.calls).toEqual([
      ['gemini-provider-session', handoff],
      ['gemini-provider-session', 'Interrupted work\nPending work'],
    ]));
    await vi.waitFor(() => expect(mocks.getAgentState()).toMatchObject({
      messageQueue: { pendingMessageIds: [], currentMessageIds: [] },
    }));

    expect(mocks.getExitHandler()).toBeTypeOf('function');
    await mocks.getExitHandler()!();
    await runPromise;
  });
});
