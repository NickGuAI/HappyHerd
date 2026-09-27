/**
 * Destinations the phone top bar and navigation drawer open directly (UI
 * overhaul). Like every screen on tablets, they show no Back: the drawer and
 * the brand lead away from them. Pages opened from inside one of them keep
 * Back. Values are the Expo Router stack route names.
 */
export const HERD_PHONE_TOP_LEVEL_ROUTES: ReadonlySet<string> = new Set([
    'index',
    'inbox/index',
    'settings/index',
    'automations/index',
    'projects/index',
    'workspace/index',
    'new/index',
]);

export function isHerdPhoneTopLevelRoute(routeName: string): boolean {
    return HERD_PHONE_TOP_LEVEL_ROUTES.has(routeName);
}
