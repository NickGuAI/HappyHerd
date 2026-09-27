import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeSpawnRequest } from '@/sync/spawnRequestId';

const mocks = vi.hoisted(() => {
    // Header visibility the screen asks its navigator for.
    const setOptions = vi.fn();
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
    return {
        setOptions,
        platform: 'web',
        mac: false,
        dimensions: { width: 844, height: 390 },
        renderMachines: [] as any[],
        liveMachines: {} as Record<string, any>,
        projects: {} as Record<string, any>,
        focusMode: null as { projectId: string; endsAt: number } | null,
        overrides: {} as Record<string, Record<string, string>>,
        draft: {} as any,
        machineSpawnNewSession: vi.fn(),
        machineListCommanders: vi.fn(),
        sessionSetAgentModes: vi.fn(),
        createWorktree: vi.fn(),
        listWorktrees: vi.fn(),
        refreshSessions: vi.fn(),
        sendMessage: vi.fn(),
        assignSessionProject: vi.fn(),
        alert: vi.fn(),
        confirm: vi.fn(),
        navigateToSession: vi.fn(),
        routerBack: vi.fn(),
        emptyList: [] as any[],
        places: [] as any[],
        setFavorites: vi.fn(),
        expImageUpload: false,
        pickImages: vi.fn(),
        pickImagesForUpload: vi.fn(),
        uploadAssets: vi.fn(),
        pickAndUpload: vi.fn(),
        machineUploaderOptions: null as any,
        addWorkspaceContextEntry: vi.fn(),
        buildWorkspaceContextMessage: vi.fn(),
        clearWorkspaceContextFiles: vi.fn(),
        uploadPhase: 'idle',
        newSessionMode: 'advanced' as 'streamline' | 'advanced',
        githubStatus: 'unknown' as 'github' | 'git' | 'none' | 'unknown',
        githubStatusByPath: {} as Record<string, 'github' | 'git' | 'none' | 'unknown'>,
        githubLoading: false,
        lastCommanderWorkspaces: null as any,
        streamlineAgentDefaults: {} as Record<string, Record<string, string>>,
        streamlineAgent: 'claude',
        draftVersion: 0,
        draftListeners: new Set<() => void>(),
        streamlineLocations: [] as any[],
        streamlineGithubWorktree: true,
        setAgentDefaultOverrides: vi.fn(),
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
            get OS() { return mocks.platform; },
            select: (options: Record<string, unknown>) => options[mocks.platform] ?? options.default,
        },
        // The native phone menu sheet (HerdBottomSheet) drags through PanResponder.
        PanResponder: { create: () => ({ panHandlers: {} }) },
        Keyboard: {
            isVisible: () => false,
            dismiss: vi.fn(),
            addListener: () => ({ remove: vi.fn() }),
        },
        AppState: { addEventListener: () => ({ remove: vi.fn() }) },
        LayoutAnimation: {
            configureNext: vi.fn(),
            Presets: { easeInEaseOut: {} },
        },
        useWindowDimensions: () => mocks.dimensions,
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
    useNavigation: () => ({ setOptions: mocks.setOptions }),
    useRouter: () => ({ back: mocks.routerBack }),
}));
vi.mock('react-native-unistyles', async () => {
    const { lightTheme } = await import('@/theme');
    const theme = {
        ...lightTheme,
        colors: {
            ...lightTheme.colors,
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
vi.mock('@/utils/responsive', () => ({
    useDeviceType: () => 'phone',
    useHeaderHeight: () => 0,
    useIsTablet: () => mocks.dimensions.width >= 700,
}));
vi.mock('@/utils/platform', () => ({ isRunningOnMac: () => mocks.mac }));
vi.mock('@/utils/newSessionSidebarLayout', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/utils/newSessionSidebarLayout')>(),
    NEW_SESSION_DESKTOP_MIN_WINDOW_WIDTH: 1100,
    NEW_SESSION_PANEL_ROW_FONT_SIZE: 16,
    getNewSessionSidebarLayout: () => ({ showSidebar: false, sidebarWidth: 0 }),
}));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}), mono: () => ({}) } }));
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
vi.mock('@/components/MobileTypographyFloor', async () => {
    const ReactModule = await import('react');
    return {
        MobileTypographyFloor: (props: any) => ReactModule.createElement('MobileTypographyFloor', props, props.children),
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
    addWorkspaceContextEntry: mocks.addWorkspaceContextEntry,
    buildWorkspaceContextMessage: mocks.buildWorkspaceContextMessage,
    clearWorkspaceContextFiles: mocks.clearWorkspaceContextFiles,
    workspaceContextEntryKey: (entry: { path: string; source: { kind: string; machineId?: string } }) => JSON.stringify(
        entry.source.kind === 'machine'
            ? ['machine', entry.source.machineId, entry.path]
            : ['session', entry.path],
    ),
}));

vi.mock('@/components/CommanderSessionAvatar', async () => {
    const ReactModule = await import('react');
    return { CommanderSessionAvatar: (props: any) => ReactModule.createElement('CommanderSessionAvatar', props) };
});
vi.mock('@/sync/githubRepository', () => ({
    useGithubRepository: (_machineId: string | null, path: string | null) => ({
        status: (path && mocks.githubStatusByPath[path]) || mocks.githubStatus,
        loading: mocks.githubLoading,
    }),
    detectGithubRepository: async () => mocks.githubStatus,
}));
vi.mock('@/hooks/useStreamlineLocations', () => ({
    useStreamlineLocations: (commanderWorkspaces: unknown) => {
        mocks.lastCommanderWorkspaces = commanderWorkspaces;
        return mocks.streamlineLocations;
    },
}));
vi.mock('@/sync/storage', () => ({
    useAllMachines: () => mocks.renderMachines,
    useSessions: () => mocks.emptyList,
    useProjects: () => mocks.projects,
    useSetting: (key: string) => key === 'focusMode' ? mocks.focusMode : ({
        agentInputEnterToSend: false,
        fileDiffsSidebar: false,
        expImageUpload: mocks.expImageUpload,
        newSessionMode: mocks.newSessionMode,
        streamlineAgent: mocks.streamlineAgent,
        streamlineAgentDefaults: mocks.streamlineAgentDefaults,
        streamlineGithubWorktree: mocks.streamlineGithubWorktree,
    })[key] ?? false,
    useSettingMutable: (key: string) => key === 'agentDefaultOverrides'
        ? [mocks.overrides, mocks.setAgentDefaultOverrides]
        : [mocks.emptyList, mocks.setFavorites],
    useLocalSetting: () => false,
    storage: { getState: () => ({ machines: mocks.liveMachines, projects: mocks.projects, settings: { focusMode: mocks.focusMode } }) },
}));
vi.mock('@/hooks/useNewSessionDraft', async () => {
    const ReactModule = await import('react');
    const subscribe = (listener: () => void) => {
        mocks.draftListeners.add(listener);
        return () => { mocks.draftListeners.delete(listener); };
    };
    const version = () => mocks.draftVersion;
    // Like the real store, writes through a live draft re-render its readers.
    const useNewSessionDraft = (selector: (state: any) => unknown) => {
        ReactModule.useSyncExternalStore(subscribe, version, version);
        return selector(mocks.draft);
    };
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
        pickImages: mocks.pickImages,
        pickImagesForUpload: mocks.pickImagesForUpload,
    }),
}));
vi.mock('@/hooks/useMachineFileUpload', () => ({
    useMachineFileUpload: (options: unknown) => {
        mocks.machineUploaderOptions = options;
        return {
            state: { phase: mocks.uploadPhase },
            canCancel: false,
            canRetry: false,
            reset: vi.fn(),
            cancel: vi.fn(),
            retry: vi.fn(),
            pickAndUpload: mocks.pickAndUpload,
            uploadAssets: mocks.uploadAssets,
        };
    },
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
    machineStopSession: vi.fn(async () => ({ success: true })),
    sessionKill: vi.fn(async () => ({ success: true })),
    sessionArchive: vi.fn(),
    machineListCommanders: mocks.machineListCommanders,
    machineSpawnNewSession: mocks.machineSpawnNewSession,
    sessionSetAgentModes: mocks.sessionSetAgentModes,
}));
vi.mock('@/sync/sync', () => ({
    sync: {
        refreshSessions: mocks.refreshSessions,
        ensureSessionReady: mocks.refreshSessions,
        sendMessage: mocks.sendMessage,
        assignSessionProject: mocks.assignSessionProject,
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
        selectedAccountProjectId: undefined,
        setAccountProjectId: vi.fn((value: string | null | undefined) => { mocks.draft.selectedAccountProjectId = value; }),
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
                        permissionModes: 'dsh:--profile-acp:dump-config:permission-presets',
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
                    permissionModes: [
                        { code: 'read-only', value: 'read-only' },
                        { code: 'workspace-write', value: 'workspace-write', isDefault: true },
                        { code: 'danger-full-access', value: 'danger-full-access' },
                    ],
                    acp: { loadSession: false, prompt: { image: false } },
                },
            },
        },
    };
}

