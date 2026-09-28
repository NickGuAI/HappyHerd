import * as React from 'react';

let selected: string | null = null;
const listeners = new Set<() => void>();

export function selectFixtureSession(id: string) {
    selected = id;
    (window as any).__SELECTED_SESSION__ = id;
    listeners.forEach((listener) => listener());
}

export function useFixtureSelection(): string | null {
    return React.useSyncExternalStore(
        (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        () => selected,
        () => selected,
    );
}
