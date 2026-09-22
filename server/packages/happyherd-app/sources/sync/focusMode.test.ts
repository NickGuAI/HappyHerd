import { describe, expect, it, vi } from 'vitest';
import {
    FOCUS_DURATIONS,
    FocusModeSchema,
    formatFocusRemaining,
    getActiveFocusMode,
    getFocusRemainingSeconds,
} from './focusMode';

describe('focus mode', () => {
    const startedAt = 1_800_000_000_000;
    const focus = { projectId: 'project-1', endsAt: startedAt + 30 * 60_000 };

    it('offers the four supported durations', () => {
        expect(FOCUS_DURATIONS).toEqual([15, 30, 45, 60]);
    });

    it('validates a project and an absolute end time', () => {
        expect(FocusModeSchema.parse(focus)).toEqual(focus);
        expect(FocusModeSchema.safeParse({ ...focus, projectId: '' }).success).toBe(false);
        expect(FocusModeSchema.safeParse({ projectId: 'project-1' }).success).toBe(false);
        expect(FocusModeSchema.safeParse({ ...focus, endsAt: Infinity }).success).toBe(false);
    });

    it('restores the same active timer with elapsed time removed after reload', () => {
        const restored = FocusModeSchema.parse(JSON.parse(JSON.stringify(focus)));
        const reopenedAt = startedAt + 10 * 60_000;
        expect(getActiveFocusMode(restored, reopenedAt)).toBe(restored);
        expect(getFocusRemainingSeconds(restored, reopenedAt)).toBe(20 * 60);
        expect(restored.endsAt).toBe(focus.endsAt);
    });

    it('stays off without a timer and after its original end time', () => {
        expect(getActiveFocusMode(null, startedAt)).toBeNull();
        expect(getFocusRemainingSeconds(null, startedAt)).toBe(0);
        expect(getActiveFocusMode(focus, focus.endsAt)).toBeNull();
        expect(getActiveFocusMode(focus, focus.endsAt + 60_000)).toBeNull();
        expect(getFocusRemainingSeconds(focus, focus.endsAt + 60_000)).toBe(0);
        expect(focus.endsAt).toBe(startedAt + 30 * 60_000);
    });

    it('shows the last second until the timer actually expires', () => {
        expect(getActiveFocusMode(focus, focus.endsAt - 1)).toBe(focus);
        expect(getFocusRemainingSeconds(focus, focus.endsAt - 1)).toBe(1);
        expect(getFocusRemainingSeconds(focus, focus.endsAt)).toBe(0);
    });

    it('uses the current clock when a time is not supplied', () => {
        const clock = vi.spyOn(Date, 'now').mockReturnValue(focus.endsAt - 60_000);
        try {
            expect(getActiveFocusMode(focus)).toBe(focus);
            expect(getFocusRemainingSeconds(focus)).toBe(60);
        } finally {
            clock.mockRestore();
        }
    });

    it.each([
        [0, '00:00'],
        [1, '00:01'],
        [59, '00:59'],
        [60, '01:00'],
        [15 * 60, '15:00'],
        [60 * 60, '60:00'],
    ])('formats %i remaining seconds as %s', (seconds, expected) => {
        expect(formatFocusRemaining(seconds)).toBe(expected);
    });
});
