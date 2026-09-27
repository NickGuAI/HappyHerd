import { describe, expect, it } from 'vitest';

import { focusModeProgress, focusModeTotalSeconds } from './focusProgress';

describe('focus countdown progress', () => {
    it('uses the recorded start for the whole duration', () => {
        const focus = { projectId: 'p', endsAt: 3_600_000, startedAt: 0 };
        expect(focusModeTotalSeconds(focus, 2_400)).toBe(3_600);
        expect(focusModeProgress(focus, 2_400)).toBeCloseTo(2 / 3);
    });

    it('falls back to the smallest duration covering the remaining time for older timers', () => {
        const focus = { projectId: 'p', endsAt: 1_000_000 };
        expect(focusModeTotalSeconds(focus, 14 * 60)).toBe(15 * 60);
        expect(focusModeTotalSeconds(focus, 40 * 60)).toBe(45 * 60);
        expect(focusModeTotalSeconds(focus, 75 * 60)).toBe(75 * 60);
    });

    it('ignores an unusable start and clamps progress to the ring', () => {
        expect(focusModeTotalSeconds({ projectId: 'p', endsAt: 1_000, startedAt: 5_000 }, 60)).toBe(15 * 60);
        expect(focusModeProgress({ projectId: 'p', endsAt: 60_000, startedAt: 0 }, 90)).toBe(1);
        expect(focusModeProgress({ projectId: 'p', endsAt: 60_000, startedAt: 0 }, 0)).toBe(0);
    });
});