async function renderScreen() {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
        renderer = create(React.createElement(NewSessionScreen), {
            // Chips measure themselves to anchor their picker.
            // Inputs focus on a timer (the path picker); a busy run can reach it before the test unmounts.
            createNodeMock: () => ({
                measureInWindow: (done: (...rect: number[]) => void) => done(40, 700, 90, 28),
                focus: () => {},
                blur: () => {},
            }),
        });
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
    completeSpawnRequest();
    mocks.platform = 'web';
    mocks.mac = false;
    mocks.dimensions = { width: 844, height: 390 };
    mocks.overrides = {};
    mocks.places = [];
    mocks.projects = {};
    mocks.focusMode = null;
    mocks.expImageUpload = false;
    mocks.machineUploaderOptions = null;
    mocks.uploadPhase = 'idle';
    mocks.newSessionMode = 'advanced';
    mocks.githubStatus = 'unknown';
    mocks.githubStatusByPath = {};
    mocks.githubLoading = false;
    mocks.lastCommanderWorkspaces = null;
    mocks.draftVersion = 0;
    mocks.draftListeners.clear();
    mocks.streamlineAgentDefaults = {};
    mocks.streamlineAgent = 'claude';
    mocks.streamlineLocations = [];
    mocks.streamlineGithubWorktree = true;
    mocks.draft = createDraft();
    const machine = createRigMachine();
    mocks.renderMachines = [machine];
    mocks.liveMachines = { [machine.id]: machine };
    mocks.machineListCommanders.mockResolvedValue({ commanders: [] });
    mocks.machineSpawnNewSession.mockResolvedValue({ type: 'error', errorMessage: 'stop after payload' });
    mocks.listWorktrees.mockResolvedValue([]);
    mocks.createWorktree.mockResolvedValue({ success: true, worktreePath: '/worktree', branchName: 'branch' });
    mocks.refreshSessions.mockResolvedValue(undefined);
    mocks.sendMessage.mockResolvedValue({ localId: 'first-message' });
    mocks.assignSessionProject.mockResolvedValue(undefined);
    mocks.confirm.mockResolvedValue(false);
    mocks.pickImagesForUpload.mockResolvedValue([]);
    mocks.uploadAssets.mockResolvedValue([]);
    mocks.buildWorkspaceContextMessage.mockImplementation(async (_sessionId: string, prompt: string, entries: any[]) => ({
        promptText: `${prompt}\n\n${entries.map((entry) => `Use exact file: ${entry.path}`).join('\n')}`.trim(),
        displayText: `${prompt}\n\n${entries.map((entry) => entry.path).join('\n')}`.trim(),
    }));
});

