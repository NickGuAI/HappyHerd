import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    wide: true,
    prompt: vi.fn(async () => null as string | null),
    sessions: [] as any[],
    machine: null as any,
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        View: host('View'),
        Text: host('Text'),
        Pressable: host('Pressable'),
        ActivityIndicator: host('ActivityIndicator'),
        RefreshControl: host('RefreshControl'),
        Platform: { OS: 'web', select: (options: Record<string, unknown>) => options.web ?? options.default },
    };
});
vi.mock('expo-router', async () => {
    const ReactModule = await import('react');
    return {
        Stack: { Screen: (props: any) => ReactModule.createElement('StackScreen', props) },
        useLocalSearchParams: () => ({ id: 'machine-one' }),
        useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
    };
});
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});
vi.mock('react-native-unistyles', async () => {
    const { lightTheme } = await import('@/theme');
    return {
        StyleSheet: { create: (factory: any) => (typeof factory === 'function' ? factory(lightTheme) : factory) },
        useUnistyles: () => ({ theme: lightTheme }),
    };
});
vi.mock('@/components/herd/pages/HerdList', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        HerdItem: host('HerdItem'),
        HerdItemGroup: host('HerdItemGroup'),
        HerdListHeader: host('HerdListHeader'),
        HerdValueItem: host('HerdValueItem'),
    };
});
vi.mock('@/components/herd/pages/HerdPage', async () => {
    const ReactModule = await import('react');
    return {
        HerdButton: (props: any) => ReactModule.createElement('HerdButton', props),
        HerdChip: (props: any) => ReactModule.createElement('HerdChip', props),
        HerdDot: (props: any) => ReactModule.createElement('HerdDot', props),
        HerdPageHeader: (props: any) => ReactModule.createElement('HerdPageHeader', props, props.leading, props.subtitlePrefix, props.actions),
        useHerdWideLayout: () => mocks.wide,
    };
});
vi.mock('@/components/ItemList', async () => {
    const ReactModule = await import('react');
    return { ItemList: (props: any) => ReactModule.createElement('ItemList', props, props.children) };
});
vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});
vi.mock('@/components/MultiTextInput', async () => {
    const ReactModule = await import('react');
    return { MultiTextInput: ReactModule.forwardRef((props: any, _ref) => ReactModule.createElement('MultiTextInput', props)) };
});
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}), mono: () => ({}) } }));
vi.mock('@/components/navigation/headerMetrics', () => ({ MOBILE_GLASS_HEADER_HEIGHT: 0 }));
vi.mock('@/sync/storage', () => ({
    useSessions: () => mocks.sessions,
    useMachine: () => mocks.machine,
    useSetting: () => false,
}));
vi.mock('@/sync/ops', () => ({
    machineStopDaemon: vi.fn(),
    machineUpdateMetadata: vi.fn(),
    machineDelete: vi.fn(),
    machineSpawnNewSession: vi.fn(),
}));
vi.mock('@/sync/sync', () => ({ sync: { refreshMachines: vi.fn() } }));
vi.mock('@/modal', () => ({ Modal: { alert: vi.fn(), confirm: vi.fn(), prompt: mocks.prompt } }));
vi.mock('@/utils/sessionUtils', () => ({
    formatOSPlatform: (platform: string) => (platform === 'darwin' ? 'macOS' : platform),
    formatPathRelativeToHome: (path: string, home?: string) => (home && path.startsWith(home) ? `~${path.slice(home.length)}` : path),
    getSessionName: (session: any) => session.id,
    getSessionSubtitle: () => '',
}));
vi.mock('@/utils/machineUtils', () => ({ isMachineOnline: (machine: any) => machine.active }));
vi.mock('@/hooks/useNavigateToSession', () => ({ useNavigateToSession: () => vi.fn() }));
vi.mock('@/utils/pathUtils', () => ({ resolveAbsolutePath: (path: string) => path }));
vi.mock('@/text', () => ({
    t: (key: string, params?: Record<string, string | number>) => `${key}${params ? `:${JSON.stringify(params)}` : ''}`,
}));

import { lightTheme } from '@/theme';
import MachineDetailScreen from './[id]';

const originalConsoleError = console.error;
beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});
afterAll(() => vi.restoreAllMocks());

const renderers: ReactTestRenderer[] = [];
beforeEach(() => {
    act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()));
    vi.clearAllMocks();
    mocks.wide = true;
    mocks.sessions = [];
    mocks.machine = {
        id: 'machine-one',
        active: true,
        activeAt: 1,
        metadataVersion: 3,
        daemonStateVersion: 2,
        metadata: {
            host: 'studio.local',
            displayName: 'Studio Mac',
            platform: 'darwin',
            homeDir: '/Users/example-user',
            cliAvailability: { claude: true, codex: false, gemini: true, grok: true, dsh: false, detectedAt: 5 },
        },
        daemonState: { pid: 48211, httpPort: 7443, startedWithCliVersion: '1.4.2' },
    };
});

