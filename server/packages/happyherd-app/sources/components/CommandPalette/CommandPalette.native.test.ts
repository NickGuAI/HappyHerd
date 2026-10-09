import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
    View: 'View', Text: 'Text', TextInput: 'TextInput', ScrollView: 'ScrollView', Pressable: 'Pressable', Modal: 'Modal',
    Platform: { OS: 'ios' }, useWindowDimensions: () => ({ width: 1024, height: 768 }),
}));
vi.mock('react-native-unistyles', () => {
    const theme: any = new Proxy({}, { get: () => theme });
    return { StyleSheet: { create: (factory: any) => factory(theme) }, useUnistyles: () => ({ theme }) };
});
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}), mono: () => ({}) } }));
vi.mock('@/components/StyledText', () => ({ Text: 'Text' }));
vi.mock('@/components/herd/pages/HerdPage', () => ({ HerdKey: 'HerdKey' }));
vi.mock('@/components/herd/mobile/useHerdPhone', () => ({ useHerdPhoneLayout: () => false, useHerdPhoneWeb: () => false }));
vi.mock('@/components/herd/shell/HerdShellIcon', () => ({ HerdShellIcon: 'HerdShellIcon' }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { CommandPalette } from './CommandPalette';
import { NativeKeyboardHost, NativeKeyboardModal } from '@/keyboard/NativeKeyboard';
import * as nativeInput from '@/keyboard/NativeInputView';
import { dispatchNativeShortcut, getNativeShortcuts } from '@/keyboard/nativeShortcuts';

const renderers: any[] = [];
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => renderers.splice(0).forEach(renderer => renderer.unmount())); vi.restoreAllMocks(); });
function render(element: React.ReactElement) {
    let renderer: any;
    act(() => { renderer = create(element); });
    renderers.push(renderer);
    return renderer;
}

describe('native palette production component', () => {
    it('renders search and command buttons on iOS, filters, and invokes one selected action', () => {
        const action = vi.fn();
        const other = vi.fn();
        const close = vi.fn();
        const renderer = render(React.createElement(NativeKeyboardHost, null, React.createElement(CommandPalette, {
            commands: [{ id: 'workspace', title: 'Workspace', action }, { id: 'settings', title: 'Settings', action: other }],
            onClose: close,
        })));
        expect(renderer.root.findAll((node: any) => node.type === 'View' && node.props.testID === 'command-palette')).toHaveLength(1);
        act(() => renderer.root.findByType('TextInput').props.onChangeText('work'));
        const choices = renderer.root.findAll((node: any) => node.type === 'Pressable' && node.props.accessibilityRole === 'button' && node.props.accessibilityState);
        expect(choices).toHaveLength(1);
        act(() => choices[0].props.onPress());
        expect(action).toHaveBeenCalledTimes(1);
        expect(other).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('executes the selected command once from the native software keyboard Go action', () => {
        const action = vi.fn();
        const close = vi.fn();
        const renderer = render(React.createElement(NativeKeyboardHost, null, React.createElement(CommandPalette, {
            commands: [{ id: 'one', title: 'One', action }], onClose: close,
        })));
        act(() => renderer.root.findByType('TextInput').props.onSubmitEditing({ nativeEvent: { text: '', eventCount: 1, target: 1 } }));
        expect(action).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('advertises focused native input navigation and returns its captured Enter command', () => {
        const action = vi.fn();
        const close = vi.fn();
        render(React.createElement(NativeKeyboardHost, null, React.createElement(CommandPalette, { commands: [{ id: 'one', title: 'One', action }], onClose: close })));
        const command = getNativeShortcuts().find(command => command.key === 'Enter')!;
        expect(command).toMatchObject({ scope: 'composer' });
        expect(command.target).toBeTruthy();
        expect(command.host).toBeTruthy();
        act(() => dispatchNativeShortcut({ id: command.id, key: 'Enter', meta: false, alt: false, shift: false }));
        expect(action).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('restores the idle native host at the completed dismissal boundary and preserves the caller callback', () => {
        const order: string[] = [];
        vi.spyOn(nativeInput, 'restoreNativeKeyboardFocus').mockImplementation(() => { order.push('restore'); });
        const renderer = render(React.createElement(NativeKeyboardModal, { visible: true, onDismiss: () => order.push('dismissed') }, React.createElement('Text', null, 'Sheet')));
        act(() => renderer.root.findByType('Modal').props.onDismiss());
        expect(order).toEqual(['dismissed', 'restore']);
    });

    it('gives stacked native modals different Escape hosts and excludes the lower modal command from the upper host', () => {
        const lowerClose = vi.fn();
        const upperClose = vi.fn();
        const renderer = render(React.createElement(NativeKeyboardHost, null,
            React.createElement(NativeKeyboardModal, { visible: true, onRequestClose: lowerClose },
                React.createElement(NativeKeyboardModal, { visible: true, onRequestClose: upperClose }, React.createElement('Text', null, 'Top')))));
        const hostViews = renderer.root.findAll((node: any) => node.type === 'View' && node.props.host);
        const commandsByHost = hostViews.map((node: any) => node.props.commands.filter((command: any) => command.key === 'Escape'));
        expect(commandsByHost.map((commands: any[]) => commands.length)).toEqual([0, 1, 1]);
        expect(commandsByHost[1][0].host).not.toBe(commandsByHost[2][0].host);
        const top = commandsByHost[2][0];
        act(() => dispatchNativeShortcut({ id: top.id, key: 'Escape', meta: false, alt: false, shift: false }));
        expect(upperClose).toHaveBeenCalledTimes(1);
        expect(lowerClose).not.toHaveBeenCalled();
    });
});
