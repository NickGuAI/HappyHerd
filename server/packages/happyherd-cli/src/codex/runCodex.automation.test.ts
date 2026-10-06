import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readContextPromptFromEnvironment, instructionReceiptMetadata } from '@/agentContext/commanderContext';
import { notifyDaemonSessionStarted } from '@/daemon/controlClient';
import { HAPPYHERD_MACHINE_SESSION_SETTINGS_ENV } from '@happyherd/wire';
import { MessageQueue2 } from '@/utils/MessageQueue2';

const mocks = vi.hoisted(() => {
    const events: string[] = [];
    let metadata: Record<string, unknown> = {};
    let agentState: Record<string, unknown> = { controlledByUser: false };
    let reconnectAgentState: Record<string, unknown> = { controlledByUser: false };
    let eventHandler: ((message: Record<string, unknown>) => void) | null = null;
    let approvalHandler: ((params: Record<string, unknown>) => Promise<string>) | null = null;
    let requestInteractiveApproval = false;
    let emitResumeAndTurnUsage = false;
    let contextMetadata: Record<string, unknown> = {};
    let refreshedSessionMetadata: Record<string, unknown> | undefined;
    let failContextInjection = false;
    let automationInstruction = 'Deliver the automation task.';
    const permissionHandleToolCall = vi.fn(async () => ({ decision: 'approved' }));
    const startThreadCalls: Array<Record<string, unknown>> = [];
    const resumeThreadCalls: Array<Record<string, unknown>> = [];
    const injectDeveloperInstructionsCalls: Array<Record<string, unknown>> = [];
    const sendTurnCalls: Array<Record<string, unknown>> = [];
    const sessionCreationMetadataCalls: Array<Record<string, unknown>> = [];
    const contextBeforeInjectionCalls: Array<Record<string, unknown>> = [];

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
        sendProviderUsageReport: vi.fn(async (_report: unknown, options?: { onDurable?: () => void }) => {
            options?.onDurable?.();
        }),
        getMetadata: vi.fn(() => metadata),
        getAgentState: vi.fn(() => agentState),
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
        setContextMetadata(value: Record<string, unknown>) { contextMetadata = value; },
        getContextMetadata() { return contextMetadata; },
        setRefreshedSessionMetadata(value: Record<string, unknown>) { refreshedSessionMetadata = value; },
        getRefreshedSessionMetadata(fallback: Record<string, unknown>) { return refreshedSessionMetadata ?? fallback; },
        setFailContextInjection(value: boolean) { failContextInjection = value; },
        shouldFailContextInjection() { return failContextInjection; },
        setAutomationInstruction(value: string) { automationInstruction = value; },
        getAutomationInstruction() { return automationInstruction; },
        setAgentState(value: Record<string, unknown>) {
            agentState = value;
        },
        setReconnectAgentState(value: Record<string, unknown>) {
            reconnectAgentState = value;
        },
        getReconnectAgentState() {
            return reconnectAgentState;
        },
        setEventHandler(handler: (message: Record<string, unknown>) => void) {
            eventHandler = handler;
        },
        emitCompleted(turnId?: string) {
            eventHandler?.({
                type: 'task_complete',
                provider_terminal: true,
                ...(turnId ? { turn_id: turnId } : {}),
            });
        },
        emitEvent(message: Record<string, unknown>) {
            eventHandler?.(message);
        },
        setEmitResumeAndTurnUsage(value: boolean) {
            emitResumeAndTurnUsage = value;
        },
        shouldEmitResumeAndTurnUsage() {
            return emitResumeAndTurnUsage;
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
            emitResumeAndTurnUsage = false;
            contextMetadata = {};
            refreshedSessionMetadata = undefined;
            failContextInjection = false;
            automationInstruction = 'Deliver the automation task.';
            agentState = { controlledByUser: false };
            reconnectAgentState = { controlledByUser: false };
            approvalHandler = null;
            permissionHandleToolCall.mockClear();
            startThreadCalls.length = 0;
            resumeThreadCalls.length = 0;
            injectDeveloperInstructionsCalls.length = 0;
            sendTurnCalls.length = 0;
            sessionCreationMetadataCalls.length = 0;
            contextBeforeInjectionCalls.length = 0;
            session.sendProviderUsageReport.mockClear();
        },
        permissionHandleToolCall,
        startThreadCalls,
        resumeThreadCalls,
        injectDeveloperInstructionsCalls,
        sendTurnCalls,
        sessionCreationMetadataCalls,
        contextBeforeInjectionCalls,
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
            getOrCreateSession: vi.fn(async ({ metadata, state }) => {
                mocks.sessionCreationMetadataCalls.push({ ...metadata });
                return {
                    id: 'session-one',
                    seq: 0,
                    encryptionKey: new Uint8Array(32),
                    encryptionVariant: 'dataKey',
                    metadata,
                    metadataVersion: 0,
                    agentState: state,
                    agentStateVersion: 0,
                };
            }),
            refreshSessionForReconnect: vi.fn(async (session) => ({
                ...session,
                metadata: mocks.getRefreshedSessionMetadata(session.metadata),
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

vi.mock('@/utils/createSessionMetadata', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/utils/createSessionMetadata')>(),
    createSessionMetadata: vi.fn((options: { spawnSettings?: Record<string, unknown> }) => {
        const metadata = {
            path: '/srv/app',
            host: 'host',
            homeDir: '/home/test',
            happyHomeDir: '/home/test/.happyherd',
            happyLibDir: '/srv/happyherd',
            happyToolsDir: '/srv/happyherd/tools',
            startedFromDaemon: true,
            hostPid: 42,
            flavor: 'codex',
            ...(options.spawnSettings ? { spawnSettings: options.spawnSettings } : {}),
            ...mocks.getContextMetadata(),
        };
        mocks.setMetadata(metadata);
        return {
            state: mocks.getReconnectAgentState(),
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
    commanderContextReceiptForResume: vi.fn(() => ({})),
    readContextPromptFromEnvironment: vi.fn(async () => 'Commander context only'),
    mergeContextPrompt: vi.fn((base: string | undefined, extra: string | undefined) => (
        base && extra ? `${base}\n\n${extra}` : base ?? extra
    )),
    instructionReceiptMetadata: vi.fn(() => ({ instructionHash: 'delivered-instruction-hash' })),
}));

vi.mock('@/automations/sessionBootstrap', () => ({
    readAutomationBootstrapFromEnvironment: vi.fn(async () => ({
        schemaVersion: 1,
        automationId: '11111111-1111-4111-8111-111111111111',
        runId: '22222222-2222-4222-8222-222222222222',
        kind: 'scheduled',
        instruction: mocks.getAutomationInstruction(),
    })),
}));

vi.mock('@/claude/utils/startHappyHerdServer', () => ({
    startHappyHerdServer: vi.fn(async () => ({
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

        setUserInputHandler = vi.fn();
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
            if (mocks.shouldEmitResumeAndTurnUsage()) {
                mocks.emitEvent({
                    type: 'token_count',
                    thread_id: this.threadId,
                    turn_id: 'parent-turn',
                    total: { totalTokens: 250, inputTokens: 200, outputTokens: 50 },
                    last: { totalTokens: 150, inputTokens: 120, outputTokens: 30 },
                });
            }
            return { threadId: this.threadId, model: String(options.model) };
        });
        injectDeveloperInstructions = vi.fn(async (options: Record<string, unknown>) => {
            mocks.injectDeveloperInstructionsCalls.push(options);
            mocks.contextBeforeInjectionCalls.push({ ...mocks.getMetadata() });
            if (mocks.shouldFailContextInjection()) throw new Error('native context injection failed');
            return {};
        });
        clearGoal = vi.fn(async () => ({ cleared: true }));
        sendTurnAndWait = vi.fn(async (prompt: unknown, options: Record<string, unknown>) => {
            mocks.sendTurnCalls.push({ ...options, prompt });
            const decision = await mocks.maybeRequestInteractiveApproval();
            if (decision) {
                mocks.events.push(`approval:${decision}`);
                return { aborted: true };
            }
            if (mocks.shouldEmitResumeAndTurnUsage()) {
                mocks.emitEvent({
                    type: 'token_count',
                    thread_id: this.threadId,
                    turn_id: 'child-turn',
                    total: { totalTokens: 300, inputTokens: 240, outputTokens: 60 },
                    last: { totalTokens: 50, inputTokens: 40, outputTokens: 10 },
                });
                mocks.emitCompleted('child-turn');
            } else {
                mocks.emitCompleted();
            }
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
        delete process.env.HAPPYHERD_RECONNECT_SESSION_ID;
        delete process.env.HAPPYHERD_RECONNECT_ENCRYPTION_KEY;
        delete process.env.HAPPYHERD_RECONNECT_ENCRYPTION_VARIANT;
        delete process.env.HAPPYHERD_RECONNECT_QUEUE_MESSAGE_ID;
        delete process.env[HAPPYHERD_MACHINE_SESSION_SETTINGS_ENV];
        vi.mocked(notifyDaemonSessionStarted).mockClear();
    });

    it.each([false, true])('delivers canonical shared guidance and its exact receipt on Codex startup (resume: %s)', async (resume) => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-codex-shared-'));
        const originalEnv = { ...process.env };
        try {
            process.env.HAPPYHERD_HOME_DIR = join(root, 'home');
            process.env.TMPDIR = join(root, 'tmp');
            await mkdir(process.env.TMPDIR, { recursive: true });
            const commanderDir = join(process.env.HAPPYHERD_HOME_DIR, 'commanders', 'athena');
            await mkdir(commanderDir, { recursive: true });
            await writeFile(join(commanderDir, 'COMMANDER.md'), [
                '---', 'identity_and_scope:', '  name: Athena', '  commander_id: athena',
                `  workspace: ${root}`, '  role: Test commander', '---', '# Private commander',
            ].join('\n'));
            const actual = await vi.importActual<typeof import('@/agentContext/commanderContext')>('@/agentContext/commanderContext');
            const bundle = await actual.prepareCommanderContext('athena', root);
            Object.assign(process.env, actual.contextEnvironment(bundle));
            const prompt = await actual.readContextPromptFromEnvironment();
            expect(prompt).toContain(join(process.env.HAPPYHERD_HOME_DIR, 'agentcontext', 'README.md'));
            expect(prompt).toContain(join(process.env.HAPPYHERD_HOME_DIR, 'agentcontext', 'happyherd-cli.md'));
            await access(join(process.env.HAPPYHERD_HOME_DIR, 'agentcontext', 'README.md'));
            await access(join(process.env.HAPPYHERD_HOME_DIR, 'agentcontext', 'happyherd-cli.md'));
            mocks.setContextMetadata({ ...actual.contextMetadataFromEnvironment() });
            vi.mocked(readContextPromptFromEnvironment).mockResolvedValueOnce(prompt);
            vi.mocked(instructionReceiptMetadata).mockImplementation(actual.instructionReceiptMetadata);
            vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

            await runCodex({
                credentials: { token: 'test-token' } as never,
                startedBy: 'daemon', ...(resume ? { resumeThreadId: 'retained-thread' } : {}),
            });

            const delivered = resume
                ? mocks.injectDeveloperInstructionsCalls[0]?.instructions
                : mocks.startThreadCalls[0]?.developerInstructions;
            expect(delivered).toBe(prompt);
            expect(mocks.getMetadata()).toMatchObject({
                commanderId: 'athena', contextHash: bundle.contextHash,
                commanderContextFiles: bundle.commanderContextFiles,
                instructionProvider: 'codex', instructionLayer: 'developer',
                instructionHash: createHash('sha256').update(String(delivered)).digest('hex'),
            });
        } finally {
            vi.mocked(instructionReceiptMetadata).mockImplementation(() => ({ instructionHash: 'delivered-instruction-hash' }) as ReturnType<typeof instructionReceiptMetadata>);
            for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
            Object.assign(process.env, originalEnv);
            await rm(root, { recursive: true, force: true });
        }
    });

    it.each([false, true])('withholds a resumed context receipt until native delivery (failure: %s)', async (failInjection) => {
        vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        const files = [{ kind: 'commander', path: '/context/COMMANDER.md' }];
        mocks.setContextMetadata({ commanderId: 'athena', contextHash: 'new-context-hash', commanderContextFiles: files });
        mocks.setFailContextInjection(failInjection);
        const run = runCodex({
            credentials: { token: 'test-token' } as never,
            startedBy: 'daemon', resumeThreadId: 'retained-thread',
        });
        if (failInjection) await expect(run).rejects.toThrow('native context injection failed');
        else await run;

        for (const before of [...mocks.sessionCreationMetadataCalls, ...mocks.contextBeforeInjectionCalls]) {
            expect(before).not.toHaveProperty('commanderContextFiles');
            expect(before).not.toHaveProperty('contextHash');
            expect(before).not.toHaveProperty('instructionHash');
        }
        expect(mocks.injectDeveloperInstructionsCalls[0]).toEqual({
            threadId: 'retained-thread', instructions: 'Commander context only',
        });
        if (failInjection) {
            expect(mocks.getMetadata()).not.toHaveProperty('commanderContextFiles');
            expect(mocks.getMetadata()).not.toHaveProperty('contextHash');
            expect(mocks.getMetadata()).not.toHaveProperty('instructionHash');
            expect(mocks.sendTurnCalls).toEqual([]);
        } else {
            expect(mocks.getMetadata()).toMatchObject({
                commanderId: 'athena', commanderContextFiles: files,
                contextHash: 'new-context-hash', instructionHash: 'delivered-instruction-hash',
            });
        }
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
        expect(mocks.startThreadCalls[0]).toMatchObject({
            developerInstructions: 'Commander context only',
        });
        expect(String(mocks.startThreadCalls[0]?.developerInstructions)).not.toContain('User Safeguard');
        expect(String(mocks.startThreadCalls[0]?.developerInstructions)).not.toContain('automation boundary');
        expect(mocks.injectDeveloperInstructionsCalls).toEqual([]);
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
            developerInstructions: 'Commander context only',
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
        process.env.HAPPYHERD_RECONNECT_SESSION_ID = 'session-one';
        process.env.HAPPYHERD_RECONNECT_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
        process.env.HAPPYHERD_RECONNECT_ENCRYPTION_VARIANT = 'dataKey';
        process.env.HAPPYHERD_RECONNECT_QUEUE_MESSAGE_ID = 'heartbeat-occurrence';

        await runCodex({
            credentials: { token: 'test-token' } as never,
            startedBy: 'daemon',
        });

        expect(mocks.session.skipExistingMessages).toHaveBeenCalledWith(
            ['heartbeat-occurrence'],
            0,
        );
    });

    it.each([true, false, undefined])('registers only the authoritative Super Session flag on reconnect (%s)', async (isSuperSession) => {
        vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        process.env.HAPPYHERD_RECONNECT_SESSION_ID = 'session-one';
        process.env.HAPPYHERD_RECONNECT_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
        process.env.HAPPYHERD_RECONNECT_ENCRYPTION_VARIANT = 'dataKey';
        mocks.setContextMetadata({
            isSuperSession: isSuperSession === true ? undefined : true,
            automationRunId: 'local-run',
        });
        mocks.setRefreshedSessionMetadata({
            isSuperSession,
            automationRunId: 'server-run',
        });

        await runCodex({
            credentials: { token: 'test-token' } as never,
            startedBy: 'daemon',
        });

        const registeredMetadata = vi.mocked(notifyDaemonSessionStarted).mock.calls[0]?.[1];
        expect(registeredMetadata?.isSuperSession).toBe(isSuperSession === true ? true : undefined);
        expect(registeredMetadata?.automationRunId).toBe('local-run');
    });

    it('resumes only pending queue IDs and keeps interrupted current work in state', async () => {
        vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        process.env.HAPPYHERD_RECONNECT_SESSION_ID = 'session-one';
        process.env.HAPPYHERD_RECONNECT_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
        process.env.HAPPYHERD_RECONNECT_ENCRYPTION_VARIANT = 'dataKey';
        process.env.HAPPYHERD_RECONNECT_QUEUE_MESSAGE_ID = 'already-submitted';
        mocks.setReconnectAgentState({
            controlledByUser: false,
            messageQueue: {
                pendingMessageIds: ['queued-follow-up', 'already-submitted', 'queued-follow-up'],
                currentMessageIds: ['already-submitted'],
            },
        });

        await runCodex({
            credentials: { token: 'test-token' } as never,
            startedBy: 'daemon',
            resumeThreadId: 'retained-thread',
        });

        expect(mocks.session.skipExistingMessages).toHaveBeenCalledWith(['queued-follow-up'], 0);
        expect(mocks.session.getAgentState().messageQueue).toEqual({
            pendingMessageIds: ['queued-follow-up'],
            currentMessageIds: ['already-submitted'],
        });
        expect(mocks.sendTurnCalls).toHaveLength(1);
        expect(String(mocks.sendTurnCalls[0]?.prompt)).toContain('Deliver the automation task.');
    });

    it('waits for runCodex queue ownership persistence before app-server turn submission', async () => {
        vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        const id = 'codex-follow-up';
        const originalPush = MessageQueue2.prototype.push;
        vi.spyOn(MessageQueue2.prototype, 'push').mockImplementation(function (this: MessageQueue2<unknown>, message, mode, attachments, queueMessageId) {
            return originalPush.call(this, message, mode, attachments, queueMessageId ?? id);
        });
        let resolveWrite!: () => void;
        let signalWriteStarted!: () => void;
        const writeStarted = new Promise<void>((resolve) => { signalWriteStarted = resolve; });
        const writeGate = new Promise<void>((resolve) => { resolveWrite = resolve; });
        mocks.session.updateAgentState.mockImplementation(async (updater) => {
            const next = updater(mocks.session.getAgentState());
            if ((next.messageQueue as { currentMessageIds?: string[] } | undefined)?.currentMessageIds?.includes(id)) {
                signalWriteStarted();
                await writeGate;
            }
            mocks.setAgentState(next);
        });

        const run = runCodex({ credentials: { token: 'test-token' } as never, startedBy: 'daemon' });
        await writeStarted;
        expect(mocks.sendTurnCalls).toEqual([]);
        expect(mocks.session.getAgentState().messageQueue).toMatchObject({ currentMessageIds: [] });
        resolveWrite();
        await run;
        expect(mocks.sendTurnCalls).toHaveLength(1);
        expect(String(mocks.sendTurnCalls[0]?.prompt)).toContain('Deliver the automation task.');
        expect(mocks.session.getAgentState().messageQueue).toMatchObject({
            pendingMessageIds: [], currentMessageIds: [],
        });
    });

    it('does not submit a Codex turn when queue ownership persistence is rejected', async () => {
        vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        const id = 'codex-follow-up';
        const originalPush = MessageQueue2.prototype.push;
        vi.spyOn(MessageQueue2.prototype, 'push').mockImplementation(function (this: MessageQueue2<unknown>, message, mode, attachments, queueMessageId) {
            return originalPush.call(this, message, mode, attachments, queueMessageId ?? id);
        });
        mocks.session.updateAgentState.mockImplementation(async (updater) => {
            const next = updater(mocks.session.getAgentState());
            if ((next.messageQueue as { currentMessageIds?: string[] } | undefined)?.currentMessageIds?.includes(id)) {
                throw new Error('queue ownership update rejected');
            }
            mocks.setAgentState(next);
        });

        await runCodex({ credentials: { token: 'test-token' } as never, startedBy: 'daemon' });

        expect(mocks.sendTurnCalls).toEqual([]);
        expect(mocks.session.getAgentState().messageQueue).toMatchObject({
            pendingMessageIds: [id], currentMessageIds: [],
        });
    });

    it.each([
        ['state-only goal command', '/goal clear', false],
        ['unsupported image-only command', '', true],
    ])('durably retires a dequeued %s without provider submission', async (_label, instruction, imageOnly) => {
        vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        mocks.setAutomationInstruction(instruction);
        const id = 'codex-local-terminal';
        const originalPush = MessageQueue2.prototype.push;
        const originalPushIsolated = MessageQueue2.prototype.pushIsolated;
        const unsupported = { data: new Uint8Array([0, 1, 2]), mimeType: 'image/jpeg', name: 'broken.jpg' };
        const inject = (target: typeof originalPush) => vi.fn(function (this: MessageQueue2<unknown>, message: string, mode: unknown, attachments?: Array<typeof unsupported>, queueMessageId?: string) {
            return target.call(this, message, mode, imageOnly ? [unsupported] : attachments, queueMessageId ?? id);
        });
        vi.spyOn(MessageQueue2.prototype, 'push').mockImplementation(inject(originalPush) as typeof originalPush);
        vi.spyOn(MessageQueue2.prototype, 'pushIsolated').mockImplementation(inject(originalPushIsolated) as typeof originalPushIsolated);

        await runCodex({ credentials: { token: 'test-token' } as never, startedBy: 'daemon' });

        expect(mocks.sendTurnCalls).toEqual([]);
        expect(mocks.session.getAgentState().messageQueue).toMatchObject({
            pendingMessageIds: [], currentMessageIds: [],
        });
    });

    it('seeds a resumed thread without recounting parent usage and reports only the child response', async () => {
        vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        mocks.setEmitResumeAndTurnUsage(true);

        await runCodex({
            credentials: { token: 'test-token' } as never,
            startedBy: 'daemon',
            resumeThreadId: 'provider-thread-child',
        });

        expect(mocks.session.sendProviderUsageReport).toHaveBeenCalledTimes(1);
        expect(mocks.session.sendProviderUsageReport.mock.calls[0][0]).toMatchObject({
            provider: 'codex',
            tokens: { total: 50, input: 40, output: 10 },
        });
    });

    it('recovers only the uncommitted Codex delta when the same HappyHerd session resumes', async () => {
        vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        mocks.setEmitResumeAndTurnUsage(true);
        mocks.setAgentState({
            controlledByUser: false,
            usageCursors: {
                codexTokens: {
                    'provider-thread-child': {
                        total: 100,
                        input: 80,
                        output: 20,
                        cacheCreation: 0,
                        cacheRead: 0,
                        reasoning: 0,
                    },
                },
            },
        });

        await runCodex({
            credentials: { token: 'test-token' } as never,
            startedBy: 'daemon',
            resumeThreadId: 'provider-thread-child',
        });

        const reports = mocks.session.sendProviderUsageReport.mock.calls.map(([report]) => report);
        expect(reports).toHaveLength(2);
        expect(reports[0]).toMatchObject({ tokens: { total: 150 } });
        expect(reports[1]).toMatchObject({ tokens: { total: 50 } });
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
