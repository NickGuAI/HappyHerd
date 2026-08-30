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
