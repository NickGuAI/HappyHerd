import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
    return {
        renderMachines: [] as any[],
        liveMachines: {} as Record<string, any>,
        overrides: {} as Record<string, Record<string, string>>,
        draft: {} as any,
        machineSpawnNewSession: vi.fn(),
        machineListCommanders: vi.fn(),
        sessionSetAgentModes: vi.fn(),
        createWorktree: vi.fn(),
        listWorktrees: vi.fn(),
        refreshSessions: vi.fn(),
        sendMessage: vi.fn(),
        alert: vi.fn(),
        confirm: vi.fn(),
        navigateToSession: vi.fn(),
        routerBack: vi.fn(),
        emptyList: [] as any[],
        places: [] as any[],
        setFavorites: vi.fn(),
    };
});

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const component = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    class AnimatedValue {
        setValue() {}
    }
    return {
        View: component('View'),
        Text: component('Text'),
        Pressable: component('Pressable'),
        Modal: component('Modal'),
        TouchableWithoutFeedback: component('TouchableWithoutFeedback'),
        TextInput: component('TextInput'),
        ScrollView: component('ScrollView'),
        ActivityIndicator: component('ActivityIndicator'),
        Image: component('Image'),
        Animated: {
            Value: AnimatedValue,
            View: component('AnimatedView'),
            parallel: () => ({ start: (done?: () => void) => done?.() }),
            timing: () => ({}),
            spring: () => ({}),
        },
        Platform: {
            OS: 'web',
            select: (options: Record<string, unknown>) => options.web ?? options.default,
        },
        Keyboard: {
            isVisible: () => false,
            dismiss: vi.fn(),
            addListener: () => ({ remove: vi.fn() }),
        },
        LayoutAnimation: {
            configureNext: vi.fn(),
            Presets: { easeInEaseOut: {} },
        },
        useWindowDimensions: () => ({ width: 1200, height: 800 }),
    };
});
vi.mock('expo-glass-effect', async () => {
    const ReactModule = await import('react');
    return { GlassView: (props: any) => ReactModule.createElement('GlassView', props, props.children) };
});
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    const icon = (name: string) => (props: any) => ReactModule.createElement(name, props);
    return {
        Ionicons: icon('Ionicons'),
        Octicons: icon('Octicons'),
        MaterialCommunityIcons: icon('MaterialCommunityIcons'),
    };
});
vi.mock('expo-router', () => ({
    useLocalSearchParams: () => ({}),
    useNavigation: () => ({ setOptions: vi.fn() }),
    useRouter: () => ({ back: mocks.routerBack }),
}));
vi.mock('react-native-unistyles', () => {
    const theme = {
        colors: {
            text: 'text',
            textSecondary: 'text-secondary',
            divider: 'divider',
            input: { background: 'input' },
            header: { tint: 'tint', background: 'header' },
            status: { disconnected: 'disconnected' },
            groupped: { background: 'grouped', chevron: 'chevron' },
            radio: { active: 'active' },
            surfaceHighest: 'surface-highest',
            glass: {
                overlayTint: 'overlay-tint',
                overlay: 'overlay',
                border: 'border',
                shadow: 'shadow',
                backgroundStrong: 'glass-strong',
                backgroundSubtle: 'glass-subtle',
                highlight: 'highlight',
            },
            button: {
                primary: { tint: 'primary-tint', background: 'primary', disabled: 'disabled' },
                secondary: { tint: 'secondary-tint' },
            },
        },
    };
    return {
        useUnistyles: () => ({ theme }),
        StyleSheet: {
            create: (factory: any) => typeof factory === 'function' ? factory(theme) : factory,
        },
    };
});
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('react-native-keyboard-controller', async () => {
    const ReactModule = await import('react');
    const component = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        KeyboardAvoidingView: component('KeyboardAvoidingView'),
        KeyboardStickyView: component('KeyboardStickyView'),
    };
});
vi.mock('expo-constants', () => ({ default: { statusBarHeight: 0 } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'request-1' }));
vi.mock('zustand/react/shallow', () => ({ useShallow: (selector: unknown) => selector }));
vi.mock('@/utils/responsive', () => ({ useHeaderHeight: () => 0 }));
vi.mock('@/utils/platform', () => ({ isRunningOnMac: () => false }));
vi.mock('@/utils/newSessionSidebarLayout', () => ({
    getNewSessionSidebarLayout: () => ({ showSidebar: false, sidebarWidth: 0 }),
}));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/components/layout', () => ({ layout: { maxWidth: 1200 } }));
vi.mock('@/components/MultiTextInput', async () => {
    const ReactModule = await import('react');
    return {
        MULTI_TEXT_INPUT_LINE_HEIGHT: 20,
        MultiTextInput: ReactModule.forwardRef((props: any, _ref) => (
            ReactModule.createElement('MultiTextInput', props)
        )),
    };
});

