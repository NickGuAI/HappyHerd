export const DESKTOP_NAVIGATION_BOUNDARY_TOGGLE_WIDTH = 28;
export const DESKTOP_NAVIGATION_BOUNDARY_TOGGLE_HIT_SLOP = 8;

export function resolveDesktopNavigationDrawerWidth(input: {
    isDesktopLayout: boolean;
    zenMode: boolean;
    navigationSidebarCollapsed: boolean;
    fullDrawerWidth: number;
}): number {
    return input.isDesktopLayout
        && !input.zenMode
        && !input.navigationSidebarCollapsed
        ? input.fullDrawerWidth
        : 0;
}

export function resolveDesktopNavigationBoundaryToggleLeft(drawerWidth: number): number {
    return Math.max(8, drawerWidth - 14);
}

export function resolveDesktopNavigationHeaderLeftPadding(
    navigationSidebarCollapsed: boolean,
    defaultPadding: number,
): number {
    if (!navigationSidebarCollapsed) return defaultPadding;
    return Math.max(
        defaultPadding,
        resolveDesktopNavigationBoundaryToggleLeft(0)
            + DESKTOP_NAVIGATION_BOUNDARY_TOGGLE_WIDTH
            + DESKTOP_NAVIGATION_BOUNDARY_TOGGLE_HIT_SLOP,
    );
}

export function resolveDesktopPersistentHeaderControlsLeft(
    drawerWidth: number,
    preferredLeft: number,
): number {
    return drawerWidth === 0 ? Math.max(56, preferredLeft) : preferredLeft;
}
