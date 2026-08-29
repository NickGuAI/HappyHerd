import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HAPPYHERD_MACHINE_SESSION_SETTINGS_ENV } from '@slopus/happy-wire';

const mocks = vi.hoisted(() => {
  const sessionHandlers = new Map<string, (params: any) => Promise<any> | any>();
  let userMessageHandler: ((message: any) => void) | null = null;
  let killHandler: (() => Promise<void>) | null = null;

  const mockSession = {
    onUserMessage: vi.fn((handler: (message: any) => void) => {
      userMessageHandler = handler;
    }),
    keepAlive: vi.fn(),
    sendSessionProtocolMessage: vi.fn(),
    sendSessionEvent: vi.fn(),
    updateMetadata: vi.fn(),
    suppressNextArchiveSignal: vi.fn(),
    skipExistingMessages: vi.fn(),
    sendSessionDeath: vi.fn(),
    flush: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    updateAgentState: vi.fn((handler: (state: Record<string, unknown>) => Record<string, unknown>) => {
      handler({});
    }),
    rpcHandlerManager: {
      registerHandler: vi.fn((name: string, handler: (params: any) => Promise<any> | any) => {
        sessionHandlers.set(name, handler);
      }),
    },
  };

  const backendState = {
    listeners: [] as Array<(message: any) => void>,
    prompts: [] as Array<{ sessionId: string; prompt: string }>,
    setConfigOptionCalls: [] as Array<{ configId: string; value: string }>,
    setModeCalls: [] as string[],
    setModelCalls: [] as Array<{ modelId: string; reasoningEffort?: string }>,
    startSessionMessages: [] as any[],
    startSessionCalls: 0,
    cancelCalls: [] as string[],
    disposeCalls: 0,
    constructorArgs: null as any,
    stopReason: 'end_turn' as 'end_turn' | 'refusal' | 'cancelled',
  };

  return {
    mockReadSettings: vi.fn(async () => ({ machineId: 'machine-1', sandboxConfig: undefined })),
    mockApiCreate: vi.fn(),
    mockGetOrCreateMachine: vi.fn(async () => ({})),
    mockGetOrCreateSession: vi.fn(async () => ({ id: 'session-1' })),
    mockRefreshSessionForReconnect: vi.fn(),
    mockSetupOfflineReconnection: vi.fn(),
    mockNotifyDaemonSessionStarted: vi.fn(async () => ({ error: null })),
    mockStartHappyServer: vi.fn(),
    mockProjectPath: vi.fn(() => '/tmp/happy'),
    mockSetBackend: vi.fn(),
    mockKillRegister: vi.fn((_rpc: unknown, handler: () => Promise<void>) => {
      killHandler = handler;
    }),
    mockLoggerDebug: vi.fn(),
    mockConsoleLog: vi.spyOn(console, 'log').mockImplementation(() => {}),
    sessionHandlers,
    getUserMessageHandler: () => userMessageHandler,
    setUserMessageHandler: (handler: ((message: any) => void) | null) => {
      userMessageHandler = handler;
    },
    getKillHandler: () => killHandler,
    setKillHandler: (handler: (() => Promise<void>) | null) => {
      killHandler = handler;
    },
    mockSession,
    backendState,
  };
});

vi.mock('@/persistence', async () => {
  const actual = await vi.importActual<typeof import('@/persistence')>('@/persistence');
  return {
    ...actual,
    readSettings: mocks.mockReadSettings,
  };
});

vi.mock('@/api/api', () => ({
  ApiClient: {
    create: mocks.mockApiCreate,
  },
}));

vi.mock('@/daemon/run', () => ({
  initialMachineMetadata: { host: 'host', platform: 'darwin', happyCliVersion: 'test', homeDir: '/tmp', happyHomeDir: '/tmp/.happy', happyLibDir: '/tmp/happy' },
}));

vi.mock('@/utils/setupOfflineReconnection', () => ({
  setupOfflineReconnection: mocks.mockSetupOfflineReconnection,
}));

vi.mock('@/daemon/controlClient', () => ({
  notifyDaemonSessionStarted: mocks.mockNotifyDaemonSessionStarted,
}));

vi.mock('@/claude/registerKillSessionHandler', () => ({
  registerKillSessionHandler: mocks.mockKillRegister,
}));

vi.mock('@/claude/utils/startHappyServer', () => ({
  startHappyServer: mocks.mockStartHappyServer,
}));

vi.mock('@/projectPath', () => ({
  projectPath: mocks.mockProjectPath,
}));