vi.mock('@/components/AgentInputAttachmentStrip', async () => {
    const ReactModule = await import('react');
    return { AgentInputAttachmentStrip: (props: any) => ReactModule.createElement('AgentInputAttachmentStrip', props) };
});
vi.mock('@/components/WorkspaceContextStrip', async () => {
    const ReactModule = await import('react');
    return { WorkspaceContextStrip: (props: any) => ReactModule.createElement('WorkspaceContextStrip', props) };
});
vi.mock('@/components/MachineWorkspaceContextPicker', async () => {
    const ReactModule = await import('react');
    return { MachineWorkspaceContextPicker: (props: any) => ReactModule.createElement('MachineWorkspaceContextPicker', props) };
});
vi.mock('@/components/MachinePathBrowser', async () => {
    const ReactModule = await import('react');
    return { MachinePathBrowser: (props: any) => ReactModule.createElement('MachinePathBrowser', props) };
});
vi.mock('@/components/MachineFileUploadStatus', async () => {
    const ReactModule = await import('react');
    return { MachineFileUploadStatus: (props: any) => ReactModule.createElement('MachineFileUploadStatus', props) };
});
vi.mock('@/components/ProviderIcon', async () => {
    const ReactModule = await import('react');
    return { ProviderIcon: (props: any) => ReactModule.createElement('ProviderIcon', props) };
});
vi.mock('@/components/navigation/Header', async () => {
    const ReactModule = await import('react');
    return { Header: (props: any) => ReactModule.createElement('Header', props, props.children) };
});
vi.mock('@/components/MobileGlass', async () => {
    const ReactModule = await import('react');
    return {
        MobileGlassSurface: (props: any) => ReactModule.createElement('MobileGlassSurface', props, props.children),
    };
});
vi.mock('@/components/BubblePressable', async () => {
    const ReactModule = await import('react');
    return { BubblePressable: (props: any) => ReactModule.createElement('BubblePressable', props, props.children) };
});
vi.mock('@/components/AnimatedOverlay', async () => {
    const ReactModule = await import('react');
    const component = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        AnimatedClickAwayBackdrop: component('AnimatedClickAwayBackdrop'),
        AnimatedPopup: component('AnimatedPopup'),
        LocalBlurHalo: component('LocalBlurHalo'),
    };
});
vi.mock('@/components/navigation/headerMetrics', () => ({ MOBILE_GLASS_HEADER_HEIGHT: 0 }));
vi.mock('@/components/glassInteractionPolicy', () => ({ getNativeGlassInteractivity: () => false }));
vi.mock('@/sync/workspaceContext', () => ({
    MAX_WORKSPACE_CONTEXT_ITEMS: 5,
    addWorkspaceContextEntry: vi.fn(),
    buildWorkspaceContextMessage: vi.fn(),
    clearWorkspaceContextFiles: vi.fn(),
    workspaceContextEntryKey: (entry: { path: string; source: { kind: string; machineId?: string } }) => JSON.stringify(
        entry.source.kind === 'machine'
            ? ['machine', entry.source.machineId, entry.path]
            : ['session', entry.path],
    ),
}));

