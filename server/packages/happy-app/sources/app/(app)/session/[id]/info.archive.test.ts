import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
    return {
        back: vi.fn(),
        kill: vi.fn(),
        cleanup: vi.fn(async () => {}),
        controlHeartbeat: vi.fn(),
        session: {
            id: 'session-1',
            seq: 1,
            createdAt: 1,
            updatedAt: 2,
            active: true,
            activeAt: 2,
            metadata: null,
            metadataVersion: 0,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: 0,
            presence: 'online',
        } as any,
    };
});

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    class AnimatedValue {
        setValue() {}
    }
    return {
        View: (props: any) => ReactModule.createElement('View', props, props.children),
        Text: (props: any) => ReactModule.createElement('Text', props, props.children),
        Pressable: (props: any) => ReactModule.createElement('Pressable', props, props.children),
        TextInput: (props: any) => ReactModule.createElement('TextInput', props),
        ActivityIndicator: (props: any) => ReactModule.createElement('ActivityIndicator', props),
        Animated: {
            Value: AnimatedValue,
            View: (props: any) => ReactModule.createElement('AnimatedView', props, props.children),
            loop: () => ({ start: vi.fn() }),
            sequence: () => ({}),
            timing: () => ({}),
        },
        Platform: {
            OS: 'web',
            select: (options: Record<string, unknown>) => options.web ?? options.default,
        },
    };
});
vi.mock('expo-router', async () => {
    const ReactModule = await import('react');
    return {
        Stack: { Screen: (props: any) => ReactModule.createElement('StackScreen', props) },
        useLocalSearchParams: () => ({ id: 'session-1' }),
        useRouter: () => ({ back: mocks.back, push: vi.fn() }),
    };
});
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});
vi.mock('react-native-unistyles', () => ({
    useUnistyles: () => ({
        theme: {
            colors: {
                groupped: { background: 'background' },
                glass: {
                    backgroundStrong: 'glass',
                    border: 'border',
                    shadow: 'shadow',
                },
                surface: 'surface',
                surfaceHigh: 'surface-high',
                text: 'text',
                textSecondary: 'secondary',
                textLink: 'link',
                textDestructive: 'destructive',
                divider: 'divider',
            },
        },
    }),
}));
vi.mock('@/components/Item', async () => {
    const ReactModule = await import('react');
    return { Item: (props: any) => ReactModule.createElement('Item', props) };
});
vi.mock('@/components/ItemGroup', async () => {
    const ReactModule = await import('react');
    return { ItemGroup: (props: any) => ReactModule.createElement('ItemGroup', props, props.children) };
});
vi.mock('@/components/ItemList', async () => {
    const ReactModule = await import('react');
    return { ItemList: (props: any) => ReactModule.createElement('ItemList', props, props.children) };
});
vi.mock('@/components/Avatar', async () => {
    const ReactModule = await import('react');
    return { Avatar: (props: any) => ReactModule.createElement('Avatar', props) };
});
vi.mock('@/components/CodeView', async () => {
    const ReactModule = await import('react');
    return { CodeView: (props: any) => ReactModule.createElement('CodeView', props) };
});
vi.mock('@/components/MobileGlass', async () => {
    const ReactModule = await import('react');
    return { MobileGlassSurface: (props: any) => ReactModule.createElement('MobileGlassSurface', props, props.children) };
});
vi.mock('@/components/ProviderIcon', () => ({ ProviderIcon: 'ProviderIcon' }));
vi.mock('@/components/layout', () => ({ layout: { maxWidth: 1000 } }));
vi.mock('@/components/navigation/headerMetrics', () => ({ MOBILE_GLASS_HEADER_HEIGHT: 0 }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/sync/storage', () => ({
    useIsDataReady: () => true,
    useSession: () => mocks.session,
    useSessionProjectAvatar: () => null,
}));
vi.mock('@/utils/sessionUtils', () => ({
    formatOSPlatform: (value: string) => value,
    formatPathRelativeToHome: (value: string) => value,
    getResumeCommand: () => null,
    getSessionAvatarId: () => 'avatar',
    getSessionName: () => 'Session',
    useSessionStatus: () => ({
        isConnected: true,
        isPulsing: false,
        statusColor: 'green',
        statusDotColor: 'green',
        statusText: 'Online',
    }),
}));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('@/modal', () => ({ Modal: { alert: vi.fn() } }));
vi.mock('@/sync/ops', () => ({
    machineControlHeartbeat: mocks.controlHeartbeat,
    sessionArchive: vi.fn(async () => ({ success: true })),
    sessionDelete: vi.fn(async () => ({ success: true })),
    sessionKill: mocks.kill,
}));
vi.mock('@/hooks/useWorktreeCleanup', () => ({ maybeCleanupWorktree: mocks.cleanup }));
vi.mock('@/hooks/useSessionQuickActions', () => ({
    useSessionQuickActions: () => ({
        canShowResume: false,
        canFork: false,
        forking: false,
        forkSession: vi.fn(),
        openDuplicateSheet: vi.fn(),
        resumeSession: vi.fn(),
        resumeSessionSubtitle: '',
    }),
}));
vi.mock('@/utils/copySessionMetadataToClipboard', () => ({
    copySessionMetadataAndLogsToClipboard: vi.fn(),
    copySessionMetadataToClipboard: vi.fn(),
}));
vi.mock('@/utils/versionUtils', () => ({ MINIMUM_CLI_VERSION: '0', isVersionSupported: () => true }));
vi.mock('@/utils/errors', () => ({ HappyError: class HappyError extends Error {} }));
vi.mock('@/sync/rig', () => ({ getRigIdentity: () => null, isRigMetadata: () => false }));
vi.mock('@/text', () => ({
    t: (key: string, params?: Record<string, string | number>) => (
        `${key}${params ? `:${JSON.stringify(params)}` : ''}`
    ),
}));

