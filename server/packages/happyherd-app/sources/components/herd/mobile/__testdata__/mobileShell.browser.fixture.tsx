import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { SidebarNavigator } from '@/components/SidebarNavigator';
import { HerdCommandPaletteContext } from '@/components/herd/shell/commandPaletteBridge';

function openPalette() {
    (window as any).__PALETTE_OPENS__ = ((window as any).__PALETTE_OPENS__ ?? 0) + 1;
}

/** The signed-in phone shell exactly as the root layout mounts it; `palette=on` turns the command palette on. */
function Fixture() {
    const palette = new URLSearchParams(window.location.search).get('palette') === 'on' ? openPalette : null;
    return (
        <HerdCommandPaletteContext.Provider value={palette}>
            <div data-testid="phone-shell" style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
                <SidebarNavigator />
            </div>
        </HerdCommandPaletteContext.Provider>
    );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
