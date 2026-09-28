import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ modalShow: vi.fn() }));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Pressable: host('button'),
        ScrollView: host('div'),
        View: host('div'),
        useWindowDimensions: () => ({ width: 1200, height: 800 }),
    };
});
vi.mock('expo-image', async () => {
    const ReactModule = await import('react');
    return { Image: (props: any) => ReactModule.createElement('Image', props) };
});
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});
vi.mock('react-native-unistyles', () => {
    const theme = { colors: { divider: '#dddddd', surfaceHigh: '#eeeeee', textSecondary: '#666666' } };
    return {
        StyleSheet: { create: (factory: (value: typeof theme) => unknown) => factory(theme) },
        useUnistyles: () => ({ theme }),
    };
});
vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('span', props, props.children) };
});
vi.mock('@/hooks/useAttachmentImage', () => ({
    useAttachmentImage: () => ({ uri: 'data:image/png;base64,iVBORw0KGgo=', error: null }),
}));
vi.mock('@/modal', () => ({ Modal: { show: mocks.modalShow } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { FileView } from './FileView';
import { HerdModalContentWidthContext } from '@/components/herd/modalArea';

const flat = (style: any): Record<string, unknown> => Array.isArray(style)
    ? Object.assign({}, ...style.flat(Infinity).filter(Boolean))
    : (style ?? {});

describe('FileView attachment preview', () => {
    it('sizes the preview to the modal\'s content width, not the window\'s', () => {
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(FileView, {
                tool: {
                    name: 'file',
                    state: 'completed',
                    input: { ref: 'attachment-one', name: 'chart.png', image: { width: 640, height: 480 } },
                    createdAt: 1,
                    startedAt: 1,
                    completedAt: 1,
                    description: null,
                },
                metadata: null,
                messages: [],
                sessionId: 'session-one',
            }));
        });
        act(() => renderer.root.findByProps({ accessibilityLabel: 'markdown.openImageFullSize: chart.png' }).props.onPress());
        expect(mocks.modalShow).toHaveBeenCalledOnce();
        const { component, props } = mocks.modalShow.mock.calls[0][0];
        let preview!: ReactTestRenderer;
        // BaseModal's content width for a centered modal on an 844 x 390 iPhone with 47 px side insets.
        act(() => {
            preview = create(React.createElement(HerdModalContentWidthContext.Provider, { value: 710 },
                React.createElement(component, { ...props, onClose: vi.fn() })));
        });
        const card = preview.root.findByProps({ accessibilityLabel: 'markdown.closeImagePreview' }).parent;
        expect(flat(card.props.style).width).toBe(710);
        // The card less its 16 px padding on each side.
        expect(preview.root.findByType('Image' as any).props.style.width).toBe(678);
        act(() => {
            preview.unmount();
            renderer.unmount();
        });
    });
});
