import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SESSION_SCOPED_ENV_KEYS } from '@/daemon/sessionEnvironment';
import { activateCredentialAccount } from '@/credentialPool/activate';
import { markCredentialAccountLimited, renameCredentialAccount, upsertCredentialAccount, useCredentialAccount } from '@/credentialPool/store';

const mocks = vi.hoisted(() => ({
    mockExistsSync: vi.fn(),
    mockSpawnHappyHerdCLI: vi.fn(),
    mockResolveLocalReconnectableSession: vi.fn(),
    mockHasLocalHappyHerdAgentAuth: vi.fn(),
    mockResolveHappyHerdSession: vi.fn(),
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

vi.mock('@/utils/spawnHappyHerdCLI', () => ({
    spawnHappyHerdCLI: mocks.mockSpawnHappyHerdCLI,
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

vi.mock('@/resume/localHappyHerdAgentAuth', () => ({
    hasLocalHappyHerdAgentAuth: mocks.mockHasLocalHappyHerdAgentAuth,
}));

vi.mock('./resolveHappyHerdSession', async () => {
    const actual = await vi.importActual<typeof import('./resolveHappyHerdSession')>('./resolveHappyHerdSession');
    return {
        ...actual,
        resolveHappyHerdSession: mocks.mockResolveHappyHerdSession,
    };
});

import { spawnHappyHerdCLI } from '@/utils/spawnHappyHerdCLI';

import { buildResumeLaunch, formatResumeHelp, handleResumeCommand, parseResumeCommandArgs } from './handleResumeCommand';
import { LocalResumeSessionError } from './localResumeStore';
import type { ReconnectableHappyHerdSession } from './resolveHappyHerdSession';

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

function createReconnectableSession(): ReconnectableHappyHerdSession {
    return {
        id: 'session-1',
        active: false,
        metadata: {
            path: '/tmp/repo',
            flavor: 'codex',
            codexThreadId: '019ccca5-726b-7c61-b914-16de27dfab6e',
            host: 'localhost',
            homeDir: '/tmp',
            happyHomeDir: '/tmp/.happyherd',
            happyLibDir: '/tmp/happyherd',
            happyToolsDir: '/tmp/happyherd/tools',
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
    mocks.mockSpawnHappyHerdCLI.mockReturnValue(createChildProcess());
    mocks.mockPrepareCommanderContext.mockResolvedValue({
        bundlePath: '/tmp/current-agentcontext.md',
        contextHash: 'current-context-hash',
    });
    mocks.mockResolveLocalReconnectableSession.mockRejectedValue(
        new LocalResumeSessionError('no local session', 'not_found'),
    );
    mocks.mockHasLocalHappyHerdAgentAuth.mockReturnValue(false);
    mocks.mockDetectCLIAvailability.mockReturnValue({
        claude: true,
        codex: true,
        gemini: false,
        grok: true,
        dsh: true,
        agy: false,
        detectedAt: 1,
    });
    mocks.mockDetectAgentCapabilities.mockResolvedValue({
        capabilities: {
            claude: {
                detectedAt: 1,
                sources: { models: 'test', effortLevels: 'test', permissionModes: 'test' },
                models: [
                    { code: 'default', value: 'Default' },
                    { code: 'claude-opus-test', value: 'Claude Opus Test' },
                ],
                effortLevels: [
                    { code: 'max', value: 'Max', isDefault: true },
                    { code: 'high', value: 'High' },
                ],
                permissionModes: [
                    { code: 'default', value: 'Default', isDefault: true },
                    { code: 'bypassPermissions', value: 'Bypass permissions' },
                    { code: 'plan', value: 'Plan' },
                ],
            },
            codex: {
                detectedAt: 1,
                sources: { models: 'test', effortLevels: 'test', permissionModes: 'test' },
                models: [
                    { code: 'gpt-5.6-codex', value: 'GPT-5.6 Codex', isDefault: true },
                    { code: 'gpt-custom', value: 'GPT Custom' },
                ],
                effortLevels: [
                    { code: 'xhigh', value: 'Extra high', isDefault: true },
                    { code: 'high', value: 'High' },
                ],
                permissionModes: [
                    { code: 'default', value: 'Ask first' },
                    { code: 'auto', value: 'Auto' },
                    { code: 'read-only', value: 'Read only' },
                    { code: 'safe-yolo', value: 'Workspace', isDefault: true },
                    { code: 'yolo', value: 'Full access' },
                ],
            },
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
            dsh: {
                detectedAt: 1,
                sources: { models: 'test', effortLevels: 'test', permissionModes: 'test' },
                models: [{ code: 'deepseek-v4-flash', value: 'DeepSeek V4 Flash', isDefault: true }],
                effortLevels: [{ code: 'high', value: 'High', isDefault: true }],
                permissionModes: [{ code: 'workspace-write', value: 'Workspace write', isDefault: true }],
                acp: { loadSession: false, resumeSession: true, prompt: { image: false } },
            },
        },
    });
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('parseResumeCommandArgs', () => {
    it('parses the happyherd session id', () => {
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
            'HappyHerd session ID is required: happyherd resume <session-id>',
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
                happyHomeDir: '/tmp/.happyherd',
                happyLibDir: '/tmp/happyherd',
                happyToolsDir: '/tmp/happyherd/tools',
            },
        })).toEqual({
            cwd: '/tmp/p1-control-flow',
            args: ['codex', '--resume', '019ccca5-726b-7c61-b914-16de27dfab6e', '--provider-account-mode', 'unmanaged'],
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
                happyHomeDir: '/tmp/.happyherd',
                happyLibDir: '/tmp/happyherd',
                happyToolsDir: '/tmp/happyherd/tools',
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
                happyHomeDir: '/tmp/.happyherd',
                happyLibDir: '/tmp/happyherd',
                happyToolsDir: '/tmp/happyherd/tools',
            },
        }, { startedBy: 'daemon' })).toEqual({
            cwd: '/tmp/repo',
            args: ['grok', '--started-by', 'daemon', '--resume', 'grok-provider-session'],
        });
    });

    it('builds a DSH resume command from the provider ACP session ID', () => {
        expect(buildResumeLaunch({
            id: 'session-dsh',
            active: false,
            metadata: {
                path: '/tmp/repo',
                flavor: 'dsh',
                acpSessionId: 'dsh-provider-session',
                host: 'localhost',
                homeDir: '/tmp',
                happyHomeDir: '/tmp/.happyherd',
                happyLibDir: '/tmp/happyherd',
                happyToolsDir: '/tmp/happyherd/tools',
            },
        }, { startedBy: 'daemon' })).toEqual({
            cwd: '/tmp/repo',
            args: ['dsh', '--started-by', 'daemon', '--resume', 'dsh-provider-session'],
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
                happyHomeDir: '/tmp/.happyherd',
                happyLibDir: '/tmp/happyherd',
                happyToolsDir: '/tmp/happyherd/tools',
            },
        })).toThrow('HappyHerd session session-3 uses unsupported flavor "gemini".');
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
                happyHomeDir: '/tmp/.happyherd',
                happyLibDir: '/tmp/happyherd',
                happyToolsDir: '/tmp/happyherd/tools',
            },
        })).toThrow('HappyHerd session session-acp uses unsupported flavor "acp".');
    });
});

