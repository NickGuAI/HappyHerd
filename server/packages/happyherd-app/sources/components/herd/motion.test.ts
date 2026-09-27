import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { darkTheme, lightTheme } from '@/theme';
import { HERD_HOST_CLASSES, HERD_MOTION, HERD_MOTION_CLASSES, herdStaggerClass, herdWebClasses } from './motion';

const css = readFileSync(resolve(__dirname, '../../theme.css'), 'utf8');

describe('HappyHerd fluid motion', () => {
    it('defines every motion class in theme.css', () => {
        for (const name of HERD_MOTION_CLASSES) {
            expect(css, name).toMatch(new RegExp(`\\.${name}(:active)?\\s*[{,]`));
        }
    });

    it('disables every animated or transitioning class for reduced motion', () => {
        const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n    .herd-rise'));
        expect(reduced.length).toBeGreaterThan(0);
        for (const name of HERD_MOTION_CLASSES) {
            expect(reduced, name).toContain(`.${name}`);
        }
    });

    it('reveals each host\'s controls on hover and never on touch-only screens', () => {
        for (const host of HERD_HOST_CLASSES) {
            expect(css, host).toContain(`.${host}:hover .${host}-reveal`);
        }
        const touch = css.slice(css.indexOf('@media (hover: none) {'));
        expect(touch).toMatch(/\.herd-shell-reveal, \.herd-row-reveal \{ display: none; \}/);
    });

    it('staggers list items in capped 45 ms steps', () => {
        expect(herdStaggerClass(0)).toBeUndefined();
        expect(herdStaggerClass(1)).toBe('herd-d1');
        expect(herdStaggerClass(7.9)).toBe('herd-d7');
        expect(herdStaggerClass(99)).toBe(`herd-d${HERD_MOTION.maxStaggerSteps}`);
        for (let step = 1; step <= HERD_MOTION.maxStaggerSteps; step++) {
            expect(css).toContain(`.herd-d${step} { animation-delay: ${step * HERD_MOTION.stagger}ms; }`);
        }
    });

    it('drops empty class names', () => {
        expect(herdWebClasses('herd-rise', false, undefined, null, '', herdStaggerClass(2))).toEqual(['herd-rise', 'herd-d2']);
    });
});

describe.each([['light', lightTheme], ['dark', darkTheme]] as const)('%s overhaul tokens', (_name, theme) => {
    it('uses a softer, ordered corner scale', () => {
        const { sm, md, lg, xl, xxl } = theme.borderRadius;
        expect([sm, md, lg, xl, xxl]).toEqual([...[sm, md, lg, xl, xxl]].sort((a, b) => a - b));
        expect(sm).toBeGreaterThanOrEqual(6);
        expect(theme.kilv.radius).toBeGreaterThanOrEqual(8);
        expect(theme.kilv.radiusCard).toBeGreaterThan(theme.kilv.radius);
        expect(theme.kilv.radiusSheet).toBeGreaterThanOrEqual(theme.kilv.radiusCard);
        // Phone surfaces are the roundest: the floating button, then the bottom sheets.
        expect(theme.kilv.radiusFab).toBeGreaterThan(theme.kilv.radiusSheet);
        expect(theme.kilv.radiusBottomSheet).toBeGreaterThan(theme.kilv.radiusFab);
    });

    it('shares one selected-state language', () => {
        expect(theme.colors.selection.border).toBe(theme.colors.textLink);
        expect(theme.colors.selection.ring).toContain(theme.colors.selection.border);
        expect(theme.colors.selection.background).toMatch(/^rgba\(/);
    });

    it('keeps the motion scale ordered', () => {
        expect(theme.kilv.motionFast).toBe(HERD_MOTION.fast);
        expect(theme.kilv.motionBase).toBe(HERD_MOTION.base);
        expect(theme.kilv.motionSlow).toBe(HERD_MOTION.slow);
        expect(theme.kilv.easeOut).toMatch(/^cubic-bezier\(/);
    });
});
