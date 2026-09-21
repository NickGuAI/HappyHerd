import { describe, expect, it } from 'vitest';
import {
    MOBILE_COMPOSER_BASE_HEIGHT,
    MOBILE_COMPOSER_CHROME_HEIGHT,
    MOBILE_COMPOSER_METRICS,
    resolveAgentInputLayout,
    resolveMobileCollapsedComposerGeometry,
    resolveMobileComposerActionGeometry,
    resolveMobileComposerActionRowGeometry,
    resolveMobileComposerHeight,
    resolveMobileComposerMenuGeometry,
} from './agentInputLayout';

describe('agent input compact mobile layout', () => {
    it('aligns composer text start with the left edge of the add glyph', () => {
        const layout = resolveAgentInputLayout({
            shellInset: 10,
            actionSize: 42,
            addIconSize: 26,
        });

        expect(layout.textInset).toBe(layout.shellInset + (42 - 26) / 2);
        expect(layout.inputContainerPaddingLeft).toBe(layout.inputContainerPaddingRight);
        expect(layout.inputContainerPaddingLeft).toBe((42 - 26) / 2);
    });

    it('keeps Home and Chat composers on one derived metric contract', () => {
        expect(MOBILE_COMPOSER_METRICS.inputFontSize).toBeGreaterThanOrEqual(16);
        expect(MOBILE_COMPOSER_METRICS.inputMinHeight).toBeGreaterThanOrEqual(44);
        expect(MOBILE_COMPOSER_BASE_HEIGHT).toBe(
            MOBILE_COMPOSER_METRICS.shellPaddingTop
            + MOBILE_COMPOSER_METRICS.inputMinHeight
            + MOBILE_COMPOSER_METRICS.actionRowHeight
            + MOBILE_COMPOSER_METRICS.shellPaddingBottom,
        );
        expect(MOBILE_COMPOSER_CHROME_HEIGHT).toBe(
            MOBILE_COMPOSER_BASE_HEIGHT - MOBILE_COMPOSER_METRICS.inputMinHeight,
        );
    });

    it('starts collapsed composer text where the capsule becomes straight', () => {
        const geometry = resolveMobileCollapsedComposerGeometry();

        expect(geometry.contentPaddingLeft).toBe(geometry.contentPaddingRight);
        expect(geometry.inputPaddingLeft).toBe(geometry.shellHeight / 2 - geometry.contentPaddingLeft);
        expect(geometry.textInset).toBe(geometry.contentPaddingLeft + geometry.inputPaddingLeft);
    });

    it('grows the chat shell as the input grows and when attachments appear', () => {
        expect(resolveMobileComposerHeight(1)).toBe(MOBILE_COMPOSER_BASE_HEIGHT);
        expect(resolveMobileComposerHeight(MOBILE_COMPOSER_METRICS.inputMaxHeight)).toBeGreaterThan(MOBILE_COMPOSER_BASE_HEIGHT);
        expect(resolveMobileComposerHeight(1, true)).toBe(
            MOBILE_COMPOSER_BASE_HEIGHT + MOBILE_COMPOSER_METRICS.attachmentExtraHeight,
        );
    });

    it.each(['icon', 'model', 'effort', 'permission'] as const)(
        'keeps %s native-menu frame geometry separate from label padding',
        (variant) => {
            const geometry = resolveMobileComposerMenuGeometry(variant);
            expect(geometry.frame).not.toHaveProperty('paddingLeft');
            expect(geometry.frame).not.toHaveProperty('paddingRight');
            expect(geometry.frame).not.toHaveProperty('paddingHorizontal');
            expect(geometry.frame).not.toHaveProperty('gap');
            if (variant === 'model') expect(geometry.frame.flexShrink).toBe(1);
            else expect(geometry.frame.flexShrink).toBe(0);
        },
    );

    it('uses identical row and circular-button geometry in both composers', () => {
        const row = resolveMobileComposerActionRowGeometry();
        const icon = resolveMobileComposerActionGeometry('icon');
        const primary = resolveMobileComposerActionGeometry('primary');

        expect(row.flexDirection).toBe('row');
        expect(row.height).toBe(MOBILE_COMPOSER_METRICS.actionRowHeight);
        expect(icon.width).toBe(primary.width);
        expect(icon.height).toBe(primary.height);
        expect(icon.borderRadius).toBe(Number(icon.width) / 2);
        expect(primary.borderRadius).toBe(Number(primary.width) / 2);
        expect(primary.marginLeft).toBe(MOBILE_COMPOSER_METRICS.primaryActionMarginLeft);
        expect(icon).not.toHaveProperty('marginLeft');
    });
});
