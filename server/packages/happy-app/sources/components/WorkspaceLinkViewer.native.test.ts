import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    machines: [] as Array<{
        id: string;
        active: boolean;
        activeAt?: number;
        metadata?: Record<string, string>;
    }>,
    dataReady: true,
    getTree: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    confirm: vi.fn(),
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
vi.mock('@/modal', () => ({ Modal: { confirm: mocks.confirm } }));
vi.mock('@/sync/ops', () => ({
    machineGetDirectoryTree: mocks.getTree,
    machineReadFile: mocks.readFile,
    machineWriteFile: mocks.writeFile,
}));
vi.mock('@/sync/storage', () => ({
    useAllMachines: () => mocks.machines,
    useIsDataReady: () => mocks.dataReady,
    useSession: () => ({ metadata: { machineId: 'owner-machine', path: '/work' } }),
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
    mocks.writeFile.mockReset();
    mocks.confirm.mockReset();
    mocks.confirm.mockResolvedValue(false);
    mocks.composerMounted.mockReset();
});

const reference = {
    mode: 'link' as const,
    originSessionId: 'origin-session',
    machineId: 'owner-machine',
    absolutePath: '/work/report.md',
};

async function renderViewer(
    overrides: Partial<React.ComponentProps<typeof WorkspaceLinkViewer>> = {},
): Promise<ReactTestRenderer> {
    let renderer!: ReactTestRenderer;
    await act(async () => {
        renderer = create(React.createElement(WorkspaceLinkViewer, {
            reference,
            onFeedbackSent: vi.fn(),
            ...overrides,
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
    it('opens and writes an exact file on only the pinned online machine', async () => {
        mockExactFileAndParent();
        mocks.readFile.mockResolvedValue({ success: true, content: 'cmVwb3J0' });
        mocks.writeFile.mockResolvedValue({ success: true, hash: 'saved-hash' });
        const renderer = await renderViewer();

        expect(mocks.getTree).toHaveBeenNthCalledWith(1, 'owner-machine', '/work/report.md', 1);
        expect(mocks.getTree).toHaveBeenNthCalledWith(2, 'owner-machine', '/work', 1);
        const panel = renderer.root.findByType('FileContentPanel' as any);
        expect(panel.props).toMatchObject({
            resourceKey: 'machine:owner-machine',
            filePath: '/work/report.md',
            canWrite: true,
        });

        await act(async () => {
            await panel.props.readFile('/work/report.md');
        });
        expect(mocks.readFile).toHaveBeenCalledWith('owner-machine', '/work/report.md');

        await act(async () => {
            await panel.props.writeFile('/work/report.md', 'dXBkYXRlZA==', 'original-hash');
        });
        expect(mocks.writeFile).toHaveBeenCalledWith(
            'owner-machine',
            '/work/report.md',
            'dXBkYXRlZA==',
            'original-hash',
        );

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

    it('threads the original link position into the shared file viewer', async () => {
        mockExactFileAndParent();
        const renderer = await renderViewer({ reference: { ...reference, line: '42', column: '7' } });

        expect(renderer.root.findByType('FileContentPanel' as any).props).toMatchObject({
            requestedLine: 42,
            requestedColumn: 7,
        });
        expect(renderer.root.findByType('WorkspaceFeedbackComposer' as any).props).toMatchObject({
            line: 42,
            column: 7,
        });
        act(() => renderer.unmount());
    });

    it('retains the loaded file host after a background read failure and recovery', async () => {
        mockExactFileAndParent();
        mocks.readFile.mockResolvedValue({ success: true, content: 'cmVwb3J0' });
        const renderer = await renderViewer();
        const panel = renderer.root.findByType('FileContentPanel' as any);

        await act(async () => { await panel.props.readFile('/work/report.md'); });
        mocks.readFile.mockResolvedValue({ success: false, error: 'EIO: temporary failure' });
        await act(async () => { await panel.props.readFile('/work/report.md'); });
        expect(renderer.root.findByType('FileContentPanel' as any)).toBe(panel);

        mocks.readFile.mockResolvedValue({ success: true, content: 'cmVwb3J0' });
        await act(async () => { await panel.props.readFile('/work/report.md'); });
        expect(renderer.root.findByType('FileContentPanel' as any)).toBe(panel);

        act(() => renderer.root.findByProps({ accessibilityLabel: 'workspace.mobileBackToFiles' }).props.onPress());
        act(() => renderer.root.findByProps({ accessibilityLabel: 'common.fileViewer: report.md' }).props.onPress());
        mocks.readFile.mockResolvedValue({ success: false, error: 'ENOENT: no such file' });
        await act(async () => {
            await renderer.root.findByType('FileContentPanel' as any).props.readFile('/work/report.md');
        });
        expect(renderer.root.findAllByType('FileContentPanel' as any)).toHaveLength(0);
        act(() => renderer.unmount());
    });

    it.each([
        { originSessionId: 'other-session' },
        { machineId: 'other-machine' },
        { absolutePath: '/work/other.md' },
    ])('reinitializes a loaded viewer when its reference changes: %j', async (change) => {
        mocks.machines.push({ id: 'other-machine', active: true, metadata: { platform: 'linux' } });
        mocks.getTree.mockImplementation(async (_machineId: string, path: string) => ({
            success: true,
            tree: path.endsWith('.md')
                ? { type: 'file', name: path.split('/').at(-1), path }
                : { type: 'directory', name: 'work', path, children: [] },
        }));
        mocks.readFile.mockResolvedValue({ success: true, content: 'cmVwb3J0' });
        const renderer = await renderViewer();
        const panel = renderer.root.findByType('FileContentPanel' as any);
        await act(async () => { await panel.props.readFile(reference.absolutePath); });
        const nextReference = { ...reference, ...change };
        await act(async () => {
            renderer.update(React.createElement(WorkspaceLinkViewer, {
                reference: nextReference,
                onFeedbackSent: vi.fn(),
            }));
            await Promise.resolve();
            await Promise.resolve();
        });
        const nextPanel = renderer.root.findByType('FileContentPanel' as any);
        expect(nextPanel).not.toBe(panel);
        expect(nextPanel.props).toMatchObject({
            resourceKey: `machine:${nextReference.machineId}`,
            filePath: nextReference.absolutePath,
            markdownSessionId: nextReference.originSessionId,
        });
        act(() => renderer.unmount());
    });

    it('shows an offline error when a new target replaces a loaded reference while disconnected', async () => {
        mockExactFileAndParent();
        mocks.readFile.mockResolvedValue({ success: true, content: 'cmVwb3J0' });
        const renderer = await renderViewer();
        const panel = renderer.root.findByType('FileContentPanel' as any);
        await act(async () => { await panel.props.readFile(reference.absolutePath); });
        mocks.machines = mocks.machines.map((machine) => ({ ...machine, active: false }));
        await act(async () => {
            renderer.update(React.createElement(WorkspaceLinkViewer, {
                reference: { ...reference, absolutePath: '/work/other.md' },
                onFeedbackSent: vi.fn(),
            }));
            await Promise.resolve();
        });
        expect(renderer.root.findAllByType('FileContentPanel' as any)).toHaveLength(0);
        expect(renderer.root.findAllByType('Text' as any).map((node: any) => node.props.children))
            .toContain('workspace.offlineTitle');
        expect(mocks.getTree).toHaveBeenCalledTimes(2);
        act(() => renderer.unmount());
    });

    it('keeps a dirty file mounted when discard is cancelled and returns to files after confirmation', async () => {
        mockExactFileAndParent();
        const onDirtyChange = vi.fn();
        const renderer = await renderViewer({ onDirtyChange });
        const panel = renderer.root.findByType('FileContentPanel' as any);

        act(() => panel.props.onDirtyChange(true));
        expect(onDirtyChange).toHaveBeenLastCalledWith(true);

        const backToFiles = renderer.root.findByProps({ accessibilityLabel: 'workspace.mobileBackToFiles' });
        await act(async () => {
            backToFiles.props.onPress();
            await Promise.resolve();
        });
        expect(mocks.confirm).toHaveBeenCalledWith(
            'uiCopy.discardUnsavedChanges',
            'uiCopy.yourCurrentFileEditsHaveNotBeenSaved',
            { cancelText: 'common.cancel', confirmText: 'common.discard', destructive: true },
        );
        expect(renderer.root.findAllByType('FileContentPanel' as any)).toHaveLength(1);

        mocks.confirm.mockResolvedValueOnce(true);
        await act(async () => {
            backToFiles.props.onPress();
            await Promise.resolve();
        });
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        expect(renderer.root.findAllByType('FileContentPanel' as any)).toHaveLength(0);
        act(() => renderer.unmount());
    });

    it('preserves a dirty editor when a passive file read fails', async () => {
        mockExactFileAndParent();
        mocks.readFile.mockResolvedValue({ success: false, error: 'EIO: transient poll failure' });
        const renderer = await renderViewer();
        const panel = renderer.root.findByType('FileContentPanel' as any);

        act(() => panel.props.onDirtyChange(true));
        await act(async () => {
            await panel.props.readFile('/work/report.md');
        });

        expect(renderer.root.findByType('FileContentPanel' as any)).toBe(panel);
        const text = renderer.root.findAllByType('Text' as any).map((node: any) => node.props.children);
        expect(text).not.toContain('workspace.linkReadErrorTitle');
        expect(text).not.toContain('EIO: transient poll failure');
        act(() => renderer.unmount());
    });

    it('keeps the file reader stable across heartbeat-only machine replacements', async () => {
        mockExactFileAndParent();
        mocks.readFile.mockResolvedValue({ success: true, content: 'cmVwb3J0' });
        const renderer = await renderViewer();
        const initialReadFile = renderer.root.findByType('FileContentPanel' as any).props.readFile;

        mocks.machines = [{
            id: 'owner-machine',
            active: true,
            activeAt: 20_000,
            metadata: { displayName: 'Owner Machine', platform: 'linux' },
        }];
        await act(async () => {
            renderer.update(React.createElement(WorkspaceLinkViewer, {
                reference,
                onFeedbackSent: vi.fn(),
            }));
            await Promise.resolve();
        });

        expect(renderer.root.findByType('FileContentPanel' as any).props.readFile).toBe(initialReadFile);
        act(() => renderer.unmount());
    });

    it('preserves a POSIX filename backslash in the selected path and header', async () => {
        const posixReference = { ...reference, absolutePath: '/work/notes\\final.md' };
        mocks.getTree.mockImplementation(async (_machineId: string, path: string) => {
            if (path === posixReference.absolutePath) {
                return {
                    success: true,
                    tree: { type: 'file', name: 'notes\\final.md', path },
                };
            }
            return {
                success: true,
                tree: {
                    type: 'directory',
                    name: 'work',
                    path: '/work',
                    children: [{ type: 'file', name: 'notes\\final.md', path: posixReference.absolutePath }],
                },
            };
        });
        let renderer!: ReactTestRenderer;
        await act(async () => {
            renderer = create(React.createElement(WorkspaceLinkViewer, {
                reference: posixReference,
                onFeedbackSent: vi.fn(),
            }));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(renderer.root.findByType('FileContentPanel' as any).props.filePath)
            .toBe('/work/notes\\final.md');
        const text = renderer.root.findAllByType('Text' as any).map((node: any) => node.props.children);
        expect(text).toContain('notes\\final.md');
        expect(text).not.toContain('final.md');
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

    it('ignores an older directory response after a newer navigation wins', async () => {
        let finishFirst!: (response: any) => void;
        let finishSecond!: (response: any) => void;
        mocks.getTree.mockImplementation((_machineId: string, path: string) => {
            if (path === '/work/report.md') {
                return Promise.resolve({
                    success: true,
                    tree: {
                        type: 'directory',
                        name: 'report.md',
                        path,
                        children: [
                            { type: 'directory', name: 'first', path: `${path}/first` },
                            { type: 'directory', name: 'second', path: `${path}/second` },
                        ],
                    },
                });
            }
            return new Promise((resolve) => {
                if (path.endsWith('/first')) finishFirst = resolve;
                if (path.endsWith('/second')) finishSecond = resolve;
            });
        });
        const renderer = await renderViewer();
        const directoryRows = renderer.root.findAllByType('Pressable' as any)
            .filter((node: any) => node.props.accessibilityLabel === 'uiCopy.openFolderValue');
        expect(directoryRows).toHaveLength(2);

        act(() => {
            directoryRows[0]!.props.onPress();
            directoryRows[1]!.props.onPress();
        });
        await act(async () => {
            finishSecond({
                success: true,
                tree: {
                    type: 'directory',
                    name: 'second',
                    path: '/work/report.md/second',
                    children: [{ type: 'file', name: 'newer.txt', path: '/work/report.md/second/newer.txt' }],
                },
            });
            await Promise.resolve();
        });
        await act(async () => {
            finishFirst({
                success: true,
                tree: {
                    type: 'directory',
                    name: 'first',
                    path: '/work/report.md/first',
                    children: [{ type: 'file', name: 'stale.txt', path: '/work/report.md/first/stale.txt' }],
                },
            });
            await Promise.resolve();
        });

        const text = renderer.root.findAllByType('Text' as any).map((node: any) => node.props.children);
        expect(text).toContain('/work/report.md/second');
        expect(text).toContain('newer.txt');
        expect(text).not.toContain('stale.txt');
        act(() => renderer.unmount());
    });

    it('keeps the offline state when a superseded directory read returns late', async () => {
        let finishChild!: (response: any) => void;
        mocks.getTree.mockImplementation((_machineId: string, path: string) => {
            if (path === '/work/report.md') {
                return Promise.resolve({
                    success: true,
                    tree: {
                        type: 'directory',
                        name: 'report.md',
                        path,
                        children: [{ type: 'directory', name: 'child', path: `${path}/child` }],
                    },
                });
            }
            return new Promise((resolve) => { finishChild = resolve; });
        });
        const renderer = await renderViewer();
        act(() => renderer.root.findByProps({ accessibilityLabel: 'uiCopy.openFolderValue' }).props.onPress());

        mocks.machines = [{
            id: 'owner-machine',
            active: false,
            metadata: { displayName: 'Owner Machine', platform: 'linux' },
        }];
        await act(async () => {
            renderer.update(React.createElement(WorkspaceLinkViewer, {
                reference,
                onFeedbackSent: vi.fn(),
            }));
            await Promise.resolve();
        });
        await act(async () => {
            finishChild({
                success: false,
                error: 'EIO: stale directory read failed',
            });
            await Promise.resolve();
        });

        const text = renderer.root.findAllByType('Text' as any).map((node: any) => node.props.children);
        expect(text).toContain('workspace.offlineTitle');
        expect(text).not.toContain('EIO: stale directory read failed');
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

    it('ignores a late child read failure after returning to the directory', async () => {
        mocks.getTree.mockResolvedValue({
            success: true,
            tree: {
                type: 'directory',
                name: 'report.md',
                path: '/work/report.md',
                children: [{ type: 'file', name: 'notes.txt', path: '/work/report.md/notes.txt' }],
            },
        });
        let finishRead!: (response: { success: false; error: string }) => void;
        mocks.readFile.mockImplementation(() => new Promise((resolve) => {
            finishRead = resolve;
        }));
        const renderer = await renderViewer();

        act(() => renderer.root.findByProps({ accessibilityLabel: 'common.fileViewer: notes.txt' }).props.onPress());
        const pendingRead = renderer.root.findByType('FileContentPanel' as any).props
            .readFile('/work/report.md/notes.txt');
        act(() => renderer.root.findByProps({ accessibilityLabel: 'workspace.mobileBackToFiles' }).props.onPress());
        await act(async () => {
            finishRead({ success: false, error: 'EIO: abandoned read failed' });
            await pendingRead;
        });

        expect(renderer.root.findAllByType('FileContentPanel' as any)).toHaveLength(0);
        const text = renderer.root.findAllByType('Text' as any).map((node: any) => node.props.children);
        expect(text).toContain('notes.txt');
        expect(text).not.toContain('workspace.linkReadErrorTitle');
        expect(text).not.toContain('EIO: abandoned read failed');
        act(() => renderer.unmount());
    });

    it('ignores an older failure after reopening the same file and completing a newer read', async () => {
        mocks.getTree.mockResolvedValue({
            success: true,
            tree: {
                type: 'directory',
                name: 'report.md',
                path: '/work/report.md',
                children: [{ type: 'file', name: 'notes.txt', path: '/work/report.md/notes.txt' }],
            },
        });
        const pendingReads: Array<{
            resolve: (response: { success: boolean; content?: string; error?: string }) => void;
        }> = [];
        mocks.readFile.mockImplementation(() => new Promise((resolve) => {
            pendingReads.push({ resolve });
        }));
        const renderer = await renderViewer();

        act(() => renderer.root.findByProps({ accessibilityLabel: 'common.fileViewer: notes.txt' }).props.onPress());
        const firstRead = renderer.root.findByType('FileContentPanel' as any).props
            .readFile('/work/report.md/notes.txt');
        act(() => renderer.root.findByProps({ accessibilityLabel: 'workspace.mobileBackToFiles' }).props.onPress());
        act(() => renderer.root.findByProps({ accessibilityLabel: 'common.fileViewer: notes.txt' }).props.onPress());
        const secondRead = renderer.root.findByType('FileContentPanel' as any).props
            .readFile('/work/report.md/notes.txt');

        await act(async () => {
            pendingReads[1]!.resolve({ success: true, content: 'bmV3' });
            await secondRead;
            pendingReads[0]!.resolve({ success: false, error: 'EIO: stale read failed' });
            await firstRead;
        });

        expect(renderer.root.findByType('FileContentPanel' as any).props.filePath)
            .toBe('/work/report.md/notes.txt');
        const text = renderer.root.findAllByType('Text' as any).map((node: any) => node.props.children);
        expect(text).not.toContain('workspace.linkReadErrorTitle');
        expect(text).not.toContain('EIO: stale read failed');
        act(() => renderer.unmount());
    });

    it('blocks the Viewer Back control while strict feedback is pending', async () => {
        mocks.getTree.mockResolvedValue({
            success: true,
            tree: { type: 'directory', name: 'work', path: '/work', children: [] },
        });
        const onBack = vi.fn();
        const onFeedbackSendingChange = vi.fn();
        let renderer!: ReactTestRenderer;
        await act(async () => {
            renderer = create(React.createElement(WorkspaceLinkViewer, {
                reference,
                onBack,
                onFeedbackSent: vi.fn(),
                onFeedbackSendingChange,
            }));
            await Promise.resolve();
            await Promise.resolve();
        });

        act(() => renderer.root.findByType('WorkspaceFeedbackComposer' as any).props.onSendingChange(true));
        let back = renderer.root.findByProps({ accessibilityLabel: 'common.back' });
        expect(back.props.disabled).toBe(true);
        expect(back.props.accessibilityState).toEqual({ disabled: true });
        expect(back.props.onPress).toBeUndefined();
        expect(onFeedbackSendingChange).toHaveBeenLastCalledWith(true);

        act(() => renderer.root.findByType('WorkspaceFeedbackComposer' as any).props.onSendingChange(false));
        back = renderer.root.findByProps({ accessibilityLabel: 'common.back' });
        expect(back.props.disabled).toBe(false);
        act(() => back.props.onPress());
        expect(onBack).toHaveBeenCalledOnce();
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
