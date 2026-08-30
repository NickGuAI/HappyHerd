import { afterEach, describe, expect, it, vi } from 'vitest';
import { HAPPYHERD_MACHINE_SESSION_SETTINGS_ENV } from '@slopus/happy-wire';

const mocks = vi.hoisted(() => {
    const events: string[] = [];
    let metadata: Record<string, unknown> = {};
    let agentState: Record<string, unknown> = { controlledByUser: false };
    let eventHandler: ((message: Record<string, unknown>) => void) | null = null;
    let approvalHandler: ((params: Record<string, unknown>) => Promise<string>) | null = null;
    let requestInteractiveApproval = false;
    const permissionHandleToolCall = vi.fn(async () => ({ decision: 'approved' }));
    const startThreadCalls: Array<Record<string, unknown>> = [];
    const resumeThreadCalls: Array<Record<string, unknown>> = [];
    const sendTurnCalls: Array<Record<string, unknown>> = [];

    const session = {
        sessionId: 'session-one',
        rpcHandlerManager: { registerHandler: vi.fn() },
        onFileEvent: vi.fn(),
        onUserMessage: vi.fn(),
        trackAttachmentDownload: vi.fn(),
        drainAttachmentsForUserMessage: vi.fn().mockResolvedValue([]),
        uploadLocalImageAttachmentEnvelope: vi.fn(),
        suppressNextArchiveSignal: vi.fn(),
        skipExistingMessages: vi.fn(),
        keepAlive: vi.fn(),
        sendSessionEvent: vi.fn(),
        sendSessionProtocolMessage: vi.fn(),
        getMetadata: vi.fn(() => metadata),
        updateAgentState: vi.fn((update: (current: Record<string, unknown>) => Record<string, unknown>) => {
            agentState = update(agentState);
        }),
        updateMetadata: vi.fn(async (update: (current: Record<string, unknown>) => Record<string, unknown>) => {
            metadata = update(metadata);
            const outcome = metadata.automationProviderOutcome as { status?: string } | undefined;
            if (outcome?.status) events.push(`outcome:${outcome.status}`);
        }),
        sendSessionDeath: vi.fn(() => events.push('session-death')),
        flush: vi.fn(async () => { events.push('flush'); }),
        close: vi.fn(async () => { events.push('session-close'); }),
    };

    return {
        events,
        session,
        setMetadata(value: Record<string, unknown>) {
            metadata = value;
        },
        getMetadata() {
            return metadata;
        },
        setEventHandler(handler: (message: Record<string, unknown>) => void) {
            eventHandler = handler;
        },
        emitCompleted() {
            eventHandler?.({
                type: 'task_complete',
                provider_terminal: true,
            });
        },
        setApprovalHandler(handler: (params: Record<string, unknown>) => Promise<string>) {
            approvalHandler = handler;
        },
        requestInteractiveApproval(value: boolean) {
            requestInteractiveApproval = value;
        },
        async maybeRequestInteractiveApproval() {
            if (!requestInteractiveApproval || !approvalHandler) return null;
            return approvalHandler({
                type: 'exec',
                callId: 'approval-one',
                command: 'printf smoke',
                cwd: '/srv/app',
            });
        },
        resetRuntime() {
            requestInteractiveApproval = false;
            approvalHandler = null;
            permissionHandleToolCall.mockClear();
            startThreadCalls.length = 0;
            resumeThreadCalls.length = 0;
            sendTurnCalls.length = 0;
        },
        permissionHandleToolCall,
        startThreadCalls,
        resumeThreadCalls,
        sendTurnCalls,
    };
});

vi.mock('node:child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:child_process')>();
    return {
        ...actual,
        execSync: vi.fn(() => 'codex-cli 1.0.0'),
    };
});

vi.mock('@/api/api', () => ({
    ApiClient: {
        create: vi.fn(async () => ({
            getOrCreateMachine: vi.fn(),
            getOrCreateSession: vi.fn(async ({ metadata, state }) => ({
                id: 'session-one',
                seq: 0,
                encryptionKey: new Uint8Array(32),
                encryptionVariant: 'dataKey',
                metadata,
                metadataVersion: 0,
                agentState: state,
                agentStateVersion: 0,
            })),
            refreshSessionForReconnect: vi.fn(async (session) => session),
            push: vi.fn(() => ({ sendSessionNotification: vi.fn() })),
        })),
    },
}));

vi.mock('@/persistence', () => ({
    readSettings: vi.fn(async () => ({ machineId: 'machine-one' })),
}));

vi.mock('@/daemon/run', () => ({
    initialMachineMetadata: {},
}));

