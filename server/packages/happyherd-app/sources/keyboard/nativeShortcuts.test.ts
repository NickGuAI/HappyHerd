import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
import { dispatchNativeShortcut, getNativeShortcuts, registerNativeShortcuts, subscribeNativeShortcuts, type NativeShortcutEvent } from './nativeShortcuts';

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).reverse().forEach(cleanup => cleanup()); });
const key = (id: string, override: Partial<NativeShortcutEvent> = {}): NativeShortcutEvent => ({ id, key: 'Escape', meta: false, alt: false, shift: false, ...override });

describe('native command advertisement and dispatch', () => {
    it('retains both modal hosts while advertising their newest overlays first', () => {
        const root = vi.fn();
        const modal = vi.fn();
        cleanups.push(registerNativeShortcuts([{ id: 'root', key: 'Escape', scope: 'overlay', host: 'root-host' }], root));
        cleanups.push(registerNativeShortcuts([{ id: 'modal', key: 'Escape', scope: 'overlay', host: 'modal-host' }], modal));
        expect(getNativeShortcuts().map(command => [command.id, command.host])).toEqual([['modal', 'modal-host'], ['root', 'root-host']]);
        // Native host eligibility chooses its own descriptor, then returns its ID.
        dispatchNativeShortcut(key('modal'));
        expect(modal).toHaveBeenCalledTimes(1);
        expect(root).not.toHaveBeenCalled();
    });

    it('keeps permission candidates in oldest-first order behind overlay descriptors', () => {
        cleanups.push(registerNativeShortcuts([{ id: 'old', key: '1', scope: 'permission', target: 'old-target' }], vi.fn()));
        cleanups.push(registerNativeShortcuts([{ id: 'new', key: '1', scope: 'permission', target: 'new-target' }], vi.fn()));
        cleanups.push(registerNativeShortcuts([{ id: 'overlay', key: 'Escape', scope: 'overlay' }], vi.fn()));
        expect(getNativeShortcuts().map(command => command.id)).toEqual(['overlay', 'old', 'new']);
    });

    it('does not move an older pending card behind a newer card when its choices change', () => {
        const older = registerNativeShortcuts([{ id: 'old:0', key: '1', scope: 'permission', target: 'old' }], vi.fn());
        cleanups.push(older);
        cleanups.push(registerNativeShortcuts([{ id: 'new:0', key: '1', scope: 'permission', target: 'new' }], vi.fn()));
        older.update([
            { id: 'old:0', key: '1', scope: 'permission', target: 'old' },
            { id: 'old:1', key: '2', scope: 'permission', target: 'old' },
        ]);
        expect(getNativeShortcuts().map(command => command.target)).toEqual(['old', 'old', 'new']);
    });

    it('delivers captured key/modifier values without rebuilding them from current commands', () => {
        const run = vi.fn();
        cleanups.push(registerNativeShortcuts([{ id: 'composer', key: 'ArrowDown', scope: 'composer' }], run));
        const captured = key('composer', { key: 'Tab', shift: true });
        dispatchNativeShortcut(captured);
        expect(run).toHaveBeenCalledWith('composer', captured);
    });

    it('does not dispatch stale native events after the owner unmounts', () => {
        const run = vi.fn();
        const cleanup = registerNativeShortcuts([{ id: 'gone', key: 'Escape' }], run);
        cleanup();
        dispatchNativeShortcut(key('gone'));
        expect(run).not.toHaveBeenCalled();
    });

    it('publishes a stable snapshot until registration changes and notifies cleanup', () => {
        const listener = vi.fn();
        const stop = subscribeNativeShortcuts(listener);
        cleanups.push(stop);
        const cleanup = registerNativeShortcuts([{ id: 'owned', key: 'k', meta: true }], vi.fn());
        const snapshot = getNativeShortcuts();
        expect(getNativeShortcuts()).toBe(snapshot);
        cleanup();
        expect(listener).toHaveBeenCalledTimes(2);
        expect(getNativeShortcuts()).not.toBe(snapshot);
    });
});
