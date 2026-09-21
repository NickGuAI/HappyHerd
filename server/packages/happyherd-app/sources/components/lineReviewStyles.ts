import { darkTheme, lightTheme } from '@/theme';

/** Shared visual values for rendered Markdown and Pierre's native review gutter. */
export function lineReviewVariables(dark: boolean, numberColor: string) {
    const colors = (dark ? darkTheme : lightTheme).colors;
    return {
        '--hh-review-number-width': '40px',
        '--hh-review-button-size': '20px',
        '--hh-review-gutter-gap': '2px',
        '--hh-review-content-gap': '4px',
        '--hh-review-gutter-width': 'calc(var(--hh-review-number-width) + var(--hh-review-gutter-gap) + var(--hh-review-button-size) + var(--hh-review-content-gap))',
        '--hh-review-number-color': numberColor,
        '--hh-review-accent': colors.textLink,
        '--hh-review-accent-text': colors.button.primary.tint,
        '--hh-review-highlight': colors.surfacePressedOverlay,
    };
}