vi.mock('@/utils/createSessionMetadata', () => ({
    createSessionMetadata: vi.fn((options: { spawnSettings?: Record<string, unknown> }) => {
        const metadata = {
            path: '/srv/app',
            host: 'host',
            homeDir: '/home/test',
            happyHomeDir: '/home/test/.happyherd',
            happyLibDir: '/srv/happy',
            happyToolsDir: '/srv/happy/tools',
            startedFromDaemon: true,
            hostPid: 42,
            flavor: 'codex',
            ...(options.spawnSettings ? { spawnSettings: options.spawnSettings } : {}),
        };
        mocks.setMetadata(metadata);
        return {
            state: { controlledByUser: false },
            metadata,
        };
    }),
}));

vi.mock('@/utils/setupOfflineReconnection', () => ({
    setupOfflineReconnection: vi.fn(() => ({
        session: mocks.session,
        reconnectionHandle: null,
        isOffline: false,
    })),
}));

vi.mock('@/daemon/controlClient', () => ({
    notifyDaemonSessionStarted: vi.fn(async () => ({})),
}));

vi.mock('@/agentContext/commanderContext', () => ({
    readContextPromptFromEnvironment: vi.fn(async () => null),
    instructionReceiptMetadata: vi.fn(() => ({})),
}));

vi.mock('@/automations/sessionBootstrap', () => ({
    readAutomationBootstrapFromEnvironment: vi.fn(async () => ({
        schemaVersion: 1,
        automationId: '11111111-1111-4111-8111-111111111111',
        runId: '22222222-2222-4222-8222-222222222222',
        kind: 'scheduled',
        instruction: 'Deliver the automation task.',
    })),
}));

vi.mock('@/claude/utils/startHappyServer', () => ({
    startHappyServer: vi.fn(async () => ({
        url: 'http://127.0.0.1:1234',
        stop: vi.fn(() => mocks.events.push('mcp-stop')),
    })),
}));

vi.mock('./codexSkills', () => ({
    discoverCodexSkillCommands: vi.fn(async () => []),
}));

vi.mock('./agentMcpConfig', () => ({
    readHappyHerdAgentSessionEnvironment: vi.fn(() => null),
    buildHappyHerdAgentMcpServerConfig: vi.fn(() => null),
}));

vi.mock('./utils/permissionHandler', () => ({
    CodexPermissionHandler: class {
        reset = vi.fn();
        abortAll = vi.fn();
        handleToolCall = mocks.permissionHandleToolCall;
        updateSession = vi.fn();
    },
}));

vi.mock('./utils/reasoningProcessor', () => ({
    ReasoningProcessor: class {
        abort = vi.fn();
        handleSectionBreak = vi.fn();
        processDelta = vi.fn();
        complete = vi.fn();
    },
}));

vi.mock('./utils/diffProcessor', () => ({
    DiffProcessor: class {
        reset = vi.fn();
        processDiff = vi.fn();
    },
}));

vi.mock('./utils/sessionProtocolMapper', () => ({
    mapCodexProcessorMessageToSessionEnvelopes: vi.fn(() => ({ envelopes: [] })),
    mapCodexMcpMessageToSessionEnvelopes: vi.fn((_message, state) => ({
        ...state,
        envelopes: [],
    })),
}));

vi.mock('./codexAppServerClient', () => ({
    CodexAppServerClient: class {
        sandboxEnabled = false;
        threadId: string | null = null;

        setApprovalHandler = vi.fn((handler: (params: Record<string, unknown>) => Promise<string>) => {
            mocks.setApprovalHandler(handler);
        });
        setEventHandler = vi.fn((handler: (message: Record<string, unknown>) => void) => {
            mocks.setEventHandler(handler);
        });
        connect = vi.fn(async () => undefined);
        listModels = vi.fn(async () => []);
        supportsGoalActions = vi.fn(() => false);
        hasActiveThread = vi.fn(() => this.threadId !== null);
        startThread = vi.fn(async (options: Record<string, unknown>) => {
            mocks.startThreadCalls.push(options);
            this.threadId = 'thread-one';
            return { threadId: this.threadId };
        });
        resumeThread = vi.fn(async (options: Record<string, unknown>) => {
            mocks.resumeThreadCalls.push(options);
            this.threadId = String(options.threadId);
            return { threadId: this.threadId, model: String(options.model) };
        });
        sendTurnAndWait = vi.fn(async (_prompt: unknown, options: Record<string, unknown>) => {
            mocks.sendTurnCalls.push(options);
            const decision = await mocks.maybeRequestInteractiveApproval();
            if (decision) {
                mocks.events.push(`approval:${decision}`);
                return { aborted: true };
            }
            mocks.emitCompleted();
            return { aborted: false };
        });
        disconnect = vi.fn(async () => {
            mocks.events.push('client-disconnect');
        });
    },
}));

import { runCodex } from './runCodex';