vi.mock('@/utils/serverConnectionErrors', () => ({
  connectionState: {
    setBackend: mocks.mockSetBackend,
  },
}));

vi.mock('@/ui/logger', () => ({
  logger: {
    debug: mocks.mockLoggerDebug,
  },
}));

vi.mock('./AcpBackend', () => ({
  AcpBackend: class MockAcpBackend {
    constructor(args: any) {
      mocks.backendState.constructorArgs = args;
    }

    onMessage(handler: (message: any) => void) {
      mocks.backendState.listeners.push(handler);
    }

    offMessage(handler: (message: any) => void) {
      mocks.backendState.listeners = mocks.backendState.listeners.filter((item) => item !== handler);
    }

    async startSession() {
      mocks.backendState.startSessionCalls += 1;
      for (const message of mocks.backendState.startSessionMessages) {
        for (const listener of mocks.backendState.listeners) {
          listener(message);
        }
      }
      return { sessionId: 'acp-session-1', providerSessionId: 'provider-session-1' };
    }

    async sendPrompt(sessionId: string, prompt: string) {
      mocks.backendState.prompts.push({ sessionId, prompt });
      for (const listener of mocks.backendState.listeners) {
        listener({ type: 'status', status: 'running' });
        listener({ type: 'model-output', textDelta: 'hello' });
        listener({ type: 'tool-call', toolName: 'ReadFile', args: { path: 'README.md' }, callId: 'tool-1' });
        listener({ type: 'tool-result', toolName: 'ReadFile', result: { ok: true }, callId: 'tool-1' });
        listener({ type: 'status', status: 'idle' });
      }
    }

    async sendPromptAndGetResult(sessionId: string, prompt: string) {
      await this.sendPrompt(sessionId, prompt);
      return { stopReason: mocks.backendState.stopReason };
    }

    async setSessionConfigOption(configId: string, value: string) {
      mocks.backendState.setConfigOptionCalls.push({ configId, value });
      return true;
    }

    async setSessionMode(modeId: string) {
      mocks.backendState.setModeCalls.push(modeId);
      return true;
    }

    async setSessionModel(modelId: string, reasoningEffort?: string) {
      mocks.backendState.setModelCalls.push({ modelId, reasoningEffort });
      return true;
    }

    async cancel(sessionId: string) {
      mocks.backendState.cancelCalls.push(sessionId);
      for (const listener of mocks.backendState.listeners) {
        listener({ type: 'status', status: 'stopped' });
      }
    }

    async dispose() {
      mocks.backendState.disposeCalls += 1;
    }
  },
}));

import { resolveAcpPermissionPolicy, runAcp } from './runAcp';

