import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const events: string[] = [];
    let metadata: Record<string, unknown> = {};
    let agentState: Record<string, unknown> = { controlledByUser: false };
    let eventHandler: ((message: Record<string, unknown>) => void) | null = null;

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
    createSessionMetadata: vi.fn(() => {
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
        handleToolCall = vi.fn(async () => ({ decision: 'approved' }));
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

        setApprovalHandler = vi.fn();
        setEventHandler = vi.fn((handler: (message: Record<string, unknown>) => void) => {
            mocks.setEventHandler(handler);
        });
        connect = vi.fn(async () => undefined);
        listModels = vi.fn(async () => []);
        supportsGoalActions = vi.fn(() => false);
        hasActiveThread = vi.fn(() => this.threadId !== null);
        startThread = vi.fn(async () => {
            this.threadId = 'thread-one';
            return { threadId: this.threadId };
        });
        sendTurnAndWait = vi.fn(async () => {
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
});
