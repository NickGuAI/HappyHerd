import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
    return {
        back: vi.fn(),
        dispatch: vi.fn(),
        replace: vi.fn(),
        kill: vi.fn(),
        archive: vi.fn(),
        deleteSession: vi.fn(),
        cleanup: vi.fn(async () => {}),
        controlHeartbeat: vi.fn(),
        modalAlert: vi.fn(),
        canBrowseFiles: true,
        canUseShell: true,
        latestSession: null as any,
        navigationState: {
            index: 1,
            routes: [
                { key: 'session-route-1', name: 'session/[id]', params: { id: 'session-1' } },
                { key: 'info-route-1', name: 'session/[id]/info', params: { id: 'session-1' } },
            ],
        },
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
        useRouter: () => ({ back: mocks.back, replace: mocks.replace, push: vi.fn() }),
    };
});
vi.mock('expo-crypto', () => ({ randomUUID: () => 'changes-request-1' }));
vi.mock('@react-navigation/native', () => ({
    CommonActions: {
        setParams: (params: Record<string, string>) => ({ type: 'SET_PARAMS', payload: { params } }),
    },
    StackActions: {
        pop: (count: number) => ({ type: 'POP', payload: { count } }),
    },
    useNavigation: () => ({
        dispatch: mocks.dispatch,
        getState: () => mocks.navigationState,
    }),
}));
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
vi.mock('@/components/navigation/headerMetrics', () => ({ MOBILE_GLASS_HEADER_HEIGHT: 0 }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/sync/storage', () => ({
    storage: { getState: () => ({ sessions: { [mocks.session.id]: mocks.latestSession } }) },
    useIsDataReady: () => true,
    useProjects: () => ({}),
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
vi.mock('@/modal', () => ({ Modal: { alert: mocks.modalAlert } }));
vi.mock('@/sync/ops', () => ({
    machineControlHeartbeat: mocks.controlHeartbeat,
    sessionArchive: mocks.archive,
    sessionDelete: mocks.deleteSession,
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
vi.mock('@/sync/rig', () => ({
    getRigIdentity: () => null,
    isRigMetadata: () => false,
    rigCanBrowseFiles: () => mocks.canBrowseFiles,
    rigCanUseShell: () => mocks.canUseShell,
}));
vi.mock('@/utils/platform', () => ({ isRunningOnMac: () => false }));
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
    mocks.session.id = 'session-1';
    mocks.session.metadata = null;
    mocks.latestSession = mocks.session;
    mocks.canBrowseFiles = true;
    mocks.canUseShell = true;
    mocks.navigationState = {
        index: 1,
        routes: [
            { key: 'session-route-1', name: 'session/[id]', params: { id: 'session-1' } },
            { key: 'info-route-1', name: 'session/[id]/info', params: { id: 'session-1' } },
        ],
    };
    mocks.archive.mockResolvedValue({ success: true });
    mocks.deleteSession.mockResolvedValue({ success: true });
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

    it('keeps a bot retryable when its owning machine does not confirm archive', async () => {
        mocks.session.metadata = {
            machineId: 'machine-one',
            path: '/srv/bot',
            bot: {
                id: 'bot-one',
                name: 'Build assistant',
                username: 'build-assistant',
                workspaceId: 'workspace-one',
                orderKey: 'a0',
            },
        };
        mocks.kill.mockResolvedValue({ success: false, message: '' });

        let renderer!: ReturnType<typeof create>;
        await act(async () => {
            renderer = create(React.createElement(SessionInfoScreen));
        });

        const items = renderer.root.findAllByType('Item' as any);
        const archiveItem = items.find((item: any) => item.props.title === 'sessionInfo.archiveSession')!;
        expect(items.some((item: any) => item.props.title === 'sessionInfo.deleteSession')).toBe(false);

        await act(async () => {
            archiveItem.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.kill).toHaveBeenCalledWith('session-1');
        expect(mocks.cleanup).not.toHaveBeenCalled();
        expect(mocks.archive).not.toHaveBeenCalled();
        expect(mocks.back).not.toHaveBeenCalled();
        expect(mocks.modalAlert).toHaveBeenCalledWith(
            'common.error',
            'sessionInfo.botArchiveRequiresMachine',
            expect.any(Array),
        );
        act(() => renderer.unmount());
    });

    it('uses newly synced bot metadata before archive cleanup or fallback', async () => {
        mocks.session.metadata = { machineId: 'machine-one', path: '/srv/app' };
        mocks.kill.mockResolvedValue({ success: false, message: '' });
        let renderer!: ReturnType<typeof create>;
        await act(async () => {
            renderer = create(React.createElement(SessionInfoScreen));
        });
        mocks.latestSession = {
            ...mocks.session,
            metadata: {
                ...mocks.session.metadata,
                bot: {
                    id: 'bot-one',
                    name: 'Build assistant',
                    username: 'build-assistant',
                    workspaceId: 'workspace-one',
                    orderKey: 'a0',
                },
            },
        };

        const archiveItem = renderer.root.findAllByType('Item' as any)
            .find((item: any) => item.props.title === 'sessionInfo.archiveSession')!;
        await act(async () => {
            archiveItem.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.cleanup).not.toHaveBeenCalled();
        expect(mocks.kill).toHaveBeenCalledWith('session-1');
        expect(mocks.archive).not.toHaveBeenCalled();
        expect(mocks.back).not.toHaveBeenCalled();
        expect(mocks.modalAlert).toHaveBeenCalledWith(
            'common.error',
            'sessionInfo.botArchiveRequiresMachine',
            expect.any(Array),
        );
        act(() => renderer.unmount());
    });

    it('retains the ordinary cleanup and server archive fallback', async () => {
        mocks.session.metadata = { machineId: 'machine-one', path: '/srv/app' };
        mocks.kill.mockResolvedValue({ success: false, message: 'not running' });

        let renderer!: ReturnType<typeof create>;
        await act(async () => {
            renderer = create(React.createElement(SessionInfoScreen));
        });
        const archiveItem = renderer.root.findAllByType('Item' as any)
            .find((item: any) => item.props.title === 'sessionInfo.archiveSession')!;
        await act(async () => {
            archiveItem.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.cleanup).toHaveBeenCalledWith('session-1', '/srv/app', 'machine-one');
        expect(mocks.archive).toHaveBeenCalledWith('session-1');
        expect(mocks.back).toHaveBeenCalledTimes(2);
        act(() => renderer.unmount());
    });

    it('refuses a pre-opened Delete confirmation after synced metadata becomes a bot', async () => {
        mocks.session.metadata = { machineId: 'machine-one', path: '/srv/app' };
        let renderer!: ReturnType<typeof create>;
        await act(async () => {
            renderer = create(React.createElement(SessionInfoScreen));
        });
        const deleteItem = renderer.root.findAllByType('Item' as any)
            .find((item: any) => item.props.title === 'sessionInfo.deleteSession')!;
        act(() => deleteItem.props.onPress());
        const confirmationButtons = mocks.modalAlert.mock.calls[0]?.[2] as Array<{ onPress?: () => void }>;

        mocks.latestSession = {
            ...mocks.session,
            metadata: {
                ...mocks.session.metadata,
                bot: {
                    id: 'bot-one',
                    name: 'Build assistant',
                    username: 'build-assistant',
                    workspaceId: 'workspace-one',
                    orderKey: 'a0',
                },
            },
        };
        await act(async () => {
            confirmationButtons[1]?.onPress?.();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.cleanup).not.toHaveBeenCalled();
        expect(mocks.kill).not.toHaveBeenCalled();
        expect(mocks.deleteSession).not.toHaveBeenCalled();
        expect(mocks.back).not.toHaveBeenCalled();
        expect(mocks.modalAlert).toHaveBeenLastCalledWith(
            'common.error',
            'sessionInfo.botDeleteUnavailable',
            expect.any(Array),
        );
        act(() => renderer.unmount());
    });
});

describe('Session info first actions', () => {
    it('removes the duplicate hero and puts Changes first', async () => {
        let renderer!: ReturnType<typeof create>;
        await act(async () => {
            renderer = create(React.createElement(SessionInfoScreen));
        });

        expect(renderer.root.findAllByType('Avatar' as any)).toHaveLength(0);
        expect(renderer.root.findAllByType('MobileGlassSurface' as any)).toHaveLength(0);
        const groups = renderer.root.findAllByType('ItemGroup' as any);
        expect(groups[0].props.title).toBe('sessionInfo.quickActions');
        const firstAction = groups[0].findAllByType('Item' as any)[0];
        expect(firstAction.props.title).toBe('files.changes');

        act(() => firstAction.props.onPress());
        expect(mocks.dispatch).toHaveBeenCalledWith({
            type: 'SET_PARAMS',
            payload: { params: { openChangesRequestId: 'changes-request-1' } },
            source: 'session-route-1',
        });
        expect(mocks.dispatch).toHaveBeenNthCalledWith(2, { type: 'POP', payload: { count: 1 } });
        expect(mocks.replace).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('opens an exact Side chat session route when its root route is not mounted', async () => {
        mocks.session.id = 'side-chat';
        mocks.navigationState = {
            index: 1,
            routes: [
                { key: 'session-parent-route', name: 'session/[id]', params: { id: 'parent' } },
                { key: 'info-side-route', name: 'session/[id]/info', params: { id: 'side-chat' } },
            ],
        };
        let renderer!: ReturnType<typeof create>;
        await act(async () => {
            renderer = create(React.createElement(SessionInfoScreen));
        });

        const changes = renderer.root.findAllByType('Item' as any)
            .find((item: any) => item.props.title === 'files.changes')!;
        act(() => changes.props.onPress());

        expect(mocks.replace).toHaveBeenCalledWith({
            pathname: '/session/[id]',
            params: { id: 'side-chat', openChangesRequestId: 'changes-request-1' },
        });
        expect(mocks.dispatch).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('does not dispatch Changes when the session lacks file capabilities', async () => {
        mocks.canBrowseFiles = false;
        let renderer!: ReturnType<typeof create>;
        await act(async () => {
            renderer = create(React.createElement(SessionInfoScreen));
        });

        const changes = renderer.root.findAllByType('Item' as any)
            .find((item: any) => item.props.title === 'files.changes')!;
        expect(changes.props.disabled).toBe(true);
        expect(changes.props.onPress).toBeUndefined();
        expect(mocks.dispatch).not.toHaveBeenCalled();
        expect(mocks.replace).not.toHaveBeenCalled();
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
