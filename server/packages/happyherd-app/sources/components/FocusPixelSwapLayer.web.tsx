import * as React from 'react';
import { createPortal } from 'react-dom';

/**
 * Web: the swap's layer covers the window above every sheet, menu and exit
 * layer. It is `inert` and lets pointers through, so the page keeps its
 * clicks, focus and keys while the tiles play.
 */
export function FocusPixelSwapLayer({ children }: { children: React.ReactNode }) {
    const [host] = React.useState(() => {
        const element = document.createElement('div');
        element.setAttribute('inert', '');
        element.setAttribute('aria-hidden', 'true');
        element.setAttribute('data-testid', 'focus-mode-pixel-swap-layer');
        Object.assign(element.style, {
            position: 'fixed',
            inset: '0',
            pointerEvents: 'none',
            zIndex: '10000',
        });
        return element;
    });
    React.useLayoutEffect(() => {
        document.body.appendChild(host);
        return () => host.remove();
    }, [host]);
    return createPortal(children, host);
}
