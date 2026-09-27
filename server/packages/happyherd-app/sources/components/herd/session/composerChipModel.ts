/**
 * Composer chips (UI overhaul): which settings chips fit the composer, and the
 * tone of the permission chip. The composer narrows when the Workspace or a
 * side panel shares the window, so visibility follows the composer's own
 * width rather than the window.
 */

/** Below this composer width the model and effort chips step aside. */
export const COMPOSER_MODEL_CHIPS_MIN_WIDTH = 640;
/** Below this composer width the permission chip steps aside (not on phones). */
export const COMPOSER_PERMISSION_CHIP_MIN_WIDTH = 520;
/** Below this width the context meter keeps its ring and drops its text. */
export const COMPOSER_CONTEXT_TEXT_MIN_WIDTH = 520;

export type ComposerChipVisibility = {
    agent: boolean;
    model: boolean;
    effort: boolean;
    permission: boolean;
    contextText: boolean;
};

export function resolveComposerChipVisibility(options: {
    /** Measured composer width; 0 while unmeasured. */
    width: number;
    /** Phone layout: agent and permission chips stay, model and effort move to the settings menu. */
    phone: boolean;
}): ComposerChipVisibility {
    const width = options.width > 0 ? options.width : Number.POSITIVE_INFINITY;
    if (options.phone) {
        return { agent: true, model: false, effort: false, permission: true, contextText: width >= COMPOSER_CONTEXT_TEXT_MIN_WIDTH };
    }
    const roomy = width >= COMPOSER_MODEL_CHIPS_MIN_WIDTH;
    return {
        agent: true,
        model: roomy,
        effort: roomy,
        permission: width >= COMPOSER_PERMISSION_CHIP_MIN_WIDTH,
        contextText: width >= COMPOSER_CONTEXT_TEXT_MIN_WIDTH,
    };
}

export type PermissionChipTone = 'danger' | 'info' | 'accent' | 'warning' | 'neutral';

/** Unrestricted modes read as a warning, edits as info, planning in the accent. */
export function resolvePermissionChipTone(modeKey: string | null | undefined): PermissionChipTone {
    switch (modeKey) {
        case 'bypassPermissions':
        case 'yolo':
        case 'danger-full-access':
            return 'danger';
        case 'safe-yolo':
            return 'warning';
        case 'acceptEdits':
            return 'info';
        case 'plan':
            return 'accent';
        default:
            return 'neutral';
    }
}

/** Remaining context, whole percent, from the used percentage the gauge reports. */
export function contextRemainingPercent(usedPercent: number): number {
    return Math.max(0, Math.min(100, Math.round(100 - usedPercent)));
}
