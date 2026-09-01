import { describe, expect, it } from 'vitest';

import {
    DESKTOP_NAVIGATION_BOUNDARY_TOGGLE_HIT_SLOP,
    DESKTOP_NAVIGATION_BOUNDARY_TOGGLE_WIDTH,
    resolveDesktopNavigationBoundaryToggleLeft,
    resolveDesktopNavigationDrawerWidth,
    resolveDesktopNavigationHeaderLeftPadding,
    resolveDesktopPersistentHeaderControlsLeft,
} from './sidebarNavigationLayout';

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

    it('pins the toggle to the visible navigation boundary', () => {
        expect(resolveDesktopNavigationBoundaryToggleLeft(360)).toBe(346);
        expect(resolveDesktopNavigationBoundaryToggleLeft(0)).toBe(8);
    });

    it('keeps collapsed navigation and persistent header hit targets separate', () => {
        const toggleHitTargetRight = resolveDesktopNavigationBoundaryToggleLeft(0)
            + DESKTOP_NAVIGATION_BOUNDARY_TOGGLE_WIDTH
            + DESKTOP_NAVIGATION_BOUNDARY_TOGGLE_HIT_SLOP;
        const persistentControlsHitTargetLeft = resolveDesktopPersistentHeaderControlsLeft(0, 16) - 10;

        expect(toggleHitTargetRight).toBeLessThan(persistentControlsHitTargetLeft);
        expect(resolveDesktopPersistentHeaderControlsLeft(360, 16)).toBe(16);
        expect(resolveDesktopPersistentHeaderControlsLeft(0, 117)).toBe(117);
    });

    it('reserves the collapsed toggle hit target before desktop header content', () => {
        expect(resolveDesktopNavigationHeaderLeftPadding(false, 16)).toBe(16);
        expect(resolveDesktopNavigationHeaderLeftPadding(true, 16)).toBe(44);
    });
});
