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

    it('defaults the Side chat panel owner and preserves an explicit parent session', () => {
        expect(localSettingsParse({}).sidebarSideChatSessionId).toBeNull();
        expect(applyLocalSettings(localSettingsParse({}), {
            sidebarSideChatSessionId: 'parent-session',
        }).sidebarSideChatSessionId).toBe('parent-session');
    });

    it('keeps legacy persisted panel state readable while adding a null Side chat owner', () => {
        const legacy = localSettingsParse({
            sidebarPanelsOpen: ['sideChat'],
            sidebarPanelActive: 'sideChat',
        });

        expect(legacy.sidebarPanelsOpen).toEqual(['sideChat']);
        expect(legacy.sidebarPanelActive).toBe('sideChat');
        expect(legacy.sidebarSideChatSessionId).toBeNull();
    });
});

describe('command palette local setting (UI overhaul)', () => {
    it('turns the palette and the top bar search on by default', () => {
        expect(localSettingsParse({}).commandPaletteEnabled).toBe(true);
        expect(localSettingsParse(undefined).commandPaletteEnabled).toBe(true);
    });

    it('turns on the palette a device saved while it was opt-in, once', () => {
        // Every saved setting from before stored the old `false` default.
        const legacy = localSettingsParse({ commandPaletteEnabled: false, zenMode: true });
        expect(legacy.commandPaletteEnabled).toBe(true);
        expect(legacy.commandPaletteOnByDefault).toBe(true);
        expect(legacy.zenMode).toBe(true);
    });

    it('keeps an opt-out made after the default applies', () => {
        const optedOut = applyLocalSettings(localSettingsParse({}), { commandPaletteEnabled: false });
        const reloaded = localSettingsParse(JSON.parse(JSON.stringify(optedOut)));
        expect(reloaded.commandPaletteEnabled).toBe(false);
    });
});
