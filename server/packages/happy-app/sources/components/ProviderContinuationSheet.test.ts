import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    navigateToSession: vi.fn(),
    machineSpawnNewSession: vi.fn(),
    ensureSessionMessagesLoaded: vi.fn(),
    refreshSessions: vi.fn(async () => undefined),
    sendMessage: vi.fn(),
    sourceFlavor: 'claude' as string | null | undefined,
    messagesLoaded: true,
    messages: [
        { kind: 'agent-text', id: 'a1', localId: null, createdAt: 2, text: 'Latest answer' },
        { kind: 'user-text', id: 'u1', localId: null, createdAt: 1, text: 'Please continue this work' },
    ] as any[],
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const component = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        ActivityIndicator: component('ActivityIndicator'),
        Platform: { OS: 'web', select: (choices: Record<string, unknown>) => choices.web ?? choices.default },
        Pressable: component('Pressable'),
        Text: component('Text'),
        View: component('View'),
        useWindowDimensions: () => ({ width: 1200, height: 900 }),
    };
});
vi.mock('@expo/vector-icons', () => ({
    Ionicons: Object.assign(() => null, { glyphMap: {} }),
}));
vi.mock('react-native-unistyles', () => {
    const theme = {
        colors: {
            divider: '#ddd', glass: { backgroundStrong: '#fff', border: '#ddd', overlay: '#fff', overlayTint: '#fff' },
            surface: '#fff', surfaceHigh: '#eee', text: '#111', textLink: '#06c', textSecondary: '#666',
        },
    };
    return {
        StyleSheet: { hairlineWidth: 1, create: (factory: any) => factory(theme) },
        useUnistyles: () => ({ theme }),
    };
});

vi.mock('@/hooks/useHappyAction', () => ({
    useHappyAction: (action: () => Promise<void>) => [false, action],
}));
vi.mock('@/hooks/useNavigateToSession', () => ({
    useNavigateToSession: () => mocks.navigateToSession,
}));
vi.mock('@/sync/ops', () => ({ machineSpawnNewSession: mocks.machineSpawnNewSession }));
vi.mock('@/sync/sync', () => ({
    sync: {
        ensureSessionMessagesLoaded: mocks.ensureSessionMessagesLoaded,
        refreshSessions: mocks.refreshSessions,
        sendMessage: mocks.sendMessage,
    },
}));
vi.mock('@/sync/storage', () => ({
    useSession: () => ({
        id: 'source-session',
        metadata: {
            flavor: mocks.sourceFlavor,
            machineId: 'machine-1',
            path: '/workspace/project',
            commanderId: 'commander-1',
        },
    }),
    useMachine: () => ({
        id: 'machine-1',
        active: true,
        metadata: { cliAvailability: { claude: true, codex: true } },
    }),
    useSessionMessages: () => ({
        isLoaded: mocks.messagesLoaded,
        messages: mocks.messages,
    }),
}));
vi.mock('@/text', () => ({
    t: (key: string, params?: { provider?: string }) => params?.provider ? `${key}:${params.provider}` : key,
}));
vi.mock('./MobileGlass', async () => {
    const ReactModule = await import('react');
    const { View } = await import('react-native');
    return { MobileGlassSurface: (props: any) => ReactModule.createElement(View, props) };
});

import { ProviderContinuationSheet } from './ProviderContinuationSheet';

