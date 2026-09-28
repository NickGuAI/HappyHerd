import * as React from 'react';

/** Lets a browser fixture place real content in the mocked drawer's screen slot. */
export const FixtureDrawerScreenContext = React.createContext<(() => React.ReactNode) | null>(null);