describe('Full New Session path selection', () => {
    it('selects an exact recent path when display labels repeat, closes the picker, and sends that path', async () => {
        const firstPath = '~/project';
        const secondPath = '/Users/dev/project';
        mocks.places = [
            { key: firstPath, name: 'Repeated project', path: firstPath, projectId: 'project-1' },
            { key: secondPath, name: 'Repeated project', path: secondPath, projectId: 'project-2' },
            { key: '~/bare', name: '~/bare', path: '~/bare' },
            { key: '/Users/dev/bare', name: '/Users/dev/bare', path: '/Users/dev/bare' },
        ];
        mocks.draft = createDraft({ selectedPath: '/Users/dev/starting' });
        mocks.draft.setPath = vi.fn((path: string) => {
            mocks.draft.selectedPath = path;
        });
        const renderer = await renderScreen();

        const initialTrigger = findPathTrigger(renderer, '~/starting');
        expect(initialTrigger).toBeDefined();
        await act(async () => initialTrigger!.props.onPress());

        const recentPathList = renderer.root.findAllByType('ScrollView' as any).find((node: any) => (
            node.props.testID === 'new-session-recent-path-list'
        ));
        expect(recentPathList).toBeDefined();
        expect(recentPathList!.props.nestedScrollEnabled).toBe(true);
        expect(flattenStyle(recentPathList!.props.style)).toMatchObject({
            maxHeight: 176,
            overscrollBehaviorY: 'contain',
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-y',
        });

        const secondRecent = renderer.root.findByProps({
            testID: `new-session-recent-path-${encodeURIComponent(secondPath)}`,
        });
        expect(secondRecent.props.accessibilityState).toEqual({ selected: false });
        expect(secondRecent.props.accessibilityLabel).toBe(`Repeated project, ${secondPath}`);
        expect(secondRecent.findAllByType('Text' as any).map((text: any) => text.props.children)).toEqual([
            'Repeated project',
            secondPath,
        ]);
        expect(renderer.root.findByProps({
            testID: `new-session-recent-path-${encodeURIComponent('~/bare')}`,
        }).findAllByType('Text' as any).map((text: any) => text.props.children)).toEqual([
            '~/bare',
        ]);
        expect(renderer.root.findByProps({
            testID: `new-session-recent-path-${encodeURIComponent('/Users/dev/bare')}`,
        }).findAllByType('Text' as any).map((text: any) => text.props.children)).toEqual([
            '~/bare',
            '/Users/dev/bare',
        ]);
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

    it('keeps every rendered New Session text input at 16 CSS px or larger on Web', async () => {
        mocks.places = Array.from({ length: 5 }, (_, index) => ({
            key: `/Users/dev/project-${index}`,
            name: `Project ${index}`,
            path: `/Users/dev/project-${index}`,
            projectId: `project-${index}`,
        }));
        mocks.draft = createDraft({ selectedPath: '/Users/dev/starting' });
        const renderer = await renderScreen();

        expect(renderer.root.findByType('MobileTypographyFloor' as any).props.active).toBe(true);

        const trigger = findPathTrigger(renderer, '~/starting');
        expect(trigger).toBeDefined();
        const pathConfigLabel = trigger!.findAllByType('Text' as any).find((text: any) => (
            text.props.children === '~/starting'
        ));
        expect(flattenStyle(pathConfigLabel?.props.style).fontSize).toBe(16);
        await act(async () => trigger!.props.onPress());

        for (const input of renderer.root.findAllByType('TextInput' as any)) {
            expect(flattenStyle(input.props.style).fontSize).toBeGreaterThanOrEqual(16);
        }
        const firstRecentPath = renderer.root.findByProps({
            testID: `new-session-recent-path-${encodeURIComponent('/Users/dev/project-0')}`,
        }).findAllByType('Text' as any)[0];
        expect(flattenStyle(firstRecentPath.props.style).fontSize).toBe(16);
        const recentSectionLabel = renderer.root.findAllByType('Text' as any).find((text: any) => (
            text.props.children === 'workspace.recent'
        ));
        expect(flattenStyle(recentSectionLabel?.props.style).fontSize).toBe(13);
        act(() => renderer.unmount());
    });
});

describe('New Session Commander onboarding', () => {
    it.each([
        ['ios', 390, 844],
        ['ios', 1024, 1366],
        ['web', 1440, 900],
        ['web', 390, 844],
    ])('exposes creation after Commander rows and retains selections on %s %dx%d', async (platform, width, height) => {
        mocks.platform = platform as string;
        mocks.dimensions = { width: width as number, height: height as number };
        mocks.machineListCommanders.mockResolvedValue({ commanders: [
            { id: 'athena', name: 'Athena', workspace: '/Users/dev/athena' },
        ] });
        mocks.draft = createDraft({ selectedCommanderId: 'athena' });
        const renderer = await renderScreen();
        const trigger = renderer.root.findAllByType('BubblePressable' as any)
            .find((item: any) => item.props.accessibilityLabel === 'happyHerd.automations.commander');
        expect(trigger).toBeDefined();
        await act(async () => trigger!.props.onPress());

        const options = renderer.root.findAllByType('BubblePressable' as any)
            .filter((item: any) => ['radio', 'button'].includes(item.props.accessibilityRole));
        const action = options.find((item: any) => item.props.accessibilityLabel === 'happyHerd.commander.createTitle');
        const commander = options.find((item: any) => item.props.accessibilityLabel === 'Athena');
        expect(action).toBeDefined();
        expect(commander).toBeDefined();
        expect(options.indexOf(action!)).toBeGreaterThan(options.indexOf(commander!));
        expect(action!.props.accessibilityRole).toBe('button');
        expect(action!.props.accessibilityHint).toBe('happyHerd.commander.createSubtitle');
        expect(action!.props.accessibilityState).toEqual({ disabled: false });
        expect(action!.findAllByType('Text' as any).every((text: any) => text.props.numberOfLines === undefined)).toBe(true);
        await act(async () => action!.props.onPress());

        expect(mocks.draft.setInput).toHaveBeenCalledWith('happyHerd.commander.onboardingPrompt');
        for (const setter of ['setMachineId', 'setPath', 'setCommanderId', 'setAgentType', 'setPermissionMode', 'setModelMode', 'setEffortLevel']) {
            expect(mocks.draft[setter]).not.toHaveBeenCalled();
        }
        expect(mocks.machineSpawnNewSession).not.toHaveBeenCalled();
        expect(renderer.root.findAllByType('BubblePressable' as any)
            .filter((item: any) => item.props.accessibilityLabel === 'happyHerd.commander.createTitle')).toHaveLength(0);
        act(() => renderer.unmount());
    });
});

describe('Full New Session account project selection', () => {
    beforeEach(() => {
        mocks.projects = {
            'project-a': { id: 'project-a', name: 'Project Alpha', kind: 'personal' },
            'project-b': { id: 'project-b', name: 'Project Beta', kind: 'personal' },
            'system-project': { id: 'system-project', name: 'System Project', kind: 'system' },
        };
        mocks.focusMode = { projectId: 'project-a', endsAt: Date.now() + 60_000 };
        mocks.machineSpawnNewSession.mockResolvedValue({ type: 'success', sessionId: 'new-session' });
    });

    it('shows the focused project and lets the user select another account project or no project', async () => {
        const renderer = await renderScreen();
        const findTrigger = () => renderer.root.findAllByType('BubblePressable' as any)
            .find((node: any) => node.props.testID === 'new-session-account-project')!;
        expect(findTrigger().props.accessibilityValue).toEqual({ text: 'Project Alpha' });
        await act(async () => findTrigger().props.onPress());
        const options = renderer.root.findAllByType('BubblePressable' as any)
            .filter((node: any) => node.props.accessibilityRole === 'radio');
        expect(options.map((node: any) => node.props.accessibilityLabel)).toEqual([
            'projects.noProject', 'Project Alpha', 'Project Beta',
        ]);
        await act(async () => options.find((node: any) => node.props.accessibilityLabel === 'Project Beta')!.props.onPress());
        expect(mocks.draft.selectedAccountProjectId).toBe('project-b');
        expect(findTrigger().props.accessibilityValue).toEqual({ text: 'Project Beta' });
        await act(async () => findTrigger().props.onPress());
        const noProject = renderer.root.findAllByType('BubblePressable' as any)
            .find((node: any) => node.props.accessibilityRole === 'radio' && node.props.accessibilityLabel === 'projects.noProject')!;
        await act(async () => noProject.props.onPress());
        expect(mocks.draft.selectedAccountProjectId).toBe(null);
        expect(findTrigger().props.accessibilityValue).toEqual({ text: 'projects.noProject' });
        expect(mocks.draft.setPath).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('assigns the focus project after readiness and before the first message and navigation, independently of Rig routing', async () => {
        const order: string[] = [];
        mocks.places = [{ key: '~/project', path: '~/project', name: 'Rig Project', projectId: 'rig-project' }];
        mocks.refreshSessions.mockImplementation(async () => { order.push('ready'); });
        mocks.assignSessionProject.mockImplementation(async () => {
            await Promise.resolve();
            order.push('assigned');
        });
        mocks.sendMessage.mockImplementation(async () => { order.push('send'); return { localId: 'first-message' }; });
        mocks.navigateToSession.mockImplementation(() => { order.push('navigate'); });
        const renderer = await renderScreen();
        await pressSend(renderer);
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
            happyherdAgentTarget: { kind: 'project', id: 'rig-project' },
        }));
        expect(mocks.assignSessionProject).toHaveBeenCalledWith('new-session', 'project-a');
        expect(order).toEqual(['ready', 'assigned', 'send', 'navigate']);
        expect(mocks.draft.setAccountProjectId).toHaveBeenLastCalledWith(undefined);
        act(() => renderer.unmount());
    });

    it.each([null, 'project-b'])('respects an explicit account project selection of %s', async (selectedAccountProjectId) => {
        mocks.draft = createDraft({ selectedAccountProjectId });
        const renderer = await renderScreen();
        await pressSend(renderer);
        expect(mocks.assignSessionProject).toHaveBeenCalledWith('new-session', selectedAccountProjectId);
        expect(mocks.draft.setAccountProjectId).toHaveBeenLastCalledWith(undefined);
        act(() => renderer.unmount());
    });

    it('keeps the created session and selected project when assignment fails, focus expires, and the user retries', async () => {
        mocks.assignSessionProject.mockRejectedValueOnce(new Error('Project assignment failed'));
        const renderer = await renderScreen();
        await pressSend(renderer);
        expect(mocks.alert).toHaveBeenCalledWith('common.error', 'Project assignment failed');
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        expect(mocks.navigateToSession).not.toHaveBeenCalled();
        expect(mocks.draft.input).toBe('Start the task');
        expect(mocks.draft.selectedAccountProjectId).toBe('project-a');

        mocks.focusMode = null;
        await pressSend(renderer);
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(1);
        expect(mocks.assignSessionProject.mock.calls).toEqual([
            ['new-session', 'project-a'], ['new-session', 'project-a'],
        ]);
        expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
        expect(mocks.navigateToSession).toHaveBeenCalledWith('new-session');
        expect(mocks.draft.selectedAccountProjectId).toBe(undefined);
        act(() => renderer.unmount());
    });

    it('retains the launch project when Focus Mode ends while session readiness is pending', async () => {
        mocks.refreshSessions.mockImplementation(async () => { mocks.focusMode = null; });
        const renderer = await renderScreen();
        await pressSend(renderer);
        expect(mocks.assignSessionProject).toHaveBeenCalledWith('new-session', 'project-a');
        expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
        act(() => renderer.unmount());
    });

    it('does not assign or send if the user changes the account project before readiness', async () => {
        mocks.refreshSessions.mockImplementation(async () => {
            mocks.draft = { ...mocks.draft, selectedAccountProjectId: 'project-b' };
        });
        const renderer = await renderScreen();
        await pressSend(renderer);
        expect(mocks.assignSessionProject).not.toHaveBeenCalled();
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        expect(mocks.navigateToSession).not.toHaveBeenCalled();
        expect(mocks.draft.selectedAccountProjectId).toBe('project-b');
        act(() => renderer.unmount());
    });

    it('does not send or navigate if the account selection changes while assignment is pending', async () => {
        mocks.assignSessionProject.mockImplementation(async () => {
            mocks.draft = { ...mocks.draft, selectedAccountProjectId: null };
        });
        const renderer = await renderScreen();
        await pressSend(renderer);
        expect(mocks.assignSessionProject).toHaveBeenCalledWith('new-session', 'project-a');
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        expect(mocks.navigateToSession).not.toHaveBeenCalled();
        expect(mocks.draft.selectedAccountProjectId).toBe(null);
        act(() => renderer.unmount());
    });
});

describe('Full New Session provider launch', () => {
    it('launches Claude Opus 5.5 with its exact-machine medium default', async () => {
        const modelEfforts = ['low', 'medium', 'high', 'xhigh', 'max'].map((code) => ({
            code,
            value: code,
            ...(code === 'medium' ? { isDefault: true } : {}),
        }));
        const machine = {
            id: 'machine-1',
            active: true,
            activeAt: Date.now(),
            metadata: {
                homeDir: '/Users/dev',
                cliAvailability: { claude: true },
                agentCapabilities: {
                    claude: {
                        detectedAt: 1,
                        sources: {
                            models: 'happyherd-release-catalog',
                            effortLevels: 'cli-help',
                            permissionModes: 'daemon-defaults',
                        },
                        models: [
                            { code: 'default', value: 'provider default' },
                            { code: 'claude-opus-5-5', value: 'claude-opus-5-5', effortLevels: modelEfforts },
                        ],
                        effortLevels: [
                            { code: 'low', value: 'low' },
                            { code: 'medium', value: 'medium' },
                            { code: 'high', value: 'high' },
                            { code: 'xhigh', value: 'xhigh' },
                            { code: 'max', value: 'max', isDefault: true },
                        ],
                        permissionModes: [
                            { code: 'default', value: 'default' },
                            { code: 'bypassPermissions', value: 'bypassPermissions', isDefault: true },
                        ],
                    },
                },
            },
        };
        mocks.renderMachines = [machine];
        mocks.liveMachines = { [machine.id]: machine };
        mocks.draft = createDraft({ agentType: 'claude', modelMode: 'claude-opus-5-5' });

        const renderer = await renderScreen();
        await pressSend(renderer);

        expect(mocks.machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            agent: 'claude',
            modelMode: 'claude-opus-5-5',
            effortLevel: 'medium',
        }));
        act(() => renderer.unmount());
    });

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

    it('launches dsh from a real Web send gesture with exact catalog defaults', async () => {
        const machine = createDshMachine();
        mocks.renderMachines = [machine];
        mocks.liveMachines = { [machine.id]: machine };
        mocks.draft = createDraft({ agentType: 'dsh' });
        mocks.machineSpawnNewSession.mockResolvedValue({ type: 'success', sessionId: 'dsh-session' });
        const renderer = await renderScreen();

        await pressSend(renderer);

        expect(mocks.machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            agent: 'dsh',
            permissionMode: 'workspace-write',
            modelMode: 'deepseek-v5',
            effortLevel: 'high',
        }));
        expect(mocks.sessionSetAgentModes).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ permissionMode: expect.anything() }),
        );
        act(() => renderer.unmount());
    });

    it('uploads dsh Photos through the workspace uploader and binds the exact path to the initial message', async () => {
        const machine = createDshMachine();
        mocks.renderMachines = [machine];
        mocks.liveMachines = { [machine.id]: machine };
        mocks.draft = createDraft({ agentType: 'dsh' });
        mocks.pickImagesForUpload.mockResolvedValue([{
            id: 'photo-1',
            uri: 'file:///photo.jpg',
            name: 'photo.jpg',
            mimeType: 'image/jpeg',
            size: 123,
            width: 100,
            height: 80,
        }]);
        mocks.uploadAssets.mockImplementation(async (assets: Array<{ name: string }>) => {
            const paths = assets.map((asset) => `/Users/dev/project/${asset.name}`);
            paths.forEach((path) => mocks.machineUploaderOptions.onUploaded(path, {
                machineId: 'machine-1',
                directory: '/Users/dev/project',
                selectionKey: 'dsh',
            }));
            return paths;
        });
        mocks.machineSpawnNewSession.mockResolvedValue({ type: 'success', sessionId: 'dsh-session' });
        const renderer = await renderScreen();

        const attachmentButton = renderer.root.findAllByType('BubblePressable' as any).find((candidate: any) => (
            candidate.props.accessibilityLabel === 'happyHerd.composer.addAttachment'
        ));
        expect(attachmentButton).toBeDefined();
        await act(async () => attachmentButton!.props.onPress());
        const photos = renderer.root.findByProps({ testID: 'attachment-menu-photos' });
        await act(async () => {
            photos.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.pickImagesForUpload).toHaveBeenCalledWith(5);
        expect(mocks.uploadAssets).toHaveBeenCalledWith([
            expect.objectContaining({ uri: 'file:///photo.jpg', name: 'photo.jpg' }),
        ]);
        expect(renderer.root.findByType('WorkspaceContextStrip' as any).props.entries).toEqual([
            {
                path: '/Users/dev/project/photo.jpg',
                kind: 'file',
                source: { kind: 'machine', machineId: 'machine-1' },
            },
        ]);

        await pressSend(renderer);

        expect(mocks.addWorkspaceContextEntry).toHaveBeenCalledWith('dsh-session', {
            path: '/Users/dev/project/photo.jpg',
            kind: 'file',
            source: { kind: 'machine', machineId: 'machine-1' },
        });
        expect(mocks.sendMessage).toHaveBeenCalledWith(
            'dsh-session',
            'Start the task\n\nUse exact file: /Users/dev/project/photo.jpg',
            {
                source: 'new_session',
                attachments: [],
                displayText: 'Start the task\n\n/Users/dev/project/photo.jpg',
                signal: expect.any(AbortSignal), isCurrent: expect.any(Function),
            },
        );
        expect(mocks.clearWorkspaceContextFiles).toHaveBeenCalledWith('dsh-session');
        expect(mocks.pickImages).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('does not offer another dsh attachment picker while an upload is active', async () => {
        const machine = createDshMachine();
        mocks.renderMachines = [machine];
        mocks.liveMachines = { [machine.id]: machine };
        mocks.draft = createDraft({ agentType: 'dsh' });
        mocks.uploadPhase = 'uploading';
        const renderer = await renderScreen();

        expect(renderer.root.findAllByType('BubblePressable' as any).some((candidate: any) => (
            candidate.props.accessibilityLabel === 'happyHerd.composer.addAttachment'
        ))).toBe(false);
        const send = renderer.root.findAllByType('Pressable' as any)
            .find((item: any) => item.props.accessibilityLabel === 'happyHerd.composer.send');
        expect(send?.props.disabled).toBe(true);
        await act(async () => send?.props.onPress());
        expect(mocks.machineSpawnNewSession).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('preserves existing workspace context when switching between non-dsh providers', async () => {
        const machine = {
            id: 'machine-1',
            active: true,
            activeAt: Date.now(),
            metadata: {
                homeDir: '/Users/dev',
                cliAvailability: { claude: true, codex: true },
            },
        };
        mocks.renderMachines = [machine];
        mocks.liveMachines = { [machine.id]: machine };
        mocks.draft = createDraft({ agentType: 'codex' });
        const renderer = await renderScreen();

        act(() => {
            mocks.machineUploaderOptions.onUploaded('/Users/dev/project/notes.txt', {
                machineId: 'machine-1',
                directory: '/Users/dev/project',
                selectionKey: 'codex',
            });
        });
        expect(renderer.root.findByType('WorkspaceContextStrip' as any).props.entries).toHaveLength(1);

        mocks.draft = { ...mocks.draft, agentType: 'claude' };
        await act(async () => {
            renderer.update(React.createElement(NewSessionScreen));
            await Promise.resolve();
        });

        expect(renderer.root.findByType('WorkspaceContextStrip' as any).props.entries).toEqual([{
            path: '/Users/dev/project/notes.txt',
            kind: 'file',
            source: { kind: 'machine', machineId: 'machine-1' },
        }]);
        act(() => renderer.unmount());
    });

    it('launches the provider-native dsh mode selected through the rendered permission picker', async () => {
        const machine = createDshMachine();
        mocks.renderMachines = [machine];
        mocks.liveMachines = { [machine.id]: machine };
        mocks.draft = createDraft({ agentType: 'dsh' });
        mocks.machineSpawnNewSession.mockResolvedValue({ type: 'success', sessionId: 'dsh-session' });
        const renderer = await renderScreen();

        const permissionTrigger = renderer.root.findAllByType('BubblePressable' as any)
            .find((candidate: any) => candidate.findAllByType('Text' as any).some((text: any) => (
                text.props.children === 'workspace-write'
            )));
        expect(permissionTrigger).toBeDefined();
        await act(async () => permissionTrigger!.props.onPress());

        const dangerMode = renderer.root.findAllByType('BubblePressable' as any)
            .find((candidate: any) => candidate.props.accessibilityRole === 'radio'
                && candidate.findAllByType('Text' as any).some((text: any) => (
                    text.props.children === 'danger-full-access'
                )));
        expect(dangerMode).toBeDefined();
        await act(async () => dangerMode!.props.onPress());
        await pressSend(renderer);

        expect(mocks.draft.setPermissionMode).toHaveBeenCalledWith('danger-full-access');
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            agent: 'dsh',
            permissionMode: 'danger-full-access',
        }));
        expect(mocks.sessionSetAgentModes).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ permissionMode: expect.anything() }),
        );
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

function createClaudeMachine() {
    const efforts = ['low', 'medium', 'high', 'xhigh', 'max'].map((code) => ({ code, value: code, ...(code === 'max' ? { isDefault: true } : {}) }));
    return {
        id: 'machine-1',
        active: true,
        activeAt: Date.now(),
        metadata: {
            homeDir: '/Users/dev',
            host: 'studio',
            cliAvailability: { claude: true },
            agentCapabilities: {
                claude: {
                    detectedAt: 1,
                    sources: { models: 'happyherd-release-catalog', effortLevels: 'cli-help', permissionModes: 'daemon-defaults' },
                    models: [
                        { code: 'claude-opus-5', value: 'Opus 5', isDefault: true, effortLevels: efforts },
                        { code: 'claude-opus-5-5', value: 'Opus 5.5', effortLevels: efforts },
                    ],
                    effortLevels: efforts,
                    permissionModes: [
                        { code: 'default', value: 'default' },
                        { code: 'acceptEdits', value: 'acceptEdits' },
                        { code: 'bypassPermissions', value: 'bypassPermissions', isDefault: true },
                    ],
                },
            },
        },
    };
}

function notifyDraft() {
    mocks.draftVersion += 1;
    mocks.draftListeners.forEach((listener) => listener());
}

/** A draft whose setters write back and notify readers, as the real store does. */
function createLiveDraft(overrides: Record<string, unknown> = {}) {
    const draft: any = createDraft(overrides);
    for (const [setter, field] of [
        ['setModelMode', 'modelMode'],
        ['setEffortLevel', 'effortLevel'],
        ['setPermissionMode', 'permissionMode'],
        ['setAgentType', 'agentType'],
        ['setPath', 'selectedPath'],
        ['setCommanderId', 'selectedCommanderId'],
        ['setSessionType', 'sessionType'],
        ['setWorktreeKey', 'worktreeKey'],
    ] as const) {
        draft[setter] = vi.fn((value: unknown) => { mocks.draft[field] = value; notifyDraft(); });
    }
    // The real store clears machine-bound fields and resets fields on an agent change.
    draft.setMachineId = vi.fn((id: string) => {
        Object.assign(mocks.draft, {
            selectedMachineId: id, selectedPath: null, selectedCommanderId: null,
            permissionMode: null, modelMode: null, effortLevel: null, sessionType: 'simple', worktreeKey: null,
        });
        notifyDraft();
    });
    draft.setAgentType = vi.fn((agent: string) => {
        Object.assign(mocks.draft, agent === mocks.draft.agentType
            ? { agentType: agent }
            : { agentType: agent, permissionMode: null, modelMode: null, effortLevel: null });
        notifyDraft();
    });
    return draft;
}

async function settle(_renderer: ReturnType<typeof create>) {
    // Mock-only inputs (GitHub status, loading) change outside React; a store
    // notification re-renders the screen so it reads them, then effects settle.
    for (let pass = 0; pass < 3; pass += 1) {
        await act(async () => {
            notifyDraft();
            await Promise.resolve();
        });
    }
}

describe('Streamline New Session', () => {
    beforeEach(() => {
        const machine = createClaudeMachine();
        mocks.renderMachines = [machine];
        mocks.liveMachines = { [machine.id]: machine };
        mocks.newSessionMode = 'streamline';
        mocks.dimensions = { width: 1440, height: 900 };
        mocks.draft = createLiveDraft({ agentType: 'claude', selectedPath: '/Users/dev/repo' });
        mocks.streamlineLocations = [{ machineId: 'machine-1', path: '/Users/dev/repo', name: 'repo', machineName: 'studio', online: true }];
    });

    it('opens in Streamline on the web and switches to the full Advanced form', async () => {
        const renderer = await renderScreen();
        await settle(renderer);
        const streamlineRoots = () => renderer.root.findAll((node: any) => node.props?.testID === 'streamline-sections');
        expect(streamlineRoots().length).toBeGreaterThan(0);
        const mode = renderer.root.find((node: any) => node.props?.testID === 'new-session-mode');
        await act(async () => { mode.props.onChange('advanced'); });
        expect(streamlineRoots()).toHaveLength(0);
        expect(renderer.root.findAll((node: any) => node.props?.accessibilityLabel === 'sessionInfo.path').length).toBeGreaterThan(0);
        act(() => renderer.unmount());
    });

    it('starts one Claude session with the Streamline defaults in a new worktree for a GitHub folder', async () => {
        mocks.githubStatus = 'github';
        const renderer = await renderScreen();
        await settle(renderer);

        expect(mocks.draft.setModelMode).toHaveBeenCalledWith('claude-opus-5-5');
        expect(mocks.draft.setEffortLevel).toHaveBeenCalledWith('xhigh');
        expect(mocks.draft.setPermissionMode).toHaveBeenCalledWith('acceptEdits');
        const summary = renderer.root.find((node: any) => node.props?.testID === 'streamline-summary');
        expect(summary.props).toBeDefined();

        await pressSend(renderer);
        expect(mocks.createWorktree).toHaveBeenCalledTimes(1);
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(1);
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            agent: 'claude',
            modelMode: 'claude-opus-5-5',
            effortLevel: 'xhigh',
            permissionMode: 'acceptEdits',
        }));
        act(() => renderer.unmount());
    });

    it('runs directly in a folder that is not a GitHub repository', async () => {
        mocks.githubStatus = 'none';
        const renderer = await renderScreen();
        await settle(renderer);
        await pressSend(renderer);
        expect(mocks.createWorktree).not.toHaveBeenCalled();
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(1);
        act(() => renderer.unmount());
    });

    it('never adds a worktree when the setting is off', async () => {
        mocks.githubStatus = 'github';
        mocks.streamlineGithubWorktree = false;
        const renderer = await renderScreen();
        await settle(renderer);
        await pressSend(renderer);
        expect(mocks.createWorktree).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('keeps the saved Agent Defaults when a Streamline chip changes this launch', async () => {
        const machine = createDshMachine();
        mocks.renderMachines = [machine];
        mocks.liveMachines = { [machine.id]: machine };
        mocks.draft = createLiveDraft({ agentType: 'dsh', selectedPath: '/Users/dev/repo' });
        const renderer = await renderScreen();
        await settle(renderer);
        // dsh's Streamline effort (medium) and permission (default) are not advertised, so the catalog defaults apply.
        expect(mocks.draft.setModelMode).toHaveBeenCalledWith('deepseek-v4-flash');
        expect(mocks.draft.setPermissionMode).toHaveBeenCalledWith('workspace-write');

        const chip = renderer.root.find((node: any) => node.props?.testID === 'streamline-chip-permission');
        await act(async () => { chip.props.onPress(); });
        await settle(renderer);
        const picker = renderer.root.find((node: any) => node.props?.testID === 'streamline-chip-picker');
        const option = picker.findAll((node: any) => node.props?.accessibilityLabel === 'read-only' && typeof node.props?.onPress === 'function')[0];
        expect(option).toBeDefined();
        await act(async () => { option.props.onPress(); });
        expect(mocks.draft.setPermissionMode).toHaveBeenLastCalledWith('read-only');
        expect(mocks.setAgentDefaultOverrides).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });
});

