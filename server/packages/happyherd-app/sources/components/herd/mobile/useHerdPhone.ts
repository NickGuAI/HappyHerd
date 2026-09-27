import { Platform, useWindowDimensions } from 'react-native';

/** Below this window width, Web popovers present as bottom sheets (UI overhaul). */
export const HERD_PHONE_SHEET_MAX_WIDTH = 700;

/** Web at phone width: menus and pickers become bottom sheets. */
export function isHerdPhoneWeb(width: number): boolean {
    return Platform.OS === 'web' && width < HERD_PHONE_SHEET_MAX_WIDTH;
}

export function useHerdPhoneWeb(): boolean {
    const { width } = useWindowDimensions();
    return isHerdPhoneWeb(width);
}
