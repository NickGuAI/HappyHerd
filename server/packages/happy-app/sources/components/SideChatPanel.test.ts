import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    visible: vi.fn(),
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        View: host('View'),
        Text: host('Text'),
        Pressable: host('Pressable'),
        ActivityIndicator: host('ActivityIndicator'),
        ScrollView: host('ScrollView'),
        Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default },
        useWindowDimensions: () => ({ width: 390, height: 844 }),
    };
});
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Octicons: (props: any) => ReactModule.createElement('Octicons', props) };
});
vi.mock('react-native-unistyles', () => {
    const theme = {
        colors: {
            text: '#111',
            textSecondary: '#666',
            divider: '#ddd',
            surface: '#eee',
            surfaceSelected: '#ddd',
            groupped: { background: '#fff' },
            button: { primary: { background: '#111', tint: '#fff' } },
        },
    };
    return {
        StyleSheet: {
            hairlineWidth: 1,
            create: (factory: any) => typeof factory === 'function' ? factory(theme) : factory,
        },
        useUnistyles: () => ({ theme }),
    };
});
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 20, right: 0, bottom: 10, left: 0 }),
}));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/text', () => ({
    t: (key: string, params?: { index?: number; count?: number }) => {
        if (key === 'sideChat.tabLabel') return `Side chat ${params?.index}`;
        if (key === 'sideChat.openCount') return `Open sub-workers (${params?.count})`;
        return key;
    },
}));
vi.mock('@/sync/storage', () => ({
    useSession: () => null,
    useSideChatSessions: () => [],
}));
vi.mock('@/sync/sync', () => ({ sync: { onSessionVisible: mocks.visible } }));
vi.mock('@/modal', () => ({ Modal: { show: vi.fn() } }));
vi.mock('@/-session/SessionView', async () => {
    const ReactModule = await import('react');
    return {
        SessionViewLoaded: (props: any) => ReactModule.createElement('SessionViewLoaded', props),
    };
});

import {
    SideChatAccessButton,
    SideChatFullscreen,
    SideChatPanel,
    type SideChatPanelProps,
} from './SideChatPanel';
import type { Session } from '@/sync/storageTypes';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());

function child(id: string, createdAt: number): Session {
    return {
        id,
        createdAt,
        updatedAt: createdAt,
        active: true,
        metadata: {
            path: '/srv/project',
            host: 'machine-one',
            isSideChat: true,
            parentSessionId: 'parent',
        },
    } as Session;
}

function panelProps(overrides: Partial<SideChatPanelProps> = {}): SideChatPanelProps {
    return {
        parentSessionId: 'parent',
        sideChats: [child('child-one', 1), child('child-two', 2)],
        activeSideChatId: null,
        onSelectSideChat: vi.fn(),
        onCloseSideChat: vi.fn(),
        onCreateSideChat: vi.fn(),
        canCreateSideChat: true,
        creatingSideChat: false,
        ...overrides,
    };
}

function render(element: React.ReactElement): ReactTestRenderer {
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(element); });
    return renderer;
}

describe('SideChatAccessButton', () => {
    it('exposes an existing external child without creating another', () => {
        const onPress = vi.fn();
        const renderer = render(React.createElement(SideChatAccessButton, {
            count: 2,
            expanded: false,
            compact: false,
            onPress,
        }));

        const button = renderer.root.findByType('Pressable' as any);
        expect(button.props.accessibilityLabel).toBe('Open sub-workers (2)');
        expect(button.props.accessibilityState).toEqual({ expanded: false });
        expect(renderer.root.findAllByType('Text' as any).map((node: any) => node.props.children))
            .toContain('sideChat.panelTitle');
        act(() => button.props.onPress());
        expect(onPress).toHaveBeenCalledOnce();
    });
});

describe('SideChatPanel', () => {
    it('shows multiple children as tabs and focuses the newest hydrated child by default', () => {
        const props = panelProps();
        const renderer = render(React.createElement(SideChatPanel, props));

        const labels = renderer.root.findAllByType('Text' as any).map((node: any) => node.props.children);
        expect(labels).toEqual(expect.arrayContaining(['Side chat 1', 'Side chat 2']));
        expect(renderer.root.findByType('SessionViewLoaded' as any).props.sessionId).toBe('child-two');
        expect(mocks.visible).toHaveBeenCalledWith('child-two');

        const firstTab = renderer.root.findAllByType('Pressable' as any)
            .find((node: any) => node.findAllByType('Text' as any)
                .some((textNode: any) => textNode.props.children === 'Side chat 1'));
        act(() => firstTab?.props.onPress());
        expect(props.onSelectSideChat).toHaveBeenCalledWith('child-one');

        const closeButtons = renderer.root.findAllByType('Pressable' as any)
            .filter((node: any) => node.props.accessibilityLabel === 'sideChat.close');
        act(() => closeButtons[1].props.onPress({ stopPropagation: vi.fn() }));
        expect(props.onCloseSideChat).toHaveBeenCalledWith('child-two');
    });

    it('collapses the full-screen host without closing or archiving child tabs', () => {
        const props = panelProps();
        const onCollapse = vi.fn();
        const renderer = render(React.createElement(SideChatFullscreen, { ...props, onCollapse }));

        const collapse = renderer.root.findAllByType('Pressable' as any)
            .find((node: any) => node.props.accessibilityLabel === 'sideChat.collapse');
        act(() => collapse?.props.onPress());
        expect(onCollapse).toHaveBeenCalledOnce();
        expect(props.onCloseSideChat).not.toHaveBeenCalled();
        expect(renderer.root.findAllByType('Pressable' as any)
            .filter((node: any) => node.props.accessibilityLabel === 'sideChat.close')).toHaveLength(2);
    });
});
