import * as z from 'zod';

export const FOCUS_DURATIONS = [15, 30, 45, 60] as const;

export const FocusModeSchema = z.object({
    projectId: z.string().min(1),
    endsAt: z.number().finite().positive(),
}).passthrough();

export type FocusMode = z.infer<typeof FocusModeSchema>;

export function getActiveFocusMode(focusMode: FocusMode | null, now = Date.now()): FocusMode | null {
    return focusMode && focusMode.endsAt > now ? focusMode : null;
}

export function getFocusRemainingSeconds(focusMode: FocusMode | null, now = Date.now()): number {
    return focusMode ? Math.max(0, Math.ceil((focusMode.endsAt - now) / 1000)) : 0;
}

export function formatFocusRemaining(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