vi.mock('@/sync/storage', () => ({
    useAllMachines: () => mocks.renderMachines,
    useSessions: () => mocks.emptyList,
    useSetting: (key: string) => ({
        agentInputEnterToSend: false,
        fileDiffsSidebar: false,
        expImageUpload: false,
    })[key] ?? false,
    useSettingMutable: (key: string) => key === 'agentDefaultOverrides'
        ? [mocks.overrides, vi.fn()]
        : [mocks.emptyList, mocks.setFavorites],
    useLocalSetting: () => false,
    storage: { getState: () => ({ machines: mocks.liveMachines }) },
}));
vi.mock('@/hooks/useNewSessionDraft', () => {
    const useNewSessionDraft = (selector: (state: any) => unknown) => selector(mocks.draft);
    useNewSessionDraft.getState = () => mocks.draft;
    return { useNewSessionDraft };
});
vi.mock('@/hooks/useNavigateToSession', () => ({
    useNavigateToSession: () => mocks.navigateToSession,
}));
vi.mock('@/hooks/useImagePicker', () => ({
    useImagePicker: () => ({
        selectedImages: [],
        clearImages: vi.fn(),
        removeImage: vi.fn(),
        pickImages: vi.fn(),
    }),
}));
vi.mock('@/hooks/useMachineFileUpload', () => ({
    useMachineFileUpload: () => ({
        state: { phase: 'idle' },
        canCancel: false,
        canRetry: false,
        reset: vi.fn(),
        cancel: vi.fn(),
        retry: vi.fn(),
        pickAndUpload: vi.fn(),
    }),
}));
vi.mock('@/hooks/useVoiceDictation', () => ({
    useVoiceDictation: () => ({
        phase: 'idle',
        error: null,
        canRetry: false,
        toggle: vi.fn(),
        cancel: vi.fn(),
        retry: vi.fn(),
    }),
}));
vi.mock('@/hooks/useVoiceInputAvailability', () => ({
    useVoiceInputAvailability: () => ({ available: false }),
}));
vi.mock('@/sync/agentSessionPlaces', () => ({
    collectSessionPlaces: () => mocks.places,
    collectSessionWorkspaces: () => mocks.emptyList,
}));
vi.mock('@/sync/ops', () => ({
    machineListCommanders: mocks.machineListCommanders,
    machineSpawnNewSession: mocks.machineSpawnNewSession,
    sessionSetAgentModes: mocks.sessionSetAgentModes,
}));
vi.mock('@/sync/sync', () => ({
    sync: {
        refreshSessions: mocks.refreshSessions,
        sendMessage: mocks.sendMessage,
    },
}));
vi.mock('@/utils/worktree', () => ({
    createWorktree: mocks.createWorktree,
    listWorktrees: mocks.listWorktrees,
}));
vi.mock('@/modal', () => ({
    Modal: { alert: mocks.alert, confirm: mocks.confirm },
}));
vi.mock('@/text', () => ({ t: (key: string) => key }));

let NewSessionScreen!: React.ComponentType;
const originalConsoleError = console.error;

function createDraft(overrides: Record<string, unknown> = {}) {
    return {
        input: 'Start the task',
        attachments: [],
        selectedMachineId: 'machine-1',
        setMachineId: vi.fn(),
        selectedPath: '~/project',
        setPath: vi.fn(),
        selectedCommanderId: null,
        setCommanderId: vi.fn(),
        agentType: 'rig',
        setAgentType: vi.fn(),
        permissionMode: null,
        setPermissionMode: vi.fn(),
        modelMode: null,
        setModelMode: vi.fn(),
        effortLevel: null,
        setEffortLevel: vi.fn(),
        sessionType: 'simple',
        setSessionType: vi.fn(),
        worktreeKey: null,
        setWorktreeKey: vi.fn(),
        setInput: vi.fn(),
        setAttachments: vi.fn(),
        ...overrides,
    };
}

function createRigMachine(metadata: Record<string, unknown> = {}) {
    return {
        id: 'machine-1',
        active: true,
        activeAt: Date.now(),
        metadata: {
            homeDir: '/Users/dev',
            machineKind: 'rig',
            rigOnly: true,
            cliAvailability: { rig: true },
            capabilities: { newSession: true, worktrees: false },
            defaults: {
                providerId: 'codex',
                modelId: 'base',
                permissionMode: 'auto',
                effort: 'low',
            },
            models: [
                {
                    providerId: 'codex', id: 'base', name: 'Base', providerName: 'Codex',
                    thinkingLevels: ['low'], defaultThinkingLevel: 'low',
                },
                {
                    providerId: 'claude', id: 'alternate', name: 'Alternate', providerName: 'Claude',
                    thinkingLevels: ['low', 'max'], defaultThinkingLevel: 'low',
                },
            ],
            operatingModes: [
                { code: 'auto', value: 'Auto', description: 'Automatic', kind: 'safe-yolo' },
                { code: 'careful', value: 'Careful', description: 'Ask first', kind: 'default' },
            ],
            ...metadata,
        },
    };
}

