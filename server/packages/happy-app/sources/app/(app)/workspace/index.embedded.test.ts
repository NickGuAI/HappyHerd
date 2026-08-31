import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getTree: vi.fn(),
    machines: [] as Array<{
        id: string;
        active: boolean;
        metadata: {
            displayName: string;
            homeDir: string;
            platform: string;
        };
    }>,
    recentPaths: [] as Array<{ machineId: string; path: string }>,
    favoritePaths: [] as Array<{ machineId: string; path: string }>,
    workspaceEnabled: true,
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Platform: { OS: 'web' },
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        TextInput: host('TextInput'),
        useWindowDimensions: () => ({ width: 1440, height: 900 }),
        View: host('View'),
    };
});

vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});

vi.mock('expo-router', async () => {
    const ReactModule = await import('react');
    const Screen = (props: any) => ReactModule.createElement('Stack.Screen', props);
    return {
        Stack: { Screen },
        useLocalSearchParams: () => ({}),
        useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
    };
});

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock('react-native-unistyles', () => {
    const colors = {
        button: { primary: { background: '#000', tint: '#fff' } },
        divider: '#ddd',
        groupped: { background: '#fafafa' },
        input: { background: '#f5f5f5' },
        success: '#0a0',
        surface: '#fff',
        surfaceSelected: '#eee',
        text: '#111',
        textLink: '#06c',
        textSecondary: '#666',
        warning: '#b70',
    };
    const theme = { colors };
    return {
        StyleSheet: {
            create: (factory: any) => typeof factory === 'function' ? factory(theme) : factory,
            hairlineWidth: 1,
        },
        useUnistyles: () => ({ theme }),
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

vi.mock('@/components/layout', () => ({ layout: { maxWidth: 1200 } }));
vi.mock('@/modal', () => ({
    Modal: {
        alert: vi.fn(),
        confirm: vi.fn(async () => true),
        prompt: vi.fn(async () => null),
    },
}));
vi.mock('@/sync/ops', () => ({
    machineCreateDirectory: vi.fn(),
    machineGetDirectoryTree: mocks.getTree,
    machineReadFile: vi.fn(),
    machineWriteFile: vi.fn(),
}));
vi.mock('@/sync/storage', () => ({
    storage: {
        getState: () => ({
            settings: {
                favoriteMachinePaths: mocks.favoritePaths,
                recentMachinePaths: mocks.recentPaths,
            },
        }),
    },
    useAllMachines: () => mocks.machines,
    useSetting: (key: string) => {
        if (key === 'machineWorkspace') return mocks.workspaceEnabled;
        if (key === 'recentMachinePaths') return mocks.recentPaths;
        if (key === 'favoriteMachinePaths') return mocks.favoritePaths;
        return undefined;
    },
}));
vi.mock('@/sync/sync', () => ({ sync: { applySettings: vi.fn() } }));
vi.mock('@/sync/workspaceContext', () => ({
    MAX_WORKSPACE_CONTEXT_ITEMS: 8,
    addWorkspaceContextEntry: vi.fn(),
    getWorkspaceContextEntries: () => [],
    removeWorkspaceContextEntry: vi.fn(),
}));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/constants/Typography', () => ({
    Typography: { default: () => ({}), mono: () => ({}) },
}));
vi.mock('@/utils/hostPath', () => ({
    hostRoot: () => '/',
    parentHostPath: (path: string) => path.slice(0, path.lastIndexOf('/')) || '/',
}));
vi.mock('@/utils/machineUtils', () => ({
    isMachineOnline: (machine: { active: boolean }) => machine.active,
}));
vi.mock('@/utils/sessionUtils', () => ({
    formatPathRelativeToHome: (path: string) => path,
}));
vi.mock('@/utils/pathUtils', () => ({
    resolveAbsolutePath: (path: string, homeDir?: string) => path.startsWith('/') ? path : `${homeDir}/${path}`,
}));
vi.mock('@/hooks/useMachineFileUpload', () => ({
    useMachineFileUpload: () => ({
        canCancel: false,
        canRetry: false,
        cancel: vi.fn(),
        pickAndUpload: vi.fn(),
        reset: vi.fn(),
        retry: vi.fn(),
        state: { phase: 'idle' },
    }),
}));
vi.mock('@/components/MachineFileUploadStatus', async () => {
    const ReactModule = await import('react');
    return { MachineFileUploadStatus: (props: any) => ReactModule.createElement('MachineFileUploadStatus', props) };
});
vi.mock('@/components/WorkspaceLinkViewer', async () => {
    const ReactModule = await import('react');
    return { WorkspaceLinkViewer: (props: any) => ReactModule.createElement('WorkspaceLinkViewer', props) };
});
vi.mock('@/components/WorkspaceLinkViewerModel', () => ({ workspaceLinkViewerKey: () => 'workspace-link' }));
vi.mock('@/-session/workspaceLinkNavigation', () => ({
    dismissWorkspaceLinkToOrigin: vi.fn(),
    useWorkspaceLinkDismissGuard: () => ({
        guardDismiss: (action: () => void) => action(),
        onDirtyChange: vi.fn(),
        onSendingChange: vi.fn(),
    }),
}));