function summaryText(renderer: ReturnType<typeof create>): string {
    const summary = renderer.root.find((node: any) => node.props?.testID === 'streamline-summary');
    return summary.findAllByType('Text' as any).map((node: any) => [].concat(node.props.children).join('')).join(' ');
}

describe('New Session title on Web Mobile', () => {
    it.each([
        ['Streamline', 'streamline', false],
        ['Advanced', 'advanced', true],
    ] as const)('shows the header row in %s only when the page does not carry the title itself', async (_label, mode, headerShown) => {
        const machine = createClaudeMachine();
        mocks.renderMachines = [machine];
        mocks.liveMachines = { [machine.id]: machine };
        mocks.newSessionMode = mode;
        mocks.dimensions = { width: 390, height: 844 };
        mocks.draft = createLiveDraft({ agentType: 'claude', selectedPath: '/Users/dev/repo' });
        mocks.setOptions.mockClear();
        const renderer = await renderScreen();
        await settle(renderer);
        // Streamline's page opens with "Start New Session"; a header row would repeat it.
        expect(mocks.setOptions).toHaveBeenLastCalledWith({ headerShown });
        act(() => renderer.unmount());
    });
});

describe('Streamline on native phones', () => {
    // Owner decision, 2026-09-27: native phones follow the synced New Session mode, as the web does.
    beforeEach(() => {
        const machine = createClaudeMachine();
        mocks.renderMachines = [machine];
        mocks.liveMachines = { [machine.id]: machine };
        mocks.newSessionMode = 'streamline';
        mocks.platform = 'ios';
        mocks.dimensions = { width: 390, height: 844 };
        mocks.draft = createLiveDraft({ agentType: 'claude', selectedPath: '/Users/dev/repo' });
        mocks.streamlineLocations = [{ machineId: 'machine-1', path: '/Users/dev/repo', name: 'repo', machineName: 'studio', online: true }];
    });
    const byTestID = (renderer: ReturnType<typeof create>, testID: string) => renderer.root.findAll((node: any) => node.props?.testID === testID);

    it('opens a native phone in Streamline, with the chips in the pinned composer, and starts the session from it', async () => {
        const renderer = await renderScreen();
        await settle(renderer);
        expect(byTestID(renderer, 'streamline-sections').length).toBeGreaterThan(0);
        expect(byTestID(renderer, 'new-session-mode').length).toBeGreaterThan(0);
        // The page carries the title: no header repeats it.
        expect(renderer.root.findAllByType('Header' as any)).toHaveLength(0);
        // The chips sit in the composer below the page, in place of the agent and settings buttons.
        const composer = byTestID(renderer, 'streamline-composer')[0];
        expect(composer.findAll((node: any) => node.props?.testID === 'streamline-composer-chips').length).toBeGreaterThan(0);
        expect(renderer.root.findAll((node: any) => node.props?.accessibilityLabel === 'settings.title')).toHaveLength(0);
        expect(byTestID(renderer, 'streamline-sections')[0].findAll((node: any) => node.props?.testID === 'streamline-composer').length).toBe(0);

        await pressSend(renderer);
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(1);
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1', agent: 'claude', modelMode: 'claude-opus-5-5', effortLevel: 'xhigh', permissionMode: 'acceptEdits',
        }));
        act(() => renderer.unmount());
    });

    it('opens chip pickers as a sheet, and the folder browser in the full form\'s keyboard-aware popover', async () => {
        const renderer = await renderScreen();
        await settle(renderer);
        const chip = renderer.root.find((node: any) => node.props?.testID === 'streamline-chip-permission');
        await act(async () => { chip.props.onPress(); });
        await settle(renderer);
        // One picker: the menu sheet, not the full form's popover as well.
        expect(byTestID(renderer, 'streamline-chip-picker-handle').length).toBeGreaterThan(0);
        expect(renderer.root.findAllByType('KeyboardStickyView' as any)).toHaveLength(0);
        const option = byTestID(renderer, 'streamline-chip-picker')[0]
            .findAll((node: any) => node.props?.accessibilityLabel === 'default' && typeof node.props?.onPress === 'function')[0];
        await act(async () => { option.props.onPress(); });
        expect(mocks.draft.setPermissionMode).toHaveBeenLastCalledWith('default');

        const browse = renderer.root.find((node: any) => node.props?.testID === 'streamline-choose-folder' && typeof node.props?.onPress === 'function');
        await act(async () => { browse.props.onPress(); });
        await settle(renderer);
        const sticky = renderer.root.findAllByType('KeyboardStickyView' as any);
        expect(sticky).toHaveLength(1);
        expect(sticky[0].props.enabled).toBe(true);
        expect(byTestID(renderer, 'streamline-folder-browser')).toHaveLength(0);
        act(() => renderer.unmount());
    });

    it('keeps native tablets on the full form', async () => {
        mocks.dimensions = { width: 1024, height: 1366 };
        const renderer = await renderScreen();
        await settle(renderer);
        expect(byTestID(renderer, 'streamline-sections')).toHaveLength(0);
        act(() => renderer.unmount());
    });

    it('keeps the iOS app on a Mac on the full form in a small window, which the device rule calls a phone', async () => {
        // This file's device rule calls a window under 700 px wide a phone.
        mocks.mac = true;
        mocks.dimensions = { width: 640, height: 900 };
        const renderer = await renderScreen();
        await settle(renderer);
        expect(byTestID(renderer, 'streamline-sections')).toHaveLength(0);
        expect(byTestID(renderer, 'new-session-mode')).toHaveLength(0);
        expect(renderer.root.findAll((node: any) => node.props?.accessibilityLabel === 'sessionInfo.path').length).toBeGreaterThan(0);
        act(() => renderer.unmount());
    });
});

