/** Shared visual values for rendered Markdown and Pierre's native review gutter. */
export function lineReviewVariables(dark: boolean, numberColor: string) {
    return {
        '--hh-review-number-width': '40px',
        '--hh-review-button-size': '20px',
        '--hh-review-gutter-gap': '2px',
        '--hh-review-content-gap': '4px',
        '--hh-review-gutter-width': 'calc(var(--hh-review-number-width) + var(--hh-review-gutter-gap) + var(--hh-review-button-size) + var(--hh-review-content-gap))',
        '--hh-review-number-color': numberColor,
        '--hh-review-accent': dark ? '#d29922' : '#9a6700',
        '--hh-review-accent-text': dark ? '#0d1117' : '#ffffff',
        '--hh-review-highlight': dark ? 'rgba(210,153,34,.16)' : 'rgba(154,103,0,.12)',
    };
}
