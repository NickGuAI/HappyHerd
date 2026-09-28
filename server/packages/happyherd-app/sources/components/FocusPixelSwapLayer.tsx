import * as React from 'react';
import { Modal } from 'react-native';

/** Native: the swap covers the window, the top bar and sheets included, in a transparent Modal. */
export function FocusPixelSwapLayer({ children }: { children: React.ReactNode }) {
    return (
        <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => {}}>
            {children}
        </Modal>
    );
}
