import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
    width: 1200,
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Keyboard: {
            addListener: () => ({ remove: vi.fn() }),
            dismiss: vi.fn(),
            isVisible: () => false,
        },
        Platform: {
            OS: 'web',
            select: (values: Record<string, unknown>) => values.web ?? values.default,
        },
        Pressable: host('Pressable'),
        Text: host('Text'),
        TouchableWithoutFeedback: host('TouchableWithoutFeedback'),
        View: host('View'),
        useWindowDimensions: () => ({ width: testState.width, height: 900 }),
    };
});

vi.mock('react-native-svg', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return { default: host('Svg'), Circle: host('Circle') };
});

vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return {
        Ionicons: (props: any) => ReactModule.createElement('Ionicons', props),
        Octicons: (props: any) => ReactModule.createElement('Octicons', props),
    };
});

vi.mock('react-native-unistyles', async () => {
    const { lightTheme } = await import('@/theme');
    return {
        StyleSheet: {
            absoluteFillObject: {},
            hairlineWidth: 1,
            create: (factory: any) => typeof factory === 'function' ? factory(lightTheme, {}) : factory,
        },
        useUnistyles: () => ({ theme: lightTheme }),
    };
});

vi.mock('./AgentInputAttachmentStrip', async () => {
    const ReactModule = await import('react');
    return { AgentInputAttachmentStrip: (props: any) => ReactModule.createElement('AgentInputAttachmentStrip', props) };
});
vi.mock('./WorkspaceContextStrip', async () => {
    const ReactModule = await import('react');
    return { WorkspaceContextStrip: (props: any) => ReactModule.createElement('WorkspaceContextStrip', props) };
});
vi.mock('./CompactWorkspaceContextButton', async () => {
    const ReactModule = await import('react');
    return { CompactWorkspaceContextButton: (props: any) => ReactModule.createElement('CompactWorkspaceContextButton', props) };
});
vi.mock('@/components/AttachmentInputButton', async () => {
    const ReactModule = await import('react');
    return { AttachmentInputButton: (props: any) => ReactModule.createElement('AttachmentInputButton', props) };
});
vi.mock('@/components/AttachmentInputMenu', async () => {
    const ReactModule = await import('react');
    return { AttachmentInputMenu: (props: any) => ReactModule.createElement('AttachmentInputMenu', props) };
});
vi.mock('./MultiTextInput', async () => {
    const ReactModule = await import('react');
    const MultiTextInput = ReactModule.forwardRef((props: any, ref: any) => {
        ReactModule.useImperativeHandle(ref, () => ({
            focus: vi.fn(),
            getText: () => props.defaultValue ?? '',
            setTextAndSelection: vi.fn(),
        }));
        return ReactModule.createElement('MultiTextInput', props);
    });
    return { MultiTextInput };
});
vi.mock('./layout', () => ({ layout: { maxWidth: 840 } }));
vi.mock('@/constants/Typography', () => ({
    Typography: { default: () => ({}), mono: () => ({}) },
}));
vi.mock('./haptics', () => ({ hapticsError: vi.fn(), hapticsLight: vi.fn() }));
vi.mock('./Shaker', async () => {
    const ReactModule = await import('react');
    return {
        Shaker: ReactModule.forwardRef((props: any, ref: any) => {
            ReactModule.useImperativeHandle(ref, () => ({ shake: vi.fn() }));
            return ReactModule.createElement('Shaker', props, props.children);
        }),
    };
});
vi.mock('./StatusDot', async () => {
    const ReactModule = await import('react');
    return { StatusDot: (props: any) => ReactModule.createElement('StatusDot', props) };
});
vi.mock('./autocomplete/useActiveWord', () => ({ useActiveWord: () => null }));
vi.mock('./autocomplete/useActiveSuggestions', () => ({
    useActiveSuggestions: () => [[], -1, vi.fn(), vi.fn()],
}));
vi.mock('./AgentInputAutocomplete', async () => {
    const ReactModule = await import('react');
    return { AgentInputAutocomplete: (props: any) => ReactModule.createElement('AgentInputAutocomplete', props) };
});
vi.mock('./FloatingOverlay', async () => {
    const ReactModule = await import('react');
    return { FloatingOverlay: (props: any) => ReactModule.createElement('FloatingOverlay', props, props.children) };
});
vi.mock('./GitStatusBadge', async () => {
    const ReactModule = await import('react');
    return {
        GitStatusBadge: (props: any) => ReactModule.createElement('GitStatusBadge', props),
        useHasMeaningfulGitStatus: () => false,
    };
});
vi.mock('@/sync/storage', () => ({ useSetting: () => undefined }));
vi.mock('@/sync/modeHacks', () => ({ hackMode: (mode: unknown) => mode, hackModes: (modes: unknown) => modes }));
vi.mock('@/utils/permissionModeLabels', () => ({
    getPermissionModeMenuLabel: (mode: { name: string }) => mode.name,
    getPermissionModeShortLabel: (mode: { name: string } | null) => mode?.name?.split(/\s+/)[0] ?? null,
}));
vi.mock('@/utils/sessionStatusBar', () => ({
    formatUsageLimitResetTime: () => '',
    getUsageLimitDisplayPercentage: () => 0,
    getUsageLimitRows: () => [],
}));
vi.mock('@/utils/rigGitLineChanges', () => ({ compactCount: (value: number) => String(value) }));
vi.mock('@/utils/platform', () => ({ isRunningOnMac: () => false }));
vi.mock('./MobileGlass', async () => {
    const ReactModule = await import('react');
    return { MobileGlassSurface: (props: any) => ReactModule.createElement('MobileGlassSurface', props, props.children) };
});
vi.mock('./AnimatedOverlay', async () => {
    const ReactModule = await import('react');
    return {
        AnimatedClickAwayBackdrop: (props: any) => ReactModule.createElement('AnimatedClickAwayBackdrop', props, props.children),
        AnimatedFade: ({ children, visible }: any) => visible ? children : null,
    };
});
vi.mock('./BubblePressable', async () => {
    const ReactModule = await import('react');
    return {
        BubblePressable: (props: any) => ReactModule.createElement('Pressable', props, props.children),
    };
});
vi.mock('./NativeSettingsMenu', async () => {
    const ReactModule = await import('react');
    return { NativeSettingsMenu: (props: any) => ReactModule.createElement('NativeSettingsMenu', props, props.children) };
});
vi.mock('./ProviderIcon', async () => {
    const ReactModule = await import('react');
    return { ProviderIcon: (props: any) => ReactModule.createElement('ProviderIcon', props) };
});
vi.mock('@/sync/rig', () => ({ isRigMetadata: () => false }));
vi.mock('./glassInteractionPolicy', () => ({ shouldUseExpoNativeSettingsMenu: () => false }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { AgentInput } from './AgentInput';

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
    testState.width = 1200;
});

