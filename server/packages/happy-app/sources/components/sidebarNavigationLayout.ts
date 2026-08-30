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

export function resolveDesktopPersistentHeaderControlsLeft(
    drawerWidth: number,
    preferredLeft: number,
): number {
    return drawerWidth === 0 ? Math.max(56, preferredLeft) : preferredLeft;
}
