import { Platform, useWindowDimensions } from 'react-native';
import { useIsTablet } from '@/utils/responsive';
import { isRunningOnMac } from '@/utils/platform';

/** Below this window width the web takes the phone layout (UI overhaul). */
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

/**
 * The phone layout. On the web it is the window's width, since the device
 * rule reads a 1024 × 768 browser window as an 8-inch phone. Native phones stay
 * phones in landscape; tablets and the iPad app on Mac adapt to narrow windows.
 */
export function isHerdPhoneLayout(input: { platform: string; width: number; isTablet: boolean; runningOnMac?: boolean }): boolean {
    return input.width < HERD_PHONE_SHEET_MAX_WIDTH
        || (input.platform !== 'web' && !input.isTablet && !input.runningOnMac);
}

export function useHerdPhoneLayout(): boolean {
    const { width } = useWindowDimensions();
    const isTablet = useIsTablet() || (Platform.OS === 'ios' && Platform.isPad);
    return isHerdPhoneLayout({ platform: Platform.OS, width, isTablet, runningOnMac: isRunningOnMac() });
}
