import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    machines: [] as Array<{ id: string; active: boolean; metadata?: Record<string, string> }>,
    dataReady: true,
    getTree: vi.fn(),
    readFile: vi.fn(),
    composerMounted: vi.fn(),
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        View: host('View'),
    };
});
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});
vi.mock('@/components/AgentContentView', async () => {
    const ReactModule = await import('react');
    return {
        AgentContentView: (props: any) => ReactModule.createElement(
            'AgentContentView',
            props,
            props.content,
            props.input,
        ),
    };
});
vi.mock('@/components/FileViewPanel', async () => {
    const ReactModule = await import('react');
    return { FileContentPanel: (props: any) => ReactModule.createElement('FileContentPanel', props) };
});
vi.mock('@/components/FileIcon', async () => {
    const ReactModule = await import('react');
    return { FileIcon: (props: any) => ReactModule.createElement('FileIcon', props) };
});
vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});
vi.mock('@/components/WorkspaceFeedbackComposer', async () => {
    const ReactModule = await import('react');
    return {
        WorkspaceFeedbackComposer: (props: any) => {
            ReactModule.useState(() => {
                mocks.composerMounted(props.absolutePath);
                return null;
            });
            return ReactModule.createElement('WorkspaceFeedbackComposer', props);
        },
    };
});
vi.mock('@/constants/Typography', () => ({
    Typography: { default: () => ({}), mono: () => ({}) },
}));
vi.mock('@/sync/ops', () => ({
    machineGetDirectoryTree: mocks.getTree,
    machineReadFile: mocks.readFile,
}));
vi.mock('@/sync/storage', () => ({
    useAllMachines: () => mocks.machines,
    useIsDataReady: () => mocks.dataReady,
}));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/utils/hostPath', () => ({
    parentHostPath: (path: string) => path.slice(0, path.lastIndexOf('/')) || '/',
}));
vi.mock('@/utils/machineUtils', () => ({ isMachineOnline: (machine: { active: boolean }) => machine.active }));
vi.mock('react-native-unistyles', () => {
    const colors = new Proxy({}, { get: () => '#000' });
    const theme = { colors, dark: false };
    return {
        StyleSheet: {
            create: (factory: any) => factory(theme),
            hairlineWidth: 1,
        },
        useUnistyles: () => ({ theme }),
    };
});

import { WorkspaceLinkViewer } from './WorkspaceLinkViewer';

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
    mocks.machines = [{
        id: 'owner-machine',
        active: true,
        metadata: { displayName: 'Owner Machine', platform: 'linux' },
    }];
    mocks.dataReady = true;
    mocks.getTree.mockReset();
    mocks.readFile.mockReset();
    mocks.composerMounted.mockReset();
});

const reference = {
    mode: 'link' as const,
    originSessionId: 'origin-session',
    machineId: 'owner-machine',
    absolutePath: '/work/report.md',
};

async function renderViewer(): Promise<ReactTestRenderer> {
    let renderer!: ReactTestRenderer;
    await act(async () => {
        renderer = create(React.createElement(WorkspaceLinkViewer, {
            reference,
            onFeedbackSent: vi.fn(),
        }));
        await Promise.resolve();
    });
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
    return renderer;
}

function mockExactFileAndParent() {
    mocks.getTree.mockImplementation(async (_machineId: string, path: string) => {
        if (path === '/work/report.md') {
            return {
                success: true,
                tree: { type: 'file', name: 'report.md', path: '/work/report.md' },
            };
        }
        if (path === '/work') {
            return {
                success: true,
                tree: {
                    type: 'directory',
                    name: 'work',
                    path: '/work',
                    children: [{ type: 'file', name: 'report.md', path: '/work/report.md' }],
                },
            };
        }
        return { success: false, error: `ENOENT: ${path}` };
    });
}

