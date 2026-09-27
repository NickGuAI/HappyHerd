/**
 * Desktop navigation layout. The panel toggle lives in the HappyHerd top bar
 * (components/herd/shell/HerdTopBar.tsx) with a secondary handle on the panel
 * edge (HerdSidebarEdgeToggle), so nothing sits in a screen header's corner.
 */

/** Zen and the collapse setting stay independent inputs; either hides the panel. */
export function resolveDesktopNavigationHidden(input: {
    zenMode: boolean;
    navigationSidebarCollapsed: boolean;
}): boolean {
    return input.zenMode || input.navigationSidebarCollapsed;
}

export function resolveDesktopNavigationDrawerWidth(input: {
    isDesktopLayout: boolean;
    hidden: boolean;
    fullDrawerWidth: number;
}): number {
    return input.isDesktopLayout && !input.hidden ? input.fullDrawerWidth : 0;
}
