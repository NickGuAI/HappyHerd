import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { SessionView } from '@/-session/SessionView';

createRoot(document.getElementById('root')!).render(
    <>
        <div data-testid="foreground-session" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <SessionView id="parent" />
        </div>
        <div style={{ display: 'none' }} aria-hidden="true">
            <SessionView id="background" />
        </div>
    </>,
);