describe('WorkspaceLinkViewer', () => {
    it('opens an exact file from its containing directory on only the pinned machine in read-only mode', async () => {
        mockExactFileAndParent();
        mocks.readFile.mockResolvedValue({ success: true, content: 'cmVwb3J0' });
        const renderer = await renderViewer();

        expect(mocks.getTree).toHaveBeenNthCalledWith(1, 'owner-machine', '/work/report.md', 1);
        expect(mocks.getTree).toHaveBeenNthCalledWith(2, 'owner-machine', '/work', 1);
        const panel = renderer.root.findByType('FileContentPanel' as any);
        expect(panel.props).toMatchObject({
            resourceKey: 'machine:owner-machine',
            filePath: '/work/report.md',
            canWrite: false,
        });

        await act(async () => {
            await panel.props.readFile('/work/report.md');
        });
        expect(mocks.readFile).toHaveBeenCalledWith('owner-machine', '/work/report.md');

        const backToFiles = renderer.root.findByProps({ accessibilityLabel: 'workspace.mobileBackToFiles' });
        act(() => backToFiles.props.onPress());
        expect(renderer.root.findAllByType('FileContentPanel' as any)).toHaveLength(0);
        const directoryText = renderer.root.findAllByType('Text' as any).map((node: any) => node.props.children);
        expect(directoryText).toContain('/work');
        expect(directoryText).toContain('report.md');

        const reportRow = renderer.root.findByProps({ accessibilityLabel: 'common.fileViewer: report.md' });
        act(() => reportRow.props.onPress());
        expect(renderer.root.findByType('FileContentPanel' as any).props.filePath).toBe('/work/report.md');

        const composer = renderer.root.findByType('WorkspaceFeedbackComposer' as any);
        expect(composer.props).toMatchObject({
            originSessionId: 'origin-session',
            machineId: 'owner-machine',
            machineLabel: 'Owner Machine',
            absolutePath: '/work/report.md',
        });
        act(() => renderer.unmount());
    });

    it('keeps the exact folder navigable and opens child files without changing the feedback reference', async () => {
        mocks.getTree.mockImplementation(async (_machineId: string, path: string) => {
            if (path === '/work/report.md') {
                return {
                    success: true,
                    tree: {
                        type: 'directory',
                        name: 'report.md',
                        path: '/work/report.md',
                        children: [
                            { type: 'directory', name: 'nested', path: '/work/report.md/nested' },
                            { type: 'file', name: 'notes.txt', path: '/work/report.md/notes.txt' },
                        ],
                    },
                };
            }
            return {
                success: true,
                tree: {
                    type: 'directory',
                    name: 'nested',
                    path: '/work/report.md/nested',
                    children: [{ type: 'file', name: 'deep.txt', path: '/work/report.md/nested/deep.txt' }],
                },
            };
        });
        const renderer = await renderViewer();

        expect(renderer.root.findAllByType('FileContentPanel' as any)).toHaveLength(0);
        let text = renderer.root.findAllByType('Text' as any).map((node: any) => node.props.children);
        expect(text).toContain('notes.txt');
        expect(text).toContain('/work/report.md/notes.txt');

        const notesRow = renderer.root.findByProps({ accessibilityLabel: 'common.fileViewer: notes.txt' });
        act(() => notesRow.props.onPress());
        expect(renderer.root.findByType('FileContentPanel' as any).props.filePath).toBe('/work/report.md/notes.txt');
        expect(renderer.root.findByType('WorkspaceFeedbackComposer' as any).props.absolutePath).toBe('/work/report.md');

        act(() => renderer.root.findByProps({ accessibilityLabel: 'workspace.mobileBackToFiles' }).props.onPress());
        const nestedRow = renderer.root.findByProps({ accessibilityLabel: 'uiCopy.openFolderValue' });
        await act(async () => {
            nestedRow.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(mocks.getTree).toHaveBeenLastCalledWith('owner-machine', '/work/report.md/nested', 1);
        text = renderer.root.findAllByType('Text' as any).map((node: any) => node.props.children);
        expect(text).toContain('deep.txt');
        act(() => renderer.unmount());
    });

    it('fails closed when the pinned machine is missing and retries the same reference', async () => {
        mocks.machines = [{ id: 'other-machine', active: true }];
        const renderer = await renderViewer();

        expect(mocks.getTree).not.toHaveBeenCalled();
        const text = renderer.root.findAllByType('Text' as any).map((node: any) => node.props.children);
        const textParts = text.flatMap((value: unknown) => Array.isArray(value) ? value : [value]);
        expect(text).toContain('owner-machine');
        expect(textParts).toContain('/work/report.md');
        expect(text).toContain('uiCopy.machineNotFound');
        expect(text).toContain('workspace.linkMachineMissingDescription');

        const retry = renderer.root.findByType('Pressable' as any);
        await act(async () => {
            retry.props.onPress();
            await Promise.resolve();
        });
        expect(mocks.getTree).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('keeps read failures in the Viewer and retries the same target', async () => {
        mockExactFileAndParent();
        mocks.readFile.mockResolvedValue({ success: false, error: 'ENOENT: no such file' });
        const renderer = await renderViewer();
        const panel = renderer.root.findByType('FileContentPanel' as any);

        await act(async () => {
            await panel.props.readFile('/work/report.md');
        });
        expect(renderer.root.findAllByType('FileContentPanel' as any)).toHaveLength(0);
        const text = renderer.root.findAllByType('Text' as any).map((node: any) => node.props.children);
        expect(text).toContain('workspace.missingPathTitle');
        expect(text).toContain('workspace.linkPathMissingDescription');
        expect(text).toContain('ENOENT: no such file');

        const retry = renderer.root.findByType('Pressable' as any);
        await act(async () => {
            retry.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(mocks.getTree).toHaveBeenCalledTimes(3);
        expect(mocks.getTree).toHaveBeenNthCalledWith(3, 'owner-machine', '/work', 1);
        expect(renderer.root.findAllByType('FileContentPanel' as any)).toHaveLength(1);
        act(() => renderer.unmount());
    });

    it('retries a failed child file instead of returning to the original folder', async () => {
        mocks.getTree.mockResolvedValue({
            success: true,
            tree: {
                type: 'directory',
                name: 'report.md',
                path: '/work/report.md',
                children: [{ type: 'file', name: 'notes.txt', path: '/work/report.md/notes.txt' }],
            },
        });
        mocks.readFile.mockResolvedValue({ success: false, error: 'EIO: temporary read failure' });
        const renderer = await renderViewer();

        act(() => renderer.root.findByProps({ accessibilityLabel: 'common.fileViewer: notes.txt' }).props.onPress());
        const childPanel = renderer.root.findByType('FileContentPanel' as any);
        await act(async () => {
            await childPanel.props.readFile('/work/report.md/notes.txt');
        });

        const retry = renderer.root.findByType('Pressable' as any);
        await act(async () => {
            retry.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.getTree).toHaveBeenLastCalledWith('owner-machine', '/work/report.md', 1);
        expect(renderer.root.findByType('FileContentPanel' as any).props.filePath)
            .toBe('/work/report.md/notes.txt');
        act(() => renderer.unmount());
    });

    it('remounts feedback state when the owning workspace reference changes', async () => {
        mocks.getTree.mockResolvedValue({
            success: true,
            tree: { type: 'directory', name: 'work', path: '/work', children: [] },
        });
        const renderer = await renderViewer();
        expect(mocks.composerMounted).toHaveBeenCalledWith('/work/report.md');

        await act(async () => {
            renderer.update(React.createElement(WorkspaceLinkViewer, {
                reference: { ...reference, absolutePath: '/work/other.md' },
                onFeedbackSent: vi.fn(),
            }));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.composerMounted).toHaveBeenCalledTimes(2);
        expect(mocks.composerMounted).toHaveBeenLastCalledWith('/work/other.md');
        act(() => renderer.unmount());
    });

    it('applies a top safe-area inset only when the full-screen route provides one', async () => {
        mocks.getTree.mockResolvedValue({
            success: true,
            tree: { type: 'directory', name: 'work', path: '/work', children: [] },
        });
        let renderer!: ReactTestRenderer;
        await act(async () => {
            renderer = create(React.createElement(WorkspaceLinkViewer, {
                reference,
                headerTopInset: 47,
                onFeedbackSent: vi.fn(),
            }));
            await Promise.resolve();
            await Promise.resolve();
        });

        const insetLayout = renderer.root.findAllByType('View' as any)
            .flatMap((node: any) => Array.isArray(node.props.style) ? node.props.style : [node.props.style])
            .find((style: any) => style?.paddingTop === 47);
        expect(insetLayout).toMatchObject({ minHeight: 111, paddingTop: 47 });
        act(() => renderer.unmount());

        const sidePanelRenderer = await renderViewer();
        const sidePanelLayout = sidePanelRenderer.root.findAllByType('View' as any)
            .flatMap((node: any) => Array.isArray(node.props.style) ? node.props.style : [node.props.style])
            .find((style: any) => style?.paddingTop === 0 && style?.minHeight === 64);
        expect(sidePanelLayout).toBeDefined();
        act(() => sidePanelRenderer.unmount());
    });

    it('describes an unknown linked-target read failure as a file or folder error', async () => {
        mocks.getTree.mockResolvedValue({ success: false, error: 'EIO: read failed' });
        const renderer = await renderViewer();

        const text = renderer.root.findAllByType('Text' as any).map((node: any) => node.props.children);
        expect(text).toContain('workspace.linkReadErrorTitle');
        expect(text).toContain('errors.tryAgain');
        expect(text).toContain('EIO: read failed');
        act(() => renderer.unmount());
    });
});
