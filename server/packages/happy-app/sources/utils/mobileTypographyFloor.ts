export const PHONE_WEB_TYPOGRAPHY_MIN_FONT_SIZE = 16;

export function resolvePhoneSafeTextEntryFontSize(platform: string, defaultFontSize: number): number {
    return platform === 'web' ? PHONE_WEB_TYPOGRAPHY_MIN_FONT_SIZE : defaultFontSize;
}

export function shouldApplyPhoneWebTypographyFloor(input: {
    platform: string;
    deviceType: 'phone' | 'tablet';
    windowWidth: number;
    desktopLayoutMinWidth: number;
}): boolean {
    return input.platform === 'web'
        && input.deviceType === 'phone'
        && input.windowWidth < input.desktopLayoutMinWidth;
}
