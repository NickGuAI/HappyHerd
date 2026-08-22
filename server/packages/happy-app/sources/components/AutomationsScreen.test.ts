import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Machine } from '@/sync/storageTypes';

const testState = vi.hoisted(() => ({
    machines: [] as Machine[],
    focusEpoch: 0,
    listAutomations: vi.fn(),
    listCommanders: vi.fn(),
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
        View: host('View'),
        useWindowDimensions: () => ({ width: 1200, height: 800 }),
    };
});

vi.mock('@react-navigation/native', async () => {
    const ReactModule = await import('react');
    return {
        useFocusEffect: (effect: React.EffectCallback) => ReactModule.useEffect(
            effect,
            [effect, testState.focusEpoch],
        ),
    };
});

vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});

vi.mock('expo-router', async () => {
    const ReactModule = await import('react');
    return {
        Stack: {
            Screen: (props: any) => ReactModule.createElement('StackScreen', props),
        },
    };
});

vi.mock('react-native-unistyles', () => {
    const theme = {
        colors: {
            text: '#111111',
            textSecondary: '#666666',
            surface: '#ffffff',
            divider: '#dddddd',
            input: { background: '#ffffff' },
            status: { disconnected: '#cc0000' },
        },
    };
    return {
        StyleSheet: {
            hairlineWidth: 1,
            create: (factory: (value: typeof theme) => unknown) => factory(theme),
        },
        useUnistyles: () => ({ theme }),
    };
});

vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});

vi.mock('@/components/HappyHerdAutomationCard', async () => {
    const ReactModule = await import('react');
    return {
        HappyHerdAutomationCard: (props: any) => ReactModule.createElement('AutomationCard', props),
    };
});

vi.mock('@/modal', () => ({
    Modal: {
        alert: vi.fn(),
        confirm: vi.fn(async () => false),
    },
}));

vi.mock('@/sync/ops', () => ({
    machineAutomationHistory: vi.fn(),
    machineCreateAutomation: vi.fn(),
    machineDeleteAutomation: vi.fn(),
    machineListAutomations: testState.listAutomations,
    machineListCommanders: testState.listCommanders,
    machinePauseAutomation: vi.fn(),
    machineResumeAutomation: vi.fn(),
    machineRunAutomationNow: vi.fn(),
    machineUpdateAutomation: vi.fn(),
}));

vi.mock('@/sync/storage', () => ({
    useAllMachines: () => testState.machines,
}));

vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/hooks/useNavigateToSession', () => ({ useNavigateToSession: () => vi.fn() }));

const translations: Record<string, string> = {
    'happyHerd.automations.subtitle': 'Automation subtitle',
    'happyHerd.automations.tagGuide': 'Expand the automation, choose Edit, add one project tag per line, then save.',
};

vi.mock('@/text', () => ({
    t: (key: string) => translations[key] ?? key,
}));

import AutomationsScreen from '../app/(app)/automations/index';

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
    testState.machines = [];
    testState.focusEpoch = 0;
    testState.listAutomations.mockReset().mockResolvedValue({
        definitionSchemaVersion: 2,
        automations: [],
    });
    testState.listCommanders.mockReset().mockResolvedValue({ commanders: [] });
});

function machine(id: string, activeAt: number): Machine {
    return {
        id,
        seq: 1,
        createdAt: 1,
        updatedAt: activeAt,
        active: true,
        activeAt,
        metadata: { displayName: id, homeDir: `/srv/${id}` },
        metadataVersion: 1,
        daemonState: { status: 'running' },
        daemonStateVersion: 1,
    } as Machine;
}

function visibleText(renderer: ReactTestRenderer): string {
    return renderer.root.findAllByType('Text' as any)
        .map((node: any) => node.props.children)
        .flat(Infinity)
        .join(' ');
}

async function renderScreen(): Promise<ReactTestRenderer> {
    let renderer!: ReactTestRenderer;
    await act(async () => {
        renderer = create(React.createElement(AutomationsScreen));
        await Promise.resolve();
        await Promise.resolve();
    });
    return renderer;
}

async function updateScreen(renderer: ReactTestRenderer): Promise<void> {
    await act(async () => {
        renderer.update(React.createElement(AutomationsScreen));
        await Promise.resolve();
        await Promise.resolve();
    });
}

describe('AutomationsScreen refresh behavior', () => {
    it('shows tag guidance without opening the form', async () => {
        testState.machines = [machine('machine-a', 100)];

        const renderer = await renderScreen();

        expect(visibleText(renderer)).toContain(
            'Expand the automation, choose Edit, add one project tag per line, then save.',
        );
        expect(renderer.root.findAllByType('TextInput' as any)).toHaveLength(0);
    });

    it('does not reload automation or Commander configuration for heartbeat-only updates', async () => {
        const original = machine('machine-a', 100);
        testState.machines = [original];
        const renderer = await renderScreen();

        expect(testState.listAutomations).toHaveBeenCalledTimes(1);
        expect(testState.listAutomations).toHaveBeenLastCalledWith('machine-a');
        expect(testState.listCommanders).toHaveBeenCalledTimes(1);
        expect(testState.listCommanders).toHaveBeenLastCalledWith('machine-a');

        testState.machines = [{ ...original, activeAt: 200, updatedAt: 200 }];
        await updateScreen(renderer);

        expect(testState.listAutomations).toHaveBeenCalledTimes(1);
        expect(testState.listCommanders).toHaveBeenCalledTimes(1);

        testState.machines = [{ ...testState.machines[0], metadataVersion: 2 }];
        await updateScreen(renderer);

        expect(testState.listAutomations).toHaveBeenCalledTimes(2);
        expect(testState.listCommanders).toHaveBeenCalledTimes(1);

        testState.machines = [{ ...testState.machines[0], daemonStateVersion: 2 }];
        await updateScreen(renderer);

        expect(testState.listAutomations).toHaveBeenCalledTimes(3);
        expect(testState.listCommanders).toHaveBeenCalledTimes(1);

        testState.machines = [testState.machines[0], machine('machine-b', 150)];
        await updateScreen(renderer);

        expect(testState.listAutomations).toHaveBeenCalledTimes(5);
        expect(testState.listAutomations).toHaveBeenNthCalledWith(4, 'machine-a');
        expect(testState.listAutomations).toHaveBeenNthCalledWith(5, 'machine-b');
        expect(testState.listCommanders).toHaveBeenCalledTimes(1);

        testState.focusEpoch += 1;
        await updateScreen(renderer);

        expect(testState.listAutomations).toHaveBeenCalledTimes(7);
        expect(testState.listCommanders).toHaveBeenCalledTimes(2);
        expect(testState.listCommanders).toHaveBeenLastCalledWith('machine-a');
    });
});