describe('Streamline New Session review fixes', () => {
    beforeEach(() => {
        const machine = createClaudeMachine();
        mocks.renderMachines = [machine];
        mocks.liveMachines = { [machine.id]: machine };
        mocks.newSessionMode = 'streamline';
        mocks.dimensions = { width: 1440, height: 900 };
        mocks.draft = createLiveDraft({ agentType: 'claude', selectedPath: '/Users/dev/repo' });
        mocks.streamlineLocations = [
            { machineId: 'machine-1', path: '/Users/dev/repo', name: 'repo', machineName: 'studio', online: true },
            { machineId: 'machine-1', path: '/Users/dev/notes', name: 'notes', machineName: 'studio', online: true },
        ];
    });

    const sendButton = (renderer: ReturnType<typeof create>) => renderer.root.findAllByType('Pressable' as any)
        .find((item: any) => item.props.accessibilityLabel === 'happyHerd.composer.send');
    const folderCard = (renderer: ReturnType<typeof create>, name: string) => renderer.root
        .find((node: any) => node.props?.testID === `streamline-folder-machine-1-${name}`);

    it('waits for the folder check before sending when it decides the worktree', async () => {
        mocks.githubStatus = 'github';
        mocks.githubLoading = true;
        const renderer = await renderScreen();
        await settle(renderer);
        expect(sendButton(renderer)?.props.disabled).toBe(true);
        mocks.githubLoading = false;
        await settle(renderer);
        await pressSend(renderer);
        expect(mocks.createWorktree).toHaveBeenCalledTimes(1);
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(1);
        act(() => renderer.unmount());
    });

    it('keeps the Streamline effort when Agent Defaults had selected another model', async () => {
        const efforts = (codes: string[]) => codes.map((code) => ({ code, value: code }));
        const machine = createDshMachine();
        (machine.metadata.agentCapabilities.dsh as any).models = [
            { code: 'deepseek-v4-pro', value: 'DeepSeek V4 Pro', isDefault: true, effortLevels: efforts(['low']) },
            { code: 'deepseek-v4-flash', value: 'DeepSeek V4 Flash', effortLevels: efforts(['low', 'medium', 'high']) },
        ];
        mocks.renderMachines = [machine];
        mocks.liveMachines = { [machine.id]: machine };
        mocks.overrides = { dsh: { modelMode: 'deepseek-v4-pro', effortLevel: 'low' } };
        mocks.draft = createLiveDraft({ agentType: 'dsh', selectedPath: '/Users/dev/repo' });
        const renderer = await renderScreen();
        await settle(renderer);
        await settle(renderer);
        expect(mocks.draft.modelMode).toBe('deepseek-v4-flash');
        expect(mocks.draft.effortLevel).toBe('medium');
        act(() => renderer.unmount());
    });

    it('applies the defaults again after a detour through Advanced', async () => {
        const renderer = await renderScreen();
        await settle(renderer);
        expect(mocks.draft.modelMode).toBe('claude-opus-5-5');
        const mode = () => renderer.root.find((node: any) => node.props?.testID === 'new-session-mode');
        await act(async () => { mode().props.onChange('advanced'); });
        // Switching agent away and back clears the launch fields, as the real store does.
        await act(async () => { mocks.draft.setAgentType('codex'); mocks.draft.setAgentType('claude'); });
        await settle(renderer);
        expect(mocks.draft.modelMode).toBeNull();
        await act(async () => { mode().props.onChange('streamline'); });
        await settle(renderer);
        expect(mocks.draft.modelMode).toBe('claude-opus-5-5');
        act(() => renderer.unmount());
    });

    it('lets a worktree chip edit hold for its folder only', async () => {
        mocks.githubStatusByPath = { '/Users/dev/repo': 'github', '/Users/dev/notes': 'none' };
        const renderer = await renderScreen();
        await settle(renderer);
        expect(summaryText(renderer)).toContain('newSession.streamline.worktreeOn');
        // Choose no worktree on the chip for the GitHub folder.
        const chip = renderer.root.find((node: any) => node.props?.testID === 'streamline-chip-worktree');
        await act(async () => { chip.props.onPress(); });
        await settle(renderer);
        const none = renderer.root.find((node: any) => node.props?.testID === 'streamline-chip-picker')
            .findAll((node: any) => node.props?.accessibilityLabel === 'uiCopy.noWorktree' && typeof node.props?.onPress === 'function')[0];
        await act(async () => { none.props.onPress(); });
        await settle(renderer);
        expect(summaryText(renderer)).toContain('newSession.streamline.worktreeOff');
        // Visit the plain folder and come back: the GitHub rule applies again.
        await act(async () => { folderCard(renderer, 'notes').props.onPress(); });
        await settle(renderer);
        await act(async () => { folderCard(renderer, 'repo').props.onPress(); });
        await settle(renderer);
        expect(summaryText(renderer)).toContain('newSession.streamline.worktreeOn');
        act(() => renderer.unmount());
    });

    it('never attributes one machine\'s Commander workspaces to another', async () => {
        const second = { ...createClaudeMachine(), id: 'machine-2' };
        mocks.renderMachines = [createClaudeMachine(), second];
        mocks.liveMachines = Object.fromEntries(mocks.renderMachines.map((machine: any) => [machine.id, machine]));
        mocks.machineListCommanders.mockImplementation((machineId: string) => machineId === 'machine-1'
            ? Promise.resolve({ commanders: [{ id: 'athena', name: 'Athena', workspace: '/Users/dev/athena', commanderPath: '/c', agentContextPath: '/c/ctx' }] })
            : new Promise(() => {}));
        mocks.streamlineLocations = [
            ...mocks.streamlineLocations,
            { machineId: 'machine-2', path: '/Users/dev/other', name: 'other', machineName: 'second', online: true },
        ];
        const renderer = await renderScreen();
        await settle(renderer);
        expect(mocks.lastCommanderWorkspaces).toEqual([{ machineId: 'machine-1', path: '/Users/dev/athena' }]);
        const other = renderer.root.find((node: any) => node.props?.testID === 'streamline-folder-machine-2-other');
        await act(async () => { other.props.onPress(); });
        await settle(renderer);
        expect(mocks.draft.selectedMachineId).toBe('machine-2');
        // machine-2's Commanders are still loading, so machine-1's workspace is not offered for it.
        expect(mocks.lastCommanderWorkspaces).toEqual([]);
        act(() => renderer.unmount());
    });

    it('keeps model and effort chips on a phone', async () => {
        mocks.dimensions = { width: 390, height: 844 };
        const renderer = await renderScreen();
        await settle(renderer);
        for (const key of ['agent', 'model', 'effort', 'permission']) {
            expect(renderer.root.findAll((node: any) => node.props?.testID === `streamline-chip-${key}`).length).toBeGreaterThan(0);
        }
        act(() => renderer.unmount());
    });

    it('launches with the Streamline settings the user saved', async () => {
        // Claude omits 'default' at spawn, so the saved choice is a non-default mode.
        mocks.streamlineAgentDefaults = { claude: { modelMode: 'claude-opus-5', effortLevel: 'high', permissionMode: 'bypassPermissions' } };
        mocks.githubStatus = 'none';
        const renderer = await renderScreen();
        await settle(renderer);
        await pressSend(renderer);
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'claude',
            modelMode: 'claude-opus-5',
            effortLevel: 'high',
            permissionMode: 'bypassPermissions',
        }));
        act(() => renderer.unmount());
    });

    it('starts on the default agent chosen in Streamline settings', async () => {
        const machine: any = createClaudeMachine();
        machine.metadata.cliAvailability = { claude: true, codex: true };
        machine.metadata.agentCapabilities.codex = {
            detectedAt: 1,
            sources: { models: 'provider', effortLevels: 'provider', permissionModes: 'provider' },
            models: [{ code: 'gpt-6-astra', value: 'gpt-6-astra', isDefault: true }],
            effortLevels: [{ code: 'high', value: 'high' }, { code: 'xhigh', value: 'xhigh', isDefault: true }],
            permissionModes: [{ code: 'default', value: 'default', isDefault: true }, { code: 'yolo', value: 'yolo' }],
        };
        mocks.renderMachines = [machine];
        mocks.liveMachines = { [machine.id]: machine };
        mocks.streamlineAgent = 'codex';
        mocks.githubStatus = 'none';
        const renderer = await renderScreen();
        await settle(renderer);
        expect(mocks.draft.agentType).toBe('codex');
        expect(mocks.draft.modelMode).toBe('gpt-6-astra');
        expect(mocks.draft.permissionMode).toBe('default');
        await pressSend(renderer);
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'codex',
            modelMode: 'gpt-6-astra',
            effortLevel: 'xhigh',
            permissionMode: 'default',
        }));
        act(() => renderer.unmount());
    });
});