describe('formatResumeHelp', () => {
    it('mentions the session id command shape', () => {
        expect(formatResumeHelp()).toContain('happyherd resume <happyherd-session-id>');
    });
});

describe('handleResumeCommand', () => {
    it.each(['local', 'legacy'] as const)('preserves a renamed managed account by stable ID through %s resume and still rotates on quota', async (source) => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-resume-identity-'));
        const paths = { stateFile: join(root, 'pool.json'), accountsDir: join(root, 'accounts') };
        try {
            const account = await upsertCredentialAccount({
                provider: 'codex', name: 'account-a',
                credential: { type: 'auth-file', path: join(root, 'a-auth.json') },
            }, { paths });
            await upsertCredentialAccount({
                provider: 'codex', name: 'account-b',
                credential: { type: 'auth-file', path: join(root, 'b-auth.json') },
            }, { paths });
            const session = createReconnectableSession();
            session.metadata.providerAccount = account.name;
            session.metadata.providerAccountId = account.id;
            session.metadata.codexHome = root;
            await renameCredentialAccount('codex', account.name, 'renamed-a', paths);
            await useCredentialAccount('codex', 'account-b', paths);
            if (source === 'local') {
                mocks.mockResolveLocalReconnectableSession.mockResolvedValue(session);
            } else {
                mocks.mockHasLocalHappyHerdAgentAuth.mockReturnValue(true);
                mocks.mockResolveHappyHerdSession.mockResolvedValue(session);
            }
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_ID', 'stale-parent-id');

            await handleResumeCommand([session.id]);
            const [args, { env }] = mocks.mockSpawnHappyHerdCLI.mock.calls[0];
            expect(args).not.toContain('--provider-account-mode');
            expect(env.HAPPYHERD_PROVIDER_ACCOUNT_ID).toBe(account.id);
            expect(env.HAPPYHERD_PROVIDER_ACCOUNT_TYPE).toBe('codex');
            expect(env.HAPPYHERD_PROVIDER_ACCOUNT).toBe('account-a');
            await expect(activateCredentialAccount('codex', { paths, env: { ...env } })).resolves.toMatchObject({
                type: 'available', account: { id: account.id, name: 'renamed-a' },
            });

            await markCredentialAccountLimited('codex', 'renamed-a', Date.now() + 60_000, { paths });
            await expect(activateCredentialAccount('codex', { paths, env: { ...env } })).resolves.toMatchObject({
                type: 'available', account: { name: 'account-b' },
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it.each(['local', 'legacy'] as const)('keeps unmanaged Codex side chats on native auth through %s resume', async (source) => {
        const session = createReconnectableSession();
        session.metadata.isSideChat = true;
        session.metadata.parentSessionId = 'parent';
        session.metadata.codexHome = '/tmp/native-codex';
        if (source === 'local') {
            mocks.mockResolveLocalReconnectableSession.mockResolvedValue(session);
        } else {
            mocks.mockHasLocalHappyHerdAgentAuth.mockReturnValue(true);
            mocks.mockResolveHappyHerdSession.mockResolvedValue(session);
        }
        vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT', 'ambient-managed');
        vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_ID', 'ambient-managed-id');
        vi.stubEnv('HAPPYHERD_CODEX_ACCOUNT_AUTH_FILE', '/managed/auth.json');

        await handleResumeCommand([session.id]);

        const [args, { env }] = mocks.mockSpawnHappyHerdCLI.mock.calls[0];
        expect(args).toEqual(expect.arrayContaining(['--provider-account-mode', 'unmanaged']));
        expect(env).not.toHaveProperty('HAPPYHERD_PROVIDER_ACCOUNT');
        expect(env).not.toHaveProperty('HAPPYHERD_PROVIDER_ACCOUNT_ID');
        expect(env).not.toHaveProperty('HAPPYHERD_CODEX_ACCOUNT_AUTH_FILE');
        expect(env.CODEX_HOME).toBe('/tmp/native-codex');
    });

    it('revalidates and preserves a local Grok launch policy on terminal resume', async () => {
        const session = createReconnectableSession();
        session.metadata = {
            ...session.metadata,
            flavor: 'grok',
            codexThreadId: undefined,
            acpSessionId: 'grok-provider-session',
            grokHome: '/srv/grok/original-home',
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
        expect(spawnHappyHerdCLI).toHaveBeenCalledWith(
            ['grok', '--resume', 'grok-provider-session', '--permission-mode', 'dontAsk'],
            expect.objectContaining({
                cwd: '/tmp/repo',
                stdio: 'inherit',
                env: expect.objectContaining({ GROK_HOME: '/srv/grok/original-home' }),
            }),
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
        expect(spawnHappyHerdCLI).toHaveBeenCalledWith(
            ['grok', '--resume', 'legacy-grok-provider-session', '--permission-mode', 'default'],
            expect.objectContaining({ cwd: '/tmp/repo', stdio: 'inherit' }),
        );
    });

    it('revalidates and restores DSH launch settings on terminal resume', async () => {
        const session = createReconnectableSession();
        session.metadata = {
            ...session.metadata,
            flavor: 'dsh',
            codexThreadId: undefined,
            acpSessionId: 'dsh-provider-session',
            spawnSettings: {
                provider: 'dsh',
                model: 'deepseek-v4-flash',
                effort: 'high',
                permission: 'workspace-write',
            },
        };
        mocks.mockResolveLocalReconnectableSession.mockResolvedValue(session);

        await handleResumeCommand(['session-1']);

        expect(mocks.mockDetectAgentCapabilities).toHaveBeenCalledOnce();
        expect(spawnHappyHerdCLI).toHaveBeenCalledWith(
            [
                'dsh',
                '--resume', 'dsh-provider-session',
                '--permission-mode', 'workspace-write',
                '--model', 'deepseek-v4-flash',
                '--effort', 'high',
            ],
            expect.objectContaining({
                cwd: '/tmp/repo',
                env: expect.objectContaining({
                    HAPPYHERD_MACHINE_SESSION_SETTINGS_JSON: JSON.stringify({
                        provider: 'dsh',
                        model: 'deepseek-v4-flash',
                        effort: 'high',
                        permission: 'workspace-write',
                    }),
                }),
            }),
        );
    });

    it('restores the latest persisted Codex mode with receipt fallbacks for unchanged dimensions', async () => {
        const session = createReconnectableSession();
        session.metadata.permissionMode = 'read-only';
        session.metadata.spawnSettings = {
            provider: 'codex',
            model: 'gpt-custom',
            effort: 'high',
            permission: 'yolo',
        };
        mocks.mockResolveLocalReconnectableSession.mockResolvedValue(session);

        await handleResumeCommand(['session-1']);

        expect(spawnHappyHerdCLI).toHaveBeenCalledWith(
            [
                'codex',
                '--resume', session.metadata.codexThreadId,
                '--provider-account-mode', 'unmanaged',
                '--permission-mode', 'read-only',
                '--model', 'gpt-custom',
                '--effort', 'high',
            ],
            expect.objectContaining({
                cwd: '/tmp/repo',
                env: expect.objectContaining({
                    HAPPYHERD_MACHINE_SESSION_SETTINGS_JSON: JSON.stringify({
                        provider: 'codex',
                        model: 'gpt-custom',
                        effort: 'high',
                        permission: 'read-only',
                    }),
                }),
            }),
        );
    });

    it('revalidates and restores the complete Claude tuple on terminal resume', async () => {
        const session = createReconnectableSession();
        session.metadata = {
            ...session.metadata,
            flavor: 'claude',
            codexThreadId: undefined,
            claudeSessionId: '11111111-1111-4111-8111-111111111111',
            permissionMode: 'bypassPermissions',
            modelMode: 'claude-opus-test',
            effortLevel: 'high',
            spawnSettings: {
                provider: 'claude',
                model: 'default',
                effort: 'max',
                permission: 'default',
            },
        };
        mocks.mockResolveLocalReconnectableSession.mockResolvedValue(session);

        await handleResumeCommand(['session-1']);

        expect(spawnHappyHerdCLI).toHaveBeenCalledWith(
            [
                'claude',
                '--resume', session.metadata.claudeSessionId,
                '--permission-mode', 'bypassPermissions',
                '--model', 'claude-opus-test',
                '--effort', 'high',
            ],
            expect.objectContaining({
                cwd: '/tmp/repo',
                env: expect.objectContaining({
                    HAPPYHERD_MACHINE_SESSION_SETTINGS_JSON: JSON.stringify({
                        provider: 'claude',
                        model: 'claude-opus-test',
                        effort: 'high',
                        permission: 'bypassPermissions',
                    }),
                }),
            }),
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

        expect(mocks.mockHasLocalHappyHerdAgentAuth).not.toHaveBeenCalled();
        expect(mocks.mockResolveHappyHerdSession).not.toHaveBeenCalled();
        expect(spawnHappyHerdCLI).toHaveBeenCalledOnce();
        const [spawnArgs, spawnOptions] = mocks.mockSpawnHappyHerdCLI.mock.calls[0];
        expect(spawnArgs).toEqual([
            'codex',
            '--resume', session.metadata.codexThreadId,
            '--provider-account-mode', 'unmanaged',
            '--permission-mode', 'safe-yolo',
            '--model', 'gpt-5.6-codex',
            '--effort', 'xhigh',
        ]);
        expect(spawnOptions.cwd).toBe('/tmp/repo');
        expect(spawnOptions.stdio).toBe('inherit');
        const expectedEnv = {
            HAPPYHERD_RECONNECT_SESSION_ID: 'session-1',
            HAPPYHERD_RECONNECT_ENCRYPTION_KEY: 'AQIDBA==',
            HAPPYHERD_RECONNECT_ENCRYPTION_VARIANT: 'dataKey',
            HAPPYHERD_RECONNECT_SEQ: '42',
            HAPPYHERD_RECONNECT_METADATA_VERSION: '7',
            HAPPYHERD_RECONNECT_AGENT_STATE_VERSION: '9',
            HAPPYHERD_CONTEXT_BUNDLE_PATH: '/tmp/current-agentcontext.md',
            HAPPYHERD_CONTEXT_HASH: 'current-context-hash',
            CODEX_HOME: '/tmp',
            HAPPYHERD_MACHINE_SESSION_SETTINGS_JSON: JSON.stringify({
                provider: 'codex',
                model: 'gpt-5.6-codex',
                effort: 'xhigh',
                permission: 'safe-yolo',
            }),
        };
        for (const [key, value] of Object.entries(expectedEnv)) {
            expect(spawnOptions.env[key]).toBe(value);
        }
        const spawnedEnv = mocks.mockSpawnHappyHerdCLI.mock.calls[0][1].env;
        expect(spawnedEnv).not.toHaveProperty('HAPPYHERD_RECONNECT_CONTEXT_HASH');
        expect(spawnedEnv).not.toHaveProperty('HAPPYHERD_FORK_CODEX_THREAD_ID');
        expect(spawnedEnv).not.toHaveProperty('CODEX_THREAD_ID');
    });

    it('does not suggest happyherd-control-agent auth login when no local resume data or agent.key exists', async () => {
        mocks.mockResolveLocalReconnectableSession.mockRejectedValue(
            new LocalResumeSessionError(
                'Cannot resume HappyHerd session "missing" on this machine: no local session encryption data found at /tmp/.happyherd/sessions.json.',
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
        expect((thrown as Error).message).not.toContain('happyherd-control-agent auth login');
        expect(mocks.mockSpawnHappyHerdCLI).not.toHaveBeenCalled();
    });

    it('falls back to legacy provider resume only when agent.key is already present', async () => {
        mocks.mockHasLocalHappyHerdAgentAuth.mockReturnValue(true);
        mocks.mockResolveHappyHerdSession.mockResolvedValue({
            id: 'legacy-session',
            active: false,
            metadata: {
                path: '/tmp/repo',
                flavor: 'claude',
                claudeSessionId: '93a9705e-bc6a-406d-8dce-8acc014dedbd',
                host: 'localhost',
                homeDir: '/tmp',
                happyHomeDir: '/tmp/.happyherd',
                happyLibDir: '/tmp/happyherd',
                happyToolsDir: '/tmp/happyherd/tools',
            },
        });
        for (const key of SESSION_SCOPED_ENV_KEYS) {
            vi.stubEnv(key, `stale-${key}`);
        }

        await handleResumeCommand(['legacy-session']);

        expect(mocks.mockResolveHappyHerdSession).toHaveBeenCalledWith('legacy-session');
        expect(spawnHappyHerdCLI).toHaveBeenCalledWith(
            [
                'claude',
                '--resume', '93a9705e-bc6a-406d-8dce-8acc014dedbd',
                '--permission-mode', 'default',
                '--effort', 'max',
            ],
            expect.objectContaining({
                cwd: '/tmp/repo',
                env: expect.any(Object),
                stdio: 'inherit',
            }),
        );
        const spawnedEnv = mocks.mockSpawnHappyHerdCLI.mock.calls[0][1].env;
        for (const key of SESSION_SCOPED_ENV_KEYS) {
            if (key === 'HAPPYHERD_MACHINE_SESSION_SETTINGS_JSON') continue;
            expect(spawnedEnv).not.toHaveProperty(key);
        }
        expect(JSON.parse(spawnedEnv.HAPPYHERD_MACHINE_SESSION_SETTINGS_JSON)).toEqual({
            provider: 'claude',
            model: 'default',
            effort: 'max',
            permission: 'default',
        });
    });
});
