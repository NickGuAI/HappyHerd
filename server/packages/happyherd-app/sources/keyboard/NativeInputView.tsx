import * as React from 'react';
import { View, type ViewProps } from 'react-native';
import type { NativeShortcut, NativeShortcutEvent } from './nativeShortcuts';

export type NativeInputProps = ViewProps & {
    host?: boolean;
    targetId?: string;
    commands?: NativeShortcut[];
    onCommand?: (event: { nativeEvent: NativeShortcutEvent }) => void;
};
// Android does not install the Apple module. iOS resolves NativeInputView.ios.tsx.
export const NativeInputView = View as React.ComponentType<NativeInputProps>;

export function restoreNativeKeyboardFocus(): void {}
