import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { SidebarNavigator } from '@/components/SidebarNavigator';
import { CommandPalette } from '@/components/CommandPalette/CommandPalette';
import { CommandPaletteModal } from '@/components/CommandPalette/CommandPaletteModal';
import { HerdCommandPaletteContext } from '@/components/herd/shell/commandPaletteBridge';
import { TimestampLayoutFixture } from './mobileShellFixtureList';
import { useLocalSetting } from '@/sync/storage';

const record = (id: string) => () => {
    (window as any).__PALETTE_RUNS__ = [...((window as any).__PALETTE_RUNS__ ?? []), id];
};

/** A few of the provider's commands, in its categories, to lay the real palette out. */
const COMMANDS = [
    { id: 'new-session', title: 'New Chat', icon: 'add-circle-outline', shortcut: '⌘N', category: 'Sessions', action: record('new-session') },
    { id: 'session-auth', title: 'Refresh token rotation', subtitle: 'web-app', icon: 'time-outline', category: 'Recent Sessions', action: record('session-auth') },
    { id: 'session-dock', title: 'Composer chips and context meter', subtitle: 'happyherd', icon: 'time-outline', category: 'Recent Sessions', action: record('session-dock') },
    { id: 'settings', title: 'Settings', icon: 'settings-outline', shortcut: '⌘,', category: 'Navigation', action: record('settings') },
];

/**
 * The signed-in phone shell exactly as the root layout mounts it. The search
 * control opens the real command palette whenever the local setting allows
 * it, as CommandPaletteProvider does; the setting starts from the app's real
 * default and `palette=off` turns it off.
 */
function Fixture() {
    const [paletteOpen, setPaletteOpen] = React.useState(false);
    const openPalette = React.useCallback(() => {
        (window as any).__PALETTE_OPENS__ = ((window as any).__PALETTE_OPENS__ ?? 0) + 1;
        setPaletteOpen(true);
    }, []);
    const palette = useLocalSetting('commandPaletteEnabled') ? openPalette : null;
    const closePalette = React.useCallback(() => setPaletteOpen(false), []);
    return (
        <HerdCommandPaletteContext.Provider value={palette}>
            <div data-testid="phone-shell" style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
                <SidebarNavigator />
            </div>
            {paletteOpen && (
                <CommandPaletteModal visible onClose={closePalette}>
                    <CommandPalette commands={COMMANDS} onClose={closePalette} />
                </CommandPaletteModal>
            )}
        </HerdCommandPaletteContext.Provider>
    );
}

createRoot(document.getElementById('root')!).render(new URLSearchParams(window.location.search).has('timestamp') ? <TimestampLayoutFixture /> : <Fixture />);
