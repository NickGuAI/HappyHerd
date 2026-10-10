import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type { NativeInputProps } from './NativeInputView';

export const NativeInputView = requireNativeViewManager<NativeInputProps>('HerdInput');

const module = requireNativeModule<{ restoreFocus: () => Promise<void> }>('HerdInput');
export function restoreNativeKeyboardFocus() { return module.restoreFocus(); }
