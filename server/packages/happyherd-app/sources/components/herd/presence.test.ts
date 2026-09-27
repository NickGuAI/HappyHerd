import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

import { HERD_EXIT, useHerdExit } from './presence';

const media = vi.hoisted(() => ({ reduce: false }));
let seen: Array<{ value: string | null; exiting: boolean }> = [];

function Probe({ value }: { value: string | null }) {
    seen.push(useHerdExit(value, HERD_EXIT.pop));
    return null;
}

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('window', { matchMedia: () => ({ matches: media.reduce }) });
    const original = console.error;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        original(message, ...args);
    });
});
afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});
afterEach(() => {
    vi.useRealTimers();
    media.reduce = false;
    seen = [];
});

function last() {
    return seen[seen.length - 1];
}

describe('useHerdExit', () => {
    it('keeps the last value while the overlay plays its exit, then drops it', () => {
        vi.useFakeTimers();
        let renderer: any;
        act(() => { renderer = create(React.createElement(Probe, { value: 'anchor' })); });
        expect(last()).toEqual({ value: 'anchor', exiting: false });

        act(() => renderer.update(React.createElement(Probe, { value: null })));
        expect(last()).toEqual({ value: 'anchor', exiting: true });

        act(() => { vi.advanceTimersByTime(HERD_EXIT.pop - 1); });
        expect(last()).toEqual({ value: 'anchor', exiting: true });
        act(() => { vi.advanceTimersByTime(1); });
        expect(last()).toEqual({ value: null, exiting: false });
        act(() => renderer.unmount());
    });

    it('reopening during the exit shows the new value at once', () => {
        vi.useFakeTimers();
        let renderer: any;
        act(() => { renderer = create(React.createElement(Probe, { value: 'first' })); });
        act(() => renderer.update(React.createElement(Probe, { value: null })));
        act(() => renderer.update(React.createElement(Probe, { value: 'second' })));
        expect(last()).toEqual({ value: 'second', exiting: false });
        act(() => { vi.advanceTimersByTime(HERD_EXIT.pop * 2); });
        expect(last()).toEqual({ value: 'second', exiting: false });
        act(() => renderer.unmount());
    });

    it('drops the value at once when the viewer prefers reduced motion', () => {
        media.reduce = true;
        let renderer: any;
        act(() => { renderer = create(React.createElement(Probe, { value: 'anchor' })); });
        act(() => renderer.update(React.createElement(Probe, { value: null })));
        expect(last()).toEqual({ value: null, exiting: false });
        act(() => renderer.unmount());
    });
});
