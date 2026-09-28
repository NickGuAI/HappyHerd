import * as React from 'react';
import { createPortal } from 'react-dom';

/**
 * Web: the layer a closed overlay plays its exit on (see herd/presence.ts).
 * It covers the window like the overlay's Modal did, but it is `inert` and
 * lets pointers through, so the page takes clicks, focus and keys at once and
 * a dismissed menu can never run an action.
 */
export function HerdExitLayer({ children }: { children: React.ReactNode }) {
    const [host] = React.useState(() => {
        const element = document.createElement('div');
        element.setAttribute('inert', '');
        element.setAttribute('aria-hidden', 'true');
        Object.assign(element.style, {
            position: 'fixed',
            inset: '0',
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'none',
            zIndex: '9999',
        });
        return element;
    });
    React.useLayoutEffect(() => {
        document.body.appendChild(host);
        return () => host.remove();
    }, [host]);
    return createPortal(children, host);
}
