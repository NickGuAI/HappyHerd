import * as React from 'react';
import { Modal, type ViewProps } from 'react-native';

export const NativeKeyboardModal = Modal;
export function NativeKeyboardHost({ children }: { children: React.ReactNode }) { return <>{children}</>; }
export function NativeShortcutTarget({ targetId: _targetId, ...props }: ViewProps & { targetId: string }) { return <>{props.children}</>; }
