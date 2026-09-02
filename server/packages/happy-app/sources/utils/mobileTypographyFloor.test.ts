import { describe, expect, it } from 'vitest';

import { shouldApplyPhoneWebTypographyFloor } from './mobileTypographyFloor';

describe('shouldApplyPhoneWebTypographyFloor', () => {
    it('targets portrait and landscape phone Web layouts', () => {
        expect(shouldApplyPhoneWebTypographyFloor({
            platform: 'web',
            deviceType: 'phone',
            windowWidth: 390,
            desktopLayoutMinWidth: 1100,
        })).toBe(true);
        expect(shouldApplyPhoneWebTypographyFloor({
            platform: 'web',
            deviceType: 'phone',
            windowWidth: 844,
            desktopLayoutMinWidth: 1100,
        })).toBe(true);
    });

    it('leaves the desktop layout and native surfaces unchanged', () => {
        expect(shouldApplyPhoneWebTypographyFloor({
            platform: 'web',
            deviceType: 'phone',
            windowWidth: 1100,
            desktopLayoutMinWidth: 1100,
        })).toBe(false);
        expect(shouldApplyPhoneWebTypographyFloor({
            platform: 'web',
            deviceType: 'tablet',
            windowWidth: 844,
            desktopLayoutMinWidth: 1100,
        })).toBe(false);
        expect(shouldApplyPhoneWebTypographyFloor({
            platform: 'ios',
            deviceType: 'phone',
            windowWidth: 390,
            desktopLayoutMinWidth: 1100,
        })).toBe(false);
    });
});
