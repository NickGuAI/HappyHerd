import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { HerdModalContentWidthContext, resolveModalContentWidth, useHerdModalPreviewWidth } from './modalArea';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe(props: { windowWidth: number; max: number }) {
    return React.createElement('Probe', { width: useHerdModalPreviewWidth(props.windowWidth, props.max) });
}

/** The preview width in a modal whose content is `contentWidth` wide, or outside any modal when it is omitted. */
function previewWidth(windowWidth: number, max: number, contentWidth?: number): number {
    const probe = React.createElement(Probe, { windowWidth, max });
    let renderer: any;
    act(() => {
        renderer = create(contentWidth === undefined
            ? probe
            : React.createElement(HerdModalContentWidthContext.Provider, { value: contentWidth }, probe));
    });
    const width = renderer.root.findByType('Probe').props.width;
    act(() => renderer.unmount());
    return width;
}

describe('resolveModalContentWidth', () => {
    it('leaves a centered modal on a landscape iPhone the window less 20 px and the notch on each side', () => {
        expect(resolveModalContentWidth({ windowWidth: 844, sidePadding: 20, insetLeft: 47, insetRight: 47 })).toBe(710);
    });

    it('leaves a phone dialog there the window less 8 px and the notch on each side', () => {
        expect(resolveModalContentWidth({ windowWidth: 844, sidePadding: 8, insetLeft: 47, insetRight: 47 })).toBe(734);
    });

    it('takes only the padding from a desktop window, which has no side insets', () => {
        expect(resolveModalContentWidth({ windowWidth: 1440, sidePadding: 20, insetLeft: 0, insetRight: 0 })).toBe(1400);
    });

    it('never goes below zero', () => {
        expect(resolveModalContentWidth({ windowWidth: 100, sidePadding: 20, insetLeft: 47, insetRight: 47 })).toBe(0);
    });
});

describe('useHerdModalPreviewWidth', () => {
    it('takes the modal\'s content width over the window\'s', () => {
        expect(previewWidth(1200, 1120, 710)).toBe(710);
    });

    it('caps the width at max', () => {
        expect(previewWidth(1440, 1120, 1400)).toBe(1120);
    });

    it('falls back to the window less 20 px a side outside a modal', () => {
        expect(previewWidth(390, 1120)).toBe(350);
        expect(previewWidth(1440, 1120)).toBe(1120);
    });
});
