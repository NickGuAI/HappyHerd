import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Text: 'Text', TextInput: 'TextInput', View: 'View', Platform: { OS: 'ios' } }));
vi.mock('react-native-unistyles', () => ({ useUnistyles: () => ({ theme: { colors: { input: { text: '#fff', placeholder: '#aaa' } } } }) }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/keyboard/NativeKeyboard', () => ({ NativeShortcutTarget: 'NativeShortcutTarget' }));
import { MultiTextInput } from './MultiTextInput';
import { dispatchNativeShortcut, getNativeShortcuts } from '@/keyboard/nativeShortcuts';

const renderers: any[] = [];
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => renderers.splice(0).forEach(renderer => renderer.unmount())); });
function render(onKeyPress: (event: unknown) => boolean) {
    let renderer: any;
    act(() => { renderer = create(React.createElement(MultiTextInput, {
        defaultValue: '/suggestion', onKeyPress,
        nativeKeyCommands: [{ key: 'Enter', shiftKey: false }],
    })); });
    renderers.push(renderer);
    return renderer;
}

describe('native text input software and hardware keys', () => {
    it('still delivers software Return to autocomplete even when hardware Enter is advertised', () => {
        const onKeyPress = vi.fn(() => true);
        const renderer = render(onKeyPress);
        const preventDefault = vi.fn();
        act(() => renderer.root.findByType('TextInput').props.onKeyPress({ nativeEvent: { key: 'Enter' }, preventDefault }));
        expect(onKeyPress).toHaveBeenCalledExactlyOnceWith({ key: 'Enter', shiftKey: false });
        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(renderer.root.findByType('TextInput').props.submitBehavior).toBe('newline');
    });

    it('marks only commands returned by the native hardware bridge as hardware input', () => {
        const onKeyPress = vi.fn(() => true);
        render(onKeyPress);
        const command = getNativeShortcuts().find(command => command.key === 'Enter')!;
        act(() => dispatchNativeShortcut({ id: command.id, key: 'Enter', shift: false, meta: false, alt: false }));
        expect(onKeyPress).toHaveBeenCalledExactlyOnceWith({ key: 'Enter', shiftKey: false, nativeHardware: true });
    });
});
