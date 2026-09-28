import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HappyHerdCommanderSummary } from '@happyherd/wire';

import type { Machine } from '@/sync/storageTypes';

const testState = vi.hoisted(() => ({
    machines: [] as Machine[],
    sessions: [] as Array<{ id: string; metadata?: { machineId?: string; commanderId?: string } }>,
    listCommanders: vi.fn(),
    readWithinRoot: vi.fn(),
    writeFile: vi.fn(),
    confirmDiscard: vi.fn(),
    navigate: vi.fn(),
    homeDockListening: false,
    draft: {
        selectedMachineId: null as string | null,
        setMachineId: vi.fn(),
        setCommanderId: vi.fn(),
        setPath: vi.fn(),
        setSessionType: vi.fn(),
        setWorktreeKey: vi.fn(),
    },
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Modal: (props: any) => (props.visible ? ReactModule.createElement('Modal', props, props.children) : null),
        Platform: { OS: 'web' },
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        Text: host('Text'),
        View: host('View'),
        useWindowDimensions: () => ({ width: 1440, height: 900 }),
    };
});

vi.mock('@/utils/responsive', () => ({ useIsTablet: () => true }));
vi.mock('react-native-unistyles', async () => {
    const { lightTheme } = await import('@/theme');
    return {
        StyleSheet: {
            hairlineWidth: 1,
            create: (factory: (value: typeof lightTheme) => unknown) => factory(lightTheme),
        },
        useUnistyles: () => ({ theme: lightTheme }),
    };
});

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});

vi.mock('expo-router', async () => {
    const ReactModule = await import('react');
    return {
        Stack: { Screen: (props: any) => ReactModule.createElement('StackScreen', props) },
        useRouter: () => ({ navigate: testState.navigate }),
    };
});

vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});

vi.mock('@/components/markdown/MarkdownView', async () => {
    const ReactModule = await import('react');
    return { MarkdownView: (props: any) => ReactModule.createElement('MarkdownView', props) };
});

vi.mock('@/components/FileViewPanel', async () => {
    const ReactModule = await import('react');
    return { FileContentPanel: (props: any) => ReactModule.createElement('FileContentPanel', props) };
});

// The Workspace's dirty guard, with its discard prompt answered by the test.
vi.mock('@/-session/workspaceLinkNavigation', async () => {
    const ReactModule = await import('react');
    return {
        useWorkspaceLinkDismissGuard: () => {
            const dirtyRef = ReactModule.useRef(false);
            return {
                dirtyRef,
                onDirtyChange: ReactModule.useCallback((dirty: boolean) => { dirtyRef.current = dirty; }, []),
                guardDismiss: ReactModule.useCallback((action: () => void) => {
                    if (!dirtyRef.current) { action(); return; }
                    void Promise.resolve(testState.confirmDiscard()).then((confirmed) => { if (confirmed) action(); });
                }, []),
                reset: ReactModule.useCallback(() => { dirtyRef.current = false; }, []),
            };
        },
    };
});

vi.mock('@/components/CommanderSessionAvatar', async () => {
    const ReactModule = await import('react');
    return { CommanderSessionAvatar: (props: any) => ReactModule.createElement('CommanderAvatar', props) };
});

vi.mock('@/components/homeDockFocus', () => ({
    requestHomeDockFocus: () => testState.homeDockListening,
}));

vi.mock('@/hooks/useNewSessionDraft', () => ({
    useNewSessionDraft: { getState: () => testState.draft },
}));

vi.mock('@/sync/ops', () => ({
    machineListCommanders: testState.listCommanders,
    machineReadFileWithinRoot: testState.readWithinRoot,
    machineWriteFile: testState.writeFile,
}));

vi.mock('@/sync/storage', () => ({
    useAllMachines: () => testState.machines,
    useAllSessions: () => testState.sessions,
}));

vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}), mono: () => ({}) } }));

vi.mock('@/text', () => ({
    t: (key: string, values?: Record<string, unknown>) => (
        values ? `${key}(${Object.entries(values).map(([name, value]) => `${name}=${value}`).join(',')})` : key
    ),
}));

import CommandersScreen from './index';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());

