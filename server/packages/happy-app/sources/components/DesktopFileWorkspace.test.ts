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
        Platform: { OS: 'web' },
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
        MachineFileViewPanel: (props: any) => ReactModule.createElement('MachineFileViewPanel', props),
    };
});

vi.mock('@/components/WorkspaceFeedbackComposer', async () => {
    const ReactModule = await import('react');
    return { WorkspaceFeedbackComposer: (props: any) => ReactModule.createElement('WorkspaceFeedbackComposer', props) };
});

vi.mock('@/components/LocalhostWorkspacePanel', async () => {
    const ReactModule = await import('react');
    return { LocalhostWorkspacePanel: (props: any) => ReactModule.createElement('LocalhostWorkspacePanel', props) };
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
        onSelect: vi.fn(),
        onRequestClose: vi.fn(),
        onFileDeleted: vi.fn(),
        onClosePicker: vi.fn(),
        onDirtyChange: vi.fn(),
        ...overrides,
    });
}

function filePanels(renderer: ReactTestRenderer) {
    return renderer.root.findAllByType('FileViewPanel' as any);
}

describe('DesktopFileWorkspace', () => {
    it('keeps every keyed file panel mounted while switching tabs and opening Workspace', () => {
        let renderer!: ReactTestRenderer;
        act(() => { renderer = create(workspaceElement()); });
        const initialMounts = Object.fromEntries(filePanels(renderer).map((node: any) => [node.props.filePath, node.props.mountId]));
        expect(filePanels(renderer).every((node: any) => node.props.headerVariant === 'desktop-workspace')).toBe(true);

        act(() => { renderer.update(workspaceElement({ activePath: '/work/b.md' })); });
        expect(Object.fromEntries(filePanels(renderer).map((node: any) => [node.props.filePath, node.props.mountId])))
            .toEqual(initialMounts);
        expect(filePanels(renderer).every((node: any) => node.props.headerVariant === 'desktop-workspace')).toBe(true);
        expect(filePanels(renderer).find((node: any) => node.props.filePath === '/work/b.md')?.props.active).toBe(true);

        act(() => { renderer.update(workspaceElement({
            activePath: '/work/b.md',
            machinePickerOpen: true,
            machinePicker: React.createElement('MachinePicker'),
        })); });
        expect(Object.fromEntries(filePanels(renderer).map((node: any) => [node.props.filePath, node.props.mountId])))
            .toEqual(initialMounts);
        expect(filePanels(renderer).every((node: any) => node.props.active === false)).toBe(true);
        expect(renderer.root.findAllByType('MachinePicker' as any)).toHaveLength(1);
    });

    it('keeps dirty and header callbacks scoped to their exact path', () => {
        const onDirtyChange = vi.fn();
        const onFileDeleted = vi.fn();
        let renderer!: ReactTestRenderer;
        act(() => { renderer = create(workspaceElement({ onDirtyChange, onFileDeleted })); });

        const second = filePanels(renderer).find((node: any) => node.props.filePath === '/work/b.md');
        act(() => second?.props.onDirtyChange(true));
        expect(onDirtyChange).toHaveBeenCalledWith('/work/b.md', true);
        act(() => second?.props.onDeleted('/work/b.md'));
        expect(onFileDeleted).toHaveBeenCalledWith('/work/b.md');

        act(() => second?.props.onHeaderRightSlotChange(React.createElement('HeaderControl')));
        act(() => { renderer.update(workspaceElement({ activePath: '/work/b.md', onDirtyChange })); });
        expect(renderer.root.findAllByType('HeaderControl' as any)).toHaveLength(1);
    });

    it('keeps the header focused on file tabs and Workspace, removes the old picker +, and closes only the requested tab', () => {
        const onOpenMachinePicker = vi.fn();
        const onRequestClose = vi.fn();
        const onSelect = vi.fn();
        let renderer!: ReactTestRenderer;
        act(() => { renderer = create(workspaceElement({ onOpenMachinePicker, onRequestClose, onSelect })); });

        expect(renderer.root.findAllByProps({ accessibilityLabel: 'files.changes' })).toHaveLength(0);

        const plus = renderer.root.findAllByType('Pressable' as any)
            .find((node: any) => node.props.accessibilityLabel === 'files.openExistingFile');
        expect(plus).toBeUndefined();
        expect(onSelect).not.toHaveBeenCalled();

        const machineWorkspace = renderer.root.findAllByType('Pressable' as any)
            .find((node: any) => node.props.accessibilityLabel === 'workspace.title');
        act(() => machineWorkspace?.props.onPress());
        expect(onOpenMachinePicker).toHaveBeenCalledOnce();

        const close = renderer.root.findAllByType('Pressable' as any)
            .find((node: any) => node.props.accessibilityLabel === 'files.closeFileTab:a.ts');
        const stopPropagation = vi.fn();
        act(() => close?.props.onPress({ stopPropagation }));
        expect(stopPropagation).toHaveBeenCalledOnce();
        expect(onRequestClose).toHaveBeenCalledWith('/work/a.ts');
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('uses the machine-wide viewer and feedback reference for an active machine tab', () => {
        const identity = JSON.stringify(['machine-2', '/work/a.ts']);
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(workspaceElement({
                paths: [identity],
                activePath: identity,
                references: { [identity]: { machineId: 'machine-2', source: 'machine', line: 12, column: 4 } },
            }));
        });

        expect(renderer.root.findByType('MachineFileViewPanel' as any).props.machineId).toBe('machine-2');
        expect(renderer.root.findByType('MachineFileViewPanel' as any).props.originSessionId).toBe('session-one');
        expect(renderer.root.findByType('MachineFileViewPanel' as any).props).toMatchObject({ requestedLine: 12, requestedColumn: 4 });
        const feedback = renderer.root.findByType('WorkspaceFeedbackComposer' as any);
        expect(feedback.props).toMatchObject({ machineId: 'machine-2', absolutePath: '/work/a.ts', line: 12, column: 4 });
    });

    it('mounts a selected-machine localhost URL in the same host without a file composer', () => {
        const identity = JSON.stringify(['machine-ec2', 'localhost', 'http://localhost:5173/dashboard']);
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(workspaceElement({
                paths: [identity],
                activePath: identity,
                references: {
                    [identity]: {
                        kind: 'localhost',
                        machineId: 'machine-ec2',
                        url: 'http://localhost:5173/dashboard',
                    },
                },
            }));
        });

        expect(renderer.root.findByType('LocalhostWorkspacePanel' as any).props).toMatchObject({
            sessionId: 'session-one',
            machineId: 'machine-ec2',
            url: 'http://localhost:5173/dashboard',
            active: true,
        });
        expect(renderer.root.findAllByType('WorkspaceFeedbackComposer' as any)).toHaveLength(0);
        expect(renderer.root.findAllByType('FileViewPanel' as any)).toHaveLength(0);
        expect(renderer.root.findByProps({ accessibilityLabel: 'files.openFileTab:http://localhost:5173/dashboard' }))
            .toBeTruthy();
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
        expect(filePanels(renderer).every((node: any) => node.props.headerVariant === 'standard')).toBe(true);
        expect(renderer.root.findAllByProps({ testID: 'desktop-file-workspace-fullscreen-header' }).length).toBeGreaterThan(0);
        expect(renderer.root.findAllByProps({ accessibilityLabel: 'files.openExistingFile' })).toHaveLength(0);

        const back = renderer.root.findAllByProps({ accessibilityLabel: 'common.back' }).at(-1)!;
        act(() => back.props.onPress());
        expect(onRequestClose).toHaveBeenCalledWith('/work/a.ts');
    });

    it('closes either picker without closing its active tab', () => {
        const onClosePicker = vi.fn();
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(workspaceElement({
                machinePickerOpen: true,
                machinePicker: React.createElement('MachinePicker'),
                onClosePicker,
            }));
        });

        const close = renderer.root.findAllByProps({ accessibilityLabel: 'common.back' }).at(-1)!;
        act(() => close.props.onPress());
        expect(onClosePicker).toHaveBeenCalledOnce();
        expect(renderer.root.findAllByType('FileViewPanel' as any)).toHaveLength(2);
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

    it('resizes the visible host through pointer capture without remounting workspace content', () => {
        let workspaceMounts = 0;
        const WorkspaceProbe = () => {
            const mountId = React.useRef(++workspaceMounts).current;
            return React.createElement('WorkspaceProbe', { mountId });
        };
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(
                DesktopFileWorkspaceSplit,
                {
                    workspaceVisible: true,
                    workspaceFullscreen: false,
                    workspace: React.createElement(WorkspaceProbe),
                    fallback: React.createElement('Fallback'),
                    children: React.createElement('Chat'),
                },
            ));
        });
        act(() => renderer.root.findByProps({ testID: 'desktop-file-workspace-split' }).props.onLayout({
            nativeEvent: { layout: { width: 1200 } },
        }));
        const initialMountId = renderer.root.findByType('WorkspaceProbe' as any).props.mountId;
        const initialWidth = renderer.root.findByProps({ testID: 'desktop-file-workspace-host' }).props.style.width;
        const divider = renderer.root.findByProps({ testID: 'desktop-file-workspace-divider' });
        const currentTarget = { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() };

        act(() => divider.props.onPointerDown({
            nativeEvent: { pointerId: 3, clientX: 900, button: 0 },
            currentTarget,
            preventDefault: vi.fn(),
        }));
        act(() => divider.props.onPointerMove({
            nativeEvent: { pointerId: 3, clientX: 800 },
            currentTarget,
            preventDefault: vi.fn(),
        }));
        act(() => divider.props.onPointerUp({
            nativeEvent: { pointerId: 3, clientX: 800 },
            currentTarget,
        }));

        expect(currentTarget.setPointerCapture).toHaveBeenCalledWith(3);
        expect(currentTarget.releasePointerCapture).toHaveBeenCalledWith(3);
        expect(renderer.root.findByProps({ testID: 'desktop-file-workspace-host' }).props.style.width)
            .toBe(initialWidth + 100);
        expect(renderer.root.findByType('WorkspaceProbe' as any).props.mountId).toBe(initialMountId);
    });
});

describe('DesktopFileWorkspaceDivider', () => {
    it('translates captured pointer movement into right-pane width', () => {
        const onWidthChange = vi.fn();
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(DesktopFileWorkspaceDivider, { width: 500, onWidthChange }));
        });

        const divider = renderer.root.findByProps({ testID: 'desktop-file-workspace-divider' });
        const currentTarget = { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() };
        act(() => divider.props.onPointerDown({
            nativeEvent: { pointerId: 7, clientX: 500, button: 0 },
            currentTarget,
            preventDefault: vi.fn(),
        }));
        act(() => divider.props.onPointerMove({
            nativeEvent: { pointerId: 7, clientX: 575 },
            currentTarget,
            preventDefault: vi.fn(),
        }));
        act(() => divider.props.onPointerUp({
            nativeEvent: { pointerId: 7, clientX: 575 },
            currentTarget,
        }));
        expect(onWidthChange).toHaveBeenCalledWith(425);
        expect(currentTarget.setPointerCapture).toHaveBeenCalledWith(7);
        expect(currentTarget.releasePointerCapture).toHaveBeenCalledWith(7);
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
