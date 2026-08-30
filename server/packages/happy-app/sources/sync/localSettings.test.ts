import { describe, expect, it } from 'vitest';

import { applyLocalSettings, localSettingsParse } from './localSettings';

describe('desktop navigation local setting', () => {
    it('defaults the independent navigation collapse preference to false', () => {
        expect(localSettingsParse({}).navigationSidebarCollapsed).toBe(false);
    });

    it('changes navigation collapse without changing Zen mode', () => {
        const current = localSettingsParse({ zenMode: false });
        const collapsed = applyLocalSettings(current, { navigationSidebarCollapsed: true });

        expect(collapsed.navigationSidebarCollapsed).toBe(true);
        expect(collapsed.zenMode).toBe(false);
    });
});