describe('runCodex automation process lifecycle', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        mocks.events.length = 0;
        mocks.resetRuntime();
        delete process.env.HAPPY_RECONNECT_SESSION_ID;
        delete process.env.HAPPY_RECONNECT_ENCRYPTION_KEY;
        delete process.env.HAPPY_RECONNECT_ENCRYPTION_VARIANT;
        delete process.env.HAPPY_RECONNECT_QUEUE_MESSAGE_ID;
        delete process.env[HAPPYHERD_MACHINE_SESSION_SETTINGS_ENV];
    });

    it('persists completion, finalizes the session, then exits with the terminal status', async () => {
        const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            mocks.events.push(`exit:${code}`);
            return undefined;
        }) as never);

        await runCodex({
            credentials: { token: 'test-token' } as never,
            startedBy: 'daemon',
        });

        expect(mocks.getMetadata().automationProviderOutcome).toMatchObject({
            automationId: '11111111-1111-4111-8111-111111111111',
            runId: '22222222-2222-4222-8222-222222222222',
            status: 'completed',
        });
        expect(mocks.getMetadata()).toMatchObject({
            permissionMode: 'yolo',
            modelMode: 'gpt-5.6-sol',
            effortLevel: 'max',
        });
        expect(exit).toHaveBeenCalledWith(0);
        expect(mocks.events).toEqual([
            'outcome:completed',
            'flush',
            'session-death',
            'flush',
            'session-close',
            'client-disconnect',
            'mcp-stop',
            'exit:0',
        ]);
    });

    it('publishes a non-default Codex launch receipt for the UI', async () => {
        vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

        await runCodex({
            credentials: { token: 'test-token' } as never,
            startedBy: 'daemon',
            permissionMode: 'safe-yolo',
            model: 'gpt-5.6-terra',
            effort: 'high',
        });

        expect(mocks.getMetadata()).toMatchObject({
            permissionMode: 'safe-yolo',
            modelMode: 'gpt-5.6-terra',
            effortLevel: 'high',
        });
    });

    it.each([
        ['first thread', undefined],
        ['resumed thread', 'provider-thread-existing'],
    ])('runs the %s with the target-daemon validated receipt tuple', async (_label, resumeThreadId) => {
        vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        process.env[HAPPYHERD_MACHINE_SESSION_SETTINGS_ENV] = JSON.stringify({
            provider: 'codex',
            permission: 'safe-yolo',
            model: 'target-codex-model',
            effort: 'high',
        });

        await runCodex({
            credentials: { token: 'test-token' } as never,
            startedBy: 'daemon',
            ...(resumeThreadId ? { resumeThreadId } : {}),
        });

        expect(mocks.getMetadata()).toMatchObject({
            spawnSettings: {
                provider: 'codex',
                permission: 'safe-yolo',
                model: 'target-codex-model',
                effort: 'high',
            },
            permissionMode: 'safe-yolo',
            modelMode: 'target-codex-model',
            effortLevel: 'high',
        });
        const threadSettings = resumeThreadId
            ? mocks.resumeThreadCalls[0]
            : mocks.startThreadCalls[0];
        expect(threadSettings).toMatchObject({
            model: 'target-codex-model',
            approvalPolicy: 'never',
            sandbox: 'workspace-write',
        });
        expect(mocks.sendTurnCalls[0]).toMatchObject({
            model: 'target-codex-model',
            effort: 'high',
            approvalPolicy: 'never',
            sandbox: 'workspace-write',
        });
    });

    it('replays the requested heartbeat occurrence when resuming the exact Codex session', async () => {
        vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        process.env.HAPPY_RECONNECT_SESSION_ID = 'session-one';
        process.env.HAPPY_RECONNECT_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
        process.env.HAPPY_RECONNECT_ENCRYPTION_VARIANT = 'dataKey';
        process.env.HAPPY_RECONNECT_QUEUE_MESSAGE_ID = 'heartbeat-occurrence';

        await runCodex({
            credentials: { token: 'test-token' } as never,
            startedBy: 'daemon',
        });

        expect(mocks.session.skipExistingMessages).toHaveBeenCalledWith(
            ['heartbeat-occurrence'],
            0,
        );
    });

    it('aborts an unexpected automation approval without publishing a pending request', async () => {
        mocks.requestInteractiveApproval(true);
        const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

        await runCodex({
            credentials: { token: 'test-token' } as never,
            startedBy: 'daemon',
            permissionMode: 'read-only',
        });

        expect(mocks.permissionHandleToolCall).not.toHaveBeenCalled();
        expect(mocks.events).toContain('approval:abort');
        expect(mocks.getMetadata().automationProviderOutcome).toMatchObject({
            status: 'failed',
            message: expect.stringContaining('requested interactive permission'),
        });
        expect(exit).toHaveBeenCalledWith(1);
    });
});
