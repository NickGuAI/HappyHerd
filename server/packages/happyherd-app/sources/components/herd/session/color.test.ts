import { describe, expect, it } from 'vitest';
import { herdAlpha } from './color';

describe('herdAlpha', () => {
    it('derives translucent colors from hex and rgb tokens', () => {
        expect(herdAlpha('#FFD79D', 0.25)).toBe('rgba(255, 215, 157, 0.25)');
        expect(herdAlpha('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
        expect(herdAlpha('rgba(240, 220, 176, 0.5)', 0.5)).toBe('rgba(240, 220, 176, 0.25)');
        expect(herdAlpha('rgb(1, 2, 3)', 0.1)).toBe('rgba(1, 2, 3, 0.1)');
        expect(herdAlpha(undefined, 0.3)).toBe('transparent');
    });

    it('mixes the CSS variables that Unistyles hands web style factories', () => {
        expect(herdAlpha('var(--colors-kilv-ink)', 0.11)).toBe('color-mix(in srgb, var(--colors-kilv-ink) 11%, transparent)');
        expect(herdAlpha(' var(--colors-text-link) ', 0.555)).toBe('color-mix(in srgb, var(--colors-text-link) 55.5%, transparent)');
        expect(herdAlpha('var(--colors-kilv-ink)', 2)).toBe('color-mix(in srgb, var(--colors-kilv-ink) 100%, transparent)');
    });
});
