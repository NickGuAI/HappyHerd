import { describe, expect, it } from 'vitest';
import { createEntranceTracker, ENTRANCE_INITIAL_WINDOW_MS } from './entranceMotion';

describe('entrance motion', () => {
    it('rises the first paint, live arrivals and revealed members once', () => {
        const openedAt = 1_000;
        const tracker = createEntranceTracker(openedAt);
        tracker.captureBaseline(['m3', 'm2', 'm1']);
        expect(tracker.shouldAnimate('m3', new Set(), openedAt + 100)).toBe(true);
        tracker.markShown('m3');
        expect(tracker.shouldAnimate('m3', new Set(), openedAt + 100)).toBe(false);

        const later = openedAt + ENTRANCE_INITIAL_WINDOW_MS + 1;
        // History (including older pages) does not animate after the first paint.
        const live = tracker.liveIds(['m5', 'm4', 'm3', 'm2', 'm1', 'm0']);
        expect([...live]).toEqual(['m5', 'm4']);
        expect(tracker.shouldAnimate('m0', live, later)).toBe(false);
        expect(tracker.shouldAnimate('m5', live, later)).toBe(true);
        tracker.markShown('m5');
        expect(tracker.shouldAnimate('m5', live, later)).toBe(false);

        tracker.reveal(['m1', 'm5']);
        expect(tracker.shouldAnimate('m1', live, later)).toBe(true);
        expect(tracker.shouldAnimate('m5', live, later)).toBe(true);
        tracker.markShown('m1');
        expect(tracker.shouldAnimate('m1', live, later)).toBe(false);
    });

    it('keeps the first non-empty baseline', () => {
        const tracker = createEntranceTracker(0);
        tracker.captureBaseline([]);
        tracker.captureBaseline(['b', 'a']);
        tracker.captureBaseline(['c', 'b', 'a']);
        expect([...tracker.liveIds(['c', 'b', 'a'])]).toEqual(['c']);
    });
});
