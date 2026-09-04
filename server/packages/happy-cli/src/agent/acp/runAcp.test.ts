import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HAPPYHERD_MACHINE_SESSION_SETTINGS_ENV } from '@slopus/happy-wire';

const mocks = vi.hoisted(() => {
  const sessionHandlers = new Map<string, (params: any) => Promise<any> | any>();
  const lifecycleEvents: string[] = [];
  let userMessageHandler: ((message: any) => void) | null = null;
  let killHandler: (() => Promise<void>) | null = null;

  const mockSession = {
    sessionId: 'session-1',
    onUserMessage: vi.fn((handler: (message: any) => void) => {
      userMessageHandler = handler;
    }),
    keepAlive: vi.fn(),
    sendSessionProtocolMessage: vi.fn(),
    sendProviderUsageReport: vi.fn(async (
      _report: any,
      options?: {
        onDurable?: () => void;
        mutateAgentState?: (state: Record<string, any>) => Record<string, any>;
      },
    ) => {
      options?.onDurable?.();
    }),
    uploadImageAttachmentEnvelope: vi.fn(async (attachment: any, role: 'user' | 'agent', opts: any) => ({
      id: `file-${attachment.name}`,
      time: opts.time,
      role,
      turn: opts.turn,
      ev: {
        t: 'file',
        ref: `ref-${attachment.name}`,
        name: attachment.name,
        size: attachment.data.length,
        mimeType: attachment.mimeType,
      },
    })),
    sendSessionEvent: vi.fn(),
    updateMetadata: vi.fn(),
    getAgentState: vi.fn(() => ({})),
    suppressNextArchiveSignal: vi.fn(),
    skipExistingMessages: vi.fn(),
    sendSessionDeath: vi.fn(),
    flush: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    updateAgentState: vi.fn(async (handler: (state: Record<string, unknown>) => Record<string, unknown>) => {
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
    setConfigOptionResult: true,
    operations: [] as string[],
    setModeCalls: [] as string[],
    setModelCalls: [] as Array<{ modelId: string; reasoningEffort?: string }>,
    startSessionMessages: [] as any[],
    startSessionCalls: 0,
    cancelCalls: [] as string[],
    disposeCalls: 0,
    constructorArgs: null as any,
    stopReason: 'end_turn' as 'end_turn' | 'refusal' | 'cancelled',
    promptError: null as Error | null,
    promptImageMessages: [] as any[],
    promptUsages: [] as any[],
    promptUsageInMeta: false,
    usageCosts: [] as Array<{ amount: number; currency: string } | null>,
    usageCostTrailingEmpty: false,
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
    mockPersistActiveGrokCredential: vi.fn(async () => {
      lifecycleEvents.push('persist');
      return true;
    }),
    mockReportProviderHardLimitOnce: vi.fn(async () => {
      lifecycleEvents.push('report');
      return true;
    }),
    mockConsoleLog: vi.spyOn(console, 'log').mockImplementation(() => {}),
    lifecycleEvents,
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
      mocks.backendState.operations.push('prompt');
      mocks.backendState.prompts.push({ sessionId, prompt });
      const promptIndex = mocks.backendState.prompts.length - 1;
      if (mocks.backendState.promptError) throw mocks.backendState.promptError;
      for (const listener of mocks.backendState.listeners) {
        listener({ type: 'status', status: 'running' });
        listener({ type: 'model-output', textDelta: 'hello' });
        listener({ type: 'tool-call', toolName: 'ReadFile', args: { path: 'README.md' }, callId: 'tool-1' });
        listener({ type: 'tool-result', toolName: 'ReadFile', result: { ok: true }, callId: 'tool-1' });
        for (const imageMessage of mocks.backendState.promptImageMessages) {
          listener(imageMessage);
        }
        const cost = mocks.backendState.usageCosts[promptIndex];
        if (cost) {
          listener({ type: 'token-count', usageSource: 'acp-usage-update', cost });
          if (mocks.backendState.usageCostTrailingEmpty) {
            listener({ type: 'token-count', usageSource: 'acp-usage-update' });
          }
        }
        listener({ type: 'status', status: 'idle' });
      }
    }

    async sendPromptAndGetResult(sessionId: string, prompt: string) {
      await this.sendPrompt(sessionId, prompt);
      const usage = mocks.backendState.promptUsages[mocks.backendState.prompts.length - 1];
      return {
        stopReason: mocks.backendState.stopReason,
        ...(mocks.backendState.promptUsageInMeta ? { _meta: { usage } } : { usage }),
      };
    }

    async setSessionConfigOption(configId: string, value: string) {
      mocks.backendState.operations.push(`config:${configId}:${value}`);
      mocks.backendState.setConfigOptionCalls.push({ configId, value });
      return mocks.backendState.setConfigOptionResult;
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
      mocks.lifecycleEvents.push('dispose');
    }
  },
}));

