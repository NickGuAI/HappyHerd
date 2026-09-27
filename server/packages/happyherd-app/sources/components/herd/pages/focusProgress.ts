import { FOCUS_DURATIONS, type FocusMode } from '@/sync/focusMode';

/**
 * Whole duration behind the focus countdown ring. Timers started from the
 * current setup record `startedAt` next to `endsAt` (the synced setting keeps
 * unknown fields); for older timers the chosen duration is the smallest option
 * that still covers the remaining time.
 */
export function focusModeTotalSeconds(focus: FocusMode, remainingSeconds: number): number {
    const startedAt = (focus as { startedAt?: unknown }).startedAt;
    if (typeof startedAt === 'number' && Number.isFinite(startedAt) && startedAt < focus.endsAt) {
        return Math.max(1, Math.round((focus.endsAt - startedAt) / 1000));
    }
    const minutes = FOCUS_DURATIONS.find((option) => option * 60 >= remainingSeconds)
        ?? FOCUS_DURATIONS[FOCUS_DURATIONS.length - 1];
    return Math.max(remainingSeconds, minutes * 60);
}

/** Remaining share of the focus session, from 1 (just started) to 0 (ended). */
export function focusModeProgress(focus: FocusMode, remainingSeconds: number): number {
    return Math.min(1, Math.max(0, remainingSeconds / focusModeTotalSeconds(focus, remainingSeconds)));
}
