import { describe, expect, it } from 'vitest';
import { clampPdfPan, fitPdfPage } from './pdfPageLayout';

describe('PDF page fitting', () => {
    it.each([
        [{ width: 600, height: 1200 }, { width: 390, height: 660 }, 0.55],
        [{ width: 600, height: 1200 }, { width: 844, height: 210 }, 0.175],
        [{ width: 1200, height: 600 }, { width: 390, height: 660 }, 0.325],
    ])('fits the entire page in the remaining reading area', (page, area, expected) => {
        const scale = fitPdfPage(page, area);
        expect(scale).toBeCloseTo(expected);
        expect(page.width * scale).toBeLessThanOrEqual(area.width);
        expect(page.height * scale).toBeLessThanOrEqual(area.height);
    });

    it('waits for measured layout before rendering', () => {
        expect(fitPdfPage({ width: 600, height: 1200 }, { width: 0, height: 0 })).toBe(0);
    });

    it('keeps the page centered on axes where it fits and bounds zoomed panning', () => {
        expect(clampPdfPan({ x: 1000, y: -1000 }, { width: 300, height: 900 }, { width: 390, height: 660 })).toEqual({ x: 0, y: -120 });
        expect(clampPdfPan({ x: 1000, y: 1000 }, { width: 780, height: 1320 }, { width: 390, height: 660 })).toEqual({ x: 195, y: 330 });
    });
});
