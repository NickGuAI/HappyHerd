import * as React from 'react';
import { Platform } from 'react-native';

/**
 * Web: Escape closes the overlay and is consumed. The app's global
 * navigation treats an unhandled Escape as Back (and exits Zen), and it
 * runs on keydown, before React Native Web's Modal sees the keyup.
 */
export function useHerdEscapeToClose(visible: boolean, onClose: () => void): void {
    const onCloseRef = React.useRef(onClose);
    onCloseRef.current = onClose;
    React.useEffect(() => {
        if (!visible || Platform.OS !== 'web' || typeof window === 'undefined') return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            onCloseRef.current();
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [visible]);
}
