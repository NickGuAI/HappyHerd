/**
 * HappyHerd fluid motion (UI overhaul). Web motion is plain CSS defined in
 * `sources/theme.css`; components opt in through Unistyles
 * `_web: { _classNames: herdWebClasses(...) }`, so there is no runtime cost and
 * native rendering is unaffected. `prefers-reduced-motion` disables every class.
 */

/** Shared scale; mirrors theme.kilv.motion{Fast,Base,Slow}. */
export const HERD_MOTION = {
    fast: 140,
    base: 240,
    slow: 420,
    stagger: 45,
    maxStaggerSteps: 10,
} as const;

/** Every motion class defined in theme.css (guarded by motion.test.ts). */
export const HERD_MOTION_CLASSES = [
    'herd-rise',
    'herd-rise-sm',
    'herd-fade',
    'herd-pop',
    'herd-sheet',
    'herd-sheet-up',
    'herd-slide-left',
    'herd-slide-right',
    'herd-check',
    'herd-attention',
    'herd-thinking',
    'herd-breathe',
    'herd-transition',
    'herd-press',
    'herd-glide',
    'herd-exit-left',
    'herd-pop-out',
    'herd-sheet-out',
    'herd-sheet-down',
    'herd-fade-out',
    'herd-shell-reveal',
    'herd-row-reveal',
] as const;

/**
 * Structural hosts for the reveal classes above. They carry no motion of
 * their own, so they are outside the reduced-motion guard.
 */
export const HERD_HOST_CLASSES = ['herd-shell', 'herd-row'] as const;

export type HerdMotionClass = typeof HERD_MOTION_CLASSES[number];

/** Stagger class for the n-th item of a list (`herd-d1` … `herd-d10`); none for the first. */
export function herdStaggerClass(index: number): string | undefined {
    const step = Math.min(Math.max(Math.floor(index), 0), HERD_MOTION.maxStaggerSteps);
    return step > 0 ? `herd-d${step}` : undefined;
}

/** Compact helper for `_web._classNames`: drops falsy entries. */
export function herdWebClasses(...names: Array<HerdMotionClass | string | false | null | undefined>): string[] {
    return names.filter((name): name is string => typeof name === 'string' && name.length > 0);
}