vi.mock('@/credentialPool/grokAuth', () => ({
  persistActiveGrokCredential: mocks.mockPersistActiveGrokCredential,
}));

vi.mock('@/credentialPool/providerLimitNotice', () => ({
  reportProviderHardLimitOnce: mocks.mockReportProviderHardLimitOnce,
}));

import {
  dshChildEnvironment,
  resolveAcpResumeSessionId,
  resolveAcpPermissionPolicy,
  resolveDshModelConfigCode,
  runAcp,
} from './runAcp';

describe('runAcp', () => {
  it('suppresses a persisted ACP session id for a fresh DSH side-chat reconnect', () => {
    expect(resolveAcpResumeSessionId(undefined, 'old-dsh-session', true)).toBeUndefined();
    expect(resolveAcpResumeSessionId(undefined, 'grok-session', false)).toBe('grok-session');
    expect(resolveAcpResumeSessionId('explicit-grok-session', 'persisted-grok-session', false))
      .toBe('explicit-grok-session');
  });
  const stripAnsi = (line: string) => line.replace(/\u001b\[[0-9;]*m/g, '');
  const stripLogPrefix = (line: string) => stripAnsi(line).replace(/^\[\d{2}:\d{2}\] /, '');
  const consoleLines = () => mocks.mockConsoleLog.mock.calls
    .map((args) => args.map((arg) => String(arg)).join(' '))
    .map(stripLogPrefix);
  const dshModelCode = (provider: string, model: string) => JSON.stringify([provider, model]);
  const dshConfigUpdate = (overrides?: { currentModel?: string; modelOptions?: Array<{ value: string; name: string }> }) => ({
    type: 'event',
    name: 'config_options_update',
    payload: {
      configOptions: [
        {
          type: 'select',
          id: 'model',
          name: 'Model',
          category: 'model',
          currentValue: overrides?.currentModel ?? dshModelCode('deepseek-official', 'deepseek-v4-flash'),
          options: overrides?.modelOptions ?? [
            { value: dshModelCode('deepseek-official', 'deepseek-v4-flash'), name: 'DeepSeek V4 Flash' },
            { value: dshModelCode('deepseek-official', 'deepseek-v4-pro'), name: 'DeepSeek V4 Pro' },
          ],
        },
        {
          type: 'select',
          id: 'reasoning_effort',
          name: 'Reasoning Effort',
          category: 'thought_level',
          currentValue: 'high',
          options: [
            { value: 'off', name: 'Off' },
            { value: 'low', name: 'Low' },
            { value: 'high', name: 'High' },
            { value: 'max', name: 'Max' },
          ],
        },
      ],
    },
  });

  it('replaces an ambient dsh permission mode and removes it when no launch selection exists', () => {
    expect(dshChildEnvironment({ DSH_PERMISSION_MODE: 'danger-full-access', PATH: '/bin' }, 'read-only')).toEqual({
      DSH_PERMISSION_MODE: 'read-only',
      PATH: '/bin',
    });
    expect(dshChildEnvironment({ DSH_PERMISSION_MODE: 'danger-full-access', PATH: '/bin' }, undefined)).toEqual({
      PATH: '/bin',
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionHandlers.clear();
    mocks.setUserMessageHandler(null);
    mocks.setKillHandler(null);
    mocks.backendState.listeners = [];
    mocks.backendState.prompts = [];
    mocks.backendState.setConfigOptionCalls = [];
    mocks.backendState.setConfigOptionResult = true;
    mocks.backendState.operations = [];
    mocks.backendState.setModeCalls = [];
    mocks.backendState.setModelCalls = [];
    mocks.backendState.startSessionMessages = [];
    mocks.backendState.startSessionCalls = 0;
    mocks.backendState.cancelCalls = [];
    mocks.backendState.disposeCalls = 0;
    mocks.backendState.constructorArgs = null;
    mocks.backendState.stopReason = 'end_turn';
    mocks.backendState.promptError = null;
    mocks.backendState.promptImageMessages = [];
    mocks.backendState.promptUsages = [];
    mocks.backendState.promptUsageInMeta = false;
    mocks.backendState.usageCosts = [];
    mocks.backendState.usageCostTrailingEmpty = false;
    mocks.lifecycleEvents.length = 0;

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

  it('uploads ACP output images once, in turn order, through encrypted agent attachments', async () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1]);
    const secondJpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 2]);
    const providerPath = '/provider/session/images/5.jpg';
    const readCallId = 'read-generated-image';
    const imageMessage = {
      type: 'model-output-image',
      data: jpeg,
      mimeType: 'image/jpeg',
      name: 'acp-tool-read-generated-image-1.jpg',
      sourceCallId: readCallId,
    };
    mocks.backendState.promptImageMessages = [
      {
        type: 'tool-call',
        toolName: 'other',
        args: { variant: 'ImageEdit' },
        callId: 'edit-generated-image',
      },
      {
        type: 'tool-result',
        toolName: 'other',
        result: {
          type: 'ImageEdit',
          path: providerPath,
          filename: '5.jpg',
          session_folder: '.private-content/images',
        },
        callId: 'edit-generated-image',
      },
      {
        type: 'tool-call',
        toolName: 'read',
        args: { variant: 'ReadFile', target_file: providerPath },
        callId: readCallId,
      },
      {
        type: 'tool-result',
        toolName: 'read',
        result: { type: 'ReadFile' },
        callId: readCallId,
      },
      imageMessage,
      imageMessage,
      { ...imageMessage, data: secondJpeg, name: 'images/provider.jpg', sourceUri: 'images/provider.jpg' },
      { ...imageMessage, name: 'images/6.jpg', sourceCallId: undefined },
    ];

    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'grok',
      command: 'grok',
      args: ['--no-auto-update', 'agent', 'stdio'],
    });

    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));
    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Generate one image' },
    });

    await vi.waitFor(() => expect(mocks.mockSession.uploadImageAttachmentEnvelope).toHaveBeenCalledTimes(2));
    expect(mocks.mockSession.uploadImageAttachmentEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({ name: '.private-content/images/5.jpg', mimeType: 'image/jpeg', data: jpeg }),
      'agent',
      expect.objectContaining({ turn: expect.any(String), time: expect.any(Number) }),
    );
    expect(mocks.mockSession.uploadImageAttachmentEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'images/provider.jpg' }),
      'agent',
      expect.any(Object),
    );
    expect(mocks.mockSession.uploadImageAttachmentEnvelope).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'images/6.jpg' }),
      expect.anything(),
      expect.anything(),
    );

    await mocks.getKillHandler()!();
    await runPromise;

    const envelopeTypes = mocks.mockSession.sendSessionProtocolMessage.mock.calls.map(([envelope]) => envelope.ev.t);
    expect(envelopeTypes).toEqual([
      'turn-start',
      'text',
      'tool-call-start',
      'tool-call-end',
      'tool-call-start',
      'tool-call-end',
      'tool-call-start',
      'tool-call-end',
      'file',
      'file',
      'turn-end',
    ]);
  });

  it('keeps exact tool image names when an unsourced direct image arrives first', async () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1]);
    mocks.backendState.promptImageMessages = [
      {
        type: 'model-output-image',
        data: jpeg,
        mimeType: 'image/jpeg',
        name: 'acp-message-1.jpg',
      },
      {
        type: 'model-output-image',
        data: jpeg,
        mimeType: 'image/jpeg',
        name: 'images/first.jpg',
        sourceCallId: 'first-tool',
        sourceUri: 'images/first.jpg',
      },
      {
        type: 'model-output-image',
        data: jpeg,
        mimeType: 'image/jpeg',
        name: 'images/independent.jpg',
        sourceCallId: 'second-tool',
        sourceUri: 'images/independent.jpg',
      },
    ];

    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'grok',
      command: 'grok',
      args: ['--no-auto-update', 'agent', 'stdio'],
    });

    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));
    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Generate images' },
    });

    await vi.waitFor(() => expect(mocks.mockSession.uploadImageAttachmentEnvelope).toHaveBeenCalledTimes(3));
    expect(mocks.mockSession.uploadImageAttachmentEnvelope).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: 'acp-message-1.jpg' }),
      'agent',
      expect.any(Object),
    );
    expect(mocks.mockSession.uploadImageAttachmentEnvelope).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: 'images/first.jpg' }),
      'agent',
      expect.any(Object),
    );
    expect(mocks.mockSession.uploadImageAttachmentEnvelope).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ name: 'images/independent.jpg' }),
      'agent',
      expect.any(Object),
    );

    await mocks.getKillHandler()!();
    await runPromise;
  });

  it('does not log encrypted upload payloads when an attachment upload fails', async () => {
    const sentinel = 'PRIVATE_ENCRYPTED_UPLOAD_SENTINEL';
    mocks.mockSession.uploadImageAttachmentEnvelope.mockRejectedValueOnce(Object.assign(
      new Error('upload failed'),
      { code: 'EUPLOAD', response: { status: 503 }, config: { data: sentinel } },
    ));
    mocks.backendState.promptImageMessages = [{
      type: 'model-output-image',
      data: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1]),
      mimeType: 'image/jpeg',
      name: 'images/failed.jpg',
    }];

    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'grok',
      command: 'grok',
      args: ['--no-auto-update', 'agent', 'stdio'],
    });

    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));
    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Generate one image' },
    });
    await vi.waitFor(() => expect(mocks.mockLoggerDebug).toHaveBeenCalledWith(
      '[grok] Failed to upload ACP agent output image',
      expect.objectContaining({ error: expect.objectContaining({ code: 'EUPLOAD', status: 503 }) }),
    ));

    expect(JSON.stringify(mocks.mockLoggerDebug.mock.calls)).not.toContain(sentinel);
    await mocks.getKillHandler()!();
    await runPromise;
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

  it('passes the stable Grok runtime home to the child while retaining the provider session id', async () => {
    vi.stubEnv('GROK_HOME', '/runtime/grok');

    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'grok',
      command: 'grok',
      args: ['--no-auto-update', 'agent', 'stdio'],
      resumeSessionId: 'grok-provider-session',
    });

    await vi.waitFor(() => expect(mocks.backendState.startSessionCalls).toBe(1));
    expect(mocks.backendState.constructorArgs.processEnv).toMatchObject({
      GROK_HOME: '/runtime/grok',
    });
    expect(mocks.backendState.constructorArgs.resumeSessionId).toBe('grok-provider-session');

    await mocks.getKillHandler()!();
    await runPromise;
    expect(mocks.lifecycleEvents).toEqual(['persist', 'dispose']);
  });

  it('persists ACP session/resume separately from legacy session/load', async () => {
    mocks.backendState.startSessionMessages = [
      {
        type: 'event',
        name: 'initialize_response',
        payload: {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: false,
            sessionCapabilities: { resume: {} },
            promptCapabilities: { image: false },
          },
        },
      },
      dshConfigUpdate(),
    ];

    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'dsh',
      command: 'dsh',
      args: ['--profile', 'acp'],
    });

    await vi.waitFor(() => expect(mocks.mockSession.updateMetadata).toHaveBeenCalled());
    const updatedMetadata = mocks.mockSession.updateMetadata.mock.calls
      .map(([update]) => update({}))
      .find((value) => value.acpCapabilities !== undefined);
    expect(updatedMetadata).toMatchObject({
      acpCapabilities: {
        loadSession: false,
        resumeSession: true,
        prompt: { image: false },
      },
    });

    await vi.waitFor(() => expect(mocks.getKillHandler()).toBeTypeOf('function'));
    await mocks.getKillHandler()!();
    await runPromise;
  });

  it('persists refreshed Grok auth before reporting a hard limit and again during cleanup', async () => {
    mocks.backendState.promptError = Object.assign(new Error('rate limit exceeded'), { status: 429 });
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'grok',
      command: 'grok',
      args: ['--no-auto-update', 'agent', 'stdio'],
    });
    const outcome = runPromise.then(
      () => null,
      (error: unknown) => error,
    );

    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));
    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Trigger the provider limit' },
    });

    await expect(outcome).resolves.toMatchObject({ message: 'rate limit exceeded' });
    expect(mocks.mockReportProviderHardLimitOnce).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      provider: 'grok',
    }));
    expect(mocks.lifecycleEvents).toEqual(['persist', 'report', 'persist', 'dispose']);
  });

  it('reports a dsh quota failure without invoking Grok credential persistence', async () => {
    mocks.backendState.promptError = new Error('quota exhausted');
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'dsh',
      command: 'dsh',
      args: ['--profile', 'acp'],
    });
    const outcome = runPromise.then(
      () => null,
      (error: unknown) => error,
    );

    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));
    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Trigger the provider limit' },
    });

    await expect(outcome).resolves.toMatchObject({ message: 'quota exhausted' });
    expect(mocks.mockReportProviderHardLimitOnce).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      provider: 'dsh',
    }));
    expect(mocks.mockPersistActiveGrokCredential).not.toHaveBeenCalled();
    expect(mocks.lifecycleEvents).toEqual(['report', 'dispose']);
  });

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

  it('executes a seeded DSH side-chat turn without loading the retired provider session', async () => {
    vi.stubEnv('HAPPY_RECONNECT_SESSION_ID', 'dsh-side-chat');
    vi.stubEnv('HAPPY_RECONNECT_ENCRYPTION_KEY', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    vi.stubEnv('HAPPY_RECONNECT_ENCRYPTION_VARIANT', 'legacy');
    vi.stubEnv('HAPPY_RECONNECT_SEQ', '12');
    vi.stubEnv('HAPPY_RECONNECT_METADATA_VERSION', '4');
    vi.stubEnv('HAPPY_RECONNECT_AGENT_STATE_VERSION', '5');
    vi.stubEnv('HAPPY_RECONNECT_QUEUE_MESSAGE_ID', 'dsh-resume-seed');
    vi.stubEnv('HAPPYHERD_FRESH_PROVIDER_RECONNECT', '1');
    mocks.mockRefreshSessionForReconnect.mockResolvedValueOnce({
      id: 'dsh-side-chat',
      metadata: { flavor: 'dsh', acpSessionId: 'old-dsh-provider-session' },
      agentState: {
        messageQueue: {
          currentMessageIds: ['interrupted'],
          pendingMessageIds: ['pending'],
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
      agentName: 'dsh',
      command: 'dsh',
      args: ['acp'],
      startedBy: 'daemon',
    });

    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));
    expect(mocks.backendState.constructorArgs.resumeSessionId).toBeUndefined();
    expect(mocks.mockSession.skipExistingMessages).toHaveBeenCalledWith(
      ['interrupted', 'pending', 'dsh-resume-seed'],
      12,
      'dsh-resume-seed',
    );
    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Interrupted work' },
      localKey: 'interrupted',
      meta: { deliveryMode: 'queue', queueMessageId: 'interrupted' },
    });
    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Pending work' },
      localKey: 'pending',
      meta: { deliveryMode: 'queue', queueMessageId: 'pending' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.backendState.prompts).toEqual([]);
    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Continue with the bounded DSH context' },
      localKey: 'dsh-resume-seed',
      meta: { deliveryMode: 'queue', queueMessageId: 'dsh-resume-seed' },
    });

    await vi.waitFor(() => expect(mocks.backendState.prompts).toEqual([
      {
        sessionId: 'acp-session-1',
        prompt: 'Continue with the bounded DSH context',
      },
      {
        sessionId: 'acp-session-1',
        prompt: 'Interrupted work\nPending work',
      },
    ]));
    await vi.waitFor(() => {
      const latestStateUpdate = mocks.mockSession.updateAgentState.mock.calls.at(-1)?.[0];
      expect(latestStateUpdate?.({})).toMatchObject({
        messageQueue: { pendingMessageIds: [], currentMessageIds: [] },
      });
    });
    const providerSessionUpdate = mocks.mockSession.updateMetadata.mock.calls
      .map(([update]) => update({ acpSessionId: 'old-dsh-provider-session' }))
      .find((updated) => updated.acpSessionId === 'provider-session-1');
    expect(providerSessionUpdate).toMatchObject({ acpSessionId: 'provider-session-1' });
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

  it('validates the default dsh model and effort without mutating provider config', async () => {
    vi.stubEnv('DSH_PERMISSION_MODE', 'danger-full-access');
    mocks.backendState.startSessionMessages = [dshConfigUpdate()];
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'dsh',
      command: 'dsh',
      args: ['--profile', 'acp'],
      startedBy: 'terminal',
      permissionMode: 'workspace-write',
      model: 'deepseek-v4-flash',
      effort: 'high',
    });
    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));
    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Use the dsh defaults' },
    });
    await vi.waitFor(() => expect(mocks.backendState.prompts).toHaveLength(1));
    expect(mocks.backendState.operations).toEqual(['prompt']);
    expect(mocks.backendState.setModeCalls).toEqual([]);
    expect(mocks.mockGetOrCreateSession).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        flavor: 'dsh',
        spawnSettings: {
          provider: 'dsh',
          model: 'deepseek-v4-flash',
          effort: 'high',
          permission: 'workspace-write',
        },
      }),
    }));
    expect(mocks.backendState.constructorArgs).toMatchObject({
      command: 'dsh',
      args: ['--profile', 'acp'],
      processEnv: expect.objectContaining({ DSH_PERMISSION_MODE: 'workspace-write' }),
    });
    await mocks.getKillHandler()!();
    await runPromise;
  });

  it('applies exact opaque dsh model and effort values before the first prompt', async () => {
    const officialPro = dshModelCode('deepseek-official', 'deepseek-v4-pro');
    mocks.backendState.startSessionMessages = [dshConfigUpdate({
      modelOptions: [
        { value: 'malformed-provider-value', name: 'Malformed' },
        { value: dshModelCode('third-party', 'deepseek-v4-pro'), name: 'DeepSeek V4 Pro' },
        { value: officialPro, name: 'DeepSeek V4 Pro' },
        { value: dshModelCode('deepseek-official', 'deepseek-v4-flash'), name: 'DeepSeek V4 Flash' },
      ],
    })];
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'dsh',
      command: 'dsh',
      args: ['--profile', 'acp'],
      model: 'deepseek-v4-pro',
      effort: 'max',
    });
    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));
    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Use pro with maximum reasoning' },
    });
    await vi.waitFor(() => expect(mocks.backendState.prompts).toHaveLength(1));
    expect(mocks.backendState.operations).toEqual([
      `config:model:${officialPro}`,
      'config:reasoning_effort:max',
      'prompt',
    ]);
    expect(mocks.backendState.setModeCalls).toEqual([]);
    await mocks.getKillHandler()!();
    await runPromise;
  });

  it('ignores message-time dsh permission metadata while preserving launch-time policy', async () => {
    mocks.backendState.startSessionMessages = [dshConfigUpdate()];
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'dsh',
      command: 'dsh',
      args: ['--profile', 'acp'],
      permissionMode: 'read-only',
      model: 'deepseek-v4-flash',
      effort: 'high',
    });
    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));
    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Do not reinterpret model as mode' },
      meta: { permissionMode: 'danger-full-access' },
    });
    await vi.waitFor(() => expect(mocks.backendState.prompts).toHaveLength(1));
    expect(mocks.backendState.setConfigOptionCalls).toEqual([]);
    expect(mocks.backendState.constructorArgs.processEnv.DSH_PERMISSION_MODE).toBe('read-only');
    await mocks.getKillHandler()!();
    await runPromise;
  });

  it('fails a rejected dsh config change before prompting', async () => {
    mocks.backendState.startSessionMessages = [dshConfigUpdate()];
    mocks.backendState.setConfigOptionResult = false;
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'dsh',
      command: 'dsh',
      args: ['--profile', 'acp'],
      model: 'deepseek-v4-pro',
      effort: 'max',
    });
    const outcome = runPromise.then(() => null, (error: unknown) => error);
    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));
    mocks.getUserMessageHandler()!({ role: 'user', content: { type: 'text', text: 'Must not run' } });
    await expect(outcome).resolves.toMatchObject({ message: 'dsh rejected model: deepseek-v4-pro' });
    expect(mocks.backendState.prompts).toEqual([]);
  });

  it('fails an unknown dsh model before prompting', async () => {
    mocks.backendState.startSessionMessages = [dshConfigUpdate()];
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'dsh',
      command: 'dsh',
      args: ['--profile', 'acp'],
      model: 'deepseek-v4-unknown',
      effort: 'high',
    });
    const outcome = runPromise.then(() => null, (error: unknown) => error);
    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));
    mocks.getUserMessageHandler()!({ role: 'user', content: { type: 'text', text: 'Must not run' } });
    await expect(outcome).resolves.toMatchObject({ message: 'Unsupported dsh model: deepseek-v4-unknown' });
    expect(mocks.backendState.prompts).toEqual([]);
  });

  it('fails closed when the live dsh session drops explicit config categories', async () => {
    const update = dshConfigUpdate();
    delete (update.payload.configOptions[0] as { category?: string }).category;
    delete (update.payload.configOptions[1] as { category?: string }).category;
    mocks.backendState.startSessionMessages = [update];
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'dsh',
      command: 'dsh',
      args: ['--profile', 'acp'],
      model: 'deepseek-v4-flash',
      effort: 'high',
    });
    const outcome = runPromise.then(() => null, (error: unknown) => error);
    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));
    mocks.getUserMessageHandler()!({ role: 'user', content: { type: 'text', text: 'Must not run' } });
    await expect(outcome).resolves.toMatchObject({ message: 'dsh did not advertise a model config option' });
    expect(mocks.backendState.prompts).toEqual([]);
  });

  it('ignores malformed dsh model values and prefers the official provider tuple', () => {
    const official = dshModelCode('deepseek-official', 'deepseek-v4-pro');
    expect(resolveDshModelConfigCode([
      { code: 'not-json', value: 'DeepSeek V4 Pro' },
      { code: JSON.stringify(['too-short']), value: 'DeepSeek V4 Pro' },
      { code: JSON.stringify(['third-party', 'deepseek-v4-pro']), value: 'DeepSeek V4 Pro' },
      { code: official, value: 'DeepSeek V4 Pro' },
    ], 'deepseek-v4-pro')).toBe(official);
    expect(resolveDshModelConfigCode([
      { code: 'not-json', value: 'deepseek-v4-unknown' },
    ], 'deepseek-v4-unknown')).toBeNull();
    expect(resolveDshModelConfigCode([
      { code: dshModelCode('third-party', 'deepseek-v4-pro'), value: 'DeepSeek V4 Pro' },
    ], 'deepseek-v4-pro')).toBeNull();
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

  it('reports Grok current-prompt usage from _meta and cumulative cost as per-turn deltas', async () => {
    mocks.backendState.promptUsages = [
      { totalTokens: 100, inputTokens: 80, outputTokens: 20 },
      { totalTokens: 145, inputTokens: 110, outputTokens: 35 },
    ];
    mocks.backendState.usageCosts = [
      { amount: 0.25, currency: 'USD' },
      { amount: 0.30, currency: 'USD' },
    ];
    mocks.backendState.promptUsageInMeta = true;
    mocks.backendState.usageCostTrailingEmpty = true;
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'grok',
      command: 'grok',
      args: ['--no-auto-update', 'agent', 'stdio'],
    });
    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));

    mocks.getUserMessageHandler()!({ role: 'user', content: { type: 'text', text: 'First' } });
    await vi.waitFor(() => expect(mocks.mockSession.sendProviderUsageReport).toHaveBeenCalledTimes(1));
    mocks.getUserMessageHandler()!({ role: 'user', content: { type: 'text', text: 'Second' } });
    await vi.waitFor(() => expect(mocks.mockSession.sendProviderUsageReport).toHaveBeenCalledTimes(2));

    await mocks.getKillHandler()!();
    await runPromise;

    expect(mocks.mockSession.sendProviderUsageReport.mock.calls[0][0]).toEqual(expect.objectContaining({
      provider: 'grok',
      tokens: expect.objectContaining({ total: 100, input: 80, output: 20 }),
      cost: { total: 0.25 },
      costBasis: 'provider-reported',
    }));
    expect(mocks.mockSession.sendProviderUsageReport.mock.calls[1][0]).toEqual(expect.objectContaining({
        provider: 'grok',
      tokens: expect.objectContaining({ total: 145, input: 110, output: 35 }),
      cost: { total: expect.any(Number) },
      costBasis: 'provider-reported',
    }));
    expect(mocks.mockSession.sendProviderUsageReport.mock.calls[1][0].cost.total).toBeCloseTo(0.05);
  });

  it('resumes Grok cumulative cost from the durable provider-session cursor', async () => {
    mocks.mockSession.getAgentState.mockReturnValueOnce({
      usageCursors: { acpCostUsd: { 'provider-session-1': 0.30 } },
    });
    mocks.backendState.promptUsages = [{ totalTokens: 50, inputTokens: 40, outputTokens: 10 }];
    mocks.backendState.usageCosts = [{ amount: 0.35, currency: 'USD' }];
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'grok',
      command: 'grok',
      args: ['--no-auto-update', 'agent', 'stdio'],
    });
    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));
    mocks.getUserMessageHandler()!({ role: 'user', content: { type: 'text', text: 'Resumed turn' } });
    await vi.waitFor(() => expect(mocks.mockSession.sendProviderUsageReport).toHaveBeenCalledOnce());
    await mocks.getKillHandler()!();
    await runPromise;

    expect(mocks.mockSession.sendProviderUsageReport.mock.calls[0][0].cost.total).toBeCloseTo(0.05);
    const mutateAgentState = mocks.mockSession.sendProviderUsageReport.mock.calls[0][1]?.mutateAgentState;
    expect(mutateAgentState).toBeTypeOf('function');
    const stateWithCursor = mutateAgentState!({});
    expect(stateWithCursor.usageCursors.acpCostUsd['provider-session-1']).toBe(0.35);
  });

  it('records an explicit provider limitation when an ACP prompt fails', async () => {
    mocks.backendState.promptError = new Error('provider failed after prompt start');
    const runPromise = runAcp({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      agentName: 'dsh',
      command: 'dsh',
      args: ['acp'],
    });
    await vi.waitFor(() => expect(mocks.getUserMessageHandler()).toBeTypeOf('function'));
    mocks.getUserMessageHandler()!({ role: 'user', content: { type: 'text', text: 'Fail' } });

    await expect(runPromise).rejects.toThrow('provider failed after prompt start');
    expect(mocks.mockSession.sendProviderUsageReport).toHaveBeenCalledTimes(1);
    expect(mocks.mockSession.sendProviderUsageReport.mock.calls[0][0]).toMatchObject({
      provider: 'dsh',
      tokensAvailable: false,
      costAvailable: false,
      limitations: ['tokens-not-reported-by-provider', 'cost-not-reported-by-provider'],
    });
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

  it('rejects an unknown ACP permission mode instead of running under the previous mode', async () => {
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

    await vi.waitFor(() => expect(mocks.mockSession.sendSessionEvent).toHaveBeenCalledWith({
      type: 'message',
      message: 'Unsupported opencode permission mode: invalid-mode',
    }));

    await mocks.getKillHandler()!();
    await runPromise;

    expect(mocks.backendState.prompts).toEqual([]);
    expect(mocks.backendState.setConfigOptionCalls).toEqual([]);
    expect(mocks.backendState.setModeCalls).toEqual([]);
    expect(mocks.backendState.setModelCalls).toEqual([]);
  });
});
