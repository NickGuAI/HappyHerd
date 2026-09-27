import * as React from 'react';

/**
 * Which top bar a control sits in. The phone top bar gives every control a
 * 44 px touch target; the desktop bar keeps its compact 34 px squares.
 */
export type HerdTopBarLayout = 'desktop' | 'phone';

export const HerdTopBarLayoutContext = React.createContext<HerdTopBarLayout>('desktop');

export function useHerdTopBarLayout(): HerdTopBarLayout {
    return React.useContext(HerdTopBarLayoutContext);
}

/** The phone top bar's height below the status bar (the mock's 52 px). */
export const HERD_PHONE_TOP_BAR_HEIGHT = 52;

/** Phone touch targets: every primary control is at least this tall and wide. */
export const HERD_PHONE_TARGET = 44;