function machine(id: string, active = true): Machine {
    return {
        id,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active,
        activeAt: 1,
        metadata: { displayName: `${id}-name`, host: id, homeDir: `/srv/${id}` },
        metadataVersion: 1,
        daemonState: { status: 'running' },
        daemonStateVersion: 1,
    } as Machine;
}

function commander(id: string, name: string, role?: string): HappyHerdCommanderSummary {
    return {
        id,
        name,
        ...(role ? { role } : {}),
        workspace: `/srv/work/${id}`,
        commanderPath: `/home/me/.happyherd/commanders/${id}/COMMANDER.md`,
        agentContextPath: `/home/me/.happyherd/commanders/${id}/agentcontext`,
    };
}

function encoded(text: string): string {
    return Buffer.from(text, 'utf8').toString('base64');
}

beforeEach(() => {
    testState.machines = [machine('machine-a'), machine('machine-b'), machine('machine-off', false)];
    testState.homeDockListening = false;
    testState.sessions = [];
    testState.navigate.mockReset();
    testState.writeFile.mockReset().mockResolvedValue({ success: true, hash: 'saved-hash' });
    testState.confirmDiscard.mockReset().mockResolvedValue(true);
    testState.draft.selectedMachineId = null;
    for (const setter of ['setMachineId', 'setCommanderId', 'setPath', 'setSessionType', 'setWorktreeKey'] as const) {
        testState.draft[setter].mockReset();
    }
    testState.listCommanders.mockReset().mockImplementation(async (machineId: string) => ({
        globalAgentsPath: null,
        commanders: machineId === 'machine-a'
            ? [commander('athena', 'Athena', 'Engineering commander')]
            : [commander('hermes', 'Hermes')],
    }));
    testState.readWithinRoot.mockReset().mockImplementation(async (_machineId: string, path: string) => ({
        success: true,
        content: encoded(path.endsWith('1-working-memory.md')
            ? '# Working memory\n\n> Read the guide first.\n\n- Shipping the pages slice today.\n'
            : '## Long-term\n\n- Prefer merge commits.\n'),
    }));
});

async function renderScreen(): Promise<ReactTestRenderer> {
    let renderer!: ReactTestRenderer;
    await act(async () => {
        renderer = create(React.createElement(CommandersScreen));
        await Promise.resolve();
        await Promise.resolve();
    });
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
    return renderer;
}

function hostNode(renderer: ReactTestRenderer, type: string, testID: string) {
    return renderer.root.findAll((node: any) => node.type === type && node.props.testID === testID)[0];
}

function text(node: { findAllByType: (type: any) => Array<{ props: { children?: unknown } }> }): string[] {
    return node.findAllByType('Text' as any).map((entry) => entry.props.children).flat(Infinity) as string[];
}

