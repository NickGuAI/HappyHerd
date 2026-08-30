import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    mountCounter: 0,
    panHandlers: null as Record<string, (...args: any[]) => void> | null,
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        PanResponder: {
            create: (handlers: Record<string, (...args: any[]) => void>) => {
                mocks.panHandlers = handlers;
                return { panHandlers: handlers };
            },
        },
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        View: host('View'),
    };
});

vi.mock('react-native-unistyles', () => {
    const theme = {
        colors: {
            divider: '#ddd',
            groupped: { background: '#fafafa' },
            surface: '#fff',
            surfaceHigh: '#eee',
            surfaceSelected: '#e5e5e5',
            text: '#111',
            textLink: '#06c',
            textSecondary: '#666',
        },
    };
    return {
        StyleSheet: {
            absoluteFillObject: { position: 'absolute', inset: 0 },
            hairlineWidth: 1,
            create: (factory: any) => typeof factory === 'function' ? factory(theme) : factory,
        },
        useUnistyles: () => ({ theme }),
    };
});

vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    const Octicons = (props: any) => ReactModule.createElement('Octicons', props);
    Octicons.glyphMap = {};
    return { Octicons };
});

vi.mock('@/components/FileIcon', async () => {
    const ReactModule = await import('react');
    return { FileIcon: (props: any) => ReactModule.createElement('FileIcon', props) };
});

vi.mock('@/components/FileViewPanel', async () => {
    const ReactModule = await import('react');
    return {
        FileViewPanel: (props: any) => {
            const mountId = ReactModule.useRef(++mocks.mountCounter).current;
            return ReactModule.createElement('FileViewPanel', { ...props, mountId });
        },
    };
});

vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});

vi.mock('@/constants/Typography', () => ({
    Typography: { default: () => ({}) },
}));

vi.mock('@/text', () => ({
    t: (key: string, params?: { name?: string }) => params?.name ? `${key}:${params.name}` : key,
}));

import {
    DesktopFileWorkspace,
    DesktopFileWorkspaceDivider,
    DesktopFileWorkspaceSplit,
} from './DesktopFileWorkspace';

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
    mocks.mountCounter = 0;
    mocks.panHandlers = null;
});

function workspaceElement(overrides: Record<string, unknown> = {}) {
    return React.createElement(DesktopFileWorkspace, {
        sessionId: 'session-one',
        paths: ['/work/a.ts', '/work/b.md'],
        activePath: '/work/a.ts',
        dirtyPaths: new Set<string>(),
        pickerOpen: false,
        picker: React.createElement('Picker'),
        onSelect: vi.fn(),
        onRequestClose: vi.fn(),
        onOpenChanges: vi.fn(),
        onOpenPicker: vi.fn(),
        onDirtyChange: vi.fn(),
        ...overrides,
    });
}

function filePanels(renderer: ReactTestRenderer) {
    return renderer.root.findAllByType('FileViewPanel' as any);
}

