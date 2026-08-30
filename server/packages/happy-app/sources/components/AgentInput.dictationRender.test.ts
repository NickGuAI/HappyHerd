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
    getPermissionModeMenuLabel: () => '',
    getPermissionModeShortLabel: () => '',
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
