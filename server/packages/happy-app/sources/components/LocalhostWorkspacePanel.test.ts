import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return { Pressable: host('Pressable'), View: host('View') };
});
vi.mock('react-native-unistyles', () => ({
    StyleSheet: { create: (styles: any) => typeof styles === 'function' ? styles({}) : styles },
    useUnistyles: () => ({ theme: { colors: { surface: '#fff', surfaceHigh: '#eee', text: '#111', textDestructive: '#c00' } } }),
}));
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Octicons: (props: any) => ReactModule.createElement('Octicons', props) };
});
vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});
vi.mock('@/components/LocalhostLiveView', async () => {
    const ReactModule = await import('react');
    return { LocalhostLiveView: (props: any) => ReactModule.createElement('LocalhostLiveView', props) };
});
vi.mock('@/components/InlineCommentReview', async () => {
    const ReactModule = await import('react');
    return { InlineCommentReview: (props: any) => ReactModule.createElement('InlineCommentReview', props) };
});
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { LocalhostWorkspacePanel } from './LocalhostWorkspacePanel';

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
        if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
});
afterAll(() => vi.restoreAllMocks());

describe('LocalhostWorkspacePanel', () => {
    it('turns one picked element into exact-session feedback context', () => {
        const onHeaderRightSlotChange = vi.fn();
        let renderer: any;
        act(() => {
            renderer = create(React.createElement(LocalhostWorkspacePanel, {
                sessionId: 'side-chat-one',
                machineId: 'machine-ec2',
                url: 'http://localhost:5173/dashboard',
                active: true,
                onHeaderRightSlotChange,
            }));
        });

        const header = onHeaderRightSlotChange.mock.calls.at(-1)?.[0];
        act(() => header.props.onPress());
        expect(renderer.root.findByType('LocalhostLiveView' as any).props.pickerEnabled).toBe(true);

        const screenshot = {
            id: 'pick-one', uri: 'data:image/png;base64,AQID', width: 120, height: 36,
            mimeType: 'image/png', size: 3, name: 'localhost-element-pick-one.png',
        };
        act(() => renderer.root.findByType('LocalhostLiveView' as any).props.onPick({
            pickId: 'pick-one',
            selector: '#save',
            outerHTML: '<button id="save">Save</button>',
            computedCss: 'display: inline-flex;',
            bounds: { x: 10, y: 20, width: 120, height: 36 },
            screenshot,
        }));

        const review = renderer.root.findByType('InlineCommentReview' as any);
        expect(review.props.originSessionId).toBe('side-chat-one');
        expect(review.props.reference).toEqual({
            machineId: 'machine-ec2',
            liveUrl: 'http://localhost:5173/dashboard',
        });
        expect(review.props.activeAnchor).toEqual({
            elementSelector: '#save',
            elementHtml: '<button id="save">Save</button>',
            elementCss: 'display: inline-flex;',
            elementBounds: { x: 10, y: 20, width: 120, height: 36 },
            screenshot,
        });
        expect(renderer.root.findByType('LocalhostLiveView' as any).props.pickerEnabled).toBe(false);
        act(() => renderer.unmount());
    });
});
