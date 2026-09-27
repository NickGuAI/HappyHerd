import { describe, expect, it } from 'vitest';

import {
    resolveDesktopNavigationDrawerWidth,
    resolveDesktopNavigationHeaderLeftPadding,
    resolveDesktopNavigationHidden,
} from './sidebarNavigationLayout';

describe('desktop navigation drawer layout', () => {
    const width = (overrides: {
        isDesktopLayout?: boolean;
        zenMode?: boolean;
        navigationSidebarCollapsed?: boolean;
    } = {}) => resolveDesktopNavigationDrawerWidth({
        isDesktopLayout: overrides.isDesktopLayout ?? true,
        hidden: resolveDesktopNavigationHidden({
            zenMode: overrides.zenMode ?? false,
            navigationSidebarCollapsed: overrides.navigationSidebarCollapsed ?? false,
        }),
        fullDrawerWidth: 360,
    });

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

    it('needs no header clearance now that the shell controls live in the top bar', () => {
        expect(resolveDesktopNavigationHeaderLeftPadding(false, 16)).toBe(16);
        expect(resolveDesktopNavigationHeaderLeftPadding(true, 16)).toBe(16);
    });
});