describe('DesktopFileWorkspace', () => {
    it('keeps every keyed file panel mounted while switching tabs and opening the picker', () => {
        let renderer!: ReactTestRenderer;
        act(() => { renderer = create(workspaceElement()); });
        const initialMounts = Object.fromEntries(filePanels(renderer).map((node: any) => [node.props.filePath, node.props.mountId]));

        act(() => { renderer.update(workspaceElement({ activePath: '/work/b.md' })); });
        expect(Object.fromEntries(filePanels(renderer).map((node: any) => [node.props.filePath, node.props.mountId])))
            .toEqual(initialMounts);
        expect(filePanels(renderer).find((node: any) => node.props.filePath === '/work/b.md')?.props.active).toBe(true);

        act(() => { renderer.update(workspaceElement({ activePath: '/work/b.md', pickerOpen: true })); });
        expect(Object.fromEntries(filePanels(renderer).map((node: any) => [node.props.filePath, node.props.mountId])))
            .toEqual(initialMounts);
        expect(filePanels(renderer).every((node: any) => node.props.active === false)).toBe(true);
        expect(renderer.root.findAllByType('Picker' as any)).toHaveLength(1);
    });

    it('keeps dirty and header callbacks scoped to their exact path', () => {
        const onDirtyChange = vi.fn();
        let renderer!: ReactTestRenderer;
        act(() => { renderer = create(workspaceElement({ onDirtyChange })); });

        const second = filePanels(renderer).find((node: any) => node.props.filePath === '/work/b.md');
        act(() => second?.props.onDirtyChange(true));
        expect(onDirtyChange).toHaveBeenCalledWith('/work/b.md', true);

        act(() => second?.props.onHeaderRightSlotChange(React.createElement('HeaderControl')));
        act(() => { renderer.update(workspaceElement({ activePath: '/work/b.md', onDirtyChange })); });
        expect(renderer.root.findAllByType('HeaderControl' as any)).toHaveLength(1);
    });

    it('keeps Changes available, uses plus only for the existing picker, and closes only the requested tab', () => {
        const onOpenChanges = vi.fn();
        const onOpenPicker = vi.fn();
        const onRequestClose = vi.fn();
        const onSelect = vi.fn();
        let renderer!: ReactTestRenderer;
        act(() => { renderer = create(workspaceElement({ onOpenChanges, onOpenPicker, onRequestClose, onSelect })); });

        const changes = renderer.root.findAllByType('Pressable' as any)
            .find((node: any) => node.props.accessibilityLabel === 'files.changes');
        act(() => changes?.props.onPress());
        expect(onOpenChanges).toHaveBeenCalledOnce();

        const plus = renderer.root.findAllByType('Pressable' as any)
            .find((node: any) => node.props.accessibilityLabel === 'files.openExistingFile');
        act(() => plus?.props.onPress());
        expect(onOpenPicker).toHaveBeenCalledOnce();
        expect(onSelect).not.toHaveBeenCalled();

        const close = renderer.root.findAllByType('Pressable' as any)
            .find((node: any) => node.props.accessibilityLabel === 'files.closeFileTab:a.ts');
        const stopPropagation = vi.fn();
        act(() => close?.props.onPress({ stopPropagation }));
        expect(stopPropagation).toHaveBeenCalledOnce();
        expect(onRequestClose).toHaveBeenCalledWith('/work/a.ts');
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('switches to a single full-width header without remounting file panels', () => {
        const onRequestClose = vi.fn();
        let renderer!: ReactTestRenderer;
        act(() => { renderer = create(workspaceElement({ onRequestClose })); });
        const initialMounts = Object.fromEntries(filePanels(renderer).map((node: any) => [node.props.filePath, node.props.mountId]));

        act(() => {
            renderer.update(workspaceElement({ compact: true, onRequestClose }));
        });

        expect(Object.fromEntries(filePanels(renderer).map((node: any) => [node.props.filePath, node.props.mountId])))
            .toEqual(initialMounts);
        expect(renderer.root.findAllByProps({ testID: 'desktop-file-workspace-fullscreen-header' }).length).toBeGreaterThan(0);
        expect(renderer.root.findAllByProps({ accessibilityLabel: 'files.openExistingFile' })).toHaveLength(0);

        const back = renderer.root.findAllByProps({ accessibilityLabel: 'common.back' }).at(-1)!;
        act(() => back.props.onPress());
        expect(onRequestClose).toHaveBeenCalledWith('/work/a.ts');
    });
});

describe('DesktopFileWorkspaceSplit', () => {
    it('shows the mounted workspace full-width without a divider or fallback', () => {
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(
                DesktopFileWorkspaceSplit,
                {
                    workspaceVisible: false,
                    workspaceFullscreen: true,
                    workspace: React.createElement('Workspace'),
                    fallback: React.createElement('Fallback'),
                    children: React.createElement('Chat'),
                },
            ));
        });

        expect(renderer.root.findByProps({ testID: 'desktop-file-workspace-host' }).props.pointerEvents).toBe('auto');
        expect(renderer.root.findAllByType('Workspace' as any)).toHaveLength(1);
        expect(renderer.root.findAllByType('Chat' as any)).toHaveLength(1);
        expect(renderer.root.findAllByType('Fallback' as any)).toHaveLength(0);
        expect(renderer.root.findAllByProps({ testID: 'desktop-file-workspace-divider' })).toHaveLength(0);
    });
});

describe('DesktopFileWorkspaceDivider', () => {
    it('translates drag distance into right-pane width without remounting content', () => {
        const onWidthChange = vi.fn();
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(DesktopFileWorkspaceDivider, { width: 500, onWidthChange }));
        });

        const divider = renderer.root.findByProps({ testID: 'desktop-file-workspace-divider' });
        act(() => divider.props.onPanResponderGrant());
        act(() => divider.props.onPanResponderMove({}, { dx: 75 }));
        expect(onWidthChange).toHaveBeenCalledWith(425);
    });

    it('supports accessible 40-pixel increments and decrements', () => {
        const onWidthChange = vi.fn();
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(DesktopFileWorkspaceDivider, { width: 500, onWidthChange }));
        });
        const divider = renderer.root.findByProps({ testID: 'desktop-file-workspace-divider' });

        act(() => divider.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
        act(() => divider.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }));
        expect(onWidthChange.mock.calls).toEqual([[540], [460]]);
    });
});