function pressable(renderer: ReactTestRenderer, label: string) {
    return renderer.root.findAllByType('Pressable' as any).find((node: any) => (
        node.props.accessibilityLabel === label
    ));
}

function renderAgentInput(options: {
    width: number;
    sessionId: string;
    phase: 'idle' | 'recording' | 'transcribing' | 'error';
}) {
    testState.width = options.width;
    const onSend = vi.fn();
    const onMicPress = vi.fn();
    const onDictationCancel = vi.fn();
    const onDictationRetry = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(React.createElement(AgentInput, {
            autocompletePrefixes: [],
            autocompleteSuggestions: async () => [],
            dictationPhase: options.phase,
            initialValue: 'Editable draft',
            onDictationCancel,
            onDictationRetry: options.phase === 'error' ? onDictationRetry : undefined,
            onMicPress,
            onSend,
            placeholder: 'Type a message',
            sessionId: options.sessionId,
        }));
    });
    return { onDictationCancel, onDictationRetry, onMicPress, onSend, renderer };
}

function renderMobileActionInput(overrides: Record<string, unknown> = {}, width = 390) {
    testState.width = width;
    const callbacks = {
        onAbort: vi.fn(async () => {}),
        onMicPress: vi.fn(),
        onOpenChanges: vi.fn(),
        onOpenWorkspace: vi.fn(),
        onPermissionModeChange: vi.fn(),
        onModelModeChange: vi.fn(),
        onEffortLevelChange: vi.fn(),
        onPickImages: vi.fn(),
        onPickDeviceFiles: vi.fn(),
        onQueueMessage: vi.fn(),
        onSend: vi.fn(),
    };
    const props = {
        autocompletePrefixes: [],
        autocompleteSuggestions: async () => [],
        availableEffortLevels: [
            { key: 'high', name: 'High effort', description: 'Reason more deeply' },
        ],
        availableModels: [
            { key: 'model-1', name: 'Model One', description: 'Primary model' },
        ],
        availableModes: [
            { key: 'default', name: 'Default permission', description: 'Use the session default' },
            { key: 'read-only', name: 'Read only', description: 'Do not edit files' },
        ],
        dictationPhase: 'idle',
        effortLevel: { key: 'high', name: 'High effort' },
        initialValue: 'Editable draft',
        webWorkspaceActions: {
            onOpenChanges: callbacks.onOpenChanges,
            onOpenWorkspace: callbacks.onOpenWorkspace,
        },
        modelMode: { key: 'model-1', name: 'Model One' },
        onAbort: callbacks.onAbort,
        onEffortLevelChange: callbacks.onEffortLevelChange,
        onMicPress: callbacks.onMicPress,
        onModelModeChange: callbacks.onModelModeChange,
        onPermissionModeChange: callbacks.onPermissionModeChange,
        onPickDeviceFiles: callbacks.onPickDeviceFiles,
        onPickImages: callbacks.onPickImages,
        onQueueMessage: callbacks.onQueueMessage,
        onSend: callbacks.onSend,
        permissionMode: { key: 'default', name: 'Default permission' },
        placeholder: 'Type a message',
        sessionId: 'mobile-session',
        showWebActionMenu: true,
        showAbortButton: true,
        ...overrides,
    };
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(React.createElement(AgentInput, props as any));
    });
    return { callbacks, renderer };
}

