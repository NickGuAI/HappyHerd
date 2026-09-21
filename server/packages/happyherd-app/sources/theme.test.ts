import { describe, expect, it } from 'vitest';
import { darkTheme, lightTheme } from './theme';

function rgba(color: string): number[] {
    if (color.startsWith('#')) return [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255).concat(1);
    return color.match(/[\d.]+/g)!.map((value, index) => Number(value) / (index < 3 ? 255 : 1));
}

function luminance(rgb: number[]) {
    return rgb.slice(0, 3).reduce((sum, value, index) => (
        sum + [0.2126, 0.7152, 0.0722][index] * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    ), 0);
}

function contrast(foreground: string, background: string, backdrop: string) {
    const fg = rgba(foreground);
    const layer = rgba(background);
    const underneath = rgba(backdrop);
    const bg = layer.slice(0, 3).map((value, index) => value * layer[3] + underneath[index] * (1 - layer[3]));
    const first = luminance(fg.slice(0, 3).map((value, index) => value * fg[3] + bg[index] * (1 - fg[3])));
    const second = luminance(bg);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe('KILV v3 themes', () => {
    it('keeps dark surfaces lifted above grouped chrome and shares the chat island', () => {
        expect(luminance(rgba(darkTheme.colors.surface))).toBeGreaterThan(luminance(rgba(darkTheme.colors.groupped.background)));
        expect(lightTheme.colors.kilv.islandTop).toBe(darkTheme.colors.kilv.islandTop);
        expect(lightTheme.colors.kilv.islandInk).toBe(darkTheme.colors.kilv.islandInk);
    });

    it.each([['light', lightTheme], ['dark', darkTheme]] as const)('%s keeps body, actions, inputs and status text readable', (_name, theme) => {
        const c = theme.colors;
        const pairs = [
            [c.text, c.surface], [c.textSecondary, c.surface], [c.textLink, c.surface],
            [c.text, c.groupped.background], [c.textSecondary, c.groupped.background], [c.textLink, c.groupped.background],
            [c.text, c.glass.overlay], [c.textSecondary, c.glass.overlay],
            [c.text, c.glass.overlayTint], [c.textSecondary, c.glass.overlayTint],
            [c.input.text, c.input.background], [c.input.placeholder, c.input.background],
            [c.button.primary.tint, c.button.primary.background],
            [c.box.error.text, c.box.error.background], [c.box.warning.text, c.box.warning.background],
            [c.permissionButton.deny.text, c.permissionButton.deny.background],
            [c.permissionButton.allow.text, c.permissionButton.allow.background],
            [c.permissionButton.allowAll.text, c.permissionButton.allowAll.background],
            [c.kilv.islandInk, c.kilv.islandTop], [c.kilv.islandDanger, c.kilv.islandBottom],
            ...Object.values(c.status).map((value) => [value, c.surface]),
        ];
        for (const [foreground, background] of pairs) {
            expect(contrast(foreground, background, c.groupped.background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(c.diff.markerAdded).not.toBe(c.diff.markerRemoved);
        expect(c.status.error).not.toBe(c.status.connected);
    });
});
