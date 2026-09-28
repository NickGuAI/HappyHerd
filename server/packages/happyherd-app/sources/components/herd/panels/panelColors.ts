import type { Theme } from '@/theme';
import { herdAlpha } from '@/components/herd/session/color';

/** The shared token translucency (`herdAlpha`), which also mixes web CSS variables. */
export const panelAlpha = herdAlpha;

/**
 * Side panel and Workspace surfaces (UI overhaul). The approved mock uses a
 * few tints that have no named theme token yet (the fainter hairlines, the
 * rim wash of an active tab, the panel and Workspace grounds). They are
 * derived here from existing KILV tokens so both palettes stay in step.
 */

/** Hairline between panel regions (mock `--hair2`). */
export function panelHairline(theme: Theme): string {
    return panelAlpha(theme.colors.kilv.ink, theme.dark ? 0.13 : 0.11);
}

/** Hover wash for rows and tabs (mock `--hair3`). */
export function panelHoverWash(theme: Theme): string {
    return panelAlpha(theme.colors.kilv.ink, theme.dark ? 0.07 : 0.06);
}

/** Border of the active tab (mock `--rim-faint`). */
export function panelRimFaint(theme: Theme): string {
    return panelAlpha(theme.colors.kilv.rimLine, 0.36);
}

/** Molten accent at an opacity (mock `--molten-aNN`). */
export function panelMolten(theme: Theme, opacity: number): string {
    return panelAlpha(theme.colors.kilv.accent, opacity);
}

/**
 * Panel ground (mock `--bg-panel`): the page background with a faint ink
 * lift, opaque so an overlay sheet never shows the chat through it. Web only;
 * native keeps the plain page background.
 */
export function panelGroundImage(theme: Theme): string {
    const lift = panelAlpha(theme.colors.kilv.ink, theme.dark ? 0.018 : 0.022);
    return `linear-gradient(${lift}, ${lift})`;
}

/**
 * Workspace ground beside the chat (mock `.ws-pane`): darker than the raised
 * slate in dark mode, the sunken paper in light mode.
 */
export function workspaceGround(theme: Theme): string {
    return theme.dark ? theme.colors.kilv.bg : theme.colors.kilv.bgSunken;
}

export function workspaceGroundImage(theme: Theme): string {
    if (!theme.dark) return 'none';
    const lift = panelAlpha(theme.colors.kilv.ink, 0.035);
    return `linear-gradient(${lift}, ${lift})`;
}

/** Left-cast shadow of an overlay sheet (mock `.panel-overlay`). */
export function panelSheetShadow(theme: Theme): string {
    return `-30px 0 60px ${panelAlpha(theme.colors.shadow.color, theme.dark ? 0.45 : 0.18)}`;
}
