import { describe, expect, it } from 'vitest';

import { darkTheme, lightTheme } from '@/theme';
import {
    panelAlpha,
    panelGroundImage,
    panelHairline,
    panelHoverWash,
    panelRimFaint,
    panelSheetShadow,
    workspaceGround,
    workspaceGroundImage,
} from './panelColors';

describe('panelAlpha', () => {
    it('mixes the Unistyles web CSS variables instead of passing them through opaque', () => {
        expect(panelAlpha('var(--colors-kilv-ink)', 0.11)).toBe('color-mix(in srgb, var(--colors-kilv-ink) 11%, transparent)');
        expect(panelAlpha(' var(--colors-kilv-accent) ', 0.555)).toBe('color-mix(in srgb, var(--colors-kilv-accent) 55.5%, transparent)');
        expect(panelAlpha('var(--colors-kilv-ink)', 2)).toBe('color-mix(in srgb, var(--colors-kilv-ink) 100%, transparent)');
    });

    it('keeps the native hex and rgb(a) conversion', () => {
        expect(panelAlpha('#14100A', 0.11)).toBe('rgba(20, 16, 10, 0.11)');
        expect(panelAlpha('rgba(151, 172, 196, 0.5)', 0.36)).toBe('rgba(151, 172, 196, 0.18)');
        expect(panelAlpha(undefined, 0.5)).toBe('transparent');
    });
});

describe('panel surfaces', () => {
    it('derives the mock tints from KILV tokens in both palettes', () => {
        expect(panelHairline(darkTheme)).toBe('rgba(247, 244, 236, 0.13)');
        expect(panelHairline(lightTheme)).toBe('rgba(20, 16, 10, 0.11)');
        expect(panelHoverWash(darkTheme)).toBe('rgba(247, 244, 236, 0.07)');
        expect(panelRimFaint(darkTheme)).toBe('rgba(151, 172, 196, 0.18)');
        expect(panelSheetShadow(darkTheme)).toBe('-30px 0 60px rgba(0, 0, 0, 0.45)');
    });

    it('keeps the panel ground opaque and the Workspace ground on the page palette', () => {
        expect(panelGroundImage(lightTheme)).toBe('linear-gradient(rgba(20, 16, 10, 0.022), rgba(20, 16, 10, 0.022))');
        expect(workspaceGround(darkTheme)).toBe(darkTheme.colors.kilv.bg);
        expect(workspaceGround(lightTheme)).toBe(lightTheme.colors.kilv.bgSunken);
        expect(workspaceGroundImage(lightTheme)).toBe('none');
    });
});