import SessionInfoScreen from './info';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());
beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.metadata = null;
});

describe('Session info archive action', () => {
    it('shows loading immediately while the daemon archive request is pending', async () => {
        let resolveKill!: (value: { success: boolean; message: string }) => void;
        mocks.kill.mockReturnValueOnce(new Promise((resolve) => {
            resolveKill = resolve;
        }));

        let renderer!: ReturnType<typeof create>;
        await act(async () => {
            renderer = create(React.createElement(SessionInfoScreen));
        });

        const archiveItem = () => renderer.root.findAllByType('Item' as any)
            .find((item: any) => item.props.title === 'sessionInfo.archiveSession')!;
        expect(archiveItem().props.loading).toBe(false);

        await act(async () => {
            archiveItem().props.onPress();
            await Promise.resolve();
        });

        expect(archiveItem().props.loading).toBe(true);
        expect(mocks.kill).toHaveBeenCalledWith('session-1');

        await act(async () => {
            resolveKill({ success: true, message: 'archived' });
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.back).toHaveBeenCalledTimes(2);
        act(() => renderer.unmount());
    });
});

describe('Session info heartbeat status', () => {
    it('renders the backend delivery, queue, last-fire, next-due, and instruction fields without polling', async () => {
        mocks.session.metadata = {
            machineId: 'machine-one',
            flavor: 'codex',
            codexThreadId: 'thread-one',
            path: '/srv/app',
        };
        mocks.controlHeartbeat.mockResolvedValue({
            heartbeat: {
                status: 'active',
                instruction: 'Continue the current task if it remains unfinished and actionable.',
                intervalSeconds: 3_600,
                nextDueAt: '2026-08-25T00:45:00.000Z',
            },
            currentRun: { status: 'running', sessionId: null },
            lastRun: {
                status: 'completed',
                sessionId: 'session-1',
                startedAt: '2026-08-25T00:00:05.000Z',
            },
            deliveryState: 'queued',
            queuedAhead: 2,
            observedAt: '2026-08-25T00:15:00.000Z',
        });

        let renderer!: ReturnType<typeof create>;
        await act(async () => {
            renderer = create(React.createElement(SessionInfoScreen));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.controlHeartbeat).toHaveBeenCalledTimes(1);
        expect(mocks.controlHeartbeat).toHaveBeenCalledWith('machine-one', {
            action: 'status',
            targetSessionId: 'session-1',
        });
        const heartbeatItem = renderer.root.findAllByType('Item' as any)
            .find((item: any) => String(item.props.title).startsWith('happyHerd.heartbeat.confirmation'))!;
        expect(heartbeatItem.props.subtitle).toContain('happyHerd.heartbeat.currentStatus');
        expect(heartbeatItem.props.subtitle).toContain('happyHerd.heartbeat.queuedAhead:{"count":2}');
        expect(heartbeatItem.props.subtitle).toContain('happyHerd.heartbeat.lastDelivery');
        expect(heartbeatItem.props.subtitle).toContain('happyHerd.heartbeat.nextDue');
        expect(heartbeatItem.props.subtitle).toContain('happyHerd.heartbeat.instructionStatus');
        expect(mocks.controlHeartbeat).toHaveBeenCalledTimes(1);

        act(() => renderer.unmount());
    });
});
