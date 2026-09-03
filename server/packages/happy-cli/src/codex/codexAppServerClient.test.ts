import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SandboxConfig } from '@/persistence';

const {
    mockExecSync,
    mockInitializeSandbox,
    mockWrapForMcpTransport,
    mockSandboxCleanup,
    mockSpawn,
} = vi.hoisted(() => ({
    mockExecSync: vi.fn(),
    mockInitializeSandbox: vi.fn(),
    mockWrapForMcpTransport: vi.fn(),
    mockSandboxCleanup: vi.fn(),
    mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({
    execSync: mockExecSync,
    spawn: mockSpawn,
}));

vi.mock('cross-spawn', () => ({
    spawn: mockSpawn,
}));

vi.mock('@/sandbox/manager', () => ({
    initializeSandbox: mockInitializeSandbox,
    wrapForMcpTransport: mockWrapForMcpTransport,
}));

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock('../package.json', () => ({
    default: { version: '0.0.1-test' },
}));

type MockRpcMessage = {
    id?: number;
    method?: string;
    params?: any;
    result?: any;
};

function pushJsonLine(stdout: NodeJS.ReadableStream & { push: (chunk: string) => void }, payload: unknown) {
    stdout.push(JSON.stringify(payload) + '\n');
}

// Mock child process with stdin/stdout/stderr
function createMockProcess(opts?: {
    pid?: number;
    initializeDelayMs?: number;
    onRequest?: (msg: MockRpcMessage, stdout: NodeJS.ReadableStream & { push: (chunk: string) => void }) => void;
}) {
    const { Readable, Writable } = require('stream');
    const initializeDelayMs = opts?.initializeDelayMs ?? 5;
    const stdin = new Writable({ write: (_: any, __: any, cb: () => void) => cb() });
    const stdout = new Readable({ read() {} });
    const stderr = new Readable({ read() {} });
    const proc = Object.assign(new (require('events').EventEmitter)(), {
        stdin,
        stdout,
        stderr,
        pid: opts?.pid ?? 12345,
        kill: vi.fn(),
    });
    // Send initialize response immediately when stdin is written to
    const origWrite = stdin.write.bind(stdin);
    stdin.write = (data: any, ...args: any[]) => {
        try {
            const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
            if (msg.method === 'initialize' && msg.id != null) {
                // Send response on next tick
                setTimeout(() => {
                    pushJsonLine(stdout, { id: msg.id, result: { userAgent: 'test' } });
                }, initializeDelayMs);
            }
            opts?.onRequest?.(msg, stdout);
        } catch {}
        return origWrite(data, ...args);
    };
    return proc;
}

async function waitFor(predicate: () => boolean, timeoutMs: number = 1000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) {
            throw new Error(`Timed out after ${timeoutMs}ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

const sandboxConfig: SandboxConfig = {
    enabled: true,
    workspaceRoot: '~/projects',
    sessionIsolation: 'workspace',
    customWritePaths: [],
    denyReadPaths: ['~/.ssh'],
    extraWritePaths: ['/tmp'],
    denyWritePaths: ['.env'],
    networkMode: 'allowed',
    allowedDomains: [],
    deniedDomains: [],
    allowLocalBinding: true,
};

const proactiveMultiAgentConfig =
    'features.multi_agent_v2.multi_agent_mode_hint_text="Proactive multi-agent delegation is active. Any earlier instruction requiring an explicit user request before spawning sub-agents no longer applies. Use sub-agents when parallel work would materially improve speed or quality. This mode remains active until a later multi-agent mode developer message changes it."';

describe('CodexAppServerClient sandbox integration', () => {
    const originalRustLog = process.env.RUST_LOG;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.RUST_LOG = originalRustLog;
        mockExecSync.mockReturnValue('codex-cli 0.107.0');
        mockInitializeSandbox.mockResolvedValue(mockSandboxCleanup);
        mockWrapForMcpTransport.mockResolvedValue({ command: 'sh', args: ['-c', 'wrapped codex app-server'] });
        mockSpawn.mockImplementation(() => createMockProcess());
    });

    afterAll(() => {
        process.env.RUST_LOG = originalRustLog;
    });

    it('reports goal action support for Codex versions with goal action requests', async () => {
        const { CodexAppServerClient } = await import('./codexAppServerClient');

        mockExecSync.mockReturnValue('codex-cli 0.140.0');
        expect(new CodexAppServerClient().supportsGoalActions()).toBe(true);

        mockExecSync.mockReturnValue('codex-cli 0.130.0');
        expect(new CodexAppServerClient().supportsGoalActions()).toBe(false);
    });

    it('wraps transport when sandbox is enabled', async () => {
        // Dynamic import to ensure mocks are applied
        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient(sandboxConfig);

        await client.connect();

        expect(mockInitializeSandbox).toHaveBeenCalledWith(sandboxConfig, process.cwd());
        expect(mockWrapForMcpTransport).toHaveBeenCalledWith('codex', [
            'app-server', '--listen', 'stdio://', '-c', 'project_doc_max_bytes=0',
            '-c', proactiveMultiAgentConfig,
        ]);
        const [command, args, options] = mockSpawn.mock.calls[0];
        expect(command).toBe('sh');
        expect(args).toEqual(['-c', 'wrapped codex app-server']);
        expect(options.env.CODEX_SANDBOX).toBe('seatbelt');
        expect(options.env.RUST_LOG).toContain('codex_core::rollout::list=off');
        expect(client.sandboxEnabled).toBe(true);

        await client.disconnect();
    });

    it('launches app-server from an explicit provider directory and environment', async () => {
        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const processEnvironment = {
            PATH: process.env.PATH,
            CODEX_HOME: '/srv/codex-homes/rotated',
            HAPPYHERD_PROVIDER_ACCOUNT: 'rotated-account',
            HAPPYHERD_PROVIDER_ACCOUNT_TYPE: 'codex',
            HAPPYHERD_CODEX_ACCOUNT_AUTH_FILE: '/srv/accounts/rotated/auth.json',
        };
        const client = new CodexAppServerClient(undefined, {
            workingDirectory: '/srv/parent-project',
            processEnvironment,
        });

        await client.connect();

        const [, , options] = mockSpawn.mock.calls[0];
        expect(options.cwd).toBe('/srv/parent-project');
        expect(options.env).toMatchObject(processEnvironment);

        await client.disconnect();
    });

    it('starts a governed agent app-server with fail-closed policy and manifest-only tools', async () => {
        const requests: MockRpcMessage[] = [];
        mockSpawn.mockImplementation(() => createMockProcess({
            onRequest: (msg, stdout) => {
                requests.push(msg);
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => pushJsonLine(stdout, {
                        id: msg.id,
                        result: {
                            thread: { id: 'thread-agent', path: '/tmp/thread-agent' },
                            model: 'gpt-test',
                        },
                    }), 0);
                }
            },
        }));
        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient(sandboxConfig, {
            agentPolicyEntrypoint: '/opt/happy/bin/happyherd-agent-codex-policy.mjs',
            requireSandbox: true,
        });

        await client.connect();
        const wrappedArgs = mockWrapForMcpTransport.mock.calls[0][1] as string[];
        expect(wrappedArgs).toContain('--dangerously-bypass-hook-trust');
        expect(wrappedArgs).toContain('web_search="disabled"');
        expect(wrappedArgs.join(' ')).toContain('hooks.PreToolUse');
        expect(wrappedArgs).toContain(proactiveMultiAgentConfig);

        await client.startThread({
            sandbox: 'read-only',
            mcpServers: {
                happyherd_agent: {
                    command: '/usr/bin/node',
                    enabled_tools: ['guide', 'contacts'],
                    required: true,
                },
            },
        });
        const start = requests.find((request) => request.method === 'thread/start');
        expect(start?.params).toEqual(expect.objectContaining({
            includeApplyPatchTool: false,
            config: {
                mcp_servers: expect.objectContaining({ happyherd_agent: expect.any(Object) }),
                web_search: 'disabled',
            },
        }));
        await client.disconnect();
    });

    it('injects exact developer instructions as model-visible context', async () => {
        const requests: MockRpcMessage[] = [];
        mockSpawn.mockImplementation(() => createMockProcess({
            onRequest: (msg, stdout) => {
                requests.push(msg);
                if (msg.method === 'thread/inject_items' && msg.id != null) {
                    setTimeout(() => pushJsonLine(stdout, {
                        id: msg.id,
                        result: {},
                    }), 0);
                }
            },
        }));
        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();

        await client.connect();
        await client.injectDeveloperInstructions({
            threadId: 'thread-safeguard',
            instructions: 'Human safeguard enabled',
        });
        await client.injectDeveloperInstructions({
            threadId: 'thread-safeguard',
            instructions: 'Automation safeguard suppressed',
        });

        expect(requests
            .filter((request) => request.method === 'thread/inject_items')
            .map((request) => request.params))
            .toEqual([
                {
                    threadId: 'thread-safeguard',
                    items: [{
                        type: 'message',
                        role: 'developer',
                        content: [{ type: 'input_text', text: 'Human safeguard enabled' }],
                    }],
                },
                {
                    threadId: 'thread-safeguard',
                    items: [{
                        type: 'message',
                        role: 'developer',
                        content: [{ type: 'input_text', text: 'Automation safeguard suppressed' }],
                    }],
                },
            ]);

        await client.disconnect();
    });

    it('does not launch a governed agent app-server when its OS sandbox cannot start', async () => {
        mockInitializeSandbox.mockRejectedValue(new Error('sandbox unavailable'));
        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient(sandboxConfig, {
            agentPolicyEntrypoint: '/opt/happy/bin/happyherd-agent-codex-policy.mjs',
            requireSandbox: true,
        });

        await expect(client.connect()).rejects.toThrow('HappyHerd Agent Codex sandbox initialization failed');
        expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('falls back to non-sandbox transport when sandbox initialization fails', async () => {
        mockInitializeSandbox.mockRejectedValue(new Error('sandbox init failed'));
        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient(sandboxConfig);

        await client.connect();

        expect(mockWrapForMcpTransport).not.toHaveBeenCalled();
        const [command, args, options] = mockSpawn.mock.calls[0];
        expect(command).toBe('codex');
        expect(args).toEqual([
            'app-server', '--listen', 'stdio://', '-c', 'project_doc_max_bytes=0',
            '-c', proactiveMultiAgentConfig,
        ]);
        expect(options.env.RUST_LOG).toContain('codex_core::rollout::list=off');
        expect(client.sandboxEnabled).toBe(false);

        await client.disconnect();
    });

    it('resets sandbox on disconnect', async () => {
        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient(sandboxConfig);

        await client.connect();
        await client.disconnect();

        expect(mockSandboxCleanup).toHaveBeenCalledTimes(1);
        expect(client.sandboxEnabled).toBe(false);
    });

    it('appends rollout log filter to existing RUST_LOG', async () => {
        process.env.RUST_LOG = 'info,codex_core=warn';
        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient(sandboxConfig);

        await client.connect();

        const options = mockSpawn.mock.calls[0][2];
        expect(options.env.RUST_LOG).toBe('info,codex_core=warn,codex_core::rollout::list=off');

        await client.disconnect();
    });

    it('ignores stale process exit during reconnect initialize', async () => {
        const proc1 = createMockProcess({ pid: 1001, initializeDelayMs: 5 });
        const proc2 = createMockProcess({ pid: 1002, initializeDelayMs: 50 });
        mockSpawn
            .mockImplementationOnce(() => proc1)
            .mockImplementationOnce(() => proc2);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();

        await client.connect();
        await client.disconnect();

        const reconnect = client.connect();
        setTimeout(() => {
            proc1.emit('exit', 0, null);
        }, 10);

        await expect(reconnect).resolves.toBeUndefined();
        await client.disconnect();
    });

    it('reconnects and resumes the same thread after forced restart timeout', async () => {
        const firstProcessRequests: MockRpcMessage[] = [];
        const secondProcessRequests: MockRpcMessage[] = [];
        type CapturedEvent = { type: string; [key: string]: unknown };

        const proc1 = createMockProcess({
            pid: 2001,
            onRequest: (msg, stdout) => {
                firstProcessRequests.push(msg);

                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-1', path: '/tmp/thread-1' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'on-request',
                                sandbox: { type: 'readOnly' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: { turn: { id: 'turn-1', status: 'inProgress' } },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: {
                                threadId: 'thread-1',
                                turn: { id: 'turn-1', status: 'inProgress' },
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/interrupt' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, { id: msg.id, result: { abortReason: 'interrupted' } });
                    }, 0);
                }
            },
        });

        const proc2 = createMockProcess({
            pid: 2002,
            onRequest: (msg, stdout) => {
                secondProcessRequests.push(msg);

                if (msg.method === 'thread/resume' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-1', path: '/tmp/thread-1' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'on-request',
                                sandbox: { type: 'readOnly' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: { turn: { id: 'turn-2', status: 'inProgress' } },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: {
                                threadId: 'thread-1',
                                turn: { id: 'turn-2', status: 'inProgress' },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/completed',
                            params: {
                                threadId: 'thread-1',
                                turn: { id: 'turn-2', status: 'completed', error: null },
                            },
                        });
                    }, 0);
                }
            },
        });

        mockSpawn
            .mockImplementationOnce(() => proc1)
            .mockImplementationOnce(() => proc2);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: CapturedEvent[] = [];
        client.setEventHandler((msg) => {
            events.push(msg as CapturedEvent);
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'on-request',
            sandbox: 'read-only',
            developerInstructions: 'global + commander + project',
        });

        const pendingTurn = client.sendTurnAndWait('hang forever', { turnTimeoutMs: 5000 });
        await waitFor(() => firstProcessRequests.some((msg) => msg.method === 'turn/start'));

        const abortResult = await client.abortTurnWithFallback({
            gracePeriodMs: 1,
            forceRestartOnTimeout: true,
        });

        await expect(pendingTurn).resolves.toEqual({ aborted: true });
        expect(abortResult).toEqual({
            hadActiveTurn: true,
            aborted: true,
            forcedRestart: true,
            resumedThread: true,
        });
        expect(events).toContainEqual(expect.objectContaining({
            type: 'turn_aborted',
            reason: 'interrupted',
            turn_id: 'turn-1',
            forced_restart: true,
        }));

        const resumeRequest = secondProcessRequests.find((msg) => msg.method === 'thread/resume');
        expect(resumeRequest?.params).toEqual(expect.objectContaining({
            threadId: 'thread-1',
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'on-request',
            sandbox: 'read-only',
            persistExtendedHistory: true,
        }));
        expect(client.threadId).toBe('thread-1');

        await expect(client.sendTurnAndWait('follow up after reconnect')).resolves.toEqual({ aborted: false });

        await client.disconnect();
    });

    it('force-restarts promptly when turn interrupt RPC does not respond', async () => {
        const firstProcessRequests: MockRpcMessage[] = [];
        const secondProcessRequests: MockRpcMessage[] = [];

        const proc1 = createMockProcess({
            pid: 2101,
            onRequest: (msg, stdout) => {
                firstProcessRequests.push(msg);

                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-stuck-interrupt', path: '/tmp/thread-stuck-interrupt' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'on-request',
                                sandbox: { type: 'readOnly' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: { turn: { id: 'turn-stuck-interrupt', status: 'inProgress' } },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: {
                                threadId: 'thread-stuck-interrupt',
                                turn: { id: 'turn-stuck-interrupt', status: 'inProgress' },
                            },
                        });
                    }, 0);
                }

                // Deliberately do not respond to turn/interrupt. This used to
                // block abortTurnWithFallback until the generic 30s RPC timeout.
            },
        });

        const proc2 = createMockProcess({
            pid: 2102,
            onRequest: (msg, stdout) => {
                secondProcessRequests.push(msg);

                if (msg.method === 'thread/resume' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-stuck-interrupt', path: '/tmp/thread-stuck-interrupt' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'on-request',
                                sandbox: { type: 'readOnly' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }
            },
        });

        mockSpawn
            .mockImplementationOnce(() => proc1)
            .mockImplementationOnce(() => proc2);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'on-request',
            sandbox: 'read-only',
            developerInstructions: 'global + commander + project',
        });

        const pendingTurn = client.sendTurnAndWait('hang on interrupt', { turnTimeoutMs: 5000 });
        await waitFor(() => firstProcessRequests.some((msg) => msg.method === 'turn/start'));
        await waitFor(() => client.turnId === 'turn-stuck-interrupt');

        const startedAt = Date.now();
        const abortResult = await client.abortTurnWithFallback({
            gracePeriodMs: 20,
            forceRestartOnTimeout: true,
        });

        expect(Date.now() - startedAt).toBeLessThan(1000);
        await expect(pendingTurn).resolves.toEqual({ aborted: true });
        expect(firstProcessRequests.some((msg) => msg.method === 'turn/interrupt')).toBe(true);
        expect(abortResult).toEqual({
            hadActiveTurn: true,
            aborted: true,
            forcedRestart: true,
            resumedThread: true,
        });
        expect(secondProcessRequests.some((msg) => msg.method === 'thread/resume')).toBe(true);
        expect(firstProcessRequests.find((msg) => msg.method === 'thread/start')?.params).toEqual(
            expect.objectContaining({ developerInstructions: 'global + commander + project' }),
        );
        expect(secondProcessRequests.find((msg) => msg.method === 'thread/resume')?.params).toEqual(
            expect.objectContaining({ developerInstructions: 'global + commander + project' }),
        );

        await client.disconnect();
    });

    it('forks, reads, and rolls back Codex threads through app-server RPC', async () => {
        const requests: MockRpcMessage[] = [];
        const proc = createMockProcess({
            pid: 2501,
            onRequest: (msg, stdout) => {
                requests.push(msg);

                if (msg.method === 'thread/fork' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: {
                                    id: 'thread-forked',
                                    path: '/tmp/thread-forked',
                                    forkedFromId: 'thread-source',
                                    turns: [],
                                },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'on-request',
                                sandbox: { type: 'workspaceWrite' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'thread/read' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: {
                                    id: 'thread-forked',
                                    turns: [
                                        { id: 'turn-1', items: [{ type: 'userMessage', id: 'user-1', content: [{ type: 'text', text: 'hello' }] }] },
                                    ],
                                },
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'thread/rollback' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: {
                                    id: 'thread-forked',
                                    turns: [
                                        { id: 'turn-1', items: [{ type: 'userMessage', id: 'user-1', content: [{ type: 'text', text: 'hello' }] }] },
                                    ],
                                },
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'thread/inject_items' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {},
                        });
                    }, 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();

        await client.connect();
        const forked = await client.forkThread({
            threadId: 'thread-source',
            cwd: '/tmp/project',
            approvalPolicy: 'on-request',
            sandbox: 'workspace-write',
        });
        const read = await client.readThread({ threadId: forked.threadId, includeTurns: true });
        const rolledBack = await client.rollbackThread({ threadId: forked.threadId, numTurns: 2 });
        const injected = await client.injectItems({
            threadId: forked.threadId,
            items: [{
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: 'hello' }],
            }],
        });

        expect(forked.threadId).toBe('thread-forked');
        expect(read.thread.turns).toHaveLength(1);
        expect(rolledBack.thread.turns).toHaveLength(1);
        expect(injected).toEqual({});
        expect(requests.find((msg) => msg.method === 'thread/fork')?.params).toEqual(expect.objectContaining({
            threadId: 'thread-source',
            cwd: '/tmp/project',
            approvalPolicy: 'on-request',
            sandbox: 'workspace-write',
        }));
        expect(requests.find((msg) => msg.method === 'thread/read')?.params).toEqual({
            threadId: 'thread-forked',
            includeTurns: true,
        });
        expect(requests.find((msg) => msg.method === 'thread/rollback')?.params).toEqual({
            threadId: 'thread-forked',
            numTurns: 2,
        });
        expect(requests.find((msg) => msg.method === 'thread/inject_items')?.params).toEqual({
            threadId: 'thread-forked',
            items: [{
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: 'hello' }],
            }],
        });

        await client.disconnect();
    });

    it('clears active thread state so the next prompt starts a fresh thread', async () => {
        const requests: MockRpcMessage[] = [];
        let nextThreadNumber = 1;
        const proc = createMockProcess({
            pid: 2601,
            onRequest: (msg, stdout) => {
                requests.push(msg);

                if (msg.method === 'thread/start' && msg.id != null) {
                    const threadId = `thread-${nextThreadNumber++}`;
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: threadId, path: `/tmp/${threadId}` },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'on-request',
                                sandbox: { type: 'readOnly' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'on-request',
            sandbox: 'read-only',
        });

        expect(client.threadId).toBe('thread-1');
        expect(client.hasActiveThread()).toBe(true);

        client.clearThreadState();

        expect(client.threadId).toBeNull();
        expect(client.turnId).toBeNull();
        expect(client.hasActiveThread()).toBe(false);

        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'on-request',
            sandbox: 'read-only',
        });

        expect(client.threadId).toBe('thread-2');
        expect(requests.filter((msg) => msg.method === 'thread/start')).toHaveLength(2);

        await client.disconnect();
    });

    it('sends extra localImage input items and omits empty text for image-only turns', async () => {
        const requests: MockRpcMessage[] = [];
        const proc = createMockProcess({
            pid: 2801,
            onRequest: (msg, stdout) => {
                requests.push(msg);

                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-images', path: '/tmp/thread-images' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                turn: { id: 'turn-images', items: [], status: 'completed', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/completed',
                            params: {
                                threadId: 'thread-images',
                                turn: { id: 'turn-images', items: [], status: 'completed', error: null },
                            },
                        });
                    }, 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });
        await client.sendTurnAndWait('', {
            extraInputItems: [{ type: 'localImage', path: '/tmp/happy-image.png' }],
        });

        expect(requests.find((msg) => msg.method === 'turn/start')?.params).toMatchObject({
            threadId: 'thread-images',
            input: [{ type: 'localImage', path: '/tmp/happy-image.png' }],
        });

        await client.disconnect();
    });

    it('keeps text-only turn input unchanged when no extra input items are supplied', async () => {
        const requests: MockRpcMessage[] = [];
        const proc = createMockProcess({
            pid: 2802,
            onRequest: (msg, stdout) => {
                requests.push(msg);

                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-text', path: '/tmp/thread-text' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                turn: { id: 'turn-text', items: [], status: 'completed', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/completed',
                            params: {
                                threadId: 'thread-text',
                                turn: { id: 'turn-text', items: [], status: 'completed', error: null },
                            },
                        });
                    }, 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });
        await client.sendTurnAndWait('hello');

        expect(requests.find((msg) => msg.method === 'turn/start')?.params).toMatchObject({
            threadId: 'thread-text',
            input: [{ type: 'text', text: 'hello' }],
        });

        await client.disconnect();
    });

    it('steers follow-up input into the provider-owned active turn', async () => {
        const requests: MockRpcMessage[] = [];
        const proc = createMockProcess({
            pid: 2803,
            onRequest: (msg, stdout) => {
                requests.push(msg);

                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-steer', path: '/tmp/thread-steer' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: 'max',
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                turn: { id: 'turn-steer', items: [], status: 'inProgress', error: null },
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/steer' && msg.id != null) {
                    setTimeout(() => pushJsonLine(stdout, { id: msg.id, result: {} }), 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });

        const completion = client.sendTurnAndWait('initial', { effort: 'max' });
        await waitFor(() => client.activeTurnId === 'turn-steer');

        await expect(client.steerTurn('follow up', {
            extraInputItems: [{ type: 'localImage', path: '/tmp/follow-up.png' }],
        })).resolves.toBe('steered');

        expect(requests.find((msg) => msg.method === 'turn/steer')?.params).toEqual({
            threadId: 'thread-steer',
            expectedTurnId: 'turn-steer',
            input: [
                { type: 'text', text: 'follow up' },
                { type: 'localImage', path: '/tmp/follow-up.png' },
            ],
        });

        pushJsonLine(proc.stdout, {
            method: 'turn/completed',
            params: {
                threadId: 'thread-steer',
                turn: { id: 'turn-steer', items: [], status: 'completed', error: null },
            },
        });
        await expect(completion).resolves.toEqual({ aborted: false });
        expect(client.activeTurnId).toBeNull();

        await client.disconnect();
    });

    it('ignores a mismatched root completion without publishing false terminal state', async () => {
        const proc = createMockProcess({
            pid: 2804,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => pushJsonLine(stdout, {
                        id: msg.id,
                        result: {
                            thread: { id: 'thread-mismatch', path: '/tmp/thread-mismatch' },
                            model: 'gpt-test',
                        },
                    }), 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: { turn: { id: 'turn-current', status: 'inProgress' } },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: {
                                threadId: 'thread-mismatch',
                                turn: { id: 'turn-current', status: 'inProgress' },
                            },
                        });
                    }, 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((event) => events.push(event as Record<string, unknown>));

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });

        const completion = client.sendTurnAndWait('initial');
        await waitFor(() => client.activeTurnId === 'turn-current');
        let completionSettled = false;
        void completion.then(() => {
            completionSettled = true;
        });

        pushJsonLine(proc.stdout, {
            method: 'turn/started',
            params: {
                threadId: 'thread-mismatch',
                turn: { id: 'turn-stale', status: 'inProgress' },
            },
        });
        pushJsonLine(proc.stdout, {
            method: 'turn/completed',
            params: {
                threadId: 'thread-mismatch',
                turn: { id: 'turn-stale', status: 'completed', error: null },
            },
        });
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(client.activeTurnId).toBe('turn-current');
        expect(client.turnId).toBe('turn-current');
        expect(completionSettled).toBe(false);
        expect(events).not.toContainEqual(expect.objectContaining({
            provider_terminal: true,
            turn_id: 'turn-stale',
        }));
        expect(events).not.toContainEqual(expect.objectContaining({
            type: 'task_started',
            turn_id: 'turn-stale',
        }));

        pushJsonLine(proc.stdout, {
            method: 'turn/completed',
            params: {
                threadId: 'thread-mismatch',
                turn: { id: 'turn-current', status: 'completed', error: null },
            },
        });
        await expect(completion).resolves.toEqual({ aborted: false });
        expect(client.activeTurnId).toBeNull();

        await client.disconnect();
    });

    it('releases a stale pending turn when the provider rejects steering and allows one retry', async () => {
        const requests: MockRpcMessage[] = [];
        let turnStartCount = 0;
        const proc = createMockProcess({
            pid: 2805,
            onRequest: (msg, stdout) => {
                requests.push(msg);
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => pushJsonLine(stdout, {
                        id: msg.id,
                        result: {
                            thread: { id: 'thread-stale-steer', path: '/tmp/thread-stale-steer' },
                            model: 'gpt-test',
                        },
                    }), 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    turnStartCount += 1;
                    const turnId = turnStartCount === 1 ? 'turn-stale' : 'turn-recovered';
                    setTimeout(() => pushJsonLine(stdout, {
                        id: msg.id,
                        result: { turn: { id: turnId, status: 'inProgress' } },
                    }), 0);
                }

                if (msg.method === 'turn/steer' && msg.id != null) {
                    setTimeout(() => pushJsonLine(stdout, {
                        id: msg.id,
                        error: { code: -32600, message: 'no active turn to steer' },
                    }), 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((event) => events.push(event as Record<string, unknown>));

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });

        const staleCompletion = client.sendTurnAndWait('initial');
        await waitFor(() => client.activeTurnId === 'turn-stale');
        let staleCompletionSettled = false;
        void staleCompletion.then(() => {
            staleCompletionSettled = true;
        });

        const steerResult = await client.steerTurn('follow up');
        expect(steerResult).toBe('turn-not-active');
        expect(staleCompletionSettled).toBe(false);
        await expect(staleCompletion).resolves.toEqual({ aborted: false });
        expect(client.activeTurnId).toBeNull();
        expect(events.filter((event) => event.provider_terminal === true && event.turn_id === 'turn-stale')).toEqual([
            expect.objectContaining({
                type: 'task_complete',
                status: 'completed',
                reason: 'stale_turn_reconciled',
                reconciled: true,
            }),
        ]);

        const recoveredCompletion = client.sendTurnAndWait('follow up');
        await waitFor(() => client.activeTurnId === 'turn-recovered');
        let recoveredCompletionSettled = false;
        void recoveredCompletion.then(() => {
            recoveredCompletionSettled = true;
        });

        pushJsonLine(proc.stdout, {
            method: 'turn/started',
            params: {
                threadId: 'thread-stale-steer',
                turn: { id: 'turn-stale', status: 'inProgress' },
            },
        });
        pushJsonLine(proc.stdout, {
            method: 'turn/completed',
            params: {
                threadId: 'thread-stale-steer',
                turn: { id: 'turn-stale', status: 'completed', error: null },
            },
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(client.activeTurnId).toBe('turn-recovered');
        expect(client.turnId).toBe('turn-recovered');
        expect(recoveredCompletionSettled).toBe(false);
        expect(events.filter((event) => event.provider_terminal === true && event.turn_id === 'turn-stale')).toHaveLength(1);

        pushJsonLine(proc.stdout, {
            method: 'turn/completed',
            params: {
                threadId: 'thread-stale-steer',
                turn: { id: 'turn-recovered', status: 'completed', error: null },
            },
        });
        await expect(recoveredCompletion).resolves.toEqual({ aborted: false });

        const turnStarts = requests.filter((request) => request.method === 'turn/start');
        expect(turnStarts).toHaveLength(2);
        expect(turnStarts[1]?.params.input).toEqual([{ type: 'text', text: 'follow up' }]);

        await client.disconnect();
    });

    it('does not reconcile steering failures that only partially match the inactive-turn error', async () => {
        let steerAttempt = 0;
        const proc = createMockProcess({
            pid: 2806,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => pushJsonLine(stdout, {
                        id: msg.id,
                        result: {
                            thread: { id: 'thread-steer-error', path: '/tmp/thread-steer-error' },
                            model: 'gpt-test',
                        },
                    }), 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => pushJsonLine(stdout, {
                        id: msg.id,
                        result: { turn: { id: 'turn-steer-error', status: 'inProgress' } },
                    }), 0);
                }

                if (msg.method === 'turn/steer' && msg.id != null) {
                    steerAttempt += 1;
                    setTimeout(() => pushJsonLine(stdout, {
                        id: msg.id,
                        error: steerAttempt === 1
                            ? { code: -32600, message: 'invalid expected turn id' }
                            : { code: -32603, message: 'no active turn to steer' },
                    }), 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });

        const completion = client.sendTurnAndWait('initial');
        await waitFor(() => client.activeTurnId === 'turn-steer-error');

        await expect(client.steerTurn('follow up')).rejects.toThrow('invalid expected turn id');
        expect(client.activeTurnId).toBe('turn-steer-error');
        await expect(client.steerTurn('follow up again')).rejects.toThrow('no active turn to steer');
        expect(client.activeTurnId).toBe('turn-steer-error');

        pushJsonLine(proc.stdout, {
            method: 'turn/completed',
            params: {
                threadId: 'thread-steer-error',
                turn: { id: 'turn-steer-error', status: 'completed', error: null },
            },
        });
        await expect(completion).resolves.toEqual({ aborted: false });

        await client.disconnect();
    });

    it('reports an inactive outcome when Codex does not own an active turn', async () => {
        const proc = createMockProcess({
            pid: 2807,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-idle', path: '/tmp/thread-idle' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });

        await expect(client.steerTurn('too late')).resolves.toBe('turn-not-active');

        await client.disconnect();
    });

    it('maps raw item notifications into legacy events and deduplicates turn completion', async () => {
        const requests: MockRpcMessage[] = [];
        const proc = createMockProcess({
            pid: 3001,
            onRequest: (msg, stdout) => {
                requests.push(msg);

                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-raw-1', path: '/tmp/thread-raw-1' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                turn: { id: 'turn-raw-1', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'thread/status/changed',
                            params: { threadId: 'thread-raw-1', status: { type: 'active', activeFlags: [] } },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: {
                                threadId: 'thread-raw-1',
                                turn: { id: 'turn-raw-1', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: 'thread-raw-1',
                                turnId: 'turn-raw-1',
                                item: {
                                    type: 'commandExecution',
                                    id: 'call-1',
                                    command: '/bin/zsh -lc pwd',
                                    cwd: '/tmp/project',
                                    status: 'inProgress',
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-raw-1',
                                turnId: 'turn-raw-1',
                                item: {
                                    type: 'subAgentActivity',
                                    id: 'activity-1',
                                    kind: 'started',
                                    agentThreadId: 'thread-child-1',
                                    agentPath: 'Auth explorer',
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-raw-1',
                                turnId: 'turn-raw-1',
                                item: {
                                    type: 'subAgentActivity',
                                    id: 'activity-1',
                                    kind: 'interrupted',
                                    agentThreadId: 'thread-child-1',
                                    agentPath: 'Auth explorer',
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-raw-1',
                                turnId: 'turn-raw-1',
                                item: {
                                    type: 'subAgentActivity',
                                    id: 'activity-1',
                                    kind: 'started',
                                    agentThreadId: 'thread-child-1',
                                    agentPath: 'Auth explorer',
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-raw-1',
                                turnId: 'turn-raw-1',
                                item: {
                                    type: 'commandExecution',
                                    id: 'call-1',
                                    command: '/bin/zsh -lc pwd',
                                    cwd: '/tmp/project',
                                    aggregatedOutput: '/tmp/project\n',
                                    exitCode: 0,
                                    durationMs: 1,
                                    status: 'completed',
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: 'thread-raw-1',
                                turnId: 'turn-raw-1',
                                item: {
                                    type: 'collabAgentToolCall',
                                    id: 'collab-1',
                                    tool: 'spawnAgent',
                                    status: 'inProgress',
                                    senderThreadId: 'thread-raw-1',
                                    receiverThreadIds: ['thread-child-1'],
                                    prompt: 'Inspect auth flow',
                                    model: 'gpt-test',
                                    reasoningEffort: 'medium',
                                    agentsStates: {},
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-raw-1',
                                turnId: 'turn-raw-1',
                                item: {
                                    type: 'collabAgentToolCall',
                                    id: 'collab-1',
                                    tool: 'spawnAgent',
                                    status: 'completed',
                                    senderThreadId: 'thread-raw-1',
                                    receiverThreadIds: ['thread-child-1'],
                                    prompt: 'Inspect auth flow',
                                    model: 'gpt-test',
                                    reasoningEffort: 'medium',
                                    agentsStates: {
                                        'thread-child-1': { status: 'completed', message: 'done' },
                                    },
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: 'thread-raw-1',
                                turnId: 'turn-raw-1',
                                item: {
                                    type: 'subAgentActivity',
                                    id: 'activity-1',
                                    kind: 'started',
                                    agentThreadId: 'thread-child-1',
                                    agentPath: 'Auth explorer',
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-raw-1',
                                turnId: 'turn-raw-1',
                                item: {
                                    type: 'imageGeneration',
                                    id: 'image-1',
                                    status: 'completed',
                                    revisedPrompt: null,
                                    result: 'base64-png',
                                    failure: null,
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-raw-1',
                                turnId: 'turn-raw-1',
                                item: {
                                    type: 'agentMessage',
                                    id: 'msg-1',
                                    text: 'done',
                                    phase: 'final_answer',
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'thread/status/changed',
                            params: { threadId: 'thread-raw-1', status: { type: 'idle' } },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/completed',
                            params: {
                                threadId: 'thread-raw-1',
                                turn: { id: 'turn-raw-1', items: [], status: 'completed', error: null },
                            },
                        });
                    }, 0);
                }
            },
        });

        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((msg) => {
            events.push(msg as Record<string, unknown>);
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });

        await expect(client.sendTurnAndWait('run pwd')).resolves.toEqual({ aborted: false });

        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'task_started', turn_id: 'turn-raw-1' }),
            expect.objectContaining({ type: 'exec_command_begin', callId: 'thread-raw-1:call-1' }),
            expect.objectContaining({ type: 'exec_command_end', callId: 'thread-raw-1:call-1', output: '/tmp/project\n' }),
            expect.objectContaining({
                type: 'collab_agent_begin',
                callId: 'collab-1',
                tool: 'spawnAgent',
                receiverThreadIds: ['thread-child-1'],
                prompt: 'Inspect auth flow',
            }),
            expect.objectContaining({
                type: 'collab_agent_end',
                callId: 'collab-1',
                status: 'completed',
                receiverThreadIds: ['thread-child-1'],
            }),
            expect.objectContaining({
                type: 'subagent_activity',
                item_id: 'activity-1',
                kind: 'started',
                agentThreadId: 'thread-child-1',
                agentPath: 'Auth explorer',
            }),
            expect.objectContaining({
                type: 'subagent_activity',
                item_id: 'activity-1',
                kind: 'interrupted',
                agentThreadId: 'thread-child-1',
                agentPath: 'Auth explorer',
            }),
            expect.objectContaining({ type: 'agent_message', message: 'done' }),
            expect.objectContaining({
                type: 'provider_output_item',
                item: expect.objectContaining({ type: 'imageGeneration', id: 'image-1' }),
            }),
        ]));
        expect(events.filter((event) => event.type === 'subagent_activity')).toHaveLength(2);
        expect(events.filter((event) => event.type === 'task_complete')).toHaveLength(1);

        await client.disconnect();
    });

    it('forwards account rate-limit snapshots to the event handler', async () => {
        const proc = createMockProcess({
            pid: 3002,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-rate-limits', path: '/tmp/thread-rate-limits' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'account/rateLimits/updated',
                            params: { primary: { usedPercent: 100, resetsAt: 1_800_000_000 } },
                        });
                    }, 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((msg) => events.push(msg as Record<string, unknown>));

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });
        await waitFor(() => events.some((event) => event.type === 'account_rate_limits_updated'));

        expect(events).toContainEqual({
            type: 'account_rate_limits_updated',
            rateLimits: { primary: { usedPercent: 100, resetsAt: 1_800_000_000 } },
        });
        await client.disconnect();
    });

    it('maps raw goal notifications into legacy goal events', async () => {
        const proc = createMockProcess({
            pid: 3003,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-goal-1', path: '/tmp/thread-goal-1' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'thread/goal/updated',
                            params: {
                                threadId: 'thread-goal-1',
                                turnId: 'turn-goal-1',
                                goal: {
                                    threadId: 'thread-goal-1',
                                    objective: 'finish the task',
                                    status: 'active',
                                    tokenBudget: null,
                                    tokensUsed: 11,
                                    timeUsedSeconds: 3,
                                    createdAt: 1781680000,
                                    updatedAt: 1781680003,
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'thread/goal/cleared',
                            params: { threadId: 'thread-goal-1' },
                        });
                    }, 0);
                }
            },
        });

        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((msg) => {
            events.push(msg as Record<string, unknown>);
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });

        await waitFor(() => events.some((event) => event.type === 'thread_goal_cleared'));

        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'thread_goal_updated',
                thread_id: 'thread-goal-1',
                threadId: 'thread-goal-1',
                turn_id: 'turn-goal-1',
                turnId: 'turn-goal-1',
                goal: expect.objectContaining({
                    threadId: 'thread-goal-1',
                    objective: 'finish the task',
                    status: 'active',
                }),
            }),
            expect.objectContaining({
                type: 'thread_goal_cleared',
                thread_id: 'thread-goal-1',
                threadId: 'thread-goal-1',
            }),
        ]));

        await client.disconnect();
    });

    it('sends goal set and clear requests through app-server', async () => {
        const requests: MockRpcMessage[] = [];
        const proc = createMockProcess({
            pid: 3004,
            onRequest: (msg, stdout) => {
                requests.push(msg);

                if (msg.method === 'thread/goal/set' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                goal: {
                                    threadId: 'thread-goal-1',
                                    objective: msg.params?.objective,
                                    status: 'active',
                                    tokenBudget: null,
                                    tokensUsed: 0,
                                    timeUsedSeconds: 0,
                                    createdAt: 1781680000,
                                    updatedAt: 1781680001,
                                },
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'thread/goal/clear' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: { cleared: true },
                        });
                    }, 0);
                }
            },
        });

        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();

        await client.connect();
        await expect(client.setGoal({
            threadId: 'thread-goal-1',
            objective: 'finish the task',
        })).resolves.toMatchObject({
            goal: {
                threadId: 'thread-goal-1',
                objective: 'finish the task',
                status: 'active',
            },
        });
        await expect(client.clearGoal({
            threadId: 'thread-goal-1',
        })).resolves.toEqual({ cleared: true });

        expect(requests).toEqual(expect.arrayContaining([
            expect.objectContaining({
                method: 'thread/goal/set',
                params: {
                    threadId: 'thread-goal-1',
                    objective: 'finish the task',
                },
            }),
            expect.objectContaining({
                method: 'thread/goal/clear',
                params: {
                    threadId: 'thread-goal-1',
                },
            }),
        ]));

        await client.disconnect();
    });

    it('maps raw file change items into legacy patch events', async () => {
        const proc = createMockProcess({
            pid: 3003,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-raw-3', path: '/tmp/thread-raw-3' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                turn: { id: 'turn-raw-3', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: {
                                threadId: 'thread-raw-3',
                                turn: { id: 'turn-raw-3', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: 'thread-raw-3',
                                turnId: 'turn-raw-3',
                                item: {
                                    type: 'fileChange',
                                    id: 'patch-1',
                                    status: 'inProgress',
                                    changes: [{
                                        path: 'README.md',
                                        kind: { type: 'update', move_path: null },
                                        diff: '@@ -1 +1 @@',
                                    }, {
                                        path: 'MONETIZATION.md',
                                        type: 'add',
                                        content: '# Monetization\n\nPaid plans.\n',
                                    }],
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-raw-3',
                                turnId: 'turn-raw-3',
                                item: {
                                    type: 'fileChange',
                                    id: 'patch-1',
                                    status: 'completed',
                                    changes: [{
                                        path: 'README.md',
                                        kind: { type: 'update', move_path: null },
                                        diff: '@@ -1 +1 @@',
                                    }, {
                                        path: 'MONETIZATION.md',
                                        type: 'add',
                                        content: '# Monetization\n\nPaid plans.\n',
                                    }],
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-raw-3',
                                turnId: 'turn-raw-3',
                                item: {
                                    type: 'agentMessage',
                                    id: 'msg-3',
                                    text: 'patched',
                                    phase: 'final_answer',
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/completed',
                            params: {
                                threadId: 'thread-raw-3',
                                turn: { id: 'turn-raw-3', status: 'completed', error: null },
                            },
                        });
                    }, 0);
                }
            },
        });

        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((msg) => {
            events.push(msg as Record<string, unknown>);
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });

        await expect(client.sendTurnAndWait('patch the file')).resolves.toEqual({ aborted: false });

        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'patch_apply_begin',
                callId: 'thread-raw-3:patch-1',
                changes: {
                    'README.md': {
                        diff: '@@ -1 +1 @@',
                        kind: { type: 'update', move_path: null },
                    },
                    'MONETIZATION.md': {
                        kind: { type: 'add', move_path: null },
                        add: { content: '# Monetization\n\nPaid plans.\n' },
                    },
                },
            }),
            expect.objectContaining({
                type: 'patch_apply_end',
                callId: 'thread-raw-3:patch-1',
                status: 'completed',
            }),
        ]));

        await client.disconnect();
    });

    it('hydrates v2 file change approvals from raw item metadata', async () => {
        const approvals: Array<Record<string, unknown>> = [];
        const proc = createMockProcess({
            pid: 3004,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-raw-4', path: '/tmp/thread-raw-4' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'on-request',
                                sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
                                reasoningEffort: null,
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: 'thread-raw-4',
                                turnId: 'turn-raw-4',
                                item: {
                                    type: 'fileChange',
                                    id: 'patch-approval-1',
                                    status: 'inProgress',
                                    changes: [{
                                        path: 'README.md',
                                        kind: { type: 'update', move_path: null },
                                        diff: '@@ -1 +1 @@',
                                    }],
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            id: 99,
                            method: 'item/fileChange/requestApproval',
                            params: {
                                threadId: 'thread-raw-4',
                                turnId: 'turn-raw-4',
                                itemId: 'patch-approval-1',
                                reason: null,
                                grantRoot: null,
                            },
                        });
                    }, 0);
                }
            },
        });

        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        client.setApprovalHandler(async (params) => {
            approvals.push(params as Record<string, unknown>);
            return 'approved';
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'on-request',
            sandbox: 'workspace-write',
        });

        await waitFor(() => approvals.length === 1);

        expect(approvals[0]).toEqual(expect.objectContaining({
            type: 'patch',
            callId: 'thread-raw-4:patch-approval-1',
            itemId: 'patch-approval-1',
            threadId: 'thread-raw-4',
            turnId: 'turn-raw-4',
            fileChanges: {
                'README.md': {
                    diff: '@@ -1 +1 @@',
                    kind: { type: 'update', move_path: null },
                },
            },
            reason: null,
        }));

        await client.disconnect();
    });

    it('scopes v2 approval IDs and raw file-change metadata by thread', async () => {
        const approvals: Array<Record<string, unknown>> = [];
        const proc = createMockProcess({
            pid: 3008,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-a', path: '/tmp/thread-a' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'on-request',
                                sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
                                reasoningEffort: null,
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: 'thread-a',
                                turnId: 'turn-a',
                                item: {
                                    type: 'fileChange',
                                    id: 'patch-shared',
                                    status: 'inProgress',
                                    changes: [{
                                        path: 'A.md',
                                        kind: { type: 'update', move_path: null },
                                        diff: '@@ A @@',
                                    }],
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: 'thread-b',
                                turnId: 'turn-b',
                                item: {
                                    type: 'fileChange',
                                    id: 'patch-shared',
                                    status: 'inProgress',
                                    changes: [{
                                        path: 'B.md',
                                        kind: { type: 'update', move_path: null },
                                        diff: '@@ B @@',
                                    }],
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            id: 101,
                            method: 'item/fileChange/requestApproval',
                            params: {
                                threadId: 'thread-a',
                                turnId: 'turn-a',
                                itemId: 'patch-shared',
                                reason: null,
                            },
                        });
                        pushJsonLine(stdout, {
                            id: 102,
                            method: 'item/fileChange/requestApproval',
                            params: {
                                threadId: 'thread-b',
                                turnId: 'turn-b',
                                itemId: 'patch-shared',
                                reason: null,
                            },
                        });
                        pushJsonLine(stdout, {
                            id: 103,
                            method: 'item/commandExecution/requestApproval',
                            params: {
                                threadId: 'thread-a',
                                turnId: 'turn-a',
                                itemId: 'cmd-shared',
                                approvalId: 'approval-a',
                                command: 'npm test',
                                cwd: '/tmp/project',
                                reason: null,
                            },
                        });
                    }, 0);
                }
            },
        });

        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        client.setApprovalHandler(async (params) => {
            approvals.push(params as Record<string, unknown>);
            return 'approved';
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'on-request',
            sandbox: 'workspace-write',
        });

        await waitFor(() => approvals.length === 3);

        expect(approvals).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'patch',
                callId: 'thread-a:patch-shared',
                itemId: 'patch-shared',
                threadId: 'thread-a',
                turnId: 'turn-a',
                fileChanges: {
                    'A.md': expect.objectContaining({ diff: '@@ A @@' }),
                },
            }),
            expect.objectContaining({
                type: 'patch',
                callId: 'thread-b:patch-shared',
                itemId: 'patch-shared',
                threadId: 'thread-b',
                turnId: 'turn-b',
                fileChanges: {
                    'B.md': expect.objectContaining({ diff: '@@ B @@' }),
                },
            }),
            // No approvalId suffix in callId: the app attaches the permission
            // card to its tool call by exact id equality with the scoped
            // exec_command_begin call id.
            expect.objectContaining({
                type: 'exec',
                callId: 'thread-a:cmd-shared',
                itemId: 'cmd-shared',
                threadId: 'thread-a',
                turnId: 'turn-a',
                approvalId: 'approval-a',
                command: ['npm test'],
            }),
        ]));

        await client.disconnect();
    });

    it('does not release the root waiter on a final-answer item without turn/completed', async () => {
        const proc = createMockProcess({
            pid: 3002,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-raw-2', path: '/tmp/thread-raw-2' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                turn: { id: 'turn-raw-2', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: {
                                threadId: 'thread-raw-2',
                                turn: { id: 'turn-raw-2', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-raw-2',
                                turnId: 'turn-raw-2',
                                item: {
                                    type: 'agentMessage',
                                    id: 'msg-2',
                                    text: 'still works',
                                    phase: 'final_answer',
                                },
                            },
                        });
                    }, 0);
                }
            },
        });

        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((msg) => {
            events.push(msg as Record<string, unknown>);
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });

        let settled = false;
        const pending = client.sendTurnAndWait('say hi', { turnTimeoutMs: 1 }).then((result) => {
            settled = true;
            return result;
        });
        await waitFor(() => events.some((event) => event.type === 'agent_message'));
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(settled).toBe(false);
        expect(events.some((event) => event.type === 'task_complete')).toBe(false);

        pushJsonLine(proc.stdout, {
            method: 'turn/completed',
            params: {
                threadId: 'thread-raw-2',
                turn: { id: 'turn-raw-2', status: 'completed', error: null },
            },
        });
        await expect(pending).resolves.toEqual({ aborted: false });
        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'task_started', turn_id: 'turn-raw-2' }),
            expect.objectContaining({ type: 'agent_message', message: 'still works' }),
            expect.objectContaining({ type: 'task_complete', turn_id: 'turn-raw-2' }),
        ]));

        await client.disconnect();
    });

    it('keeps child terminal evidence separate from the authoritative root lifecycle', async () => {
        const proc = createMockProcess({
            pid: 3008,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-root', path: '/tmp/thread-root' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: { turn: { id: 'turn-root', status: 'inProgress' } },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: {
                                threadId: 'thread-root',
                                turn: { id: 'turn-root', status: 'inProgress' },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'codex/event',
                            params: { msg: { type: 'task_complete', turn_id: 'turn-root' } },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: {
                                threadId: 'thread-child',
                                turn: { id: 'turn-child', status: 'inProgress' },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-child',
                                turnId: 'turn-child',
                                item: {
                                    type: 'agentMessage',
                                    id: 'child-message',
                                    text: 'partial child evidence',
                                    phase: 'commentary',
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/completed',
                            params: {
                                threadId: 'thread-child',
                                turn: {
                                    id: 'turn-child',
                                    status: 'failed',
                                    error: { message: 'child failed' },
                                },
                            },
                        });
                    }, 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((msg) => events.push(msg as Record<string, unknown>));

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });

        let settled = false;
        const pending = client.sendTurnAndWait('delegate').then((result) => {
            settled = true;
            return result;
        });
        await waitFor(() => events.some((event) => event.type === 'subagent_terminal'));
        expect(settled).toBe(false);
        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'agent_message',
                message: 'partial child evidence',
                agentThreadId: 'thread-child',
            }),
            expect.objectContaining({
                type: 'subagent_terminal',
                agentThreadId: 'thread-child',
                status: 'failed',
                error: { message: 'child failed' },
            }),
            expect.objectContaining({
                type: 'task_complete',
                provider_terminal: false,
            }),
        ]));

        pushJsonLine(proc.stdout, {
            method: 'turn/completed',
            params: {
                threadId: 'thread-root',
                turn: { id: 'turn-root', status: 'completed', error: null },
            },
        });
        await expect(pending).resolves.toEqual({ aborted: false });
        expect(events).toContainEqual(expect.objectContaining({
            type: 'task_complete',
            provider_terminal: true,
            turn_id: 'turn-root',
        }));

        await client.disconnect();
    });

    it('responds to MCP elicitation requests with an action payload', async () => {
        const approvals: Array<Record<string, unknown>> = [];
        const requests: MockRpcMessage[] = [];
        const proc = createMockProcess({
            pid: 3007,
            onRequest: (msg, stdout) => {
                requests.push(msg);
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-raw-7', path: '/tmp/thread-raw-7' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'on-request',
                                sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
                                reasoningEffort: null,
                            },
                        });
                        pushJsonLine(stdout, {
                            id: 77,
                            method: 'mcpServer/elicitation/request',
                            params: {
                                threadId: 'thread-raw-7',
                                turnId: 'turn-raw-7',
                                serverName: 'happy',
                                mode: 'form',
                                _meta: {
                                    codex_approval_kind: 'mcp_tool_call',
                                    tool_title: 'Change Chat Title',
                                    tool_description: 'Change the title of the current chat session',
                                    tool_params: { title: 'Casual Greeting' },
                                },
                                message: 'Allow the happy MCP server to run tool "change_title"?',
                                requestedSchema: {
                                    type: 'object',
                                    properties: {},
                                },
                            },
                        });
                    }, 0);
                }
            },
        });

        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        client.setApprovalHandler(async (params) => {
            approvals.push(params as Record<string, unknown>);
            return 'approved';
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'on-request',
            sandbox: 'workspace-write',
        });

        await waitFor(() => approvals.length === 1);
        await waitFor(() => requests.some((msg) => msg.id === 77 && msg.result?.action === 'accept'));

        expect(approvals[0]).toEqual(expect.objectContaining({
            type: 'mcp',
            callId: 'thread-raw-7:happy:77',
            itemId: 'happy:77',
            threadId: 'thread-raw-7',
            turnId: 'turn-raw-7',
            approvalId: '77',
            toolName: 'change_title',
            input: { title: 'Casual Greeting' },
            serverName: 'happy',
        }));
        expect(requests).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 77,
                result: {
                    action: 'accept',
                    content: {},
                    _meta: null,
                },
            }),
        ]));

        await client.disconnect();
    });
    it('preserves thread and turn identity on token usage updates', async () => {
        const proc = createMockProcess();
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((event) => events.push(event as Record<string, unknown>));

        await client.connect();
        pushJsonLine(proc.stdout, {
            method: 'thread/tokenUsage/updated',
            params: {
                threadId: 'thread-child',
                turnId: 'turn-child',
                tokenUsage: {
                    total: { totalTokens: 1_100, inputTokens: 1_000, outputTokens: 100 },
                    last: { totalTokens: 100, inputTokens: 80, outputTokens: 20 },
                    modelContextWindow: 200_000,
                },
            },
        });
        await waitFor(() => events.length === 1);

        expect(events[0]).toEqual(expect.objectContaining({
            type: 'token_count',
            thread_id: 'thread-child',
            threadId: 'thread-child',
            turn_id: 'turn-child',
            turnId: 'turn-child',
            total: expect.objectContaining({ totalTokens: 1_100 }),
            last: expect.objectContaining({ totalTokens: 100 }),
        }));

        await client.disconnect();
    });
});
