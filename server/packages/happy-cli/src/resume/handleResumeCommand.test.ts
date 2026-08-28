import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_SCOPED_ENV_KEYS } from '@/daemon/sessionEnvironment';

const mocks = vi.hoisted(() => ({
    mockExistsSync: vi.fn(),
    mockSpawnHappyCLI: vi.fn(),
    mockResolveLocalReconnectableSession: vi.fn(),
    mockHasLocalHappyAgentAuth: vi.fn(),
    mockResolveHappySession: vi.fn(),
    mockPrepareCommanderContext: vi.fn(),
    mockDetectAgentCapabilities: vi.fn(),
    mockDetectCLIAvailability: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return {
        ...actual,
        existsSync: mocks.mockExistsSync,
    };
});

vi.mock('@/utils/spawnHappyCLI', () => ({
    spawnHappyCLI: mocks.mockSpawnHappyCLI,
}));

vi.mock('@/agentContext/commanderContext', () => ({
    prepareCommanderContext: mocks.mockPrepareCommanderContext,
    contextEnvironment: () => ({
        HAPPYHERD_CONTEXT_BUNDLE_PATH: '/tmp/current-agentcontext.md',
        HAPPYHERD_CONTEXT_HASH: 'current-context-hash',
    }),
}));

vi.mock('@/utils/detectCLI', () => ({
    detectCLIAvailability: mocks.mockDetectCLIAvailability,
}));

vi.mock('@/capabilities/agentCapabilities', () => ({
    detectAgentCapabilities: mocks.mockDetectAgentCapabilities,
}));

vi.mock('./localResumeStore', () => {
    class MockLocalResumeSessionError extends Error {
        constructor(
            message: string,
            public readonly code: 'not_found' | 'ambiguous' | 'unavailable',
        ) {
            super(message);
            this.name = 'LocalResumeSessionError';
        }
    }

    return {
        LocalResumeSessionError: MockLocalResumeSessionError,
        resolveLocalReconnectableSession: mocks.mockResolveLocalReconnectableSession,
    };
});

vi.mock('@/resume/localHappyAgentAuth', () => ({
    hasLocalHappyAgentAuth: mocks.mockHasLocalHappyAgentAuth,
}));

vi.mock('./resolveHappySession', async () => {
    const actual = await vi.importActual<typeof import('./resolveHappySession')>('./resolveHappySession');
    return {
        ...actual,
        resolveHappySession: mocks.mockResolveHappySession,
    };
});

import { spawnHappyCLI } from '@/utils/spawnHappyCLI';

import { buildResumeLaunch, formatResumeHelp, handleResumeCommand, parseResumeCommandArgs } from './handleResumeCommand';
import { LocalResumeSessionError } from './localResumeStore';
import type { ReconnectableHappySession } from './resolveHappySession';

function createChildProcess(exitCode: number | null = 0) {
    const handlers = new Map<string, (...args: any[]) => void>();
    return {
        once: vi.fn((event: string, handler: (...args: any[]) => void) => {
            handlers.set(event, handler);
            if (event === 'exit') {
                queueMicrotask(() => handler(exitCode, null));
            }
            return undefined;
        }),
    };
}

function createReconnectableSession(): ReconnectableHappySession {
    return {
        id: 'session-1',
        active: false,
        metadata: {
            path: '/tmp/repo',
            flavor: 'codex',
            codexThreadId: '019ccca5-726b-7c61-b914-16de27dfab6e',
            host: 'localhost',
            homeDir: '/tmp',
            happyHomeDir: '/tmp/.happy',
            happyLibDir: '/tmp/happy',
            happyToolsDir: '/tmp/happy/tools',
            contextHash: 'historical-context-hash',
        },
        seq: 42,
        metadataVersion: 7,
        agentStateVersion: 9,
        encryptionKey: new Uint8Array([1, 2, 3, 4]),
        encryptionVariant: 'dataKey' as const,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockExistsSync.mockReturnValue(true);
    mocks.mockSpawnHappyCLI.mockReturnValue(createChildProcess());
    mocks.mockPrepareCommanderContext.mockResolvedValue({
        bundlePath: '/tmp/current-agentcontext.md',
        contextHash: 'current-context-hash',
    });
    mocks.mockResolveLocalReconnectableSession.mockRejectedValue(
        new LocalResumeSessionError('no local session', 'not_found'),
    );
    mocks.mockHasLocalHappyAgentAuth.mockReturnValue(false);
    mocks.mockDetectCLIAvailability.mockReturnValue({
        claude: false,
        codex: false,
        gemini: false,
        grok: true,
        agy: false,
        detectedAt: 1,
    });
    mocks.mockDetectAgentCapabilities.mockResolvedValue({
        capabilities: {
            grok: {
                detectedAt: 1,
                sources: { models: 'test', effortLevels: 'test', permissionModes: 'test' },
                models: [{ code: 'grok-build', value: 'GrokBuild', isDefault: true }],
                effortLevels: [],
                permissionModes: [
                    { code: 'default', value: 'Default', isDefault: true },
                    { code: 'dontAsk', value: 'Deny without prompting' },
                ],
            },
        },
    });
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('parseResumeCommandArgs', () => {
    it('parses the happy session id', () => {
        expect(parseResumeCommandArgs(['cmmij8olq00dp5jcxr3wtbpau'])).toEqual({
            showHelp: false,
            sessionId: 'cmmij8olq00dp5jcxr3wtbpau',
        });
    });

    it('recognizes help flags', () => {
        expect(parseResumeCommandArgs(['--help'])).toEqual({
            showHelp: true,
            sessionId: '',
        });
    });

    it('rejects missing session ids', () => {
        expect(() => parseResumeCommandArgs([])).toThrow(
            'Happy session ID is required: happy resume <session-id>',
        );
    });
});

describe('buildResumeLaunch', () => {
    it('builds a Codex resume command', () => {
        expect(buildResumeLaunch({
            id: 'session-1',
            active: false,
            metadata: {
                path: '/tmp/p1-control-flow',
                flavor: 'codex',
                codexThreadId: '019ccca5-726b-7c61-b914-16de27dfab6e',
                host: 'localhost',
                homeDir: '/tmp',
                happyHomeDir: '/tmp/.happy',
                happyLibDir: '/tmp/happy',
                happyToolsDir: '/tmp/happy/tools',
            },
        })).toEqual({
            cwd: '/tmp/p1-control-flow',
            args: ['codex', '--resume', '019ccca5-726b-7c61-b914-16de27dfab6e'],
        });
    });

    it('builds a Claude resume command', () => {
        expect(buildResumeLaunch({
            id: 'session-2',
            active: false,
            metadata: {
                path: '/tmp/repo',
                flavor: 'claude',
                claudeSessionId: '93a9705e-bc6a-406d-8dce-8acc014dedbd',
                host: 'localhost',
                homeDir: '/tmp',
                happyHomeDir: '/tmp/.happy',
                happyLibDir: '/tmp/happy',
                happyToolsDir: '/tmp/happy/tools',
            },
        })).toEqual({
            cwd: '/tmp/repo',
            args: ['claude', '--resume', '93a9705e-bc6a-406d-8dce-8acc014dedbd'],
        });
    });

    it('builds a GrokBuild resume command from the provider ACP session ID', () => {
        expect(buildResumeLaunch({
            id: 'session-grok',
            active: false,
            metadata: {
                path: '/tmp/repo',
                flavor: 'grok',
                acpSessionId: 'grok-provider-session',
                host: 'localhost',
                homeDir: '/tmp',
                happyHomeDir: '/tmp/.happy',
                happyLibDir: '/tmp/happy',
                happyToolsDir: '/tmp/happy/tools',
            },
        }, { startedBy: 'daemon' })).toEqual({
            cwd: '/tmp/repo',
            args: ['grok', '--started-by', 'daemon', '--resume', 'grok-provider-session'],
        });
    });

    it('rejects unsupported flavors', () => {
        expect(() => buildResumeLaunch({
            id: 'session-3',
            active: false,
            metadata: {
                path: '/tmp/repo',
                flavor: 'gemini',
                host: 'localhost',
                homeDir: '/tmp',
                happyHomeDir: '/tmp/.happy',
                happyLibDir: '/tmp/happy',
                happyToolsDir: '/tmp/happy/tools',
            },
        })).toThrow('Happy session session-3 uses unsupported flavor "gemini".');
    });

    it('does not reinterpret another ACP flavor as GrokBuild', () => {
        expect(() => buildResumeLaunch({
            id: 'session-acp',
            active: false,
            metadata: {
                path: '/tmp/repo',
                flavor: 'acp',
                acpSessionId: 'another-provider-session',
                host: 'localhost',
                homeDir: '/tmp',
                happyHomeDir: '/tmp/.happy',
                happyLibDir: '/tmp/happy',
                happyToolsDir: '/tmp/happy/tools',
            },
        })).toThrow('Happy session session-acp uses unsupported flavor "acp".');
    });
});

describe('formatResumeHelp', () => {
    it('mentions the session id command shape', () => {
        expect(formatResumeHelp()).toContain('happy resume <happy-session-id>');
    });
});

describe('handleResumeCommand', () => {
    it('revalidates and preserves a local Grok launch policy on terminal resume', async () => {
        const session = createReconnectableSession();
        session.metadata = {
            ...session.metadata,
            flavor: 'grok',
            codexThreadId: undefined,
            acpSessionId: 'grok-provider-session',
            spawnSettings: {
                provider: 'grok',
                model: 'grok-build',
                effort: null,
                permission: 'dontAsk',
            },
        };
        mocks.mockResolveLocalReconnectableSession.mockResolvedValue(session);

        await handleResumeCommand(['session-1']);

        expect(mocks.mockDetectAgentCapabilities).toHaveBeenCalledOnce();
        expect(spawnHappyCLI).toHaveBeenCalledWith(
            ['grok', '--resume', 'grok-provider-session', '--permission-mode', 'dontAsk'],
            expect.objectContaining({ cwd: '/tmp/repo', stdio: 'inherit' }),
        );
    });

    it('uses the current advertised default for a receipt-less legacy Grok session', async () => {
        const session = createReconnectableSession();
        session.metadata = {
            ...session.metadata,
            flavor: 'grok',
            codexThreadId: undefined,
            acpSessionId: 'legacy-grok-provider-session',
        };
        mocks.mockResolveLocalReconnectableSession.mockResolvedValue(session);

        await handleResumeCommand(['session-1']);

        expect(mocks.mockDetectAgentCapabilities).toHaveBeenCalledOnce();
        expect(spawnHappyCLI).toHaveBeenCalledWith(
            ['grok', '--resume', 'legacy-grok-provider-session', '--permission-mode', 'default'],
            expect.objectContaining({ cwd: '/tmp/repo', stdio: 'inherit' }),
        );
    });

    it('resumes from local persisted encryption data', async () => {
        const session = createReconnectableSession();
        session.metadata.codexHome = '/tmp';
        mocks.mockResolveLocalReconnectableSession.mockResolvedValue(session);
        vi.stubEnv('CODEX_HOME', '/var/tmp');
        for (const key of SESSION_SCOPED_ENV_KEYS) {
            vi.stubEnv(key, `stale-${key}`);
        }

        await handleResumeCommand(['session-1']);

        expect(mocks.mockHasLocalHappyAgentAuth).not.toHaveBeenCalled();
        expect(mocks.mockResolveHappySession).not.toHaveBeenCalled();
        expect(spawnHappyCLI).toHaveBeenCalledOnce();
        const [spawnArgs, spawnOptions] = mocks.mockSpawnHappyCLI.mock.calls[0];
        expect(spawnArgs).toEqual(['codex', '--resume', session.metadata.codexThreadId]);
        expect(spawnOptions.cwd).toBe('/tmp/repo');
        expect(spawnOptions.stdio).toBe('inherit');
        const expectedEnv = {
            HAPPY_RECONNECT_SESSION_ID: 'session-1',
            HAPPY_RECONNECT_ENCRYPTION_KEY: 'AQIDBA==',
            HAPPY_RECONNECT_ENCRYPTION_VARIANT: 'dataKey',
            HAPPY_RECONNECT_SEQ: '42',
            HAPPY_RECONNECT_METADATA_VERSION: '7',
            HAPPY_RECONNECT_AGENT_STATE_VERSION: '9',
            HAPPYHERD_CONTEXT_BUNDLE_PATH: '/tmp/current-agentcontext.md',
            HAPPYHERD_CONTEXT_HASH: 'current-context-hash',
            CODEX_HOME: '/tmp',
        };
        for (const [key, value] of Object.entries(expectedEnv)) {
            expect(spawnOptions.env[key]).toBe(value);
        }
        const spawnedEnv = mocks.mockSpawnHappyCLI.mock.calls[0][1].env;
        expect(spawnedEnv).not.toHaveProperty('HAPPY_RECONNECT_CONTEXT_HASH');
        expect(spawnedEnv).not.toHaveProperty('HAPPY_FORK_CODEX_THREAD_ID');
        expect(spawnedEnv).not.toHaveProperty('CODEX_THREAD_ID');
    });

    it('does not suggest happy-agent auth login when no local resume data or agent.key exists', async () => {
        mocks.mockResolveLocalReconnectableSession.mockRejectedValue(
            new LocalResumeSessionError(
                'Cannot resume Happy session "missing" on this machine: no local session encryption data found at /tmp/.happy/sessions.json.',
                'not_found',
            ),
        );
        let thrown: unknown;
        try {
            await handleResumeCommand(['missing']);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toContain('no local session encryption data found');
        expect((thrown as Error).message).not.toContain('happy-agent auth login');
        expect(mocks.mockSpawnHappyCLI).not.toHaveBeenCalled();
    });

    it('falls back to legacy provider resume only when agent.key is already present', async () => {
        mocks.mockHasLocalHappyAgentAuth.mockReturnValue(true);
        mocks.mockResolveHappySession.mockResolvedValue({
            id: 'legacy-session',
            active: false,
            metadata: {
                path: '/tmp/repo',
                flavor: 'claude',
                claudeSessionId: '93a9705e-bc6a-406d-8dce-8acc014dedbd',
                host: 'localhost',
                homeDir: '/tmp',
                happyHomeDir: '/tmp/.happy',
                happyLibDir: '/tmp/happy',
                happyToolsDir: '/tmp/happy/tools',
            },
        });
        for (const key of SESSION_SCOPED_ENV_KEYS) {
            vi.stubEnv(key, `stale-${key}`);
        }

        await handleResumeCommand(['legacy-session']);

        expect(mocks.mockResolveHappySession).toHaveBeenCalledWith('legacy-session');
        expect(spawnHappyCLI).toHaveBeenCalledWith(
            ['claude', '--resume', '93a9705e-bc6a-406d-8dce-8acc014dedbd'],
            expect.objectContaining({
                cwd: '/tmp/repo',
                env: expect.any(Object),
                stdio: 'inherit',
            }),
        );
        const spawnedEnv = mocks.mockSpawnHappyCLI.mock.calls[0][1].env;
        for (const key of SESSION_SCOPED_ENV_KEYS) {
            expect(spawnedEnv).not.toHaveProperty(key);
        }
    });
});
