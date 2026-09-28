import type * as React from 'react';

/** Native overlays close at once (herd/presence.ts), so there is no exit layer. */
export function HerdExitLayer(_props: { children: React.ReactNode }) {
    return null;
}
