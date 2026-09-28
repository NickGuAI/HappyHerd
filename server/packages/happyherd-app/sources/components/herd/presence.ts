import * as React from 'react';
import { Platform } from 'react-native';

/** Exit durations in ms; they match the exit classes in theme.css. */
export const HERD_EXIT = {
    /** `herd-pop-out`: anchored menus and composer chip popovers. */
    pop: 140,
    /** `herd-sheet-out`: centered page sheets. */
    sheet: 180,
    /** `herd-sheet-down`: bottom sheets. */
    sheetDown: 260,
} as const;

function playsExitMotion(): boolean {
    return Platform.OS === 'web'
        && typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Keeps an overlay's last `value` (its anchor, or `true`) for `exitMs` after
 * the value becomes null, so the overlay can play its exit class before it
 * unmounts. `exiting` is true for that interval. Native, reduced motion and
 * renders outside a browser drop the value at once.
 */
export function useHerdExit<T>(value: T | null, exitMs: number): { value: T | null; exiting: boolean } {
    const [shown, setShown] = React.useState<T | null>(value);
    if (value !== null && value !== shown) {
        setShown(value);
    } else if (value === null && shown !== null && !playsExitMotion()) {
        setShown(null);
    }
    const exiting = value === null && shown !== null;
    React.useEffect(() => {
        if (!exiting) return;
        const timer = setTimeout(() => setShown(null), exitMs);
        return () => clearTimeout(timer);
    }, [exiting, exitMs]);
    return exiting ? { value: shown, exiting: true } : { value, exiting: false };
}
