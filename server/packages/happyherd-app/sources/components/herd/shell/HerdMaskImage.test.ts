import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('expo-image', () => ({ Image: 'Image' }));

const renderers: ReactTestRenderer[] = [];

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()));
});

function render(element: React.ReactElement) {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(element);
    });
    renderers.push(renderer);
    return renderer;
}

describe('brand mark and Zen icon on the web', () => {
    it('paints the image as a CSS mask over its fill, so no SVG tint filter is needed', async () => {
        const { HerdMaskImage, herdMaskImageUri } = await import('./HerdMaskImage.web');
        // Expo's web build yields { uri, width, height } or a URL string for an image require.
        expect(herdMaskImageUri({ uri: '/assets/logo-black.png', width: 64, height: 64 })).toBe('/assets/logo-black.png');
        expect(herdMaskImageUri('/assets/zen.png')).toBe('/assets/zen.png');
        expect(herdMaskImageUri(12)).toBeNull();
        const renderer = render(React.createElement(HerdMaskImage, {
            source: { uri: '/assets/logo-black.png' }, size: 24, tint: '#F0DCB0', fill: 'linear-gradient(160deg, a, b)', testID: 'mark',
        }));
        const span = renderer.root.findByType('span' as any);
        expect(span.props['aria-hidden']).toBe('true');
        expect(span.props.style).toMatchObject({
            width: 24,
            height: 24,
            background: 'linear-gradient(160deg, a, b)',
            mask: 'url("/assets/logo-black.png") center / contain no-repeat',
            WebkitMask: 'url("/assets/logo-black.png") center / contain no-repeat',
        });
        expect(span.props.style.filter).toBeUndefined();
    });

    it('fills the brand mark with the mock gradient: molten on dark, bronze on paper', async () => {
        const { herdBrandMarkFill } = await import('./brandMark');
        const kilv = { moltenCore: '#FFF9EC', molten: '#F0DCB0', moltenDeep: '#C9AE85', accent: '#8F6E36', accentHot: '#6E5222' };
        expect(herdBrandMarkFill({ dark: true, colors: { kilv } })).toBe('linear-gradient(160deg, #FFF9EC 5%, #F0DCB0 45%, #C9AE85 92%)');
        expect(herdBrandMarkFill({ dark: false, colors: { kilv } })).toBe('linear-gradient(160deg, #8F6E36, #6E5222)');
    });
});
