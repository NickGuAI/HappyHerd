export type HerdTooltipAlign = 'center' | 'start' | 'end';

/** Native has no hover; the tooltip is web-only (HerdTooltip.web.tsx). */
export function HerdTooltip(_props: { label: string; hint?: string; align?: HerdTooltipAlign; testID?: string }) {
    return null;
}
