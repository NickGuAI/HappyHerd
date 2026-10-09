import * as React from 'react';
import { Platform } from 'react-native';
import { useNativeShortcuts } from '@/keyboard/nativeShortcuts';

type EscapeLayer = {
    close: () => void;
    accepts: (event: KeyboardEvent) => boolean;
};

// Open overlays in the order they opened; Escape belongs to the newest.
const layers: EscapeLayer[] = [];

function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    const top = layers[layers.length - 1];
    if (!top || !top.accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    top.close();
}

function registerEscapeLayer(layer: EscapeLayer): () => void {
    if (layers.length === 0) window.addEventListener('keydown', handleKeyDown, true);
    layers.push(layer);
    return () => {
        const index = layers.indexOf(layer);
        if (index >= 0) layers.splice(index, 1);
        if (layers.length === 0) window.removeEventListener('keydown', handleKeyDown, true);
    };
}

/**
 * Web: Escape closes the overlay and is consumed. The app's global
 * navigation treats an unhandled Escape as Back (and exits Zen), and it
 * runs on keydown, before React Native Web's Modal sees the keyup.
 *
 * Overlays stack: only the most recently opened one answers Escape, so a
 * menu inside a sheet closes before the sheet. `accepts` lets an overlay
 * leave an Escape to what has focus (a text field, an app dialog); the
 * key then continues as if no overlay were open.
 */
export function useHerdEscapeToClose(
    visible: boolean,
    onClose: () => void,
    accepts?: (event: KeyboardEvent) => boolean,
): void {
    const nativeId = React.useId();
    useNativeShortcuts(visible ? [{ id: `escape:${nativeId}`, key: 'Escape', scope: 'overlay', allowEditable: !accepts }] : [], onClose);
    const onCloseRef = React.useRef(onClose);
    onCloseRef.current = onClose;
    const acceptsRef = React.useRef(accepts);
    acceptsRef.current = accepts;
    React.useEffect(() => {
        if (!visible || Platform.OS !== 'web' || typeof window === 'undefined') return;
        return registerEscapeLayer({
            close: () => onCloseRef.current(),
            accepts: (event) => acceptsRef.current?.(event) ?? true,
        });
    }, [visible]);
}
