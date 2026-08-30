import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Machine, Session } from '@/sync/storageTypes';

const mocks = vi.hoisted(() => ({
    machine: null as Machine | null,
    settings: {},
    machineResumeSession: vi.fn(),
    sessionSetAgentModes: vi.fn(),
    refreshSessions: vi.fn(async () => undefined),
    navigateToSession: vi.fn(),
    routerPush: vi.fn(),
}));

vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.routerPush }) }));
vi.mock('@/hooks/useHappyAction', () => ({
    useHappyAction: (action: () => Promise<void>) => [false, action],
}));
vi.mock('@/hooks/useNavigateToSession', () => ({
    useNavigateToSession: () => mocks.navigateToSession,
}));
vi.mock('@/modal', () => ({ Modal: { alert: vi.fn(), show: vi.fn() } }));
vi.mock('@/sync/ops', () => ({
    machineResumeSession: mocks.machineResumeSession,
    sessionSetAgentModes: mocks.sessionSetAgentModes,
    sessionArchive: vi.fn(),
    sessionKill: vi.fn(),
    forkAndSpawn: vi.fn(),
}));
vi.mock('@/hooks/useWorktreeCleanup', () => ({ maybeCleanupWorktree: vi.fn() }));
vi.mock('@/sync/storage', () => ({
    storage: {
        getState: () => ({
            machines: mocks.machine ? { [mocks.machine.id]: mocks.machine } : {},
            settings: mocks.settings,
        }),
    },
    useLocalSetting: () => false,
    useMachine: () => mocks.machine,
    useSetting: () => false,
    useSession: () => null,
}));
vi.mock('@/sync/sync', () => ({ sync: { refreshSessions: mocks.refreshSessions } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/utils/copySessionMetadataToClipboard', () => ({
    copySessionMetadataToClipboard: vi.fn(),
    copySessionMetadataAndLogsToClipboard: vi.fn(),
}));
vi.mock('@/utils/sessionUtils', () => ({
    useSessionStatus: () => ({ isConnected: false }),
}));
vi.mock('@/components/DuplicateSheet', () => ({ DuplicateSheet: () => null }));

import { useSessionQuickActions } from './useSessionQuickActions';

type QuickActions = ReturnType<typeof useSessionQuickActions>;

function machineFor(provider: 'claude' | 'codex'): Machine {
    const tuple = provider === 'claude'
        ? {
            model: 'claude-opus-test',
            effort: 'high',
            permission: 'bypassPermissions',
        }
        : {
            model: 'gpt-test',
            effort: 'high',
            permission: 'yolo',
        };
    return {
        id: 'machine-1',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: {
            host: 'target',
            platform: 'linux',
            happyCliVersion: '1.0.0',
            homeDir: '/home/test',
            happyHomeDir: '/home/test/.happyherd',
            happyLibDir: '/srv/happy',
            resumeSupport: { rpcAvailable: true },
            cliAvailability: {
                claude: provider === 'claude',
                codex: provider === 'codex',
                gemini: false,
                grok: false,
                agy: false,
                detectedAt: 1,
            },
            agentCapabilities: {
                [provider]: {
                    detectedAt: 1,
                    sources: { models: 'test', effortLevels: 'test', permissionModes: 'test' },
                    models: [{
                        code: tuple.model,
                        value: tuple.model,
                        isDefault: true,
                        effortLevels: [{ code: tuple.effort, value: tuple.effort, isDefault: true }],
                    }],
                    effortLevels: [{ code: tuple.effort, value: tuple.effort, isDefault: true }],
                    permissionModes: [{ code: tuple.permission, value: tuple.permission, isDefault: true }],
                },
            },
        },
        metadataVersion: 1,
        daemonState: null,
        daemonStateVersion: 1,
    };
}

function sessionFor(provider: 'claude' | 'codex'): Session {
    const current = provider === 'claude'
        ? { modelMode: 'claude-opus-test', effortLevel: 'high', permissionMode: 'bypassPermissions' }
        : { modelMode: 'gpt-test', effortLevel: 'high', permissionMode: 'yolo' };
    return {
        id: 'session-1',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: false,
        activeAt: 1,
        metadata: {
            path: '/workspace',
            flavor: provider,
            machineId: 'machine-1',
            ...(provider === 'claude'
                ? { claudeSessionId: '11111111-1111-4111-8111-111111111111' }
                : { codexThreadId: 'codex-thread' }),
            spawnSettings: {
                provider,
                model: provider === 'claude' ? 'claude-old' : 'gpt-old',
                effort: 'medium',
                permission: provider === 'claude' ? 'default' : 'read-only',
            },
        } as Session['metadata'],
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        presence: 1,
        ...current,
    };
}

describe('useSessionQuickActions resume permission continuity', () => {
    const originalConsoleError = console.error;
    let renderer: ReactTestRenderer;
    let current!: QuickActions;

    beforeAll(() => {
        Object.assign(globalThis, {
            IS_REACT_ACT_ENVIRONMENT: true,
            __DEV__: false,
        });
        console.error = (...args: unknown[]) => {
            if (typeof args[0] === 'string' && args[0].startsWith('react-test-renderer is deprecated')) return;
            originalConsoleError(...args);
        };
    });

    afterAll(() => {
        console.error = originalConsoleError;
        delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
        delete (globalThis as Record<string, unknown>).__DEV__;
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.settings = {};
    });

    it.each(['claude', 'codex'] as const)(
        'sends and mirrors the complete daemon-confirmed %s tuple',
        async (provider) => {
            const session = sessionFor(provider);
            const expected = {
                modelMode: session.modelMode!,
                effortLevel: session.effortLevel!,
                permissionMode: session.permissionMode!,
            };
            mocks.machine = machineFor(provider);
            mocks.machineResumeSession.mockResolvedValue({
                type: 'success',
                sessionId: session.id,
                settings: {
                    provider,
                    model: expected.modelMode,
                    effort: expected.effortLevel,
                    permission: expected.permissionMode,
                },
            });

            function Harness() {
                current = useSessionQuickActions(session);
                return null;
            }
            act(() => {
                renderer = create(React.createElement(Harness));
            });

            await act(async () => {
                await current.resumeSessionWithQueuedTurn('queue-1');
            });

            expect(mocks.machineResumeSession).toHaveBeenCalledWith({
                machineId: 'machine-1',
                sessionId: session.id,
                model: expected.modelMode,
                effortLevel: expected.effortLevel,
                permissionMode: expected.permissionMode,
                replayQueueMessageId: 'queue-1',
            });
            expect(mocks.refreshSessions).toHaveBeenCalledOnce();
            expect(mocks.sessionSetAgentModes).toHaveBeenCalledWith(session.id, expected);
            expect(mocks.navigateToSession).toHaveBeenCalledWith(session.id);

            act(() => renderer.unmount());
        },
    );
});
