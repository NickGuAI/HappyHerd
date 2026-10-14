import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ reduced: false, timings: [] as any[] }));
vi.mock('react-native', () => ({
    Platform: { OS: 'ios' },
    View: 'View',
    Dimensions: { get: () => ({ height: 900 }) },
    Animated: {
        Value: class { value: number; constructor(value: number) { this.value = value; } setValue(value: number) { this.value = value; } },
        parallel: (animations: any[]) => ({
            start: () => animations.forEach((animation) => animation.start()),
            stop: () => animations.forEach((animation) => animation.stop()),
        }),
        timing: (value: any, config: any) => {
            const entry = { value, config, start: vi.fn(), stop: vi.fn() };
            state.timings.push(entry);
            return entry;
        },
    },
}));
vi.mock('react-native-reanimated', () => ({ useReducedMotion: () => state.reduced }));
vi.mock('react-native-unistyles', () => ({ StyleSheet: { create: (factory: any) => factory() } }));
import { useHerdSidebarTransition } from './sidebarTransition';
import { resetHerdSelectionGlide, useNativeHerdSelectionGlide } from './selectionGlide';

beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { resetHerdSelectionGlide(); vi.useRealTimers(); state.reduced = false; state.timings.length = 0; });

describe('native sidebar motion boundary', () => {
    it('keeps width open until content exits and cancels an interrupted close', () => {
        vi.useFakeTimers();
        let result: ReturnType<typeof useHerdSidebarTransition>;
        function Probe({ hidden }: { hidden: boolean }) { result = useHerdSidebarTransition(hidden); return null; }
        let renderer: any;
        act(() => { renderer = create(React.createElement(Probe, { hidden: false })); });
        act(() => renderer.update(React.createElement(Probe, { hidden: true })));
        expect(result!).toEqual({ widthHidden: false, phase: 'exiting' });
        act(() => vi.advanceTimersByTime(179));
        expect(result!.widthHidden).toBe(false);
        act(() => renderer.update(React.createElement(Probe, { hidden: false })));
        act(() => vi.advanceTimersByTime(500));
        expect(result!).toEqual({ widthHidden: false, phase: 'idle' });
        act(() => renderer.update(React.createElement(Probe, { hidden: true })));
        act(() => vi.advanceTimersByTime(180));
        expect(result!).toEqual({ widthHidden: true, phase: 'idle' });
        act(() => renderer.unmount());
    });

    it('snaps immediately with reduced motion', () => {
        state.reduced = true;
        let result: ReturnType<typeof useHerdSidebarTransition>;
        function Probe({ hidden }: { hidden: boolean }) { result = useHerdSidebarTransition(hidden); return null; }
        let renderer: any;
        act(() => { renderer = create(React.createElement(Probe, { hidden: false })); });
        act(() => renderer.update(React.createElement(Probe, { hidden: true })));
        expect(result!).toEqual({ widthHidden: true, phase: 'idle' });
        act(() => renderer.unmount());
    });

    it('measures current native row positions and stops an obsolete glide', () => {
        let top = 100;
        const first = { current: { measureInWindow: (cb: any) => cb(0, top, 240, 40) } };
        const second = { current: { measureInWindow: (cb: any) => cb(0, 250, 240, 40) } };
        function Probe({ selected }: { selected: string }) {
            useNativeHerdSelectionGlide('first', selected === 'first', first as any);
            useNativeHerdSelectionGlide('second', selected === 'second', second as any);
            return null;
        }
        let renderer: any;
        act(() => { renderer = create(React.createElement(Probe, { selected: 'first' })); });
        top = 150; // Scroll/resize before selection: never use a cached rectangle.
        act(() => renderer.update(React.createElement(Probe, { selected: 'second' })));
        expect(state.timings).toHaveLength(2);
        expect(state.timings[0].value.value).toBe(-100);
        expect(state.timings[0].config).toMatchObject({ toValue: 0, useNativeDriver: true });
        act(() => renderer.unmount());
        expect(state.timings[0].stop).toHaveBeenCalledOnce();
    });
});