function createGrokMachine() {
    return {
        id: 'machine-1',
        active: true,
        activeAt: Date.now(),
        metadata: {
            homeDir: '/Users/dev',
            cliAvailability: { grok: true },
            agentCapabilities: {
                grok: {
                    detectedAt: 1,
                    sources: { models: 'provider', effortLevels: 'provider', permissionModes: 'provider' },
                    models: [{
                        code: 'grok-model', value: 'Grok model', isDefault: true,
                        effortLevels: [{ code: 'grok-effort', value: 'Grok effort', isDefault: true }],
                    }],
                    effortLevels: [],
                    permissionModes: [{ code: 'grok-mode', value: 'Grok mode', isDefault: true }],
                },
            },
        },
    };
}

function createDshMachine() {
    return {
        id: 'machine-1',
        active: true,
        activeAt: Date.now(),
        metadata: {
            homeDir: '/Users/dev',
            cliAvailability: { dsh: true },
            agentCapabilities: {
                dsh: {
                    detectedAt: 1,
                    sources: {
                        models: 'dsh-acp:session/new:configOptions',
                        effortLevels: 'dsh-acp:session/new:configOptions',
                        permissionModes: 'unsupported',
                    },
                    models: [
                        { code: 'deepseek-v5', value: 'DeepSeek V5', isDefault: true },
                        { code: 'deepseek-v4-flash', value: 'DeepSeek V4 Flash' },
                    ],
                    effortLevels: [
                        { code: 'off', value: 'off' },
                        { code: 'low', value: 'low' },
                        { code: 'high', value: 'high', isDefault: true },
                        { code: 'max', value: 'max' },
                    ],
                    permissionModes: [],
                    acp: { loadSession: false, prompt: { image: false } },
                },
            },
        },
    };
}

async function renderScreen() {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
        renderer = create(React.createElement(NewSessionScreen));
        await Promise.resolve();
        await Promise.resolve();
    });
    return renderer;
}

async function pressSend(renderer: ReturnType<typeof create>) {
    const send = renderer.root.findAllByType('Pressable' as any)
        .find((item: any) => item.props.accessibilityLabel === 'happyHerd.composer.send');
    expect(send).toBeDefined();
    expect(send?.props.disabled).toBe(false);
    await act(async () => {
        await send!.props.onPress();
        await Promise.resolve();
    });
}

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) {
        return Object.assign({}, ...style.map(flattenStyle));
    }
    return style && typeof style === 'object' ? style as Record<string, unknown> : {};
}

function findPathTrigger(renderer: ReturnType<typeof create>, label: string) {
    return renderer.root.findAllByType('BubblePressable' as any).find((candidate: any) => (
        candidate.findAllByType('Text' as any).some((text: any) => text.props.children === label)
    ));
}

beforeAll(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
    const NodeModule = (await import('node:module')).default as any;
    const originalLoad = NodeModule._load;
    NodeModule._load = function loadTestAsset(request: string, ...args: unknown[]) {
        if (request.startsWith('@/assets/images/')) return 0;
        return originalLoad.call(this, request, ...args);
    };
    try {
        NewSessionScreen = (await import('./index')).default;
    } finally {
        NodeModule._load = originalLoad;
    }
});

afterAll(() => {
    vi.restoreAllMocks();
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.overrides = {};
    mocks.places = [];
    mocks.draft = createDraft();
    const machine = createRigMachine();
    mocks.renderMachines = [machine];
    mocks.liveMachines = { [machine.id]: machine };
    mocks.machineListCommanders.mockResolvedValue({ commanders: [] });
    mocks.machineSpawnNewSession.mockResolvedValue({ type: 'error', errorMessage: 'stop after payload' });
    mocks.listWorktrees.mockResolvedValue([]);
    mocks.createWorktree.mockResolvedValue({ success: true, worktreePath: '/worktree', branchName: 'branch' });
    mocks.refreshSessions.mockResolvedValue(undefined);
    mocks.sendMessage.mockResolvedValue(undefined);
    mocks.confirm.mockResolvedValue(false);
});

