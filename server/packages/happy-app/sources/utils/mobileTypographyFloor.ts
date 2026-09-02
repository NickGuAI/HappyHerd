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
