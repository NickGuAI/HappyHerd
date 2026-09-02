import * as React from 'react';

import { PHONE_WEB_TYPOGRAPHY_MIN_FONT_SIZE } from '@/utils/mobileTypographyFloor';

export const MOBILE_TYPOGRAPHY_MIN_FONT_SIZE = PHONE_WEB_TYPOGRAPHY_MIN_FONT_SIZE;

export function MobileTypographyFloor(props: { active: boolean; children: React.ReactNode }) {
    return <>{props.children}</>;
}