describe('ProviderContinuationSheet', () => {
    beforeAll(() => {
        Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    });

    afterAll(() => {
        delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.messagesLoaded = true;
        mocks.sourceFlavor = 'claude';
        mocks.messages = [
            { kind: 'agent-text', id: 'a1', localId: null, createdAt: 2, text: 'Latest answer' },
            { kind: 'user-text', id: 'u1', localId: null, createdAt: 1, text: 'Please continue this work' },
        ];
        mocks.machineSpawnNewSession.mockResolvedValue({ type: 'success', sessionId: 'target-session' });
        mocks.ensureSessionMessagesLoaded.mockResolvedValue(mocks.messages);
        mocks.refreshSessions.mockImplementation(() => new Promise(() => {}));
        mocks.sendMessage.mockResolvedValue({ localId: 'handoff-message' });
    });

    it('spawns a fresh opposite-provider session and delivers bounded context before navigation', async () => {
        const onClose = vi.fn();
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(ProviderContinuationSheet, {
                sessionId: 'source-session',
                onClose,
            }));
        });

        const target = renderer.root.findByProps({ testID: 'provider-continuation-codex' });
        await act(async () => {
            await target.props.onPress();
        });

        expect(mocks.machineSpawnNewSession).toHaveBeenCalledWith({
            machineId: 'machine-1',
            directory: '/workspace/project',
            approvedNewDirectoryCreation: false,
            agent: 'codex',
            commanderId: 'commander-1',
            continuedFromSessionId: 'source-session',
        });
        const spawnOptions = mocks.machineSpawnNewSession.mock.calls[0]?.[0];
        expect(spawnOptions).not.toHaveProperty('resumeClaudeSessionId');
        expect(spawnOptions).not.toHaveProperty('resumeCodexThreadId');
        expect(spawnOptions).not.toHaveProperty('modelMode');
        expect(spawnOptions).not.toHaveProperty('permissionMode');

        expect(mocks.refreshSessions).not.toHaveBeenCalled();
        expect(mocks.sendMessage).toHaveBeenCalledWith(
            'target-session',
            expect.stringContaining('fresh Codex session'),
            {
                source: 'new_session',
                displayText: 'session.providerContinuationHandoff:Claude',
                providerContinuationHandoff: true,
                awaitDelivery: true,
            },
        );
        expect(mocks.sendMessage.mock.calls[0]?.[1]).toContain('Please continue this work');
        expect(onClose).toHaveBeenCalledOnce();
        expect(mocks.navigateToSession).toHaveBeenCalledWith('target-session');

        act(() => renderer.unmount());
    });

    it('normalizes a legacy missing flavor to Claude and starts Codex', async () => {
        mocks.sourceFlavor = undefined;
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(ProviderContinuationSheet, { sessionId: 'source-session' }));
        });

        const target = renderer.root.findByProps({ testID: 'provider-continuation-codex' });
        await act(async () => {
            await target.props.onPress();
        });

        expect(mocks.machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'codex',
            machineId: 'machine-1',
            directory: '/workspace/project',
            commanderId: 'commander-1',
        }));
        expect(mocks.sendMessage.mock.calls[0]?.[1]).toContain('fresh Codex session');
        act(() => renderer.unmount());
    });

    it('loads an unopened source before spawning and uses the loaded visible messages', async () => {
        mocks.messagesLoaded = false;
        mocks.messages = [];
        const loadedMessages = [
            {
                kind: 'user-text', id: 'loaded', localId: null, createdAt: 3,
                text: 'HIDDEN_UNLOADED_SENTINEL', displayText: 'Visible loaded context',
            },
        ];
        mocks.ensureSessionMessagesLoaded.mockResolvedValue(loadedMessages);
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(ProviderContinuationSheet, { sessionId: 'source-session' }));
        });

        const target = renderer.root.findByProps({ testID: 'provider-continuation-codex' });
        await act(async () => {
            await target.props.onPress();
        });

        expect(mocks.ensureSessionMessagesLoaded).toHaveBeenCalledWith('source-session');
        expect(mocks.ensureSessionMessagesLoaded.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.machineSpawnNewSession.mock.invocationCallOrder[0]);
        expect(mocks.sendMessage.mock.calls[0]?.[1]).toContain('Visible loaded context');
        expect(mocks.sendMessage.mock.calls[0]?.[1]).not.toContain('HIDDEN_UNLOADED_SENTINEL');
        act(() => renderer.unmount());
    });

    it('does not spawn when an unopened source cannot load within the bounded wait', async () => {
        mocks.messagesLoaded = false;
        mocks.messages = [];
        mocks.ensureSessionMessagesLoaded.mockResolvedValue(null);
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(ProviderContinuationSheet, { sessionId: 'source-session' }));
        });

        const target = renderer.root.findByProps({ testID: 'provider-continuation-codex' });
        await expect(target.props.onPress()).rejects.toThrow('session.providerContinuationHandoffFailed');
        expect(mocks.machineSpawnNewSession).not.toHaveBeenCalled();
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });
});
