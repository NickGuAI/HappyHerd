import * as React from 'react';

import { HerdLanding } from '@/components/herd/pages/HerdLanding';
import { useHerdPhoneShell } from '../shell/phoneShell';
import { PhoneHome } from './PhoneHome';

/**
 * The phone's session list page (UI overhaul): the docked panel, or the landing
 * once the top bar's panel toggle folds the panel away, as the phone mock's
 * home shows its empty page under a collapsed panel.
 */
export function PhoneHomeRoute() {
    const homeCollapsed = useHerdPhoneShell((state) => state.homeCollapsed);
    return homeCollapsed ? <HerdLanding /> : <PhoneHome />;
}
