import * as React from 'react';

/**
 * The width `BaseModal` leaves its content (UI overhaul): the window less the
 * placement's side padding and the side safe-area insets, such as a landscape
 * phone's notch. Null outside a modal.
 */
export const HerdModalContentWidthContext = React.createContext<number | null>(null);

export function resolveModalContentWidth(input: { windowWidth: number; sidePadding: number; insetLeft: number; insetRight: number }): number {
    return Math.max(0, input.windowWidth - input.sidePadding * 2 - input.insetLeft - input.insetRight);
}

/** The width a centered preview may take: the modal's content width, at most `max`. */
export function useHerdModalPreviewWidth(windowWidth: number, max: number): number {
    const contentWidth = React.useContext(HerdModalContentWidthContext);
    // Outside a modal, keep BaseModal's centered 20 px on each side.
    return Math.min(contentWidth ?? Math.max(0, windowWidth - 40), max);
}
