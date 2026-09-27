import { Platform, useWindowDimensions } from 'react-native';

/** Below this window width, Web menus take phone metrics (UI overhaul). */
export const HERD_PHONE_SHEET_MAX_WIDTH = 700;

/**
 * Phones: floating surfaces (menus, dialogs, the palette) keep this far from
 * the window's edges, and never grow past the window less that margin.
 */
export const HERD_PHONE_FLOAT_MARGIN = 8;

/** Web at phone width: menus open as touch-size cards that fit the window. */
export function isHerdPhoneWeb(width: number): boolean {
    return Platform.OS === 'web' && width < HERD_PHONE_SHEET_MAX_WIDTH;
}

export function useHerdPhoneWeb(): boolean {
    const { width } = useWindowDimensions();
    return isHerdPhoneWeb(width);
}
