import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceFeedbackComment } from '@/sync/workspaceFeedback';
import type { InlineCommentAnchor } from './InlineCommentReview';

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return { Pressable: host('Pressable'), TextInput: host('TextInput'), View: host('View') };
});
vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/sync/sync', () => ({ sync: { sendMessage: mocks.sendMessage } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('react-native-unistyles', () => {
    const colors = new Proxy({ button: { primary: { background: '#00f', tint: '#fff' } } }, { get: (target, key) => Reflect.get(target, key) ?? '#000' });
    return {
        StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1 },
        useUnistyles: () => ({ theme: { colors } }),
    };
});

import { InlineCommentReview, InlineCommentThread } from './InlineCommentReview.web';

let selectAnchor: ((anchor: InlineCommentAnchor | null) => void) | null = null;

function Harness() {
    const [anchor, setAnchor] = React.useState<InlineCommentAnchor | null>({ line: 2 });
    const [comments, setComments] = React.useState<WorkspaceFeedbackComment[]>([]);
    selectAnchor = setAnchor;
    return React.createElement(InlineCommentReview, {
        originSessionId: 'session-one',
        reference: { machineId: 'machine-one', absolutePath: '/repo/src/a.ts' },
        activeAnchor: anchor,
        comments,
        onActiveAnchorChange: setAnchor,
        onCommentsChange: setComments,
    });
}

function button(renderer: any, label: string) {
    return renderer.root.findAllByType('Pressable' as any).find((candidate: any) => (
        candidate.findAllByType('Text' as any).some((text: any) => text.props.children === label)
    ));
}

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
        if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => mocks.sendMessage.mockReset().mockResolvedValue({ id: 'message-one' }));

