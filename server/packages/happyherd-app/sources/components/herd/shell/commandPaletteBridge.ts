import * as React from 'react';

/**
 * Opens the existing command palette from a control instead of ⌘K. The
 * provider publishes its opener here only while the palette is available
 * (signed in, web, and enabled in Features), so a null value means the
 * search control should not render.
 */
export const HerdCommandPaletteContext = React.createContext<(() => void) | null>(null);

export function useHerdCommandPalette(): (() => void) | null {
    return React.useContext(HerdCommandPaletteContext);
}
