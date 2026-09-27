import * as React from 'react';
import { createRoot } from 'react-dom/client';

import NewSessionScreen from '@/app/(app)/new/index';
import StreamlineSettingsScreen from '@/app/(app)/settings/streamline';

function Fixture() {
    const screen = new URLSearchParams(window.location.search).get('screen');
    return (
        <div data-testid="new-session-fixture" style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            {screen === 'settings' ? <StreamlineSettingsScreen /> : <NewSessionScreen />}
        </div>
    );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
