import { describe, expect, it } from 'vitest';
import {
    COMPOSER_MODEL_CHIPS_MIN_WIDTH,
    COMPOSER_PERMISSION_CHIP_MIN_WIDTH,
    contextRemainingPercent,
    resolveComposerChipVisibility,
    resolvePermissionChipTone,
} from './composerChipModel';

describe('composer chips', () => {
    it('keeps every chip while the composer is wide', () => {
        expect(resolveComposerChipVisibility({ width: 800, phone: false })).toEqual({
            agent: true, model: true, effort: true, permission: true, contextText: true,
        });
        // Unmeasured composers render everything rather than flashing chips in.
        expect(resolveComposerChipVisibility({ width: 0, phone: false }).model).toBe(true);
    });

    it('drops model and effort below 640px and the permission chip below 520px', () => {
        const narrow = resolveComposerChipVisibility({ width: COMPOSER_MODEL_CHIPS_MIN_WIDTH - 1, phone: false });
        expect(narrow).toMatchObject({ agent: true, model: false, effort: false, permission: true });
        const narrower = resolveComposerChipVisibility({ width: COMPOSER_PERMISSION_CHIP_MIN_WIDTH - 1, phone: false });
        expect(narrower).toMatchObject({ agent: true, model: false, effort: false, permission: false, contextText: false });
    });

    it('keeps the agent and permission chips on phones', () => {
        expect(resolveComposerChipVisibility({ width: 360, phone: true })).toMatchObject({
            agent: true, model: false, effort: false, permission: true,
        });
    });

    it('tones unrestricted, editing and planning permission modes', () => {
        expect(resolvePermissionChipTone('bypassPermissions')).toBe('danger');
        expect(resolvePermissionChipTone('yolo')).toBe('danger');
        expect(resolvePermissionChipTone('acceptEdits')).toBe('info');
        expect(resolvePermissionChipTone('plan')).toBe('accent');
        expect(resolvePermissionChipTone('default')).toBe('neutral');
        expect(resolvePermissionChipTone(null)).toBe('neutral');
    });

    it('reports remaining context from the used share', () => {
        expect(contextRemainingPercent(18)).toBe(82);
        expect(contextRemainingPercent(120)).toBe(0);
        expect(contextRemainingPercent(-4)).toBe(100);
    });
});
