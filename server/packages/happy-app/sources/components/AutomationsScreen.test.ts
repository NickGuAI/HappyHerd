import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HappyHerdAutomation } from '@slopus/happy-wire';

import type { Machine } from '@/sync/storageTypes';

const testState = vi.hoisted(() => ({
    machines: [] as Machine[],
    width: 1200,
    focusEpoch: 0,
    listAutomations: vi.fn(),
    automationHistory: vi.fn(),
    listCommanders: vi.fn(),
    createAutomation: vi.fn(),
    updateAutomation: vi.fn(),
    profileRpc: vi.fn(),
    profileStart: vi.fn(),
    recordProfile: vi.fn(),
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
        useWindowDimensions: () => ({ width: testState.width, height: 800 }),
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

vi.mock('@/components/HappyHerdAutomationDetail', async () => {
    const ReactModule = await import('react');
    return {
        HappyHerdAutomationDetail: (props: any) => ReactModule.createElement('AutomationDetail', props),
    };
});

vi.mock('@/modal', () => ({
    Modal: {
        alert: vi.fn(),
        confirm: vi.fn(async () => false),
    },
}));

vi.mock('@/sync/ops', () => ({
    machineAutomationHistory: testState.automationHistory,
    machineCreateAutomation: testState.createAutomation,
    machineDeleteAutomation: vi.fn(),
    machineListAutomations: testState.listAutomations,
    machineListCommanders: testState.listCommanders,
    machinePauseAutomation: vi.fn(),
    machineResumeAutomation: vi.fn(),
    machineRunAutomationNow: vi.fn(),
    machineUpdateAutomation: testState.updateAutomation,
}));

vi.mock('@/sync/storage', () => ({
    useAllMachines: () => testState.machines,
}));

vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/hooks/useNavigateToSession', () => ({ useNavigateToSession: () => vi.fn() }));
vi.mock('@/utils/automationProfiling', () => ({
    automationProfileStart: testState.profileStart,
    profileAutomationRpc: testState.profileRpc,
    recordAutomationProfile: testState.recordProfile,
}));

const translations: Record<string, string> = {
    'happyHerd.automations.new': 'New',
    'happyHerd.automations.create': 'Create automation',
    'happyHerd.automations.machine': 'Machine',
    'happyHerd.automations.save': 'Save automation',
    'happyHerd.automations.subtitle': 'Automation subtitle',
    'happyHerd.automations.allTags': 'All',
    'happyHerd.automations.tagFilters': 'Automation tags',
    'happyHerd.automations.searchPlaceholder': 'Search automations',
    'happyHerd.automations.automationCount': '{count} automations',
    'happyHerd.automations.noMatches': 'No automations match these filters.',
    'happyHerd.automations.openDetails': 'Open details for {name}',
    'happyHerd.automations.listLabel': 'Automations',
};

vi.mock('@/text', () => ({
    getCurrentLanguage: () => 'en',
    t: (key: string, values?: Record<string, unknown>) => Object.entries(values ?? {}).reduce(
        (value, [name, replacement]) => value.replace(`{${name}}`, String(replacement)),
        translations[key] ?? key,
    ),
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
    testState.width = 1200;
    testState.focusEpoch = 0;
    testState.listAutomations.mockReset().mockResolvedValue({
        definitionSchemaVersion: 2,
        automations: [],
    });
    testState.listCommanders.mockReset().mockResolvedValue({ commanders: [] });
    testState.automationHistory.mockReset().mockResolvedValue({ runs: [] });
    testState.createAutomation.mockReset().mockResolvedValue(undefined);
    testState.updateAutomation.mockReset().mockResolvedValue(undefined);
    testState.profileRpc.mockReset().mockImplementation(async (_method, operation) => operation());
    testState.profileStart.mockReset().mockReturnValue(10);
    testState.recordProfile.mockReset();
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

function automation(
    id: string,
    machineId: string,
    name: string,
    tags: string[],
): HappyHerdAutomation {
    return {
        schemaVersion: 3,
        runtimeOwner: 'happyherd',
        id,
        machineId,
        name,
        kind: 'scheduled',
        instruction: 'Review.',
        schedule: '0 8 * * *',
        timezone: 'UTC',
        workspace: `/srv/${machineId}`,
        rail: 'codex',
        commanderId: null,
        status: 'paused',
        maxRetries: 0,
        tags,
        createdAt: '2026-08-22T00:00:00.000Z',
        updatedAt: '2026-08-22T00:00:00.000Z',
        lastScheduledAt: null,
        lastRunAt: null,
    };
}

function nodeText(node: { props: { children?: unknown } }): string {
    return React.Children.toArray(node.props.children as React.ReactNode)
        .map((child) => {
            if (typeof child === 'string') return child;
            if (typeof child === 'number') return String(child);
            if (React.isValidElement(child)) return nodeText(child as { props: { children?: unknown } });
            return '';
        })
        .join('');
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
    it('shows dynamic tag filters and search without opening the form', async () => {
        testState.machines = [machine('machine-a', 100)];
        testState.listAutomations.mockResolvedValue({
            definitionSchemaVersion: 3,
            automations: [automation(
                '11111111-1111-4111-8111-111111111111',
                'machine-a',
                'Daily Attention',
                ['dream', 'health'],
            )],
        });

        const renderer = await renderScreen();

        expect(renderer.root.findByProps({ accessibilityLabel: 'Automation tags' }))
            .toBeDefined();
        expect(renderer.root.findAll((node: any) => (
            node.type === 'Pressable'
            && node.props.accessibilityRole === 'radio'
            && ['All', 'dream', 'health'].includes(nodeText(node))
        )).map((node: any) => nodeText(node))).toEqual(['All', 'dream', 'health']);
        expect(renderer.root.findByProps({ accessibilityLabel: 'Search automations' }))
            .toBeDefined();
    });

    it('does not reload automation or Commander configuration for heartbeat-only updates', async () => {
        const original = machine('machine-a', 100);
        testState.machines = [original];
        const renderer = await renderScreen();

        expect(testState.listAutomations).toHaveBeenCalledTimes(1);
        expect(testState.listAutomations).toHaveBeenLastCalledWith('machine-a');
        expect(testState.listCommanders).toHaveBeenCalledTimes(1);
        expect(testState.listCommanders).toHaveBeenLastCalledWith('machine-a');
        expect(testState.profileRpc.mock.calls.map(([method]) => method)).toEqual([
            'happyherd-automations-list',
            'happyherd-list-commanders',
        ]);
        expect(testState.recordProfile).toHaveBeenCalledWith('render', 'commit', 'success', 10);
        expect(testState.recordProfile).toHaveBeenCalledWith('route', 'total', 'success', 10);

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

describe('AutomationsScreen master-detail behavior', () => {
    it('uses one global machine selector and one deduplicated compact list', async () => {
        testState.machines = [machine('machine-a', 100), machine('machine-b', 100)];
        testState.listAutomations.mockImplementation(async (machineId: string) => ({
            definitionSchemaVersion: 2,
            automations: machineId === 'machine-a'
                ? [
                    automation('11111111-1111-4111-8111-111111111111', machineId, 'Alpha Beacon', ['Beacon']),
                    automation('22222222-2222-4222-8222-222222222222', machineId, 'Alpha Operations', ['Operations']),
                ]
                : [
                    automation('33333333-3333-4333-8333-333333333333', machineId, 'Beta Beacon', ['Beacon']),
                ],
        }));

        const renderer = await renderScreen();
        const machineSelectors = renderer.root.findAll((node: any) => (
            node.type === 'Pressable'
            && node.props.accessibilityRole === 'radio'
            && ['machine-a', 'machine-b'].includes(nodeText(node))
        ));

        expect(machineSelectors).toHaveLength(2);
        expect(renderer.root.findAll((node: any) => (
            node.type === 'ScrollView' && node.props.accessibilityRole === 'radiogroup'
        )).map((node: any) => node.props.accessibilityLabel)).toEqual(['Automation tags', 'Machine']);
        expect(machineSelectors.filter((node: any) => node.props.accessibilityState?.selected)).toHaveLength(1);
        expect(renderer.root.findAll((node: any) => (
            node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith('Open details for ')
        )).map((node: any) => node.props.accessibilityLabel)).toEqual([
            'Open details for Alpha Beacon',
            'Open details for Alpha Operations',
        ]);

        const betaSelectors = machineSelectors.filter((node: any) => nodeText(node) === 'machine-b');
        expect(betaSelectors).toHaveLength(1);

        await act(async () => {
            betaSelectors[0].props.onPress();
            await Promise.resolve();
        });

        expect(renderer.root.findAll((node: any) => (
            node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith('Open details for ')
        )).map((node: any) => node.props.accessibilityLabel)).toEqual(['Open details for Beta Beacon']);
        expect(testState.listAutomations).toHaveBeenCalledTimes(2);
        expect(testState.listCommanders).toHaveBeenCalledTimes(2);

        testState.machines = [machine('machine-a', 200), machine('machine-b', 200)];
        await updateScreen(renderer);

        expect(renderer.root.findAll((node: any) => (
            node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith('Open details for ')
        )).map((node: any) => node.props.accessibilityLabel)).toEqual(['Open details for Beta Beacon']);
        expect(testState.listAutomations).toHaveBeenCalledTimes(2);
        expect(testState.listCommanders).toHaveBeenCalledTimes(2);
    });

    it('combines dynamic tag and search filters and renders a focused empty result', async () => {
        testState.machines = [machine('machine-a', 100)];
        testState.listAutomations.mockResolvedValue({
            definitionSchemaVersion: 3,
            automations: [
                automation('11111111-1111-4111-8111-111111111111', 'machine-a', 'Daily Attention', ['dream', 'health']),
                automation('22222222-2222-4222-8222-222222222222', 'machine-a', 'Evening Review', ['health']),
            ],
        });
        const renderer = await renderScreen();
        const dreamChip = renderer.root.findAll((node: any) => (
            node.type === 'Pressable'
            && node.props.accessibilityRole === 'radio'
            && nodeText(node) === 'dream'
        ))[0];

        await act(async () => {
            dreamChip.props.onPress();
            await Promise.resolve();
        });

        expect(renderer.root.findAll((node: any) => (
            node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith('Open details for ')
        )).map((node: any) => node.props.accessibilityLabel)).toEqual(['Open details for Daily Attention']);

        const search = renderer.root.findAllByType('TextInput' as any).find((node: any) => (
            node.props.accessibilityLabel === 'Search automations'
        ))!;
        await act(async () => {
            search.props.onChangeText('evening');
            await Promise.resolve();
        });

        expect(visibleText(renderer)).toContain('No automations match these filters.');
        expect(renderer.root.findAll((node: any) => (
            node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith('Open details for ')
        ))).toHaveLength(0);
    });

    it('clears selected detail when tag or search filters exclude it', async () => {
        testState.machines = [machine('machine-a', 100)];
        testState.listAutomations.mockResolvedValue({
            definitionSchemaVersion: 3,
            automations: [
                automation('11111111-1111-4111-8111-111111111111', 'machine-a', 'Daily Attention', ['dream']),
                automation('22222222-2222-4222-8222-222222222222', 'machine-a', 'Evening Review', ['health']),
            ],
        });
        const renderer = await renderScreen();

        await act(async () => {
            renderer.root.findByProps({ accessibilityLabel: 'Open details for Daily Attention' }).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(renderer.root.findByType('AutomationDetail' as any).props.automation.name)
            .toBe('Daily Attention');

        const search = renderer.root.findByProps({ accessibilityLabel: 'Search automations' });
        await act(async () => {
            search.props.onChangeText('evening');
            await Promise.resolve();
        });
        expect(renderer.root.findAllByType('AutomationDetail' as any)).toHaveLength(0);

        await act(async () => {
            search.props.onChangeText('');
            await Promise.resolve();
        });
        expect(renderer.root.findAllByType('AutomationDetail' as any)).toHaveLength(0);

        await act(async () => {
            renderer.root.findByProps({ accessibilityLabel: 'Open details for Evening Review' }).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        const dreamChip = renderer.root.findAll((node: any) => (
            node.type === 'Pressable'
            && node.props.accessibilityRole === 'radio'
            && nodeText(node) === 'dream'
        ))[0];
        await act(async () => {
            dreamChip.props.onPress();
            await Promise.resolve();
        });
        expect(renderer.root.findAllByType('AutomationDetail' as any)).toHaveLength(0);
    });

    it('keeps the desktop list beside detail and restores preserved filters after mobile Back', async () => {
        testState.machines = [machine('machine-a', 100)];
        testState.listAutomations.mockResolvedValue({
            definitionSchemaVersion: 3,
            automations: [automation(
                '11111111-1111-4111-8111-111111111111',
                'machine-a',
                'Daily Attention',
                ['dream'],
            )],
        });
        const renderer = await renderScreen();
        const dreamChip = renderer.root.findAll((node: any) => (
            node.type === 'Pressable'
            && node.props.accessibilityRole === 'radio'
            && nodeText(node) === 'dream'
        ))[0];
        const search = renderer.root.findAllByType('TextInput' as any).find((node: any) => (
            node.props.accessibilityLabel === 'Search automations'
        ))!;

        await act(async () => {
            dreamChip.props.onPress();
            search.props.onChangeText('daily');
            await Promise.resolve();
        });
        await act(async () => {
            renderer.root.findAll((node: any) => (
                node.type === 'Pressable'
                && node.props.accessibilityLabel === 'Open details for Daily Attention'
            ))[0].props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(renderer.root.findAllByType('TextInput' as any).some((node: any) => (
            node.props.accessibilityLabel === 'Search automations'
        ))).toBe(true);
        expect(renderer.root.findByType('AutomationDetail' as any).props.mobile).toBe(false);
        expect(testState.automationHistory).toHaveBeenCalledWith('machine-a', '11111111-1111-4111-8111-111111111111');

        testState.width = 600;
        await updateScreen(renderer);
        expect(renderer.root.findByType('AutomationDetail' as any).props.mobile).toBe(true);
        expect(renderer.root.findAllByType('TextInput' as any)).toHaveLength(0);

        await act(async () => {
            renderer.root.findByType('AutomationDetail' as any).props.onBack();
            await Promise.resolve();
        });

        const restoredSearch = renderer.root.findAllByType('TextInput' as any).find((node: any) => (
            node.props.accessibilityLabel === 'Search automations'
        ));
        expect(restoredSearch?.props.value).toBe('daily');
        expect(renderer.root.findAll((node: any) => (
            node.type === 'Pressable'
            && node.props.accessibilityRole === 'radio'
            && nodeText(node) === 'dream'
        ))[0].props.accessibilityState).toEqual({ selected: true });
    });

    it('keeps failed history retryable instead of caching a false empty result', async () => {
        testState.machines = [machine('machine-a', 100)];
        testState.listAutomations.mockResolvedValue({
            definitionSchemaVersion: 3,
            automations: [automation(
                '11111111-1111-4111-8111-111111111111',
                'machine-a',
                'Daily Attention',
                ['dream'],
            )],
        });
        testState.automationHistory
            .mockRejectedValueOnce(new Error('temporary disconnect'))
            .mockResolvedValueOnce({ runs: [] });
        const renderer = await renderScreen();

        await act(async () => {
            renderer.root.findByProps({
                accessibilityLabel: 'Open details for Daily Attention',
            }).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(testState.automationHistory).toHaveBeenCalledTimes(1);
        expect(renderer.root.findByType('AutomationDetail' as any).props).toMatchObject({
            history: undefined,
            historyFailed: true,
        });

        await act(async () => {
            renderer.root.findByType('AutomationDetail' as any).props.onRetryHistory();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(testState.automationHistory).toHaveBeenCalledTimes(2);
        expect(renderer.root.findByType('AutomationDetail' as any).props).toMatchObject({
            history: [],
            historyFailed: false,
        });
    });

    it('shows the target machine in the create form and saves to the selected machine', async () => {
        testState.machines = [machine('machine-a', 100), machine('machine-b', 100)];
        const renderer = await renderScreen();
        const newButton = renderer.root.findAll((node: any) => (
            node.type === 'Pressable' && nodeText(node) === 'New'
        ))[0];

        await act(async () => {
            newButton.props.onPress();
            await Promise.resolve();
        });

        const machineSelectors = renderer.root.findAll((node: any) => (
            node.type === 'Pressable'
            && node.props.accessibilityRole === 'radio'
            && ['machine-a', 'machine-b'].includes(nodeText(node))
        ));
        expect(machineSelectors).toHaveLength(2);
        expect(renderer.root.findAll((node: any) => (
            node.type === 'ScrollView' && node.props.accessibilityRole === 'radiogroup'
        )).map((node: any) => node.props.accessibilityLabel)).toEqual(['Machine']);
        expect(machineSelectors.map((node: any) => node.props.accessibilityState?.selected)).toEqual([true, false]);

        testState.machines = [
            { ...machine('machine-a', 200), active: false },
            machine('machine-b', 200),
        ];
        await updateScreen(renderer);

        const offlineTarget = renderer.root.findAll((node: any) => (
            node.type === 'Pressable'
            && nodeText(node) === 'machine-a'
            && node.props.accessibilityState?.selected
        ))[0];
        expect(offlineTarget.props.accessibilityState).toMatchObject({ selected: true, disabled: true });
        expect(renderer.root.findAll((node: any) => (
            node.type === 'Pressable' && nodeText(node) === 'Save automation'
        ))[0].props.disabled).toBe(true);

        const onlineTarget = renderer.root.findAll((node: any) => (
            node.type === 'Pressable'
            && nodeText(node) === 'machine-b'
            && node.props.accessibilityRole === 'radio'
        ))[0];
        await act(async () => {
            onlineTarget.props.onPress();
            await Promise.resolve();
        });

        const saveButton = renderer.root.findAll((node: any) => (
            node.type === 'Pressable' && nodeText(node) === 'Save automation'
        ))[0];
        await act(async () => {
            saveButton.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(testState.listCommanders).toHaveBeenLastCalledWith('machine-b');
        expect(testState.createAutomation).toHaveBeenCalledWith(
            'machine-b',
            expect.objectContaining({ workspace: '/srv/machine-b' }),
        );
    });

    it('keeps edits pinned to the selected automation owner', async () => {
        testState.machines = [machine('machine-a', 100), machine('machine-b', 100)];
        testState.listAutomations.mockImplementation(async (machineId: string) => ({
            definitionSchemaVersion: 2,
            automations: [automation(
                machineId === 'machine-a'
                    ? '55555555-5555-4555-8555-555555555555'
                    : '66666666-6666-4666-8666-666666666666',
                machineId,
                machineId === 'machine-a' ? 'Alpha Beacon' : 'Beta Beacon',
                ['Beacon'],
            )],
        }));
        const renderer = await renderScreen();
        const betaMachineSelector = renderer.root.findAll((node: any) => (
            node.type === 'Pressable'
            && node.props.accessibilityRole === 'radio'
            && nodeText(node) === 'machine-b'
        ))[0];

        await act(async () => {
            betaMachineSelector.props.onPress();
            await Promise.resolve();
        });
        await act(async () => {
            renderer.root.findAll((node: any) => (
                node.type === 'Pressable'
                && node.props.accessibilityLabel === 'Open details for Beta Beacon'
            ))[0].props.onPress();
            await Promise.resolve();
        });
        await act(async () => {
            renderer.root.findByType('AutomationDetail' as any).props.onEdit();
            await Promise.resolve();
        });

        const editMachine = renderer.root.findAll((node: any) => (
            node.type === 'Pressable'
            && nodeText(node) === 'machine-b'
            && node.props.accessibilityState?.disabled
        ));
        expect(editMachine).toHaveLength(1);

        const saveButton = renderer.root.findAll((node: any) => (
            node.type === 'Pressable' && nodeText(node) === 'Save automation'
        ))[0];
        await act(async () => {
            saveButton.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(testState.updateAutomation).toHaveBeenCalledWith(
            'machine-b',
            '66666666-6666-4666-8666-666666666666',
            expect.objectContaining({ name: 'Beta Beacon' }),
        );
    });
});
