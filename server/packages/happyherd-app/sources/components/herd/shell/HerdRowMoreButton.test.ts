import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ os: 'ios', phone: true }));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => ReactModule.forwardRef((props: any, _ref) => ReactModule.createElement(name, props, props.children));
    return { Platform: { get OS() { return state.os; } }, Pressable: host('Pressable'), View: host('View') };
});
vi.mock('react-native-unistyles', async () => {
    const { lightTheme } = await import('@/theme');
    return { StyleSheet: { create: (factory: (value: typeof lightTheme) => unknown) => factory(lightTheme) }, useUnistyles: () => ({ theme: lightTheme }) };
});
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('../mobile/useHerdPhone', () => ({ useHerdPhoneLayout: () => state.phone }));
vi.mock('./selectionGlide', () => ({ useHerdSelectionGlide: () => undefined }));

import { HerdRowMoreButton } from './HerdSessionRowParts';

const renderers: ReactTestRenderer[] = [];
beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
    act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()));
    Object.assign(state, { os: 'ios', phone: true });
});

function render(props: Partial<React.ComponentProps<typeof HerdRowMoreButton>>) {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(React.createElement(HerdRowMoreButton, { open: false, onOpen: vi.fn(), ...props }));
    });
    renderers.push(renderer);
    return renderer.root.findAll((node: any) => node.props.testID === 'session-row-more' && node.type === 'Pressable');
}

describe('the session row ⋯ in the native app', () => {
    it('stays on every native phone row and opens the row\'s long-press actions', () => {
        const onNativePress = vi.fn();
        const onOpen = vi.fn();
        const [button] = render({ onNativePress, onOpen });
        expect(button).toBeDefined();
        expect(button.props.style({ hovered: false })).toMatchObject({ alignSelf: 'center' });
        act(() => button.props.onPress({ stopPropagation() {} }));
        expect(onNativePress).toHaveBeenCalledTimes(1);
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('keeps native tablets without it', () => {
        state.phone = false;
        expect(render({ onNativePress: vi.fn() })).toHaveLength(0);
    });

    it('has nothing to open without the row\'s native actions', () => {
        expect(render({})).toHaveLength(0);
    });
});