function render() {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(React.createElement(MachineDetailScreen));
    });
    renderers.push(renderer);
    return renderer;
}

const value = (renderer: ReactTestRenderer, title: string) => renderer.root.findAllByType('HerdValueItem' as any)
    .find((row: any) => row.props.title === title);

describe('Machine page (UI overhaul)', () => {
    it('draws the title row in the page on wide layouts: tile, name, "online · macOS · host", and Rename', async () => {
        const renderer = render();
        expect(renderer.root.findByType('StackScreen' as any).props.options.headerShown).toBe(false);
        const head = renderer.root.findByType('HerdPageHeader' as any);
        expect(head.props).toMatchObject({ title: 'Studio Mac', subtitle: 'status.online · macOS · studio.local', compact: false });
        expect(renderer.root.findByType('HerdDot' as any).props.tone).toBe('ok');
        expect(head.findAllByType('Ionicons' as any)[0].props.name).toBe('laptop-outline');
        const rename = renderer.root.findAllByType('HerdButton' as any).find((button: any) => button.props.testID === 'machine-rename')!;
        expect(rename.props.label).toBe('uiCopy.renameMachine');
        await act(async () => {
            await rename.props.onPress();
        });
        // The existing rename prompt, not a new one.
        expect(mocks.prompt).toHaveBeenCalledWith('uiCopy.renameMachine', 'uiCopy.giveThisMachineACustomNameLeaveEmptyToUse', expect.objectContaining({ defaultValue: 'Studio Mac' }));
    });

    it('keeps the stack header on narrow layouts, with Rename as a labelled icon and no second title', () => {
        mocks.wide = false;
        const renderer = render();
        expect(renderer.root.findByType('StackScreen' as any).props.options).toMatchObject({ headerShown: true, headerTitle: 'Studio Mac' });
        const head = renderer.root.findByType('HerdPageHeader' as any);
        expect(head.props.title).toBeUndefined();
        const rename = renderer.root.findAllByType('HerdButton' as any).find((button: any) => button.props.testID === 'machine-rename')!;
        expect(rename.props).toMatchObject({ label: undefined, accessibilityLabel: 'uiCopy.renameMachine' });
    });

    it('offers the machine\'s recent paths as chips under the path field, with Show all', () => {
        mocks.sessions = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => ({
            id: `session-${name}`,
            updatedAt: 1,
            metadata: { machineId: 'machine-one', path: `/Users/example-user/code/${name}` },
        }));
        const renderer = render();
        const chips = () => renderer.root.findAllByType('HerdChip' as any);
        expect(chips().map((chip: any) => chip.props.label)).toEqual([
            '~/code/a', '~/code/b', '~/code/c', '~/code/d', '~/code/e', 'machineLauncher.showAll:{"count":7}',
        ]);
        act(() => chips().at(-1)!.props.onPress());
        expect(chips()).toHaveLength(8);
        expect(chips().at(-1)!.props.label).toBe('machineLauncher.showLess');
        act(() => chips()[2].props.onPress());
        expect(renderer.root.findByType('MultiTextInput' as any).props.value).toBe('~/code/c');
        expect(chips()[2].props.selected).toBe(true);
    });

    it('lists the Daemon values on their rows, ending with a destructive Stop Daemon', () => {
        const renderer = render();
        const group = renderer.root.findAllByType('HerdItemGroup' as any).find((item: any) => item.props.title === 'machine.daemon')!;
        expect(group.findAllByType('HerdValueItem' as any).map((row: any) => [row.props.title, row.props.value])).toEqual([
            ['machine.status', 'status.online'],
            ['sessionInfo.processId', '48211'],
            ['machine.lastKnownHttpPort', '7443'],
            ['machine.cliVersion', '1.4.2'],
            ['machine.daemonStateVersion', '2'],
        ]);
        expect(value(renderer, 'sessionInfo.processId')!.props.mono).toBe(true);
        const stop = group.findAllByType('HerdItem' as any).find((item: any) => item.props.title === 'machine.stopDaemon')!;
        expect(stop.props.titleStyle.color).toBe(lightTheme.colors.textDestructive);
    });

    it('lists every reported CLI in pick order with a check or a dash, the retired Gemini last', () => {
        const renderer = render();
        const group = renderer.root.findAllByType('HerdItemGroup' as any).find((item: any) => item.props.title === 'machine.cliAvailability')!;
        const rows = group.findAllByType('HerdValueItem' as any).filter((row: any) => row.props.testID?.startsWith('machine-cli-'));
        expect(rows.map((row: any) => [row.props.testID, row.props.trailing.props.name])).toEqual([
            ['machine-cli-claude', 'checkmark'],
            ['machine-cli-codex', 'remove'],
            ['machine-cli-grok', 'checkmark'],
            ['machine-cli-dsh', 'remove'],
            ['machine-cli-gemini', 'checkmark'],
        ]);
        expect(rows[1].props.trailing.props.accessibilityLabel).toBe('machine.cliNotFound');
    });
});
