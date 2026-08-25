import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_SCOPED_ENV_KEYS } from '@/daemon/sessionEnvironment';

const mocks = vi.hoisted(() => ({
    mockExistsSync: vi.fn(),
    mockSpawnHappyCLI: vi.fn(),
    mockResolveLocalReconnectableSession: vi.fn(),
    mockHasLocalHappyAgentAuth: vi.fn(),
    mockReadCredentials: vi.fn(),
    mockResolveReconnectableSession: vi.fn(),
    mockPrepareCommanderContext: vi.fn(),
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

vi.mock('@/persistence', () => ({
    readCredentials: mocks.mockReadCredentials,
}));

vi.mock('./resolveHappySession', async () => {
    const actual = await vi.importActual<typeof import('./resolveHappySession')>('./resolveHappySession');
    return {
        ...actual,
        resolveReconnectableSession: mocks.mockResolveReconnectableSession,
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
    mocks.mockReadCredentials.mockResolvedValue(null);
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
});

describe('formatResumeHelp', () => {
    it('mentions the session id command shape', () => {
        expect(formatResumeHelp()).toContain('happy resume <happy-session-id>');
    });
});

describe('handleResumeCommand', () => {
    it('resumes from local persisted encryption data without legacy agent.key auth', async () => {
        const session = createReconnectableSession();
        session.metadata.codexHome = '/tmp';
        mocks.mockResolveLocalReconnectableSession.mockResolvedValue(session);
        vi.stubEnv('CODEX_HOME', '/var/tmp');
        for (const key of SESSION_SCOPED_ENV_KEYS) {
            vi.stubEnv(key, `stale-${key}`);
        }

        await handleResumeCommand(['session-1']);

        expect(mocks.mockHasLocalHappyAgentAuth).not.toHaveBeenCalled();
        expect(mocks.mockResolveReconnectableSession).not.toHaveBeenCalled();
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
        mocks.mockHasLocalHappyAgentAuth.mockReturnValue(false);

        let thrown: unknown;
        try {
            await handleResumeCommand(['missing']);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toContain('no local session encryption data found');
        expect((thrown as Error).message).not.toContain('happy-agent auth login');
    });

    it('falls back to a legacy access.key when agent.key is absent', async () => {
        mocks.mockReadCredentials.mockResolvedValue({
            token: 'legacy-token',
            encryption: {
                type: 'legacy',
                secret: new Uint8Array([9, 8, 7, 6]),
            },
        });
        mocks.mockResolveReconnectableSession.mockResolvedValue({
            id: 'legacy-session',
            active: false,
            metadata: {
                path: '/tmp/repo',
                flavor: 'codex',
                codexThreadId: '019ccca5-726b-7c61-b914-16de27dfab6e',
                codexHome: '/tmp',
                host: 'localhost',
                homeDir: '/tmp',
                happyHomeDir: '/tmp/.happy',
                happyLibDir: '/tmp/happy',
                happyToolsDir: '/tmp/happy/tools',
            },
            seq: 42,
            metadataVersion: 7,
            agentStateVersion: 9,
            encryptionKey: new Uint8Array([1, 2, 3, 4]),
            encryptionVariant: 'dataKey',
        });
        vi.stubEnv('CODEX_HOME', '/var/tmp');
        for (const key of SESSION_SCOPED_ENV_KEYS) {
            vi.stubEnv(key, `stale-${key}`);
        }

        await handleResumeCommand(['legacy-session']);

        expect(mocks.mockHasLocalHappyAgentAuth).not.toHaveBeenCalled();
        expect(mocks.mockResolveReconnectableSession).toHaveBeenCalledWith('legacy-session');
        expect(mocks.mockSpawnHappyCLI.mock.calls[0][0]).toEqual([
            'codex',
            '--resume',
            '019ccca5-726b-7c61-b914-16de27dfab6e',
        ]);
        const spawnedEnv = mocks.mockSpawnHappyCLI.mock.calls[0][1].env;
        expect(spawnedEnv.CODEX_HOME).toBe('/tmp');
        expect(spawnedEnv.HAPPY_RECONNECT_SESSION_ID).toBe('legacy-session');
        expect(spawnedEnv.HAPPY_RECONNECT_ENCRYPTION_KEY).toBe('AQIDBA==');
        expect(spawnedEnv.HAPPY_FORK_CODEX_THREAD_ID).toBeUndefined();
    });
});
