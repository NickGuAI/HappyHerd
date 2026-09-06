import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    selectedMachineId: 'selected-machine',
    machines: [] as any[],
    overrides: {} as Record<string, Record<string, string>>,
    setOverrides: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});
vi.mock('react-native-unistyles', () => ({
    useUnistyles: () => ({ theme: { colors: { header: { tint: '#000' } } } }),
}));
vi.mock('@/components/Item', async () => {
    const ReactModule = await import('react');
    return { Item: (props: any) => ReactModule.createElement('Item', props, props.children) };
});
vi.mock('@/components/ItemGroup', async () => {
    const ReactModule = await import('react');
    return { ItemGroup: (props: any) => ReactModule.createElement('ItemGroup', props, props.children) };
});
vi.mock('@/components/ItemList', async () => {
    const ReactModule = await import('react');
    return { ItemList: (props: any) => ReactModule.createElement('ItemList', props, props.children) };
});
vi.mock('@/hooks/useNewSessionDraft', () => ({
    useNewSessionDraft: (selector: (state: { selectedMachineId: string }) => unknown) => selector({
        selectedMachineId: mocks.selectedMachineId,
    }),
}));
vi.mock('@/sync/storage', () => ({
    useAllMachines: () => mocks.machines,
    useSettingMutable: () => [mocks.overrides, mocks.setOverrides],
}));
vi.mock('@/text', () => ({
    t: (key: string, values?: Record<string, unknown>) => (
        typeof values?.machine === 'string' ? `${key}:${values.machine}` : key
    ),
}));

import AgentDefaultsSettingsScreen from './agents';

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
    vi.clearAllMocks();
    mocks.selectedMachineId = 'selected-machine';
    mocks.machines = [];
    mocks.overrides = {};
});

function renderScreen() {
    let renderer!: ReturnType<typeof create>;
    act(() => {
        renderer = create(React.createElement(AgentDefaultsSettingsScreen));
    });
    return renderer;
}

function groupItems(renderer: ReturnType<typeof create>, title: string) {
    const group = findGroup(renderer, title);
    return group.findAllByType('Item' as any);
}

function findGroup(renderer: ReturnType<typeof create>, title: string) {
    const group = renderer.root.findAllByType('ItemGroup' as any)
        .find((candidate: any) => candidate.props.title === title);
    expect(group).toBeDefined();
    return group!;
}

