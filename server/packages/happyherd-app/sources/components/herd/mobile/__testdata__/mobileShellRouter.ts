import * as React from 'react';

type RouteInput = string | { pathname: string; params?: Record<string, string> };

let stack: string[] = ['/'];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const toPath = (route: RouteInput) => typeof route === 'string'
    ? route
    : route.pathname + (route.params ? `?${new URLSearchParams(route.params)}` : '');

function record(route: RouteInput) {
    const path = toPath(route);
    (window as any).__ROUTER_CALLS__ = [...((window as any).__ROUTER_CALLS__ ?? []), path];
    stack = [...stack, path];
    emit();
}

/** A tiny in-memory stack standing in for Expo Router in the mobile shell fixture. */
export const router = {
    push: record,
    navigate: record,
    replace: record,
    back() {
        (window as any).__ROUTER_BACK_COUNT__ = ((window as any).__ROUTER_BACK_COUNT__ ?? 0) + 1;
        if (stack.length > 1) {
            stack = stack.slice(0, -1);
            emit();
        }
    },
    canGoBack: () => stack.length > 1,
    dismissTo: record,
    setParams() {},
};

// Lets a test open a route no visible control leads to in the fixture.
(window as any).__FIXTURE_ROUTER__ = router;

export function useFixturePath(): string {
    return React.useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => stack[stack.length - 1],
        () => stack[stack.length - 1],
    );
}
