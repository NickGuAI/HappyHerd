import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentPreview } from '@/sync/attachmentTypes';

const testState = vi.hoisted(() => ({
    initialImages: [] as AttachmentPreview[],
    pickedImages: [] as AttachmentPreview[],
    onTranscript: null as null | ((text: string) => void),
    toggleVoice: vi.fn(),
    retryVoice: vi.fn(),
    voiceAvailable: true,
    dictationPhase: 'idle' as 'idle' | 'recording' | 'transcribing' | 'error',
    canRetry: false,
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Pressable: host('Pressable'),
        View: host('View'),
    };
});

vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return {
        Ionicons: (props: any) => ReactModule.createElement('Ionicons', props),
        Octicons: (props: any) => ReactModule.createElement('Octicons', props),
    };
});

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 24, left: 0 }),
}));

vi.mock('react-native-unistyles', () => {
    const theme = {
        colors: {
            surface: '#fff',
            surfaceHigh: '#eee',
            divider: '#ddd',
            text: '#111',
            textSecondary: '#777',
            textDestructive: '#c00',
            input: { background: '#f5f5f5' },
            button: { primary: { background: '#111', tint: '#fff' } },
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

vi.mock('./AgentInputAttachmentStrip', async () => {
    const ReactModule = await import('react');
    return {
        AgentInputAttachmentStrip: (props: { images: AttachmentPreview[] }) => (
            props.images.length > 0
                ? ReactModule.createElement('AttachmentStrip', props)
                : null
        ),
    };
});

vi.mock('./MultiTextInput', async () => {
    const ReactModule = await import('react');
    return {
        MultiTextInput: (props: any) => ReactModule.createElement('MultiTextInput', props),
    };
});

vi.mock('./StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});

vi.mock('@/hooks/useImagePicker', async () => {
    const ReactModule = await import('react');
    return {
        useImagePicker: () => {
            const [images, setImages] = ReactModule.useState(testState.initialImages);
            return {
                selectedImages: images,
                pickImages: () => setImages((current) => [...current, ...testState.pickedImages]),
                removeImage: (id: string) => setImages((current) => current.filter((image) => image.id !== id)),
                clearImages: () => setImages([]),
                addImages: (next: AttachmentPreview[]) => setImages((current) => [...current, ...next]),
            };
        },
    };
});

vi.mock('@/hooks/useVoiceInputAvailability', () => ({
    useVoiceInputAvailability: () => ({ available: testState.voiceAvailable }),
}));

vi.mock('@/hooks/useVoiceDictation', () => ({
    useVoiceDictation: (onTranscript: (text: string) => void) => {
        testState.onTranscript = onTranscript;
        return {
            phase: testState.dictationPhase,
            error: testState.dictationPhase === 'error' ? 'transcription failed' : null,
            toggle: testState.toggleVoice,
            cancel: vi.fn(),
            retry: testState.retryVoice,
            canRetry: testState.canRetry,
        };
    },
}));

vi.mock('@/sync/sync', () => ({
    sync: { sendMessage: vi.fn() },
}));

vi.mock('@/text', () => ({ t: (key: string) => key }));

import { WorkspaceFeedbackComposer, type WorkspaceFeedbackComposerProps } from './WorkspaceFeedbackComposer';

const image: AttachmentPreview = {
    id: 'image-1',
    uri: 'file:///feedback.png',
    width: 800,
    height: 600,
    mimeType: 'image/png',
    size: 1024,
    name: 'feedback.png',
};

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
    testState.initialImages = [];
    testState.pickedImages = [];
    testState.onTranscript = null;
    testState.toggleVoice.mockReset();
    testState.retryVoice.mockReset();
    testState.voiceAvailable = true;
    testState.dictationPhase = 'idle';
    testState.canRetry = false;
});

async function renderComposer(
    overrides: Partial<WorkspaceFeedbackComposerProps> = {},
): Promise<ReactTestRenderer> {
    const props: WorkspaceFeedbackComposerProps = {
        originSessionId: 'origin-session',
        machineId: 'machine-123',
        machineLabel: 'Studio Mac',
        absolutePath: '/Users/nick/project/docs/plan.md',
        onSent: vi.fn(),
        sendMessage: vi.fn().mockResolvedValue({ localId: 'text-local-id' }),
        ...overrides,
    };
    let renderer!: ReactTestRenderer;
    await act(async () => {
        renderer = create(React.createElement(WorkspaceFeedbackComposer, props));
        await Promise.resolve();
    });
    return renderer;
}

function button(renderer: ReactTestRenderer, accessibilityLabel: string) {
    return renderer.root.findAllByType('Pressable' as any).find((node: any) => (
        node.props.accessibilityLabel === accessibilityLabel
    ));
}

describe('WorkspaceFeedbackComposer', () => {
    it('uses the one primary control for voice while empty and makes the transcript editable', async () => {
        const sendMessage = vi.fn();
        const renderer = await renderComposer({ sendMessage });

        expect(button(renderer, 'happyHerd.composer.startVoice')).toBeDefined();
        act(() => button(renderer, 'happyHerd.composer.startVoice')!.props.onPress());
        expect(testState.toggleVoice).toHaveBeenCalledOnce();

        act(() => testState.onTranscript?.('Move the image below the heading.'));

        expect(renderer.root.findByType('MultiTextInput' as any).props.value)
            .toBe('Move the image below the heading.');
        expect(button(renderer, 'happyHerd.composer.send')).toBeDefined();
        expect(sendMessage).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('uses the same primary control to retry a failed transcription', async () => {
        testState.dictationPhase = 'error';
        testState.canRetry = true;
        const renderer = await renderComposer();

        const retry = button(renderer, 'happyHerd.composer.retryVoice');
        expect(retry).toBeDefined();
        act(() => retry!.props.onPress());
        expect(testState.retryVoice).toHaveBeenCalledOnce();
        expect(testState.toggleVoice).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('keeps Finish on the primary control while recording even when text and an image exist', async () => {
        testState.dictationPhase = 'recording';
        testState.initialImages = [image];
        const sendMessage = vi.fn();
        const renderer = await renderComposer({ sendMessage });

        act(() => renderer.root.findByType('MultiTextInput' as any).props.onChangeText('Typed while recording'));

        const finish = button(renderer, 'happyHerd.composer.finishVoice');
        expect(finish).toBeDefined();
        expect(button(renderer, 'happyHerd.composer.send')).toBeUndefined();
        act(() => finish!.props.onPress());
        expect(testState.toggleVoice).toHaveBeenCalledOnce();
        expect(sendMessage).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('sends an image draft instead of retrying a failed transcription', async () => {
        testState.dictationPhase = 'error';
        testState.canRetry = true;
        testState.initialImages = [image];
        const sendMessage = vi.fn().mockResolvedValue({ localId: 'feedback-local-id' });
        const renderer = await renderComposer({ sendMessage });

        expect(button(renderer, 'happyHerd.composer.retryVoice')).toBeUndefined();
        const send = button(renderer, 'happyHerd.composer.send');
        expect(send).toBeDefined();
        await act(async () => {
            send!.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(testState.retryVoice).not.toHaveBeenCalled();
        expect(sendMessage).toHaveBeenCalledOnce();
        act(() => renderer.unmount());
    });

    it('disables image picking while a transcription is in flight', async () => {
        testState.dictationPhase = 'transcribing';
        const renderer = await renderComposer();

        expect(button(renderer, 'happyHerd.composer.addPhoto')!.props.disabled).toBe(true);
        act(() => renderer.unmount());
    });

    it('sends text and images strictly, clears only after acceptance, and includes mobile safe area', async () => {
        testState.pickedImages = [image];
        const sendMessage = vi.fn().mockResolvedValue({ localId: 'feedback-local-id' });
        const onSent = vi.fn();
        const renderer = await renderComposer({ sendMessage, onSent });

        act(() => button(renderer, 'happyHerd.composer.addPhoto')!.props.onPress());
        act(() => renderer.root.findByType('MultiTextInput' as any).props.onChangeText('Please tighten this section.'));

        await act(async () => {
            button(renderer, 'happyHerd.composer.send')!.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(sendMessage).toHaveBeenCalledWith(
            'origin-session',
            expect.stringContaining('Please tighten this section.'),
            expect.objectContaining({
                attachments: [image],
                requireAllAttachments: true,
                displayText: expect.stringContaining('Studio Mac\n/Users/nick/project/docs/plan.md'),
            }),
        );
        expect(onSent).toHaveBeenCalledWith({ localId: 'feedback-local-id' });
        expect(renderer.root.findByType('MultiTextInput' as any).props.value).toBe('');
        expect(renderer.root.findAllByType('AttachmentStrip' as any)).toHaveLength(0);
        const rootStyle = renderer.root.findAllByType('View' as any)[0].props.style;
        expect(rootStyle).toEqual(expect.arrayContaining([
            expect.objectContaining({ paddingBottom: 32 }),
        ]));
        act(() => renderer.unmount());
    });

    it('keeps an image-only draft in the Viewer when strict sending fails', async () => {
        testState.pickedImages = [image];
        const sendMessage = vi.fn().mockRejectedValue(new Error('upload failed'));
        const onSent = vi.fn();
        const renderer = await renderComposer({ sendMessage, onSent });

        act(() => button(renderer, 'happyHerd.composer.addPhoto')!.props.onPress());
        await act(async () => {
            button(renderer, 'happyHerd.composer.send')!.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(renderer.root.findByType('AttachmentStrip' as any).props.images).toEqual([image]);
        expect(renderer.root.findByType('MultiTextInput' as any).props.value).toBe('');
        expect(renderer.root.findAllByType('Text' as any).some((node: any) => (
            node.props.children === 'happyHerd.composer.sendFailedBody'
        ))).toBe(true);
        expect(onSent).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });
});