describe('Commanders page', () => {
    it('lists the Commanders of every online machine as cards', async () => {
        const renderer = await renderScreen();

        expect(testState.listCommanders.mock.calls.map(([machineId]) => machineId).sort()).toEqual(['machine-a', 'machine-b']);
        const athena = hostNode(renderer, 'View', 'commander-card-athena');
        const hermes = hostNode(renderer, 'View', 'commander-card-hermes');
        expect(text(athena)).toEqual(expect.arrayContaining([
            'Athena',
            'Engineering commander',
            '/srv/work/athena',
            'machine-a-name',
            'memory/1-working-memory.md',
            'memory/2-long-term-memory.md',
            'sidebar.newSession',
        ]));
        expect(text(hermes)).toEqual(expect.arrayContaining(['Hermes', '/srv/work/hermes', 'machine-b-name']));
        expect(hostNode(renderer, 'Pressable', 'commander-create-card')).toBeDefined();
    });

    it('quotes the first statement of each working memory on its card', async () => {
        const renderer = await renderScreen();

        expect(testState.readWithinRoot).toHaveBeenCalledWith(
            'machine-a',
            '/home/me/.happyherd/commanders/athena/agentcontext/memory/1-working-memory.md',
            '/home/me/.happyherd/commanders/athena/agentcontext',
        );
        expect(hostNode(renderer, 'Text', 'commander-memory-line-athena')?.props.children)
            .toBe('“Shipping the pages slice today.”');
    });

    it('opens New Session with the Commander, its folder, and its machine preselected', async () => {
        const renderer = await renderScreen();
        const button = renderer.root.findByProps({ accessibilityLabel: 'happyHerd.commander.newSessionWith(name=Athena)' });

        await act(async () => button.props.onPress());

        expect(testState.draft.setMachineId).toHaveBeenCalledWith('machine-a');
        expect(testState.draft.setCommanderId).toHaveBeenCalledWith('athena');
        expect(testState.draft.setPath).toHaveBeenCalledWith('/srv/work/athena');
        expect(testState.draft.setSessionType).toHaveBeenCalledWith('simple');
        expect(testState.draft.setWorktreeKey).toHaveBeenCalledWith(null);
        expect(testState.navigate).toHaveBeenCalledWith('/new');
    });

    it('keeps the draft machine when it already matches and hands off to a listening home dock', async () => {
        testState.draft.selectedMachineId = 'machine-b';
        testState.homeDockListening = true;
        const renderer = await renderScreen();

        await act(async () => renderer.root.findByProps({
            accessibilityLabel: 'happyHerd.commander.newSessionWith(name=Hermes)',
        }).props.onPress());

        expect(testState.draft.setMachineId).not.toHaveBeenCalled();
        expect(testState.draft.setCommanderId).toHaveBeenCalledWith('hermes');
        expect(testState.navigate).not.toHaveBeenCalled();
    });

    it('starts the guided Create Commander onboarding from the header and the create card', async () => {
        const renderer = await renderScreen();
        const headerButton = renderer.root.findAll((node: any) => (
            node.type === 'Pressable' && node.props.accessibilityLabel === 'happyHerd.commander.createTitle'
        ))[0];

        await act(async () => headerButton.props.onPress());
        await act(async () => hostNode(renderer, 'Pressable', 'commander-create-card').props.onPress());

        expect(testState.navigate).toHaveBeenCalledTimes(2);
        expect(testState.navigate).toHaveBeenNthCalledWith(1, { pathname: '/new', params: { intent: 'create-commander' } });
        expect(testState.navigate).toHaveBeenNthCalledWith(2, { pathname: '/new', params: { intent: 'create-commander' } });
    });

    it('reads a memory file inside the Commander AgentContext and renders it', async () => {
        const renderer = await renderScreen();
        const chip = renderer.root.findByProps({ accessibilityLabel: 'Athena · memory/2-long-term-memory.md' });

        await act(async () => {
            chip.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(testState.readWithinRoot).toHaveBeenLastCalledWith(
            'machine-a',
            '/home/me/.happyherd/commanders/athena/agentcontext/memory/2-long-term-memory.md',
            '/home/me/.happyherd/commanders/athena/agentcontext',
        );
        const sheet = hostNode(renderer, 'View', 'commander-memory-sheet');
        expect(sheet.findByType('MarkdownView' as any).props.markdown).toBe('## Long-term\n\n- Prefer merge commits.\n');
    });

    it('shows a retryable error when the memory file cannot be read', async () => {
        const renderer = await renderScreen();
        testState.readWithinRoot.mockResolvedValueOnce({ success: false, error: 'outside root' });

        await act(async () => {
            renderer.root.findByProps({ accessibilityLabel: 'Athena · memory/1-working-memory.md' }).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        const sheet = hostNode(renderer, 'View', 'commander-memory-sheet');
        expect(text(sheet).join(' ')).toContain('happyHerd.commander.memoryReadFailed outside root');

        await act(async () => {
            sheet.findByProps({ accessibilityLabel: 'common.retry' }).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(hostNode(renderer, 'View', 'commander-memory-sheet').findAllByType('MarkdownView' as any)).toHaveLength(1);
    });

    async function openMemory(renderer: ReactTestRenderer, label: string) {
        await act(async () => {
            renderer.root.findByProps({ accessibilityLabel: label }).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        return hostNode(renderer, 'View', 'commander-memory-sheet');
    }

    async function startEditing(renderer: ReactTestRenderer) {
        await act(async () => {
            hostNode(renderer, 'View', 'commander-memory-sheet')
                .findAll((node: any) => node.props.testID === 'commander-memory-edit')[0].props.onPress();
        });
        return hostNode(renderer, 'View', 'commander-memory-sheet').findByType('FileContentPanel' as any);
    }

    it('edits a memory file in its sheet through the Workspace file editor, bound to the AgentContext', async () => {
        const renderer = await renderScreen();
        const path = '/home/me/.happyherd/commanders/athena/agentcontext/memory/1-working-memory.md';
        const root = '/home/me/.happyherd/commanders/athena/agentcontext';
        await openMemory(renderer, 'Athena · memory/1-working-memory.md');
        const editor = await startEditing(renderer);

        // One file-content surface, in Edit, with no Delete and no comments.
        expect(editor.props.filePath).toBe(path);
        expect(editor.props.canWrite).toBe(true);
        expect(editor.props.initialDisplayMode).toBe('edit');
        expect(editor.props.deleteFile).toBeUndefined();
        expect(editor.props.reviewContext).toBeUndefined();
        expect(editor.props.markdownSessionId).toBeUndefined();
        expect(hostNode(renderer, 'View', 'commander-memory-sheet').findAllByType('MarkdownView' as any)).toHaveLength(0);

        testState.readWithinRoot.mockClear();
        await act(async () => { await editor.props.readFile(path); });
        expect(testState.readWithinRoot).toHaveBeenCalledWith('machine-a', path, root);

        // The editor's own controls take the Edit button's place in the sheet header.
        await act(async () => {
            editor.props.onHeaderRightSlotChange(React.createElement('View', { testID: 'file-controls' }));
        });
        const sheet = hostNode(renderer, 'View', 'commander-memory-sheet');
        expect(sheet.findAll((node: any) => node.props.testID === 'file-controls')).toHaveLength(1);
        expect(sheet.findAll((node: any) => node.props.testID === 'commander-memory-edit')).toHaveLength(0);

        // Saving goes through the hash-guarded machine write and refreshes the card's memory line.
        const saved = encoded('# Working memory\n\n- Rewrote the plan for the Settings lane.\n');
        let result: unknown;
        await act(async () => { result = await editor.props.writeFile(path, saved, 'read-hash'); });
        expect(testState.writeFile).toHaveBeenCalledWith('machine-a', path, saved, 'read-hash');
        expect(result).toEqual({ success: true, hash: 'saved-hash' });
        const line = hostNode(renderer, 'Text', 'commander-memory-line-athena');
        expect(line.props.children).toBe('“Rewrote the plan for the Settings lane.”');
    });

    it('keeps the card line when a save is refused, and edits the long-term file too', async () => {
        const renderer = await renderScreen();
        await openMemory(renderer, 'Athena · memory/2-long-term-memory.md');
        const editor = await startEditing(renderer);
        expect(editor.props.filePath).toBe('/home/me/.happyherd/commanders/athena/agentcontext/memory/2-long-term-memory.md');

        testState.writeFile.mockResolvedValueOnce({ success: false, error: 'hash mismatch' });
        let result: unknown;
        await act(async () => { result = await editor.props.writeFile(editor.props.filePath, encoded('x'), 'old'); });
        expect(result).toEqual({ success: false, error: 'hash mismatch' });
        expect(hostNode(renderer, 'Text', 'commander-memory-line-athena').props.children)
            .toBe('“Shipping the pages slice today.”');
    });

    it('returns to the rendered memory, read again, when the editor leaves Edit with nothing unsaved', async () => {
        const renderer = await renderScreen();
        await openMemory(renderer, 'Athena · memory/1-working-memory.md');
        let editor = await startEditing(renderer);

        // Unsaved edits keep the editor, even in its Preview.
        await act(async () => {
            editor.props.onDirtyChange(true);
            editor.props.onDisplayModeChange('preview');
        });
        editor = hostNode(renderer, 'View', 'commander-memory-sheet').findByType('FileContentPanel' as any);

        testState.readWithinRoot.mockClear();
        await act(async () => {
            editor.props.onDirtyChange(false);
            editor.props.onDisplayModeChange('preview');
            await Promise.resolve();
            await Promise.resolve();
        });
        const sheet = hostNode(renderer, 'View', 'commander-memory-sheet');
        expect(sheet.findAllByType('FileContentPanel' as any)).toHaveLength(0);
        expect(sheet.findAllByType('MarkdownView' as any)).toHaveLength(1);
        expect(testState.readWithinRoot).toHaveBeenCalledTimes(1);
        expect(sheet.findAll((node: any) => node.props.testID === 'commander-memory-edit').length).toBeGreaterThan(0);
    });

    it('asks before closing the sheet over unsaved edits', async () => {
        const renderer = await renderScreen();
        await openMemory(renderer, 'Athena · memory/1-working-memory.md');
        const editor = await startEditing(renderer);
        await act(async () => { editor.props.onDirtyChange(true); });

        testState.confirmDiscard.mockResolvedValueOnce(false);
        const close = () => hostNode(renderer, 'View', 'commander-memory-sheet')
            .findAll((node: any) => node.props.accessibilityLabel === 'common.cancel' && typeof node.props.onPress === 'function')[0];
        await act(async () => {
            close().props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(testState.confirmDiscard).toHaveBeenCalledTimes(1);
        expect(hostNode(renderer, 'View', 'commander-memory-sheet').findAllByType('FileContentPanel' as any)).toHaveLength(1);

        await act(async () => {
            close().props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(testState.confirmDiscard).toHaveBeenCalledTimes(2);
        expect(hostNode(renderer, 'View', 'commander-memory-sheet')).toBeUndefined();
    });

    it('reports a machine whose Commanders could not be listed and keeps the others', async () => {
        testState.listCommanders.mockImplementation(async (machineId: string) => {
            if (machineId === 'machine-b') throw new Error('daemon unavailable');
            return { globalAgentsPath: null, commanders: [commander('athena', 'Athena')] };
        });
        const renderer = await renderScreen();

        expect(text(renderer.root).join(' '))
            .toContain('happyHerd.commander.machineLoadFailed(name=machine-b-name,message=daemon unavailable)');
        expect(hostNode(renderer, 'View', 'commander-card-athena')).toBeDefined();
    });

    it('explains when no machine is online and when no Commanders exist', async () => {
        testState.machines = [machine('machine-off', false)];
        let renderer = await renderScreen();
        expect(hostNode(renderer, 'View', 'commanders-offline')).toBeDefined();
        expect(testState.listCommanders).not.toHaveBeenCalled();

        testState.machines = [machine('machine-a')];
        testState.listCommanders.mockResolvedValue({ globalAgentsPath: null, commanders: [] });
        renderer = await renderScreen();
        const empty = hostNode(renderer, 'View', 'commanders-empty');
        expect(text(empty)).toEqual(expect.arrayContaining([
            'happyHerd.commander.emptyTitle',
            'happyHerd.commander.createSubtitle',
        ]));
    });

    it('shows each card\'s session count, counting only sessions with that Commander on its machine', async () => {
        testState.sessions = [
            { id: 's1', metadata: { machineId: 'machine-a', commanderId: 'athena' } },
            { id: 's2', metadata: { machineId: 'machine-a', commanderId: 'athena' } },
            { id: 's3', metadata: { machineId: 'machine-b', commanderId: 'athena' } },
            { id: 's4', metadata: { machineId: 'machine-b', commanderId: 'hermes' } },
            { id: 's5', metadata: { machineId: 'machine-a' } },
        ];
        const renderer = await renderScreen();
        expect(text(hostNode(renderer, 'View', 'commander-session-count-athena'))).toEqual(['projects.sessionCount(count=2)']);
        expect(text(hostNode(renderer, 'View', 'commander-session-count-hermes'))).toEqual(['projects.sessionCount(count=1)']);
    });

    it('draws the large title in the page and hides the header bar on wide web', async () => {
        const renderer = await renderScreen();
        expect(renderer.root.findByType('StackScreen' as any).props.options).toMatchObject({ headerShown: false });
        expect(renderer.root.findAll((node: any) => (
            node.type === 'Text' && node.props.accessibilityRole === 'header' && node.props.children === 'happyHerd.commander.category'
        ))).toHaveLength(1);
    });
});