function openMobileActionMenu(renderer: ReactTestRenderer) {
    const trigger = renderer.root.findByProps({ testID: 'mobile-composer-actions-trigger' });
    act(() => trigger.props.onPress());
}

function mobileMenuLabels(renderer: ReactTestRenderer): string[] {
    return renderer.root.findAllByType('Pressable' as any)
        .filter((node: any) => node.props.accessibilityRole === 'menuitem')
        .map((node: any) => node.props.accessibilityLabel);
}

function pressMobileMenuAction(renderer: ReactTestRenderer, key: string) {
    const action = renderer.root.findByProps({ testID: `mobile-composer-action-${key}` });
    act(() => action.props.onPress());
}

function renderedText(renderer: ReactTestRenderer): string[] {
    return renderer.root.findAllByType('Text' as any).flatMap((node: any) => (
        node.children.filter((child: unknown): child is string => typeof child === 'string')
    ));
}

describe.each([
    { surface: 'Web Desktop Main Agent', width: 1200, sessionId: 'main-agent' },
    { surface: 'Web Mobile Side chat', width: 390, sessionId: 'side-chat' },
])('AgentInput configured dictation UI on $surface', ({ width, sessionId }) => {
    it.each([
        { phase: 'idle' as const, actionLabel: 'happyHerd.composer.startVoice', icon: 'mic' },
        { phase: 'recording' as const, actionLabel: 'happyHerd.composer.finishVoice', icon: 'stop' },
        { phase: 'error' as const, actionLabel: 'happyHerd.composer.retryVoice', icon: 'refresh' },
    ])('renders the dedicated $phase action beside a send-only button', ({ phase, actionLabel, icon }) => {
        const controls = renderAgentInput({ width, sessionId, phase });
        const dictation = pressable(controls.renderer, actionLabel);
        const send = pressable(controls.renderer, 'happyHerd.composer.send');

        expect(dictation?.props.testID).toBe('composer-dictation-button');
        expect(dictation?.findAllByType('Ionicons' as any).some((node: any) => node.props.name === icon)).toBe(true);
        expect(send).toBeDefined();
        expect(send?.findAllByType('Octicons' as any).some((node: any) => node.props.name === 'arrow-up')).toBe(true);

        act(() => dictation?.props.onPress());
        if (phase === 'error') {
            expect(controls.onDictationRetry).toHaveBeenCalledOnce();
            expect(controls.onMicPress).not.toHaveBeenCalled();
        } else {
            expect(controls.onMicPress).toHaveBeenCalledOnce();
            expect(controls.onDictationRetry).not.toHaveBeenCalled();
        }

        act(() => send?.props.onPress());
        expect(controls.onSend).toHaveBeenCalledOnce();
        expect(controls.onMicPress).toHaveBeenCalledTimes(phase === 'error' ? 0 : 1);
        expect(controls.onDictationRetry).toHaveBeenCalledTimes(phase === 'error' ? 1 : 0);

        if (phase === 'recording') {
            const cancel = pressable(controls.renderer, 'happyHerd.composer.cancelVoice');
            expect(cancel?.props.testID).toBe('composer-dictation-cancel');
            act(() => cancel?.props.onPress());
            expect(controls.onDictationCancel).toHaveBeenCalledOnce();
        }
        act(() => controls.renderer.unmount());
    });

    it('renders transcription progress beside the still-usable send button', () => {
        const controls = renderAgentInput({ width, sessionId, phase: 'transcribing' });
        const progress = pressable(controls.renderer, 'happyHerd.composer.transcribingVoice');
        const send = pressable(controls.renderer, 'happyHerd.composer.send');

        expect(progress?.props.testID).toBe('composer-dictation-button');
        expect(progress?.props.accessibilityState).toEqual({ disabled: true, busy: true });
        expect(progress?.findAllByType('ActivityIndicator' as any)).toHaveLength(1);
        expect(send).toBeDefined();
        expect(send?.findAllByType('Octicons' as any).some((node: any) => node.props.name === 'arrow-up')).toBe(true);

        act(() => send?.props.onPress());
        expect(controls.onSend).toHaveBeenCalledOnce();
        expect(controls.onMicPress).not.toHaveBeenCalled();
        act(() => controls.renderer.unmount());
    });
});

