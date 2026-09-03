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

import { InlineCommentReview } from './InlineCommentReview.web';

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
});
