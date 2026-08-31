import { execSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SandboxConfig } from '@/persistence';
import { createSessionMetadata } from './createSessionMetadata';

vi.mock('node:child_process', () => ({
    execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execSync);

function createSandboxConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
    return {
        enabled: true,
        workspaceRoot: '~/Developer',
        sessionIsolation: 'workspace',
        customWritePaths: [],
        denyReadPaths: ['~/.ssh', '~/.aws', '~/.gnupg'],
        extraWritePaths: ['/tmp'],
        denyWritePaths: ['.env'],
        networkMode: 'allowed',
        allowedDomains: [],
        deniedDomains: [],
        allowLocalBinding: true,
        ...overrides,
    };
}

describe('createSessionMetadata', () => {
    beforeEach(() => {
        mockedExecSync.mockReset();
        mockedExecSync.mockReturnValue('main\n');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('records the Codex provider home only for Codex sessions', () => {
        vi.stubEnv('CODEX_HOME', '/tmp/original-codex-home');

        const codex = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-codex-home',
        });
        const claude = createSessionMetadata({
            flavor: 'claude',
            machineId: 'machine-claude-home',
        });

        expect(codex.metadata.codexHome).toBe('/tmp/original-codex-home');
        expect(claude.metadata.codexHome).toBeUndefined();
    });

    it('sets metadata.sandbox to the config when enabled', () => {
        const sandbox = createSandboxConfig();
        const { metadata } = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-1',
            startedBy: 'terminal',
            sandbox,
        });

        expect(metadata.sandbox).toEqual(sandbox);
    });

    it('sets metadata.sandbox to null when sandbox is disabled', () => {
        const sandbox = createSandboxConfig({ enabled: false });
        const { metadata } = createSessionMetadata({
            flavor: 'gemini',
            machineId: 'machine-2',
            startedBy: 'daemon',
            sandbox,
        });

        expect(metadata.sandbox).toBeNull();
    });

    it('sets metadata.sandbox to null when sandbox is not provided', () => {
        const { metadata } = createSessionMetadata({
            flavor: 'claude',
            machineId: 'machine-3',
        });

        expect(metadata.sandbox).toBeNull();
    });

    it('sets metadata.dangerouslySkipPermissions to null when not provided', () => {
        const { metadata } = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-4',
        });

        expect(metadata.dangerouslySkipPermissions).toBeNull();
    });

    it('sets metadata.dangerouslySkipPermissions when provided', () => {
        const { metadata } = createSessionMetadata({
            flavor: 'claude',
            machineId: 'machine-5',
            dangerouslySkipPermissions: true,
        });

        expect(metadata.dangerouslySkipPermissions).toBe(true);
    });

    it('sets fork lineage metadata when provided', () => {
        const { metadata } = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-6',
            parentSessionId: 'happy-source',
            forkedFromMessageId: 'message-2',
        });

        expect(metadata.parentSessionId).toBe('happy-source');
        expect(metadata.forkedFromMessageId).toBe('message-2');
    });

    it('sets fresh provider-continuation lineage from the daemon handoff', () => {
        vi.stubEnv('HAPPY_CONTINUED_FROM_SESSION_ID', 'happy-source');

        const { metadata } = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-continuation',
        });

        expect(metadata.continuedFromSessionId).toBe('happy-source');
        expect(metadata.parentSessionId).toBeUndefined();
    });

    it('sets metadata.isSideChat when the session is a side chat', () => {
        const { metadata } = createSessionMetadata({
            flavor: 'claude',
            machineId: 'machine-side',
            parentSessionId: 'happy-parent',
            isSideChat: true,
        });

        expect(metadata.isSideChat).toBe(true);
        expect(metadata.parentSessionId).toBe('happy-parent');
    });

    it('persists target-daemon confirmed launch settings from the scoped handoff', () => {
        vi.stubEnv('HAPPYHERD_MACHINE_SESSION_SETTINGS_JSON', JSON.stringify({
            provider: 'codex',
            model: 'gpt-5.6-sol',
            effort: 'high',
            permission: 'yolo',
        }));

        const { metadata } = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-remote',
            startedBy: 'daemon',
        });

        expect(metadata.spawnSettings).toEqual({
            provider: 'codex',
            model: 'gpt-5.6-sol',
            effort: 'high',
            permission: 'yolo',
        });
    });

    it('lets the target-daemon handoff override direct launch settings', () => {
        vi.stubEnv('HAPPYHERD_MACHINE_SESSION_SETTINGS_JSON', JSON.stringify({
            provider: 'grok',
            model: 'grok-build',
            effort: null,
            permission: 'dontAsk',
        }));

        const { metadata } = createSessionMetadata({
            flavor: 'grok',
            machineId: 'machine-remote',
            startedBy: 'daemon',
            spawnSettings: {
                provider: 'grok',
                model: 'grok-build',
                effort: null,
                permission: 'bypassPermissions',
            },
        });

        expect(metadata.spawnSettings?.permission).toBe('dontAsk');
    });

    it('omits metadata.isSideChat for a normal session', () => {
        const { metadata } = createSessionMetadata({
            flavor: 'claude',
            machineId: 'machine-normal',
        });

        expect(metadata.isSideChat).toBeUndefined();
    });

    it('records only the opaque governed Discord surface id from session context', () => {
        const previous = process.env.HAPPYHERD_AGENT_SURFACE_ID;
        process.env.HAPPYHERD_AGENT_SURFACE_ID = 'dm:discord-user-1';
        try {
            const { metadata } = createSessionMetadata({
                flavor: 'codex',
                machineId: 'machine-1',
            });
            expect(metadata.happyHerdAgentSurfaceId).toBe('dm:discord-user-1');
        } finally {
            if (previous === undefined) {
                delete process.env.HAPPYHERD_AGENT_SURFACE_ID;
            } else {
                process.env.HAPPYHERD_AGENT_SURFACE_ID = previous;
            }
        }
    });

    it('records exact automation run provenance without affecting ordinary sessions', () => {
        const automationId = crypto.randomUUID();
        const runId = crypto.randomUUID();
        process.env.HAPPYHERD_AUTOMATION_ID = automationId;
        process.env.HAPPYHERD_AUTOMATION_RUN_ID = runId;
        process.env.HAPPYHERD_AUTOMATION_KIND = 'heartbeat';
        try {
            const automated = createSessionMetadata({
                flavor: 'codex',
                machineId: 'machine-automation',
                startedBy: 'daemon',
            });
            expect(automated.metadata).toMatchObject({
                automationId,
                automationRunId: runId,
                automationKind: 'heartbeat',
            });
        } finally {
            delete process.env.HAPPYHERD_AUTOMATION_ID;
            delete process.env.HAPPYHERD_AUTOMATION_RUN_ID;
            delete process.env.HAPPYHERD_AUTOMATION_KIND;
        }

        const ordinary = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-ordinary',
            startedBy: 'daemon',
        });
        expect(ordinary.metadata.automationId).toBeUndefined();
        expect(ordinary.metadata.automationRunId).toBeUndefined();
    });

    it('sets metadata.gitBranch when a git branch is detected', () => {
        mockedExecSync.mockReturnValue('fix/session-status\n');

        const { metadata } = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-7',
        });

        expect(metadata.gitBranch).toBe('fix/session-status');
        expect(mockedExecSync).toHaveBeenCalledWith('git rev-parse --abbrev-ref HEAD', expect.objectContaining({
            cwd: process.cwd(),
        }));
    });

    it('omits metadata.gitBranch when git is unavailable or detached', () => {
        mockedExecSync.mockReturnValue('HEAD\n');

        const detached = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-8',
        });

        expect(detached.metadata.gitBranch).toBeUndefined();

        mockedExecSync.mockImplementation(() => {
            throw new Error('not a git repository');
        });

        const unavailable = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-9',
        });

        expect(unavailable.metadata.gitBranch).toBeUndefined();
    });
});