describe('Agent Defaults provider coverage', () => {
    it('renders every supported provider and leaves retired Gemini out', () => {
        const renderer = renderScreen();
        const groupTitles = renderer.root.findAllByType('ItemGroup' as any)
            .map((group: any) => group.props.title);

        expect(groupTitles).toEqual([
            'uiCopy.agentDefaults',
            'agentDefaults.capabilitySource',
            'Claude Code',
            'Codex',
            'GrokBuild',
            'dsh',
            'Antigravity',
            'Happy',
        ]);
        for (const provider of ['Claude Code', 'Codex', 'GrokBuild', 'dsh', 'Antigravity', 'Happy']) {
            expect(groupItems(renderer, provider).length).toBeGreaterThan(0);
        }
        expect(groupItems(renderer, 'GrokBuild')[0].props).toMatchObject({
            title: 'agentDefaults.selectCapabilityMachine',
            subtitle: 'agentDefaults.noMachinesForCapabilities',
        });
        expect(groupItems(renderer, 'Happy')[0].props).toMatchObject({
            title: 'agentDefaults.selectCapabilityMachine',
            subtitle: 'agentDefaults.noMachinesForCapabilities',
        });
        expect(groupTitles).not.toContain('Gemini');
    });

    it('uses only the selected exact machine catalogs for GrokBuild and Rig', () => {
        mocks.machines = [
            {
                id: 'other-machine',
                active: true,
                activeAt: 2,
                metadata: {
                    host: 'other-host',
                    agentCapabilities: {
                        grok: {
                            detectedAt: 2,
                            sources: {
                                models: 'other-provider',
                                effortLevels: 'other-provider',
                                permissionModes: 'other-provider',
                            },
                            models: [{ code: 'wrong-model', value: 'Wrong model' }],
                            permissionModes: [{ code: 'wrong-mode', value: 'Wrong mode' }],
                            effortLevels: [],
                        },
                    },
                },
            },
            {
                id: 'selected-machine',
                active: true,
                activeAt: 3,
                metadata: {
                    host: 'selected-host',
                    machineKind: 'rig',
                    rigOnly: true,
                    cliAvailability: { rig: true },
                    capabilities: { newSession: true, worktrees: false },
                    defaults: {
                        providerId: 'rig-provider',
                        modelId: 'rig-model',
                        permissionMode: 'rig-mode',
                        effort: 'rig-deep',
                    },
                    models: [{
                        providerId: 'rig-provider',
                        id: 'rig-model',
                        name: 'Exact Rig model',
                        providerName: 'Exact Rig provider',
                        thinkingLevels: ['rig-fast', 'rig-deep'],
                        defaultThinkingLevel: 'rig-deep',
                    }],
                    operatingModes: [{
                        code: 'rig-mode',
                        value: 'Exact Rig mode',
                        description: 'Exact Rig permission',
                    }],
                    agentCapabilities: {
                        grok: {
                            detectedAt: 1,
                            sources: {
                                models: 'provider',
                                effortLevels: 'provider',
                                permissionModes: 'provider',
                            },
                            models: [{
                                code: 'grok-model',
                                value: 'Exact Grok model',
                                isDefault: true,
                                effortLevels: [{ code: 'grok-deep', value: 'Exact Grok effort', isDefault: true }],
                            }],
                            effortLevels: [],
                            permissionModes: [{
                                code: 'grok-mode',
                                value: 'Exact Grok mode',
                                isDefault: true,
                            }],
                        },
                    },
                },
            },
        ];
        mocks.overrides = {
            grok: { permissionMode: 'grok-mode', modelMode: 'grok-model', effortLevel: 'grok-deep' },
            rig: { permissionMode: 'rig-mode', modelMode: 'rig-provider:rig-model', effortLevel: 'rig-deep' },
        };

        const renderer = renderScreen();

        expect(groupItems(renderer, 'agentDefaults.capabilitySource')[0].props).toMatchObject({
            detail: 'selected-host',
        });
        expect(groupItems(renderer, 'agentDefaults.capabilitySource')[0].props.subtitle)
            .toContain('selected-machine');
        expect(findGroup(renderer, 'GrokBuild').props.footer)
            .toBe('agentDefaults.capabilitiesFromMachine:selected-host');
        expect(findGroup(renderer, 'Happy').props.footer)
            .toBe('agentDefaults.capabilitiesFromMachine:selected-host');

        expect(groupItems(renderer, 'GrokBuild').map((item: any) => item.props.detail)).toEqual([
            'Exact Grok mode',
            'Exact Grok model',
            'Exact Grok effort',
        ]);
        expect(groupItems(renderer, 'Happy').map((item: any) => item.props.detail)).toEqual([
            'Exact Rig mode',
            'Exact Rig model',
            'rig-deep',
        ]);
        expect(renderer.root.findAllByType('Item' as any).map((item: any) => item.props.detail))
            .not.toContain('Wrong model');

        act(() => groupItems(renderer, 'agentDefaults.capabilitySource')[0].props.onPress());
        const otherMachine = groupItems(renderer, 'agentDefaults.capabilitySource')
            .find((item: any) => item.props.title === 'other-host');
        expect(otherMachine).toBeDefined();
        act(() => otherMachine!.props.onPress());

        expect(groupItems(renderer, 'GrokBuild').map((item: any) => item.props.detail)).toEqual([
            'Default (Wrong mode)',
            'Default (Wrong model)',
        ]);
        expect(findGroup(renderer, 'GrokBuild').props.footer)
            .toBe('agentDefaults.capabilitiesFromMachine:other-host');
        expect(groupItems(renderer, 'Happy')[0].props.title)
            .toBe('agentDefaults.providerUnavailable');
    });

    it('mirrors the exact-machine dsh permission catalog and saves a provider-native code', () => {
        mocks.machines = [{
            id: 'selected-machine',
            active: true,
            metadata: {
                host: 'selected-host',
                cliAvailability: { dsh: true },
                agentCapabilities: {
                    dsh: {
                        detectedAt: 1,
                        sources: { models: 'dsh-acp', effortLevels: 'dsh-acp', permissionModes: 'dsh-profile' },
                        models: [{ code: 'deepseek-v5', value: 'DeepSeek V5', isDefault: true }],
                        effortLevels: [{ code: 'high', value: 'high', isDefault: true }],
                        permissionModes: [
                            { code: 'read-only', value: 'read-only' },
                            { code: 'workspace-write', value: 'workspace-write', isDefault: true },
                            { code: 'danger-full-access', value: 'danger-full-access' },
                        ],
                    },
                },
            },
        }];

        const renderer = renderScreen();
        const permissionField = groupItems(renderer, 'dsh')
            .find((item: any) => item.props.title === 'uiCopy.permission');
        expect(permissionField?.props.detail).toBe('Default (workspace-write)');

        act(() => permissionField!.props.onPress());
        expect(groupItems(renderer, 'dsh').map((item: any) => item.props.title)).toEqual([
            'uiCopy.permission',
            'common.reset',
            'read-only',
            'workspace-write',
            'danger-full-access',
            'uiCopy.model',
            'uiCopy.effort',
        ]);
        const danger = groupItems(renderer, 'dsh')
            .find((item: any) => item.props.title === 'danger-full-access');
        act(() => danger!.props.onPress());
        expect(mocks.setOverrides).toHaveBeenCalledWith({
            dsh: { permissionMode: 'danger-full-access' },
        });
    });

    it('shows an actionable exact-machine unavailable state instead of a blank provider card', () => {
        mocks.machines = [{
            id: 'selected-machine',
            active: true,
            activeAt: 1,
            metadata: { host: 'plain-host' },
        }];

        const renderer = renderScreen();

        for (const provider of ['GrokBuild', 'Happy']) {
            expect(groupItems(renderer, provider)).toHaveLength(1);
            expect(groupItems(renderer, provider)[0].props).toMatchObject({
                title: 'agentDefaults.providerUnavailable',
                subtitle: 'agentDefaults.providerUnavailableOnMachine:plain-host',
            });
            expect(groupItems(renderer, provider)[0].props.onPress).toEqual(expect.any(Function));
        }
    });

    it('omits unsupported Rig dimensions instead of borrowing another provider', () => {
        mocks.machines = [{
            id: 'selected-machine',
            metadata: {
                machineKind: 'rig',
                cliAvailability: { rig: true },
                capabilities: { newSession: true },
                models: [{
                    providerId: 'rig-provider',
                    id: 'rig-model',
                    name: 'Rig model only',
                    thinkingLevels: [],
                }],
                operatingModes: [],
            },
        }];

        const renderer = renderScreen();

        expect(groupItems(renderer, 'Happy').map((item: any) => item.props.title)).toEqual([
            'uiCopy.model',
        ]);
    });

    it('shows the exact-machine fallback when synchronized Rig defaults are stale', () => {
        mocks.machines = [{
            id: 'selected-machine',
            metadata: {
                machineKind: 'rig',
                rigOnly: true,
                cliAvailability: { rig: true },
                capabilities: { newSession: true, worktrees: false },
                defaults: {
                    providerId: 'rig-provider',
                    modelId: 'rig-model',
                    permissionMode: 'rig-mode',
                    effort: 'rig-deep',
                },
                models: [{
                    providerId: 'rig-provider',
                    id: 'rig-model',
                    name: 'Exact Rig model',
                    providerName: 'Exact Rig provider',
                    thinkingLevels: ['rig-deep'],
                    defaultThinkingLevel: 'rig-deep',
                }],
                operatingModes: [{
                    code: 'rig-mode',
                    value: 'Exact Rig mode',
                    description: 'Exact Rig permission',
                }],
            },
        }];
        mocks.overrides = {
            rig: {
                permissionMode: 'stale-mode',
                modelMode: 'stale-provider:stale-model',
                effortLevel: 'stale-effort',
            },
        };

        const renderer = renderScreen();

        expect(groupItems(renderer, 'Happy').map((item: any) => item.props.detail)).toEqual([
            'Default (Exact Rig mode)',
            'Default (Exact Rig model)',
            'Default (rig-deep)',
        ]);
    });

    it('keeps a stale Codex override disabled after exact-machine model choices', () => {
        mocks.machines = [{
            id: 'selected-machine',
            metadata: {
                host: 'selected-host',
                agentCapabilities: {
                    codex: {
                        detectedAt: 1,
                        sources: {
                            models: 'provider',
                            effortLevels: 'provider',
                            permissionModes: 'provider',
                        },
                        models: [{
                            code: 'gpt-machine',
                            value: 'Machine Codex',
                            isDefault: true,
                            effortLevels: [{ code: 'high', value: 'high', isDefault: true }],
                        }],
                        effortLevels: [],
                        permissionModes: [{ code: 'default', value: 'Ask first', isDefault: true }],
                    },
                },
            },
        }];
        mocks.overrides = {
            codex: {
                permissionMode: 'default',
                modelMode: 'my-workspace-model',
                effortLevel: 'high',
            },
        };

        const renderer = renderScreen();
        const modelField = groupItems(renderer, 'Codex')
            .find((item: any) => item.props.title === 'uiCopy.model');

        expect(modelField?.props.detail).toBe('Default (Machine Codex)');
        act(() => modelField!.props.onPress());
        expect(groupItems(renderer, 'Codex').map((item: any) => item.props.title)).toContain('Machine Codex');
        const codexItems = groupItems(renderer, 'Codex');
        const unavailable = codexItems.find((item: any) => item.props.title === 'my-workspace-model');
        expect(unavailable?.props.disabled).toBe(true);
        expect(unavailable?.props.onPress).toBeUndefined();
        expect(codexItems.indexOf(unavailable)).toBeGreaterThan(codexItems.findIndex((item: any) => item.props.title === 'Machine Codex'));
        expect(groupItems(renderer, 'Codex').map((item: any) => item.props.title)).not.toContain('agentDefaults.customModel');
        expect(mocks.setOverrides).not.toHaveBeenCalled();
    });

    it('labels Reset with the revalidated code default, not a different advertised default', () => {
        mocks.machines = [{
            id: 'selected-machine',
            metadata: {
                agentCapabilities: {
                    claude: {
                        detectedAt: 1,
                        sources: {
                            models: 'provider',
                            effortLevels: 'provider',
                            permissionModes: 'provider',
                        },
                        models: [],
                        effortLevels: [],
                        permissionModes: [
                            { code: 'bypassPermissions', value: 'Bypass' },
                            { code: 'plan', value: 'Plan', isDefault: true },
                        ],
                    },
                },
            },
        }];
        mocks.overrides = { claude: { permissionMode: 'plan' } };

        const renderer = renderScreen();
        const permissionField = groupItems(renderer, 'Claude Code')[0];
        act(() => permissionField.props.onPress());
        const reset = groupItems(renderer, 'Claude Code')
            .find((item: any) => item.props.title === 'common.reset');

        expect(reset?.props.subtitle).toBe('Bypass');
    });
});