describe('Full New Session path selection', () => {
    it('selects an exact recent path when display labels repeat, closes the picker, and sends that path', async () => {
        const firstPath = '~/project';
        const secondPath = '/Users/dev/project';
        mocks.places = [
            { key: firstPath, name: 'Repeated project', path: firstPath, projectId: 'project-1' },
            { key: secondPath, name: 'Repeated project', path: secondPath, projectId: 'project-2' },
        ];
        mocks.draft = createDraft({ selectedPath: '/Users/dev/starting' });
        mocks.draft.setPath = vi.fn((path: string) => {
            mocks.draft.selectedPath = path;
        });
        const renderer = await renderScreen();

        const initialTrigger = findPathTrigger(renderer, '~/starting');
        expect(initialTrigger).toBeDefined();
        await act(async () => initialTrigger!.props.onPress());

        const secondRecent = renderer.root.findByProps({
            testID: `new-session-recent-path-${encodeURIComponent(secondPath)}`,
        });
        expect(secondRecent.props.accessibilityState).toEqual({ selected: false });
        await act(async () => secondRecent.props.onPress());

        expect(mocks.draft.setPath).toHaveBeenLastCalledWith(secondPath);
        expect(renderer.root.findAllByProps({
            testID: `new-session-recent-path-${encodeURIComponent(secondPath)}`,
        })).toHaveLength(0);

        const updatedTrigger = findPathTrigger(renderer, '~/project');
        expect(updatedTrigger).toBeDefined();
        await act(async () => updatedTrigger!.props.onPress());
        expect(renderer.root.findByProps({
            testID: `new-session-recent-path-${encodeURIComponent(firstPath)}`,
        }).props.accessibilityState).toEqual({ selected: false });
        expect(renderer.root.findByProps({
            testID: `new-session-recent-path-${encodeURIComponent(secondPath)}`,
        }).props.accessibilityState).toEqual({ selected: true });

        await pressSend(renderer);
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
            directory: secondPath,
        }));
        act(() => renderer.unmount());
    });

    it('keeps every rendered New Session text and text input at 16 CSS px or larger', async () => {
        mocks.places = Array.from({ length: 5 }, (_, index) => ({
            key: `/Users/dev/project-${index}`,
            name: `Project ${index}`,
            path: `/Users/dev/project-${index}`,
            projectId: `project-${index}`,
        }));
        mocks.draft = createDraft({ selectedPath: '/Users/dev/starting' });
        const renderer = await renderScreen();

        const trigger = findPathTrigger(renderer, '~/starting');
        expect(trigger).toBeDefined();
        await act(async () => trigger!.props.onPress());

        for (const text of renderer.root.findAllByType('Text' as any)) {
            expect(flattenStyle(text.props.style).fontSize).toEqual(expect.any(Number));
            expect(flattenStyle(text.props.style).fontSize).toBeGreaterThanOrEqual(16);
        }
        for (const input of renderer.root.findAllByType('TextInput' as any)) {
            expect(flattenStyle(input.props.style).fontSize).toBeGreaterThanOrEqual(16);
        }
        act(() => renderer.unmount());
    });
});