import { DESKTOP_WORKSPACE_BROWSER_WIDTH } from '@/utils/machineWorkspace';
import { MachineWorkspaceBrowser } from './index';

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
        id: 'main-machine',
        active: true,
        metadata: {
            displayName: 'MainEC2',
            homeDir: '/workspace/user',
            platform: 'linux',
        },
    }];
    mocks.recentPaths = [];
    mocks.favoritePaths = [];
    mocks.workspaceEnabled = true;
    mocks.getTree.mockReset();
    mocks.getTree.mockResolvedValue({
        success: true,
        tree: {
            type: 'directory',
            name: 'user',
            path: '/workspace/user',
            children: [
                { type: 'directory', name: 'project', path: '/workspace/user/project' },
                { type: 'file', name: 'notes.md', path: '/workspace/user/notes.md', size: 42 },
            ],
        },
    });
});

async function renderBrowser(props: React.ComponentProps<typeof MachineWorkspaceBrowser>): Promise<ReactTestRenderer> {
    let renderer!: ReactTestRenderer;
    await act(async () => {
        renderer = create(React.createElement(MachineWorkspaceBrowser, props));
        await Promise.resolve();
    });
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
    return renderer;
}

function browserPane(renderer: ReactTestRenderer) {
    return renderer.root.findByProps({ keyboardShouldPersistTaps: 'handled' }).parent!;
}

function flatStyle(style: unknown): Record<string, unknown> {
    const entries = Array.isArray(style) ? style : [style];
    return Object.assign({}, ...entries.filter(Boolean));
}

describe('MachineWorkspaceBrowser embedded layout', () => {
    it('fills its host, renders a non-empty directory, and emits the exact selected machine and path', async () => {
        mocks.workspaceEnabled = false;
        const onFilePress = vi.fn();
        const renderer = await renderBrowser({ embedded: true, onFilePress });

        expect(mocks.getTree).toHaveBeenCalledWith('main-machine', '/workspace/user', 1);
        expect(flatStyle(browserPane(renderer).props.style)).toMatchObject({ flex: 1, minWidth: 0 });
        expect(flatStyle(browserPane(renderer).props.style)).not.toHaveProperty('width');

        const notes = renderer.root.findAllByType('Text' as any)
            .find((node: any) => node.props.children === 'notes.md');
        expect(notes).toBeDefined();
        const row = renderer.root.findAllByType('Pressable' as any).find((candidate: any) => (
            candidate.findAllByType('Text' as any)
                .some((node: any) => node.props.children === 'notes.md')
        ));
        expect(row).toBeDefined();
        act(() => row.props.onPress());
        expect(onFilePress).toHaveBeenCalledWith({
            machineId: 'main-machine',
            path: '/workspace/user/notes.md',
        });
        act(() => renderer.unmount());
    });

    it('retains the fixed browser rail in the standalone desktop workspace', async () => {
        const renderer = await renderBrowser({});
        expect(flatStyle(browserPane(renderer).props.style)).toMatchObject({
            width: DESKTOP_WORKSPACE_BROWSER_WIDTH,
            minWidth: DESKTOP_WORKSPACE_BROWSER_WIDTH,
            maxWidth: DESKTOP_WORKSPACE_BROWSER_WIDTH,
            flexBasis: DESKTOP_WORKSPACE_BROWSER_WIDTH,
            flexGrow: 0,
            flexShrink: 0,
        });
        act(() => renderer.unmount());
    });

    it('keeps the standalone workspace behind the machineWorkspace feature gate', async () => {
        mocks.workspaceEnabled = false;
        const renderer = await renderBrowser({});

        expect(renderer.root.findAllByType('Text' as any)
            .some((node: any) => node.props.children === 'workspace.featureDisabled')).toBe(true);
        expect(renderer.root.findAllByType('Text' as any)
            .some((node: any) => node.props.children === 'notes.md')).toBe(false);

        act(() => renderer.unmount());
    });
});
