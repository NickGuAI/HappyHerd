import * as React from 'react';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

/**
 * The window's own safe-area insets. Inside the desktop shell the screens
 * see a zero top inset because the top bar consumes it; a fullscreen modal
 * covers the top bar and needs the real value.
 */
export const HerdWindowInsetsContext = React.createContext<EdgeInsets | null>(null);

/** Safe-area insets for content that covers the whole window, such as a fullscreen modal. */
export function useWindowSafeAreaInsets(): EdgeInsets {
    const shellInsets = React.useContext(HerdWindowInsetsContext);
    const localInsets = useSafeAreaInsets();
    return shellInsets ?? localInsets;
}