describe('InlineCommentReview web', () => {
    it('pins multiple line comments and sends one structured chat message', async () => {
        let renderer: any;
        act(() => { renderer = create(React.createElement(Harness)); });

        act(() => renderer.root.findByType('TextInput' as any).props.onChangeText('First issue'));
        act(() => button(renderer, 'files.pinComment').props.onPress());
        act(() => selectAnchor?.({ line: 5, column: 3 }));
        act(() => renderer.root.findByType('TextInput' as any).props.onChangeText('Second issue'));
        act(() => button(renderer, 'files.pinComment').props.onPress());

        await act(async () => {
            button(renderer, 'files.sendComments').props.onPress();
            await Promise.resolve();
        });

        expect(mocks.sendMessage).toHaveBeenCalledOnce();
        expect(mocks.sendMessage).toHaveBeenCalledWith(
            'session-one',
            expect.stringMatching(/Line: 2[\s\S]*First issue[\s\S]*Line: 5[\s\S]*Column: 3[\s\S]*Second issue/u),
            expect.objectContaining({ requireAllAttachments: true }),
        );
        act(() => renderer.unmount());
    });

    it('preserves comments added while an earlier send is still pending', async () => {
        let resolveSend: ((value: { id: string }) => void) | undefined;
        mocks.sendMessage.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));
        let renderer: any;
        act(() => { renderer = create(React.createElement(Harness)); });

        act(() => renderer.root.findByType('TextInput' as any).props.onChangeText('First issue'));
        act(() => button(renderer, 'files.pinComment').props.onPress());
        act(() => { button(renderer, 'files.sendComments').props.onPress(); });

        act(() => selectAnchor?.({ line: 9 }));
        act(() => renderer.root.findByType('TextInput' as any).props.onChangeText('Added while sending'));
        act(() => button(renderer, 'files.pinComment').props.onPress());

        await act(async () => {
            resolveSend?.({ id: 'message-one' });
            await Promise.resolve();
        });

        expect(mocks.sendMessage).toHaveBeenCalledOnce();
        expect(mocks.sendMessage.mock.calls[0][1]).toContain('First issue');
        expect(mocks.sendMessage.mock.calls[0][1]).not.toContain('Added while sending');
        expect(renderer.root.findAllByType('Text' as any).some((text: any) => (
            String(text.props.children).includes('Added while sending')
        ))).toBe(true);
        act(() => renderer.unmount());
    });

    it('keeps an edited pinned comment when its earlier submitted version is accepted', async () => {
        let resolveSend!: (value: { localId: string }) => void;
        mocks.sendMessage.mockReturnValueOnce(new Promise((resolve) => { resolveSend = resolve; }));
        let renderer: any;
        act(() => { renderer = create(React.createElement(Harness)); });

        act(() => renderer.root.findByType('TextInput' as any).props.onChangeText('Original issue'));
        act(() => button(renderer, 'files.pinComment').props.onPress());
        act(() => { button(renderer, 'files.sendComments').props.onPress(); });
        act(() => button(renderer, 'files.editFile').props.onPress());
        act(() => renderer.root.findByType('TextInput' as any).props.onChangeText('Revised while sending'));
        act(() => button(renderer, 'common.save').props.onPress());

        await act(async () => {
            resolveSend({ localId: 'original-send' });
            await Promise.resolve();
        });

        expect(mocks.sendMessage).toHaveBeenCalledOnce();
        expect(mocks.sendMessage.mock.calls[0][1]).toContain('Original issue');
        expect(mocks.sendMessage.mock.calls[0][1]).not.toContain('Revised while sending');
        expect(renderer.root.findAllByType('Text' as any).some((text: any) => (
            text.props.children === 'Revised while sending'
        ))).toBe(true);

        await act(async () => {
            button(renderer, 'files.sendComments').props.onPress();
            await Promise.resolve();
        });
        expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
        expect(mocks.sendMessage.mock.calls[1][1]).toContain('Revised while sending');
        expect(renderer.root.findAllByProps({ testID: 'inline-comment-review-bar' })).toHaveLength(0);
        act(() => renderer.unmount());
    });

    it.each(['save', 'cancel'] as const)('keeps an in-progress edit through send acceptance until explicit %s', async (finish) => {
        let resolveSend!: (value: { localId: string }) => void;
        mocks.sendMessage.mockReturnValueOnce(new Promise((resolve) => { resolveSend = resolve; }));
        let renderer: any;
        act(() => { renderer = create(React.createElement(Harness)); });

        act(() => renderer.root.findByType('TextInput' as any).props.onChangeText('Original issue'));
        act(() => button(renderer, 'files.pinComment').props.onPress());
        act(() => { button(renderer, 'files.sendComments').props.onPress(); });
        act(() => button(renderer, 'files.editFile').props.onPress());
        act(() => renderer.root.findByType('TextInput' as any).props.onChangeText('Uncommitted revision'));

        await act(async () => {
            resolveSend({ localId: 'original-send' });
            await Promise.resolve();
        });

        expect(mocks.sendMessage.mock.calls[0][1]).toContain('Original issue');
        expect(mocks.sendMessage.mock.calls[0][1]).not.toContain('Uncommitted revision');
        expect(renderer.root.findByType('TextInput' as any).props.value).toBe('Uncommitted revision');
        act(() => button(renderer, `common.${finish}`).props.onPress());
        expect(renderer.root.findAllByType('TextInput' as any)).toHaveLength(0);
        expect(renderer.root.findAllByType('Text' as any).some((text: any) => (
            text.props.children === (finish === 'save' ? 'Uncommitted revision' : 'Original issue')
        ))).toBe(true);

        await act(async () => {
            button(renderer, 'files.sendComments').props.onPress();
            await Promise.resolve();
        });
        expect(mocks.sendMessage.mock.calls[1][1]).toContain(finish === 'save' ? 'Uncommitted revision' : 'Original issue');
        if (finish === 'cancel') expect(mocks.sendMessage.mock.calls[1][1]).not.toContain('Uncommitted revision');
        act(() => renderer.unmount());
    });

    it('attaches an element crop and synchronously rejects a duplicate send press', async () => {
        let resolveSend: ((value: { id: string }) => void) | undefined;
        mocks.sendMessage.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));
        const screenshot = {
            id: 'crop-one',
            uri: 'data:image/png;base64,AA==',
            width: 120,
            height: 36,
            mimeType: 'image/png',
            size: 1,
            name: 'element-crop.png',
        };

        function LiveHarness() {
            const [anchor, setAnchor] = React.useState<InlineCommentAnchor | null>({
                elementSelector: '#save',
                elementHtml: '<button id="save">Save</button>',
                elementCss: 'display: block;',
                elementBounds: { x: 10, y: 20, width: 120, height: 36 },
                screenshot,
            });
            const [comments, setComments] = React.useState<WorkspaceFeedbackComment[]>([]);
            return React.createElement(InlineCommentReview, {
                originSessionId: 'side-chat-session',
                reference: { machineId: 'machine-ec2', liveUrl: 'http://localhost:5173/' },
                activeAnchor: anchor,
                comments,
                onActiveAnchorChange: setAnchor,
                onCommentsChange: setComments,
            });
        }

        let renderer: any;
        act(() => { renderer = create(React.createElement(LiveHarness)); });
        act(() => renderer.root.findByType('TextInput' as any).props.onChangeText('Make it larger'));
        act(() => button(renderer, 'files.pinComment').props.onPress());
        act(() => {
            button(renderer, 'files.sendComments').props.onPress();
            button(renderer, 'files.sendComments').props.onPress();
        });

        expect(mocks.sendMessage).toHaveBeenCalledOnce();
        expect(mocks.sendMessage).toHaveBeenCalledWith(
            'side-chat-session',
            expect.stringContaining('Element selector: "#save"'),
            expect.objectContaining({ attachments: [screenshot], requireAllAttachments: true }),
        );
        await act(async () => {
            resolveSend?.({ id: 'message-one' });
            await Promise.resolve();
        });
        act(() => renderer.unmount());
    });

    it('edits and removes a pinned comment inside its own line thread', () => {
        function ThreadHarness() {
            const [comments, setComments] = React.useState<WorkspaceFeedbackComment[]>([
                { id: 'line-two', line: 2, feedback: 'Original issue' },
                { id: 'line-five', line: 5, feedback: 'Other line' },
            ]);
            return React.createElement(InlineCommentThread, {
                anchor: { line: 2 },
                activeAnchor: null,
                comments,
                onActiveAnchorChange: vi.fn(),
                onCommentsChange: setComments,
            });
        }

        let renderer: any;
        act(() => { renderer = create(React.createElement(ThreadHarness)); });
        expect(renderer.root.findByProps({ testID: 'inline-comment-thread:line:2' })).toBeDefined();
        expect(renderer.root.findAllByType('Text' as any).some((text: any) => text.props.children === 'Other line')).toBe(false);

        act(() => button(renderer, 'files.editFile').props.onPress());
        const editor = renderer.root.findByType('TextInput' as any);
        expect(editor.props.value).toBe('Original issue');
        act(() => editor.props.onChangeText('Updated issue'));
        act(() => button(renderer, 'common.save').props.onPress());
        expect(renderer.root.findAllByType('Text' as any).some((text: any) => text.props.children === 'Updated issue')).toBe(true);

        act(() => button(renderer, 'common.delete').props.onPress());
        expect(renderer.root.findAllByProps({ testID: 'inline-comment-thread:line:2' })).toHaveLength(0);
        act(() => renderer.unmount());
    });

    it('keeps every pinned comment after a failed batch send and retries once', async () => {
        mocks.sendMessage.mockRejectedValueOnce(new Error('provider unavailable'));
        let renderer: any;
        act(() => { renderer = create(React.createElement(Harness)); });
        act(() => renderer.root.findByType('TextInput' as any).props.onChangeText('Keep this issue'));
        act(() => button(renderer, 'files.pinComment').props.onPress());

        await act(async () => {
            button(renderer, 'files.sendComments').props.onPress();
            await Promise.resolve();
        });

        expect(mocks.sendMessage).toHaveBeenCalledOnce();
        expect(renderer.root.findByProps({ accessibilityRole: 'alert' })).toBeDefined();
        expect(button(renderer, 'files.sendComments')).toBeDefined();
        expect(renderer.root.findAllByType('Text' as any).some((text: any) => text.props.children === 'Keep this issue')).toBe(true);

        await act(async () => {
            button(renderer, 'files.sendComments').props.onPress();
            await Promise.resolve();
        });
        expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
        expect(renderer.root.findAllByProps({ testID: 'inline-comment-review-bar' })).toHaveLength(0);
        act(() => renderer.unmount());
    });
});
