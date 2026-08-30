import { describe, expect, it } from 'vitest';

import { resolveDesktopNavigationDrawerWidth } from './sidebarNavigationLayout';

describe('desktop navigation drawer layout', () => {
    const width = (overrides: Partial<Parameters<typeof resolveDesktopNavigationDrawerWidth>[0]> = {}) => (
        resolveDesktopNavigationDrawerWidth({
            isDesktopLayout: true,
            zenMode: false,
            navigationSidebarCollapsed: false,
            fullDrawerWidth: 360,
            ...overrides,
        })
    );

    it('keeps the permanent navigation open by default', () => {
        expect(width()).toBe(360);
    });

    it('collapses navigation without requiring Zen mode', () => {
        expect(width({ navigationSidebarCollapsed: true, zenMode: false })).toBe(0);
        expect(width({ navigationSidebarCollapsed: false, zenMode: false })).toBe(360);
    });

    it('keeps Zen and navigation collapse as independent visibility inputs', () => {
        expect(width({ zenMode: true, navigationSidebarCollapsed: false })).toBe(0);
        expect(width({ zenMode: true, navigationSidebarCollapsed: true })).toBe(0);
    });

    it('never exposes the permanent drawer on a narrow layout', () => {
        expect(width({ isDesktopLayout: false })).toBe(0);
    });
});