describe('runAcp', () => {
  const stripAnsi = (line: string) => line.replace(/\u001b\[[0-9;]*m/g, '');
  const stripLogPrefix = (line: string) => stripAnsi(line).replace(/^\[\d{2}:\d{2}\] /, '');
  const consoleLines = () => mocks.mockConsoleLog.mock.calls
    .map((args) => args.map((arg) => String(arg)).join(' '))
    .map(stripLogPrefix);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionHandlers.clear();
    mocks.setUserMessageHandler(null);
    mocks.setKillHandler(null);
    mocks.backendState.listeners = [];
    mocks.backendState.prompts = [];
    mocks.backendState.setConfigOptionCalls = [];
    mocks.backendState.setModeCalls = [];
    mocks.backendState.setModelCalls = [];
    mocks.backendState.startSessionMessages = [];
    mocks.backendState.startSessionCalls = 0;
    mocks.backendState.cancelCalls = [];
    mocks.backendState.disposeCalls = 0;
    mocks.backendState.constructorArgs = null;
    mocks.backendState.stopReason = 'end_turn';

    mocks.mockApiCreate.mockResolvedValue({
      getOrCreateMachine: mocks.mockGetOrCreateMachine,
      getOrCreateSession: mocks.mockGetOrCreateSession,
      refreshSessionForReconnect: mocks.mockRefreshSessionForReconnect,
    });
    mocks.mockRefreshSessionForReconnect.mockResolvedValue({
      id: 'resumed-session',
      metadata: {},
      agentState: {},
      seq: 12,
      encryptionKey: new Uint8Array(32),
      encryptionVariant: 'legacy',
      metadataVersion: 4,
      agentStateVersion: 5,
    });
    mocks.mockSetupOfflineReconnection.mockImplementation(() => ({
      session: mocks.mockSession,
      reconnectionHandle: { cancel: vi.fn() },
      isOffline: false,
    }));
    mocks.mockStartHappyServer.mockResolvedValue({
      url: 'http://127.0.0.1:9876',
      stop: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps Grok launch permission policy distinct from ACP operating mode', () => {
    expect(resolveAcpPermissionPolicy('grok', undefined)).toBe('prompt');
    expect(resolveAcpPermissionPolicy('grok', 'default')).toBe('prompt');
    expect(resolveAcpPermissionPolicy('grok', 'acceptEdits')).toBe('prompt');
    expect(resolveAcpPermissionPolicy('grok', 'auto')).toBe('prompt');
    expect(resolveAcpPermissionPolicy('grok', 'plan')).toBe('prompt');
    expect(resolveAcpPermissionPolicy('grok', 'bypassPermissions')).toBe('approve');
    expect(resolveAcpPermissionPolicy('grok', 'dontAsk')).toBe('deny');
    expect(resolveAcpPermissionPolicy('grok', 'future-mode')).toBe('cancel');
    expect(resolveAcpPermissionPolicy('opencode', 'bypassPermissions')).toBe('prompt');
  });

  it.each(['dontAsk', 'bypassPermissions'] as const)(
    'persists direct terminal Grok %s policy in canonical spawn settings',
    async (permissionMode) => {
      const runPromise = runAcp({
        credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
        agentName: 'grok',
        command: 'grok',
        args: ['--no-auto-update', '--permission-mode', permissionMode, 'agent', 'stdio'],
        startedBy: 'terminal',
        permissionMode,
      });

      await vi.waitFor(() => expect(mocks.backendState.startSessionCalls).toBe(1));
      expect(mocks.mockGetOrCreateSession).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({
          spawnSettings: {
            provider: 'grok',
            model: null,
            effort: null,
            permission: permissionMode,
          },
        }),
      }));

      await mocks.getKillHandler()!();
      await runPromise;
    },
  );

  it('does not create pending agent state for Grok bypass callbacks', async () => {
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'grok',
      command: 'grok',
      args: ['--no-auto-update', '--permission-mode', 'bypassPermissions', 'agent', 'stdio'],
      permissionMode: 'bypassPermissions',
    });

    await vi.waitFor(() => expect(mocks.backendState.startSessionCalls).toBe(1));
    const handler = mocks.backendState.constructorArgs.permissionHandler;
    const updateCountBeforeCallback = mocks.mockSession.updateAgentState.mock.calls.length;

    expect(handler.requiresUserInput('grok-tool-17', 'execute', { command: 'pnpm test' })).toBe(false);
    await expect(handler.handleToolCall(
      'grok-tool-17',
      'execute',
      { command: 'pnpm test' },
      'Run focused tests',
    )).resolves.toEqual({ decision: 'approved_without_prompt' });
    expect(mocks.mockSession.updateAgentState).toHaveBeenCalledTimes(updateCountBeforeCallback);

    await mocks.getKillHandler()!();
    await runPromise;
  });

  it('creates exactly one pending agent-state request for interactive Grok callbacks', async () => {
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'grok',
      command: 'grok',
      args: ['--no-auto-update', '--permission-mode', 'default', 'agent', 'stdio'],
      permissionMode: 'default',
    });

    await vi.waitFor(() => expect(mocks.backendState.startSessionCalls).toBe(1));
    const handler = mocks.backendState.constructorArgs.permissionHandler;
    const updateCountBeforeCallback = mocks.mockSession.updateAgentState.mock.calls.length;

    expect(handler.requiresUserInput('grok-tool-18', 'edit', { path: 'CHANGELOG.md' })).toBe(true);
    const pending = handler.handleToolCall(
      'grok-tool-18',
      'edit',
      { path: 'CHANGELOG.md' },
      'Write the changelog',
    );

    expect(mocks.mockSession.updateAgentState).toHaveBeenCalledTimes(updateCountBeforeCallback + 1);
    const pendingStateUpdate = mocks.mockSession.updateAgentState.mock.calls.at(-1)?.[0];
    expect(pendingStateUpdate?.({})).toMatchObject({
      requests: {
        'grok-tool-18': {
          tool: 'Write the changelog',
          arguments: { path: 'CHANGELOG.md' },
        },
      },
    });

    const permissionResponse = mocks.sessionHandlers.get('permission');
    expect(permissionResponse).toBeTypeOf('function');
    await permissionResponse!({ id: 'grok-tool-18', approved: true, decision: 'approved' });
    await expect(pending).resolves.toEqual({ decision: 'approved' });

    await mocks.getKillHandler()!();
    await runPromise;
  });

  it.each([
    ['bypassPermissions', false, 'approved_without_prompt'],
    ['dontAsk', false, 'denied'],
    ['default', true, 'approved'],
  ] as const)(
    'keeps resumed Grok %s policy for a late permission callback',
    async (permissionMode, requiresUserInput, expectedDecision) => {
      vi.stubEnv('HAPPY_RECONNECT_SESSION_ID', 'resumed-session');
      vi.stubEnv('HAPPY_RECONNECT_ENCRYPTION_KEY', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
      vi.stubEnv('HAPPY_RECONNECT_ENCRYPTION_VARIANT', 'legacy');
      vi.stubEnv('HAPPY_RECONNECT_SEQ', '12');
      vi.stubEnv('HAPPY_RECONNECT_METADATA_VERSION', '4');
      vi.stubEnv('HAPPY_RECONNECT_AGENT_STATE_VERSION', '5');

      const runPromise = runAcp({
        credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
        agentName: 'grok',
        command: 'grok',
        args: ['--no-auto-update', '--permission-mode', permissionMode, 'agent', 'stdio'],
        permissionMode,
        resumeSessionId: 'grok-provider-session',
      });

      await vi.waitFor(() => expect(mocks.backendState.startSessionCalls).toBe(1));
      const handler = mocks.backendState.constructorArgs.permissionHandler;
      const updateCountBeforeCallback = mocks.mockSession.updateAgentState.mock.calls.length;
      expect(handler.requiresUserInput('late-grok-tool', 'execute', { command: 'pnpm test' }))
        .toBe(requiresUserInput);

      const decision = handler.handleToolCall(
        'late-grok-tool',
        'execute',
        { command: 'pnpm test' },
        'Run focused tests',
      );
      if (requiresUserInput) {
        expect(mocks.mockSession.updateAgentState).toHaveBeenCalledTimes(updateCountBeforeCallback + 1);
        const permissionResponse = mocks.sessionHandlers.get('permission');
        await permissionResponse!({ id: 'late-grok-tool', approved: true, decision: 'approved' });
      } else {
        expect(mocks.mockSession.updateAgentState).toHaveBeenCalledTimes(updateCountBeforeCallback);
      }
      await expect(decision).resolves.toEqual({ decision: expectedDecision });

      await mocks.getKillHandler()!();
      await runPromise;
    },
  );

  it('replays the explicit archived turn during raw Grok ACP reconnect', async () => {
    vi.stubEnv('HAPPY_RECONNECT_SESSION_ID', 'resumed-session');
    vi.stubEnv('HAPPY_RECONNECT_ENCRYPTION_KEY', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    vi.stubEnv('HAPPY_RECONNECT_ENCRYPTION_VARIANT', 'legacy');
    vi.stubEnv('HAPPY_RECONNECT_SEQ', '12');
    vi.stubEnv('HAPPY_RECONNECT_METADATA_VERSION', '4');
    vi.stubEnv('HAPPY_RECONNECT_AGENT_STATE_VERSION', '5');
    vi.stubEnv('HAPPY_RECONNECT_QUEUE_MESSAGE_ID', 'archived-next-turn');
    mocks.mockRefreshSessionForReconnect.mockResolvedValueOnce({
      id: 'resumed-session',
      metadata: {},
      agentState: {
        messageQueue: {
          pendingMessageIds: ['retained-queued-turn'],
          currentMessageIds: [],
        },
      },
      seq: 12,
      encryptionKey: new Uint8Array(32),
      encryptionVariant: 'legacy',
      metadataVersion: 4,
      agentStateVersion: 5,
    });

    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'grok',
      command: 'grok',
      args: ['--no-auto-update', '--permission-mode', 'default', 'agent', 'stdio'],
      permissionMode: 'default',
      resumeSessionId: 'grok-provider-session',
    });

    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));
    expect(mocks.mockSession.skipExistingMessages).toHaveBeenCalledWith(
      ['retained-queued-turn', 'archived-next-turn'],
      12,
    );

    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Continue the archived Grok task' },
      localKey: 'archived-next-turn',
      meta: {
        deliveryMode: 'queue',
        queueMessageId: 'archived-next-turn',
      },
    });

    await vi.waitFor(() => expect(mocks.backendState.prompts).toEqual([{
      sessionId: 'acp-session-1',
      prompt: 'Continue the archived Grok task',
    }]));
    await mocks.getKillHandler()!();
    await runPromise;
  });

  it('publishes a changed Grok launch receipt only after resumed provider startup and restores queued turns', async () => {
    const oldReceipt = {
      provider: 'grok' as const,
      model: 'grok-build',
      effort: null,
      permission: 'default',
    };
    const newReceipt = { ...oldReceipt, permission: 'bypassPermissions' };
    vi.stubEnv('HAPPY_RECONNECT_SESSION_ID', 'resumed-session');
    vi.stubEnv('HAPPY_RECONNECT_ENCRYPTION_KEY', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    vi.stubEnv('HAPPY_RECONNECT_ENCRYPTION_VARIANT', 'legacy');
    vi.stubEnv('HAPPY_RECONNECT_SEQ', '12');
    vi.stubEnv('HAPPY_RECONNECT_METADATA_VERSION', '4');
    vi.stubEnv('HAPPY_RECONNECT_AGENT_STATE_VERSION', '5');
    vi.stubEnv(HAPPYHERD_MACHINE_SESSION_SETTINGS_ENV, JSON.stringify(newReceipt));
    mocks.mockRefreshSessionForReconnect.mockResolvedValue({
      id: 'resumed-session',
      metadata: {
        flavor: 'grok',
        acpSessionId: 'grok-provider-session',
        spawnSettings: oldReceipt,
        permissionMode: 'default',
      },
      agentState: {
        messageQueue: {
          currentMessageIds: ['queue-current'],
          pendingMessageIds: ['queue-pending'],
        },
      },
      seq: 12,
      encryptionKey: new Uint8Array(32),
      encryptionVariant: 'legacy',
      metadataVersion: 4,
      agentStateVersion: 5,
    });

    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'grok',
      command: 'grok',
      args: ['--no-auto-update', '--permission-mode', 'bypassPermissions', 'agent', 'stdio'],
      startedBy: 'daemon',
      permissionMode: 'bypassPermissions',
      resumeSessionId: 'grok-provider-session',
    });

    await vi.waitFor(() => expect(mocks.backendState.startSessionCalls).toBe(1));
    expect(mocks.mockSession.skipExistingMessages).toHaveBeenCalledWith(
      ['queue-current', 'queue-pending'],
      12,
    );
    const daemonNotifications = mocks.mockNotifyDaemonSessionStarted.mock.calls as unknown as Array<[string, Record<string, any>]>;
    expect(daemonNotifications[0]?.[1]).toMatchObject({
      spawnSettings: oldReceipt,
      permissionMode: 'default',
    });
    expect(daemonNotifications.at(-1)?.[1]).toMatchObject({
      acpSessionId: 'provider-session-1',
      spawnSettings: newReceipt,
      permissionMode: 'bypassPermissions',
    });

    const confirmedMetadataUpdate = mocks.mockSession.updateMetadata.mock.calls
      .map(([update]) => update)
      .find((update) => {
        const result = update({ spawnSettings: oldReceipt, permissionMode: 'default' });
        return result.spawnSettings?.permission === 'bypassPermissions';
      });
    expect(confirmedMetadataUpdate).toBeTypeOf('function');
    expect(confirmedMetadataUpdate({ spawnSettings: oldReceipt, permissionMode: 'default' })).toMatchObject({
      spawnSettings: newReceipt,
      permissionMode: 'bypassPermissions',
    });
    await mocks.getKillHandler()!();
    await runPromise;
  });

  it('wires backend messages through mapper into session envelopes', async () => {
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'opencode',
      command: 'opencode',
      args: ['--acp'],
    });

    await vi.waitFor(() => {
      expect(mocks.getUserMessageHandler()).toBeTypeOf('function');
    });

    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Build a test plan' },
    });

    await vi.waitFor(() => {
      expect(mocks.backendState.prompts).toHaveLength(1);
    });

    await mocks.getKillHandler()!();
    await runPromise;

    expect(mocks.backendState.constructorArgs.command).toBe('opencode');
    expect(mocks.backendState.constructorArgs.args).toEqual(['--acp']);
    expect(mocks.backendState.prompts[0]).toEqual({
      sessionId: 'acp-session-1',
      prompt: 'Build a test plan',
    });
    expect(mocks.mockSession.updateMetadata.mock.calls
      .map(([update]) => update({}))
      .some((metadata) => metadata.acpSessionId === 'provider-session-1')).toBe(true);

    const envelopeTypes = mocks.mockSession.sendSessionProtocolMessage.mock.calls.map(([envelope]) => envelope.ev.t);
    expect(envelopeTypes).toEqual(['turn-start', 'text', 'tool-call-start', 'tool-call-end', 'turn-end']);
    expect(mocks.mockSession.sendSessionEvent).toHaveBeenCalledWith({ type: 'ready' });
    expect(mocks.mockSession.close).toHaveBeenCalled();
    expect(consoleLines()).toEqual(expect.arrayContaining([
      'Happy Session ID: session-1',
      'Incoming prompt: Build a test plan',
      'Status: running',
      'Outgoing message: "hello"',
      'Tool: ReadFile started (callId=tool-1)',
      'Tool: ReadFile completed (callId=tool-1)',
      'Status: idle',
    ]));
  });

  it('registers abort handler that cancels the ACP backend session', async () => {
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'gemini',
      command: 'gemini',
      args: ['--experimental-acp'],
    });

    await vi.waitFor(() => {
      expect(mocks.backendState.startSessionCalls).toBe(1);
    });

    const abortHandler = mocks.sessionHandlers.get('abort');
    expect(abortHandler).toBeTypeOf('function');

    await abortHandler!({});
    await vi.waitFor(() => {
      expect(mocks.backendState.cancelCalls).toEqual(['acp-session-1']);
    });

    await mocks.getKillHandler()!();
    await runPromise;
  });

  it('emits thinking messages in default mode', async () => {
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'opencode',
      command: 'opencode',
      args: ['--acp'],
    });

    await vi.waitFor(() => {
      expect(mocks.getUserMessageHandler()).toBeTypeOf('function');
    });

    const listener = mocks.backendState.listeners[0];
    const prompts = mocks.backendState.prompts;
    if (!listener) {
      throw new Error('Expected backend listener to be registered');
    }

    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Think first' },
    });

    await vi.waitFor(() => {
      expect(mocks.backendState.prompts).toHaveLength(1);
    });

    listener({ type: 'event', name: 'thinking', payload: { text: 'Analyzing request' } });

    await mocks.getKillHandler()!();
    await runPromise;

    expect(prompts).toHaveLength(1);
    expect(consoleLines()).toEqual(expect.arrayContaining([
      'Thinking: "Analyzing request"',
    ]));
  });

  it('emits raw backend and envelope logs when verbose is enabled', async () => {
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'opencode',
      command: 'opencode',
      args: ['acp'],
      verbose: true,
    });

    await vi.waitFor(() => {
      expect(mocks.getUserMessageHandler()).toBeTypeOf('function');
    });

    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Run the command' },
    });

    await vi.waitFor(() => {
      expect(mocks.backendState.prompts).toHaveLength(1);
    });

    await mocks.getKillHandler()!();
    await runPromise;

    const lines = consoleLines();
    expect(lines.some((line) => line.startsWith('Outgoing raw backend message from opencode: '))).toBe(true);
    expect(lines.some((line) => line.startsWith('Incoming raw envelope for opencode: '))).toBe(true);
    expect(lines).toEqual(expect.arrayContaining([
      'Outgoing message: "hello"',
      'Tool: ReadFile started (callId=tool-1)',
    ]));
  });

  it('logs slash commands, modes, and models line by line when verbose is enabled', async () => {
    mocks.backendState.startSessionMessages = [
      {
        type: 'event',
        name: 'available_commands',
        payload: [
          { name: 'init', description: 'create/update AGENTS.md' },
          { name: 'review', description: 'review uncommitted changes' },
        ],
      },
      {
        type: 'event',
        name: 'modes_update',
        payload: {
          availableModes: [
            { id: 'build', name: 'build', description: 'Executes tools' },
            { id: 'plan', name: 'plan', description: 'Disallows edit tools' },
          ],
          currentModeId: 'build',
        },
      },
      {
        type: 'event',
        name: 'models_update',
        payload: {
          currentModelId: 'gemini-2.5-pro',
          availableModels: [
            { modelId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { modelId: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
          ],
        },
      },
    ];

    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'gemini',
      command: 'gemini',
      args: ['--experimental-acp'],
      verbose: true,
    });

    await vi.waitFor(() => {
      expect(mocks.backendState.startSessionCalls).toBe(1);
    });

    await mocks.getKillHandler()!();
    await runPromise;

    const lines = consoleLines();
    expect(lines).toEqual(expect.arrayContaining([
      'Outgoing slash commands from gemini (2):',
      '  /init - create/update AGENTS.md',
      '  /review - review uncommitted changes',
      'Outgoing modes from gemini (2), current=build:',
      '  mode=build name=build - Executes tools',
      '  mode=plan name=plan - Disallows edit tools',
      'Outgoing models from gemini (2), current=gemini-2.5-pro:',
      '  model=gemini-2.5-pro name=Gemini 2.5 Pro',
      '  model=gemini-2.5-flash name=Gemini 2.5 Flash',
    ]));
  });

  it('exits when backend reports terminal startup status', async () => {
    mocks.backendState.startSessionMessages = [
      { type: 'status', status: 'error', detail: 'spawn opencode ENOENT' },
    ];

    await runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'opencode',
      command: 'opencode',
      args: ['acp'],
    });

    expect(consoleLines()).toContain('Status: error: spawn opencode ENOENT');
    expect(mocks.mockSession.close).toHaveBeenCalled();
    expect(mocks.backendState.disposeCalls).toBe(1);
  });

  it('updates session metadata with ACP config options (models and operating modes)', async () => {
    mocks.backendState.startSessionMessages = [
      {
        type: 'event',
        name: 'config_options_update',
        payload: {
          configOptions: [
            {
              type: 'select',
              id: 'mode',
              name: 'Mode',
              category: 'mode',
              currentValue: 'code',
              options: [
                { value: 'ask', name: 'Ask', description: 'Q&A mode' },
                { value: 'code', name: 'Code', description: 'Implementation mode' },
              ],
            },
            {
              type: 'select',
              id: 'model',
              name: 'Model',
              category: 'model',
              currentValue: 'claude-sonnet',
              options: [
                { value: 'claude-sonnet', name: 'Claude Sonnet', description: 'Balanced model' },
                { value: 'claude-opus', name: 'Claude Opus', description: 'Deep reasoning model' },
              ],
            },
          ],
        },
      },
    ];

    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'opencode',
      command: 'opencode',
      args: ['acp'],
    });

    await vi.waitFor(() => {
      expect(mocks.backendState.startSessionCalls).toBe(1);
    });

    await mocks.getKillHandler()!();
    await runPromise;

    const metadataHandlers = mocks.mockSession.updateMetadata.mock.calls.map((call) => call[0]);
    const baseMetadata = {
      path: '/repo',
      host: 'host',
      homeDir: '/home/user',
      happyHomeDir: '/home/user/.happy',
      happyLibDir: '/repo/.happy/lib',
      happyToolsDir: '/repo/.happy/tools',
    };
    const appliedMetadata = metadataHandlers.map((handler) => handler(baseMetadata));

    expect(appliedMetadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentModelCode: 'claude-sonnet',
          currentOperatingModeCode: 'code',
          models: [
            { code: 'claude-sonnet', value: 'Claude Sonnet', description: 'Balanced model' },
            { code: 'claude-opus', value: 'Claude Opus', description: 'Deep reasoning model' },
          ],
          operatingModes: [
            { code: 'ask', value: 'Ask', description: 'Q&A mode' },
            { code: 'code', value: 'Code', description: 'Implementation mode' },
          ],
        }),
      ]),
    );
  });

  it('switches ACP model and permission mode when requested values match config options', async () => {
    mocks.backendState.startSessionMessages = [
      {
        type: 'event',
        name: 'config_options_update',
        payload: {
          configOptions: [
            {
              type: 'select',
              id: 'permission-mode',
              name: 'Permission Mode',
              category: 'mode',
              currentValue: 'ask',
              options: [
                { value: 'ask', name: 'Ask' },
                { value: 'code', name: 'Code' },
              ],
            },
            {
              type: 'select',
              id: 'model',
              name: 'Model',
              category: 'model',
              currentValue: 'claude-sonnet',
              options: [
                { value: 'claude-sonnet', name: 'Claude Sonnet' },
                { value: 'claude-opus', name: 'Claude Opus' },
              ],
            },
          ],
        },
      },
    ];

    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'opencode',
      command: 'opencode',
      args: ['acp'],
    });

    await vi.waitFor(() => {
      expect(mocks.getUserMessageHandler()).toBeTypeOf('function');
    });

    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Apply settings then run' },
      meta: {
        permissionMode: 'Code',
        model: 'claude-opus',
      },
    });

    await vi.waitFor(() => {
      expect(mocks.backendState.prompts).toHaveLength(1);
    });

    await mocks.getKillHandler()!();
    await runPromise;

    expect(mocks.backendState.setConfigOptionCalls).toEqual([
      { configId: 'permission-mode', value: 'code' },
      { configId: 'model', value: 'claude-opus' },
    ]);
    expect(mocks.backendState.setModeCalls).toEqual([]);
    expect(mocks.backendState.setModelCalls).toEqual([]);
  });

  it('sets GrokBuild model and effort through the one observed session/set_model request', async () => {
    mocks.backendState.startSessionMessages = [{
      type: 'event',
      name: 'models_update',
      payload: {
        currentModelId: 'grok-4.6',
        availableModels: [{
          modelId: 'grok-4.6',
          name: 'Grok 4.6',
          _meta: {
            reasoningEffort: 'high',
            reasoningEfforts: [
              { id: 'high', label: 'High', default: true },
              { id: 'low', label: 'Low', default: false },
            ],
          },
        }],
      },
    }];
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'grok',
      command: 'grok',
      args: ['--no-auto-update', 'agent', 'stdio'],
      model: 'grok-4.6',
      effort: 'high',
      permissionMode: 'default',
    });
    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));

    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Use deeper reasoning' },
      meta: { model: 'grok-4.6', effort: 'low' },
    });
    await vi.waitFor(() => expect(mocks.backendState.prompts).toHaveLength(1));
    await mocks.getKillHandler()!();
    await runPromise;

    expect(mocks.backendState.constructorArgs).not.toHaveProperty('model');
    expect(mocks.backendState.constructorArgs).not.toHaveProperty('effort');
    expect(mocks.backendState.constructorArgs).not.toHaveProperty('permissionMode');
    expect(mocks.backendState.setModelCalls).toEqual([{
      modelId: 'grok-4.6',
      reasoningEffort: 'low',
    }]);
  });

  it('does not reinterpret a GrokBuild launch permission as an ACP operating-mode switch', async () => {
    mocks.backendState.startSessionMessages = [{
      type: 'event',
      name: 'config_options_update',
      payload: {
        configOptions: [{
          type: 'select',
          id: 'session-mode',
          name: 'Session Mode',
          category: 'mode',
          currentValue: 'build',
          options: [
            { value: 'build', name: 'Build' },
            { value: 'plan', name: 'Plan' },
          ],
        }],
      },
    }];
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'grok',
      command: 'grok',
      args: ['--no-auto-update', '--permission-mode', 'plan', 'agent', 'stdio'],
      permissionMode: 'plan',
    });
    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));

    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Keep the launch policy' },
      meta: { permissionMode: 'plan' },
    });
    await vi.waitFor(() => expect(mocks.backendState.prompts).toHaveLength(1));
    await mocks.getKillHandler()!();
    await runPromise;

    expect(mocks.backendState.setConfigOptionCalls).toEqual([]);
    expect(mocks.backendState.setModeCalls).toEqual([]);
  });

  it('uses the ACP prompt stop reason as the authoritative turn outcome', async () => {
    mocks.backendState.stopReason = 'refusal';
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'grok',
      command: 'grok',
      args: ['--no-auto-update', 'agent', 'stdio'],
    });
    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));
    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'A refused request' },
    });
    await vi.waitFor(() => expect(mocks.backendState.prompts).toHaveLength(1));
    await mocks.getKillHandler()!();
    await runPromise;

    const turnEnd = mocks.mockSession.sendSessionProtocolMessage.mock.calls
      .map(([envelope]) => envelope.ev)
      .find((event) => event.t === 'turn-end');
    expect(turnEnd).toEqual(expect.objectContaining({ status: 'failed' }));
  });

  it('ignores ACP model and permission mode requests when values do not match advertised options', async () => {
    mocks.backendState.startSessionMessages = [
      {
        type: 'event',
        name: 'config_options_update',
        payload: {
          configOptions: [
            {
              type: 'select',
              id: 'permission-mode',
              name: 'Permission Mode',
              category: 'mode',
              currentValue: 'ask',
              options: [
                { value: 'ask', name: 'Ask' },
                { value: 'code', name: 'Code' },
              ],
            },
            {
              type: 'select',
              id: 'model',
              name: 'Model',
              category: 'model',
              currentValue: 'claude-sonnet',
              options: [
                { value: 'claude-sonnet', name: 'Claude Sonnet' },
                { value: 'claude-opus', name: 'Claude Opus' },
              ],
            },
          ],
        },
      },
    ];

    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'opencode',
      command: 'opencode',
      args: ['acp'],
    });

    await vi.waitFor(() => {
      expect(mocks.getUserMessageHandler()).toBeTypeOf('function');
    });

    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Run without switching' },
      meta: {
        permissionMode: 'invalid-mode',
        model: 'invalid-model',
      },
    });

    await vi.waitFor(() => {
      expect(mocks.backendState.prompts).toHaveLength(1);
    });

    await mocks.getKillHandler()!();
    await runPromise;

    expect(mocks.backendState.setConfigOptionCalls).toEqual([]);
    expect(mocks.backendState.setModeCalls).toEqual([]);
    expect(mocks.backendState.setModelCalls).toEqual([]);
  });
});
