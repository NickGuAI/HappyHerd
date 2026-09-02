import { describe, expect, it } from 'vitest';

import {
    resolvePhoneSafeTextEntryFontSize,
    shouldApplyPhoneWebTypographyFloor,
} from './mobileTypographyFloor';

describe('resolvePhoneSafeTextEntryFontSize', () => {
    it('is synchronously phone-safe on Web without changing native defaults', () => {
        expect(resolvePhoneSafeTextEntryFontSize('web', 14)).toBe(16);
        expect(resolvePhoneSafeTextEntryFontSize('web', 15)).toBe(16);
        expect(resolvePhoneSafeTextEntryFontSize('ios', 15)).toBe(15);
        expect(resolvePhoneSafeTextEntryFontSize('android', 14)).toBe(14);
    });
});

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