describe('AgentInput Web action menu', () => {
    it.each([
        ['Web Desktop', 1200],
        ['Web Mobile', 390],
    ] as const)('shows an immutable launch receipt chip on %s', (_surface, width) => {
        const { callbacks, renderer } = renderMobileActionInput({
            permissionMode: { key: 'danger-full-access', name: 'danger-full-access' },
            permissionModeReadOnly: true,
            onPermissionModeChange: undefined,
        }, width);

        const chip = renderer.root.findByProps({ testID: 'composer-permission-mode-readonly' });
        expect(chip.props).toMatchObject({
            accessibilityLabel: 'agentInput.permissionMode.title: danger-full-access',
            accessibilityRole: 'text',
        });
        expect(renderedText(renderer)).toContain('danger-full-access');
        expect(renderer.root.findAllByType('Pressable' as any).some((node: any) => (
            node.props.accessibilityLabel === 'agentInput.permissionMode.title'
        ))).toBe(false);
        expect(callbacks.onPermissionModeChange).not.toHaveBeenCalled();

        act(() => renderer.unmount());
    });

    it('groups only DSH Web Mobile attachments beneath one top-level entry', () => {
        const mobile = renderMobileActionInput({ splitWebAttachmentActions: true }, 390);
        openMobileActionMenu(mobile.renderer);
        expect(mobileMenuLabels(mobile.renderer)).toEqual([
            'files.changes',
            'workspace.title',
            'settings.title',
            'happyHerd.composer.queueMessage',
            'happyHerd.composer.attachments',
        ]);
        expect(mobile.renderer.root.findByProps({ testID: 'mobile-composer-action-attachments' }).props.accessibilityState)
            .toMatchObject({ expanded: false });
        expect(mobile.renderer.root.findAllByProps({ testID: 'mobile-composer-action-photos' })).toHaveLength(0);
        expect(mobile.renderer.root.findAllByProps({ testID: 'mobile-composer-action-device-files' })).toHaveLength(0);
        pressMobileMenuAction(mobile.renderer, 'attachments');
        const chooser = mobile.renderer.root.findByType('AttachmentInputMenu' as any);
        expect(chooser.props).toMatchObject({
            visible: true,
            onPickPhotos: mobile.callbacks.onPickImages,
            onPickDeviceFiles: mobile.callbacks.onPickDeviceFiles,
        });
        expect(mobile.renderer.root.findAllByProps({ testID: 'mobile-composer-actions-menu' })).toHaveLength(0);
        act(() => chooser.props.onPickPhotos());
        act(() => chooser.props.onPickDeviceFiles());
        expect(mobile.callbacks.onPickImages).toHaveBeenCalledOnce();
        expect(mobile.callbacks.onPickDeviceFiles).toHaveBeenCalledOnce();
        act(() => mobile.renderer.unmount());

        const desktop = renderMobileActionInput({ splitWebAttachmentActions: true }, 1200);
        openMobileActionMenu(desktop.renderer);
        expect(mobileMenuLabels(desktop.renderer)).toEqual([
            'files.changes',
            'workspace.title',
            'settings.title',
            'happyHerd.composer.queueMessage',
            'happyHerd.composer.photos',
            'happyHerd.composer.deviceFiles',
        ]);
        expect(desktop.renderer.root.findAllByType('AttachmentInputMenu' as any)).toHaveLength(0);
        act(() => desktop.renderer.unmount());
    });

    it('follows the session mobile-action contract across the full narrow Web layout', () => {
        const { renderer } = renderMobileActionInput({}, 720);

        expect(renderer.root.findAllByType('Pressable' as any).filter((node: any) => (
            node.props.testID === 'mobile-composer-actions-trigger'
        ))).toHaveLength(1);
        expect(renderer.root.findAllByType('AttachmentInputButton' as any)).toHaveLength(0);

        act(() => renderer.unmount());
    });

    it('keeps the sole + menu visible and usable in zen mode', () => {
        const { renderer } = renderMobileActionInput({ zenMode: true });
        const trigger = renderer.root.findByProps({ testID: 'mobile-composer-actions-trigger' });

        expect(trigger.props.accessibilityState).toEqual({ expanded: false });
        openMobileActionMenu(renderer);
        expect(mobileMenuLabels(renderer)).toEqual(expect.arrayContaining([
            'files.changes',
            'workspace.title',
        ]));

        act(() => renderer.unmount());
    });

    it('keeps one + menu when workspace capabilities are unavailable', () => {
        const { renderer } = renderMobileActionInput({ webWorkspaceActions: undefined });

        expect(renderer.root.findByProps({ testID: 'mobile-composer-actions-trigger' })).toBeDefined();
        expect(renderer.root.findAllByType('AttachmentInputButton' as any)).toHaveLength(0);
        openMobileActionMenu(renderer);
        expect(mobileMenuLabels(renderer)).toEqual([
            'settings.title',
            'happyHerd.composer.queueMessage',
            'happyHerd.composer.attachments',
        ]);

        act(() => renderer.unmount());
    });

    it('keeps model and effort settings reachable when permission selection is locked', () => {
        const { renderer } = renderMobileActionInput({
            availableModes: [],
            webWorkspaceActions: undefined,
            onPermissionModeChange: undefined,
        });

        openMobileActionMenu(renderer);
        expect(mobileMenuLabels(renderer)).toContain('settings.title');
        pressMobileMenuAction(renderer, 'settings');
        expect(renderedText(renderer)).toEqual(expect.arrayContaining([
            'agentInput.model.title',
            'Model One',
            'agentInput.effort.title',
            'High effort',
        ]));
        expect(renderedText(renderer)).not.toContain('agentInput.permissionMode.title');

        act(() => renderer.unmount());
    });

    it.each([
        ['Web Desktop', 1200],
        ['Web Mobile', 390],
    ] as const)('replaces the standalone controls with one + on %s while keeping Mic and Send direct', (_surface, width) => {
        const { callbacks, renderer } = renderMobileActionInput({}, width);
        const trigger = renderer.root.findByProps({ testID: 'mobile-composer-actions-trigger' });

        expect(trigger.props).toMatchObject({
            accessibilityLabel: 'happyHerd.composer.moreActions',
            accessibilityRole: 'button',
            accessibilityState: { expanded: false },
        });
        expect(renderer.root.findAllByType('Pressable' as any).filter((node: any) => (
            node.props.testID === 'mobile-composer-actions-trigger'
        ))).toHaveLength(1);
        expect(renderer.root.findAllByType('Octicons' as any).filter((node: any) => node.props.name === 'plus')).toHaveLength(1);
        expect(renderer.root.findAllByType('Octicons' as any).filter((node: any) => node.props.name === 'gear')).toHaveLength(0);
        expect(renderer.root.findAllByType('Octicons' as any).filter((node: any) => node.props.name === 'stop')).toHaveLength(0);
        expect(renderer.root.findAllByType('AttachmentInputButton' as any)).toHaveLength(0);
        expect(pressable(renderer, 'happyHerd.composer.queueMessage')).toBeUndefined();

        const mic = pressable(renderer, 'happyHerd.composer.startVoice');
        const send = pressable(renderer, 'happyHerd.composer.send');
        expect(mic?.props.testID).toBe('composer-dictation-button');
        expect(send).toBeDefined();
        act(() => mic?.props.onPress());
        act(() => send?.props.onPress());
        expect(callbacks.onMicPress).toHaveBeenCalledOnce();
        expect(callbacks.onSend).toHaveBeenCalledOnce();

        openMobileActionMenu(renderer);
        expect(renderer.root.findByProps({ testID: 'mobile-composer-actions-menu' }).props.accessibilityRole).toBe('menu');
        expect(mobileMenuLabels(renderer)).toEqual([
            'files.changes',
            'workspace.title',
            'settings.title',
            'happyHerd.composer.queueMessage',
            'happyHerd.composer.attachments',
        ]);

        for (const [key, callback] of [
            ['changes', callbacks.onOpenChanges],
            ['workspace', callbacks.onOpenWorkspace],
            ['attachments', callbacks.onPickImages],
        ] as const) {
            pressMobileMenuAction(renderer, key);
            expect(callback).toHaveBeenCalledOnce();
            expect(renderer.root.findAllByProps({ testID: 'mobile-composer-actions-menu' })).toHaveLength(0);
            openMobileActionMenu(renderer);
        }
        expect(callbacks.onPickDeviceFiles).not.toHaveBeenCalled();
        expect(renderer.root.findAllByProps({ testID: 'mobile-composer-action-device-files' })).toHaveLength(0);

        pressMobileMenuAction(renderer, 'settings');
        expect(renderer.root.findAllByProps({ testID: 'mobile-composer-actions-menu' })).toHaveLength(0);
        expect(renderedText(renderer)).toEqual(expect.arrayContaining([
            'agentInput.permissionMode.title',
            'Default permission',
            'Read only',
            'agentInput.model.title',
            'Model One',
            'agentInput.effort.title',
            'High effort',
        ]));

        act(() => renderer.unmount());
    });

    it('shows Stop only while abort is the primary action', () => {
        const visible = renderMobileActionInput({ initialValue: '', showAbortButton: true });
        openMobileActionMenu(visible.renderer);
        expect(mobileMenuLabels(visible.renderer)).toContain('happyHerd.composer.stop');
        act(() => visible.renderer.unmount());

        const hidden = renderMobileActionInput({ showAbortButton: false });
        openMobileActionMenu(hidden.renderer);
        expect(mobileMenuLabels(hidden.renderer)).not.toContain('happyHerd.composer.stop');
        act(() => hidden.renderer.unmount());
    });

    it.each([
        { label: 'an empty composer', initialValue: '', isSendDisabled: false },
        { label: 'message sending disabled', initialValue: 'Queued draft', isSendDisabled: true },
    ])('disables Queue Msg for $label', ({ initialValue, isSendDisabled }) => {
        const { callbacks, renderer } = renderMobileActionInput({ initialValue, isSendDisabled });
        openMobileActionMenu(renderer);
        const queue = renderer.root.findByProps({ testID: 'mobile-composer-action-queue' });

        expect(queue.props.disabled).toBe(true);
        expect(queue.props.accessibilityState).toEqual({ disabled: true });
        act(() => queue.props.onPress());
        expect(callbacks.onQueueMessage).not.toHaveBeenCalled();

        act(() => renderer.unmount());
    });

    it('enables Queue Msg when the composer has content', () => {
        const { callbacks, renderer } = renderMobileActionInput({ initialValue: 'Queued draft' });
        openMobileActionMenu(renderer);
        const queue = renderer.root.findByProps({ testID: 'mobile-composer-action-queue' });

        expect(queue.props.disabled).not.toBe(true);
        expect(queue.props.accessibilityState.disabled).not.toBe(true);
        act(() => queue.props.onPress());
        expect(callbacks.onQueueMessage).toHaveBeenCalledOnce();
        expect(renderer.root.findAllByProps({ testID: 'mobile-composer-actions-menu' })).toHaveLength(0);

        act(() => renderer.unmount());
    });
});
