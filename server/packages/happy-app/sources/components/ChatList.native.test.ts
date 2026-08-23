import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    messages: [] as any[],
    session: null as any,
    platformOS: 'ios',
    controlMode: 'agent',
    scrollToIndex: vi.fn(),
    scrollToOffset: vi.fn(),
    listInstances: [] as Array<{
        scrollToIndex: ReturnType<typeof vi.fn>;
        scrollToOffset: ReturnType<typeof vi.fn>;
    }>,
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    const FlatList = ReactModule.forwardRef((props: any, ref: any) => {
        const instanceRef = ReactModule.useRef<{
            scrollToIndex: ReturnType<typeof vi.fn>;
            scrollToOffset: ReturnType<typeof vi.fn>;
        } | null>(null);
        if (!instanceRef.current) {
            instanceRef.current = {
                scrollToIndex: vi.fn((...args: any[]) => mocks.scrollToIndex(...args)),
                scrollToOffset: vi.fn((...args: any[]) => mocks.scrollToOffset(...args)),
            };
            mocks.listInstances.push(instanceRef.current);
        }
        ReactModule.useImperativeHandle(ref, () => instanceRef.current);
        return ReactModule.createElement('FlatList', props);
    });
    return {
        ActivityIndicator: host('ActivityIndicator'),
        AppState: { addEventListener: () => ({ remove: vi.fn() }) },
        FlatList,
        Platform: { get OS() { return mocks.platformOS; } },
        Pressable: host('Pressable'),
        Text: host('Text'),
        View: host('View'),
    };
});
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Octicons: (props: any) => ReactModule.createElement('Octicons', props) };
});
vi.mock('react-native-unistyles', () => {
    const theme = {
        colors: {
            divider: '#ddd',
            shadow: { color: '#000', opacity: 0.2 },
            surface: '#fff',
            text: '#111',
        },
    };
    return {
        StyleSheet: { create: (factory: any) => factory(theme) },
        useUnistyles: () => ({ theme }),
    };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
vi.mock('@/utils/responsive', () => ({ useHeaderHeight: () => 0 }));
vi.mock('@/sync/storage', () => ({
    useSession: () => mocks.session,
    useSessionMessages: () => ({
        messages: mocks.messages,
        hasMoreOlder: false,
        isLoadingOlder: false,
    }),
    useSetting: () => false,
}));
vi.mock('@/sync/sync', () => ({ sync: { loadOlderMessages: vi.fn() } }));
vi.mock('@/sync/controlHandoff', () => ({ resolveControlMode: () => mocks.controlMode }));
vi.mock('@/sync/rig', () => ({ usesControlledSessionUi: () => false }));
vi.mock('@/sync/queueProjection', () => ({
    projectSessionQueue: (messages: any[]) => ({ transcriptMessages: messages }),
}));
vi.mock('@/hooks/useGroupedMessages', () => ({
    useGroupedMessages: (messages: any[]) => messages.map((message) => ({
        type: 'message',
        id: message.id,
        message,
    })),
}));
vi.mock('./MessageView', async () => {
    const ReactModule = await import('react');
    return { MessageView: (props: any) => ReactModule.createElement('MessageView', props) };
});
vi.mock('./ToolGroupView', () => ({
    AgentWorkGroupView: () => null,
    ToolGroupView: () => null,
}));
vi.mock('./ChatFooter', () => ({ ChatFooter: () => null }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { ChatList } from './ChatList';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());
afterEach(() => vi.useRealTimers());

beforeEach(() => {
    mocks.messages = [];
    mocks.platformOS = 'ios';
    mocks.controlMode = 'agent';
    mocks.session = {
        id: 'origin-session',
        active: true,
        metadata: null,
        agentState: null,
        thinking: false,
    };
    mocks.scrollToIndex.mockReset();
    mocks.scrollToOffset.mockReset();
    mocks.listInstances = [];
});

function userMessage(id: string, localId: string | null = null) {
    return { kind: 'user-text', id, localId, createdAt: 1, text: id };
}

function agentMessage(id: string) {
    return { kind: 'agent-text', id, createdAt: 2, text: id, isThinking: false };
}

function chat(session = mocks.session, focusMessageId = 'feedback-local-id') {
    return React.createElement(ChatList, {
        session,
        focusMessageId,
    });
}

async function renderChat(): Promise<ReactTestRenderer> {
    let renderer!: ReactTestRenderer;
    await act(async () => {
        renderer = create(chat());
        await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });
    return renderer;
}

describe('ChatList exact feedback focus', () => {
    it('keeps native follow-latest enabled for ordinary Chat without an exact focus request', async () => {
        mocks.messages = [userMessage('ordinary')];
        let renderer!: ReactTestRenderer;
        await act(async () => {
            renderer = create(React.createElement(ChatList, { session: mocks.session }));
            await Promise.resolve();
        });
        expect(renderer.root.findByType('FlatList' as any).props.maintainVisibleContentPosition).toEqual({
            minIndexForVisible: 1,
            autoscrollToTopThreshold: 50,
        });
        act(() => renderer.unmount());
    });

    it('disables native follow-latest at index zero until Jump to Latest releases the anchor', async () => {
        mocks.messages = [userMessage('feedback-persisted-id', 'feedback-local-id')];
        const renderer = await renderChat();

        let list = renderer.root.findByType('FlatList' as any);
        expect(list.props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 1 });
        expect(mocks.scrollToIndex).toHaveBeenCalledWith({
            index: 0,
            animated: true,
            viewPosition: 0.5,
        });

        act(() => list.props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } }));
        expect(renderer.root.findByProps({ accessibilityLabel: 'uiCopy.jumpToLatest' })).toBeTruthy();

        mocks.messages = [
            agentMessage('agent-newer'),
            userMessage('feedback-persisted-id', 'feedback-local-id'),
        ];
        await act(async () => {
            renderer.update(chat({ ...mocks.session }));
            await Promise.resolve();
        });

        list = renderer.root.findByType('FlatList' as any);
        expect(list.props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 1 });
        expect(renderer.root.findAllByType('Text' as any).map((node: any) => node.props.children))
            .toContain('uiCopy.newMessagesJumpToLatest');

        mocks.scrollToOffset.mockClear();
        act(() => renderer.root.findByProps({ accessibilityLabel: 'uiCopy.jumpToLatest' }).props.onPress());
        expect(renderer.root.findByType('FlatList' as any).props.maintainVisibleContentPosition).toEqual({
            minIndexForVisible: 1,
            autoscrollToTopThreshold: 50,
        });
        expect(mocks.scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });

        mocks.messages = [
            userMessage('second-persisted-id', 'second-local-id'),
            ...mocks.messages,
        ];
        await act(async () => {
            renderer.update(chat({ ...mocks.session }, 'second-local-id'));
            await Promise.resolve();
        });
        expect(renderer.root.findByType('FlatList' as any).props.maintainVisibleContentPosition)
            .toEqual({ minIndexForVisible: 1 });
        expect(mocks.scrollToIndex).toHaveBeenLastCalledWith({
            index: 0,
            animated: true,
            viewPosition: 0.5,
        });
        act(() => renderer.unmount());
    });

    it('activates the native anchor when an initially absent receipt arrives at index zero', async () => {
        mocks.messages = [userMessage('older')];
        const renderer = await renderChat();
        expect(renderer.root.findByType('FlatList' as any).props.maintainVisibleContentPosition).toEqual({
            minIndexForVisible: 1,
            autoscrollToTopThreshold: 50,
        });

        mocks.messages = [
            userMessage('feedback-persisted-id', 'feedback-local-id'),
            userMessage('older'),
        ];
        await act(async () => {
            renderer.update(chat({ ...mocks.session }));
            await Promise.resolve();
        });

        expect(renderer.root.findByType('FlatList' as any).props.maintainVisibleContentPosition)
            .toEqual({ minIndexForVisible: 1 });
        expect(mocks.scrollToIndex).toHaveBeenCalledWith({
            index: 0,
            animated: true,
            viewPosition: 0.5,
        });
        act(() => renderer.unmount());
    });

    it('reapplies exact focus after a web control handoff remounts the native list', async () => {
        mocks.platformOS = 'web';
        mocks.messages = [userMessage('feedback-persisted-id', 'feedback-local-id')];
        const renderer = await renderChat();
        expect(mocks.listInstances).toHaveLength(1);
        expect(mocks.listInstances[0].scrollToIndex).toHaveBeenCalledTimes(1);

        mocks.controlMode = 'user';
        mocks.session = { ...mocks.session, metadata: { handoffRevision: 1 } };
        mocks.messages = [
            agentMessage('agent-newer'),
            ...mocks.messages,
        ];
        await act(async () => {
            renderer.update(chat(mocks.session));
            await Promise.resolve();
        });

        expect(mocks.listInstances).toHaveLength(2);
        expect(mocks.listInstances[0].scrollToIndex).toHaveBeenCalledTimes(1);
        expect(mocks.listInstances[1].scrollToIndex).toHaveBeenCalledTimes(1);
        expect(mocks.listInstances[1].scrollToIndex).toHaveBeenLastCalledWith({
            index: 1,
            animated: true,
            viewPosition: 0.5,
        });
        expect(renderer.root.findByType('FlatList' as any).props.maintainVisibleContentPosition)
            .toEqual({ minIndexForVisible: 1 });

        act(() => renderer.root.findByType('FlatList' as any).props.onScrollBeginDrag());
        mocks.controlMode = 'agent';
        mocks.session = { ...mocks.session, metadata: { handoffRevision: 2 } };
        mocks.messages = [agentMessage('agent-even-newer'), ...mocks.messages];
        await act(async () => {
            renderer.update(chat(mocks.session));
            await Promise.resolve();
        });
        expect(mocks.listInstances).toHaveLength(3);
        expect(mocks.listInstances[2].scrollToIndex).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('cancels a pending focus retry when a user drag releases the exact anchor', async () => {
        vi.useFakeTimers();
        mocks.messages = [userMessage('feedback-persisted-id', 'feedback-local-id')];
        mocks.scrollToIndex.mockImplementationOnce(() => {
            throw new Error('row not measured');
        });
        const renderer = await renderChat();
        expect(mocks.scrollToIndex).toHaveBeenCalledTimes(1);

        const list = renderer.root.findByType('FlatList' as any);
        act(() => list.props.onScrollBeginDrag());
        expect(renderer.root.findByType('FlatList' as any).props.maintainVisibleContentPosition).toEqual({
            minIndexForVisible: 1,
            autoscrollToTopThreshold: 50,
        });

        act(() => vi.advanceTimersByTime(60));
        expect(mocks.scrollToIndex).toHaveBeenCalledTimes(1);
        act(() => renderer.unmount());
    });
});
