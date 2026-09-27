import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { SidebarNavigator } from '@/components/SidebarNavigator';
import { HerdCommandPaletteContext } from '@/components/herd/shell/commandPaletteBridge';

function openPalette() {
    (window as any).__PALETTE_OPENS__ = ((window as any).__PALETTE_OPENS__ ?? 0) + 1;
}

function Fixture() {
    return (
        <HerdCommandPaletteContext.Provider value={openPalette}>
            <div data-testid="herd-shell-demo" style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
                <SidebarNavigator />
            </div>
        </HerdCommandPaletteContext.Provider>
    );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