describe('Full New Session provider launch', () => {
    it('sends synchronized Rig defaults in the provider-native payload', async () => {
        mocks.overrides = {
            rig: {
                permissionMode: 'careful',
                modelMode: 'claude:alternate',
                effortLevel: 'max',
            },
        };
        const renderer = await renderScreen();

        await pressSend(renderer);

        expect(mocks.machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            agent: 'rig',
            providerId: 'claude',
            modelId: 'alternate',
            permissionMode: 'careful',
            effort: 'max',
        }));
        act(() => renderer.unmount());
    });

    it('launches dsh from a real Web send gesture with exact model and effort defaults', async () => {
        const machine = createDshMachine();
        mocks.renderMachines = [machine];
        mocks.liveMachines = { [machine.id]: machine };
        mocks.draft = createDraft({ agentType: 'dsh' });
        const renderer = await renderScreen();

        await pressSend(renderer);

        expect(mocks.machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            agent: 'dsh',
            modelMode: 'deepseek-v5',
            effortLevel: 'high',
        }));
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledWith(expect.not.objectContaining({
            permissionMode: expect.anything(),
        }));
        act(() => renderer.unmount());
    });

    it('shows the live dsh probe error when its catalog disappears before the Web send gesture', async () => {
        const machine = createDshMachine();
        mocks.renderMachines = [machine];
        mocks.liveMachines = {
            [machine.id]: {
                ...machine,
                metadata: {
                    homeDir: '/Users/dev',
                    cliAvailability: { dsh: true },
                    dshCapabilityError: 'dsh probe failed; verify `dsh --profile acp` starts.',
                },
            },
        };
        mocks.draft = createDraft({ agentType: 'dsh' });
        const renderer = await renderScreen();

        await pressSend(renderer);

        expect(mocks.machineSpawnNewSession).not.toHaveBeenCalled();
        expect(mocks.alert).toHaveBeenCalledWith(
            'common.error',
            'dsh probe failed; verify `dsh --profile acp` starts.',
        );
        act(() => renderer.unmount());
    });

    it('rejects GrokBuild when its exact catalog disappears during worktree creation', async () => {
        const machine = createGrokMachine();
        mocks.renderMachines = [machine];
        mocks.liveMachines = { [machine.id]: machine };
        mocks.draft = createDraft({
            agentType: 'grok',
            sessionType: 'worktree',
        });
        mocks.overrides = {
            grok: {
                permissionMode: 'grok-mode',
                modelMode: 'grok-model',
                effortLevel: 'grok-effort',
            },
        };
        mocks.createWorktree.mockImplementation(async () => {
            mocks.liveMachines = {
                'machine-1': {
                    ...machine,
                    metadata: {
                        homeDir: '/Users/dev',
                        cliAvailability: { grok: true },
                        grokCapabilityError: 'catalog disappeared',
                    },
                },
            };
            return { success: true, worktreePath: '/worktree', branchName: 'branch' };
        });
        const renderer = await renderScreen();

        await pressSend(renderer);

        expect(mocks.createWorktree).toHaveBeenCalledOnce();
        expect(mocks.machineSpawnNewSession).not.toHaveBeenCalled();
        expect(mocks.alert).toHaveBeenCalledWith('common.error', 'catalog disappeared');
        act(() => renderer.unmount());
    });

    it('keeps an unsupported Grok model dimension empty after a successful launch', async () => {
        const machine = createGrokMachine();
        machine.metadata.agentCapabilities.grok.models = [];
        machine.metadata.agentCapabilities.grok.effortLevels = [];
        mocks.renderMachines = [machine];
        mocks.liveMachines = { [machine.id]: machine };
        mocks.draft = createDraft({ agentType: 'grok' });
        mocks.overrides = {
            grok: { permissionMode: 'grok-mode' },
        };
        mocks.machineSpawnNewSession.mockResolvedValue({
            type: 'success',
            sessionId: 'session-grok-empty-models',
        });
        const renderer = await renderScreen();

        await pressSend(renderer);

        expect(mocks.machineSpawnNewSession).toHaveBeenCalledWith(expect.not.objectContaining({
            modelMode: expect.anything(),
        }));
        expect(mocks.sessionSetAgentModes).toHaveBeenCalledWith(
            'session-grok-empty-models',
            { permissionMode: 'grok-mode' },
        );
        act(() => renderer.unmount());
    });

    it('keeps an incomplete Rig catalog from reaching spawn', async () => {
        const completeMachine = createRigMachine();
        mocks.renderMachines = [completeMachine];
        mocks.liveMachines = {
            'machine-1': createRigMachine({ models: [], operatingModes: [] }),
        };
        const renderer = await renderScreen();

        await pressSend(renderer);

        expect(mocks.machineSpawnNewSession).not.toHaveBeenCalled();
        expect(mocks.alert).toHaveBeenCalledWith(
            'common.error',
            'uiCopy.theSelectedAgentConfigurationIsUnavailable',
        );
        act(() => renderer.unmount());
    });
});
