import * as React from 'react';

export const MOBILE_TYPOGRAPHY_MIN_FONT_SIZE = 16;

export function MobileTypographyFloor(props: { active: boolean; children: React.ReactNode }) {
    return <>{props.children}</>;
}