describe('Streamline picker anchor on native phones', () => {
    beforeEach(() => {
        const machine = createClaudeMachine();
        mocks.renderMachines = [machine];
        mocks.liveMachines = { [machine.id]: machine };
        mocks.newSessionMode = 'streamline';
        mocks.platform = 'ios';
        mocks.dimensions = { width: 390, height: 844 };
        mocks.draft = createLiveDraft({ agentType: 'claude', selectedPath: '/Users/dev/repo' });
        mocks.streamlineLocations = [{ machineId: 'machine-1', path: '/Users/dev/repo', name: 'repo', machineName: 'studio', online: true }];
    });
    // The platform reports a layout to each view that listens for one.
    const fireLayout = (node: any, height: number) => act(() => {
        node.props.onLayout?.({ nativeEvent: { layout: { x: 0, y: 0, width: 366, height } } });
    });

    it('opens the folder picker above the whole pinned composer, its summary included', async () => {
        const renderer = await renderScreen();
        await settle(renderer);
        const composer = renderer.root.findAll((node: any) => node.props?.testID === 'streamline-composer')[0];
        expect(composer.findAll((node: any) => node.props?.testID === 'streamline-summary').length).toBeGreaterThan(0);
        // The summary, its margin and the composer's gap add 56 px below the input surface.
        const surfaceHeight = 120;
        const composerHeight = surfaceHeight + 56;
        fireLayout(composer.findAllByType('MobileGlassSurface' as any)[0], surfaceHeight);
        fireLayout(composer, composerHeight);

        const browse = renderer.root.find((node: any) => node.props?.testID === 'streamline-choose-folder' && typeof node.props?.onPress === 'function');
        await act(async () => { browse.props.onPress(); });
        await settle(renderer);
        const sticky = () => renderer.root.findAllByType('KeyboardStickyView' as any)[0];
        const pickerHeight = 240;
        fireLayout(sticky().findAllByType('MobileGlassSurface' as any)[0], pickerHeight);

        const safeAreaBottom = 0; // the safe-area mock's inset
        const spacer = Math.max(12, safeAreaBottom); // the composer's bottom spacer
        const gap = 10; // the page's space between a picker and the composer
        const top = flattenStyle(sticky().props.style).top as number;
        expect(top + pickerHeight + gap).toBeLessThanOrEqual(mocks.dimensions.height - spacer - composerHeight);
        act(() => renderer.unmount());
    });
});
