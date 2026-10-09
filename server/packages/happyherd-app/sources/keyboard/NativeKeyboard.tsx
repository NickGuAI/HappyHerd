import * as React from 'react';
import { Modal, Platform, View, type ModalProps, type ViewProps } from 'react-native';
import { dispatchNativeShortcut, getNativeShortcuts, subscribeNativeShortcuts, useNativeShortcuts, NativeKeyboardScopeContext } from './nativeShortcuts';

import { NativeInputView as NativeInput, restoreNativeKeyboardFocus } from './NativeInputView';

export function NativeKeyboardHost({ children, hostId }: { children: React.ReactNode; hostId?: string }) {
    const generatedId = React.useId();
    const id = hostId ?? generatedId;
    const commands = React.useSyncExternalStore(subscribeNativeShortcuts, getNativeShortcuts, getNativeShortcuts);
    if (Platform.OS !== 'ios') return <>{children}</>;
    return <NativeKeyboardScopeContext.Provider value={id}><NativeInput host commands={commands.filter(command => (!command.scope || command.scope === 'global') || command.host === id)} style={{ flex: 1 }} onCommand={event => dispatchNativeShortcut(event.nativeEvent)}>{children}</NativeInput></NativeKeyboardScopeContext.Provider>;
}

export function NativeShortcutTarget({ targetId, ...props }: ViewProps & { targetId: string }) {
    if (Platform.OS === 'web') return <>{props.children}</>;
    if (Platform.OS !== 'ios') return <View {...props} />;
    return <NativeInput {...props} targetId={targetId} />;
}

/** A native Modal has its own responder tree; the app root cannot receive its keys. */
export function NativeKeyboardModal(props: ModalProps) {
    const id = React.useId();
    useNativeShortcuts(props.visible !== false && props.onRequestClose ? [{ id: `modal:${id}`, key: 'Escape', scope: 'overlay', allowEditable: true, host: id }] : [], () => props.onRequestClose?.({} as never));
    return <Modal {...props} onDismiss={() => {
        props.onDismiss?.();
        // RN calls this after native dismissal completes. Root layout/window
        // notifications need not fire when a same-window modal disappears.
        void restoreNativeKeyboardFocus();
    }}><NativeKeyboardHost hostId={id}>{props.children}</NativeKeyboardHost></Modal>;
}
