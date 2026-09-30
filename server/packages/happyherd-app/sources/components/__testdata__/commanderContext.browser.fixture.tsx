import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { SessionView } from '@/-session/SessionView';

// The launch-context journey needs one foreground session. Keep the production
// host while avoiding unrelated routes and a hidden background session at load.
createRoot(document.getElementById('root')!).render(
    <div data-testid="foreground-session" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <SessionView id="parent" />
    </div>,
);
