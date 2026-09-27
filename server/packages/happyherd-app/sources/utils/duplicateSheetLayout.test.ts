import { describe, expect, it } from 'vitest';
import { getDuplicateSheetFrame } from './duplicateSheetLayout';

describe('getDuplicateSheetFrame', () => {
    it('keeps the duplicate sheet inside a narrow phone viewport', () => {
        expect(getDuplicateSheetFrame({ width: 240, height: 516 })).toEqual({
            width: 208,
            maxHeight: 439,
        });
    });

    it('spans a phone less 8 px a side when it rests on the bottom edge', () => {
        expect(getDuplicateSheetFrame({ width: 390, height: 844 }, true)).toEqual({
            width: 374,
            maxHeight: 717,
        });
    });

    it('caps the duplicate sheet width on larger screens', () => {
        expect(getDuplicateSheetFrame({ width: 1200, height: 900 })).toEqual({
            width: 560,
            maxHeight: 765,
        });
    });

    // A landscape iPhone: 47 px insets on the notch side and the other.
    const landscapeInsets = { left: 47, right: 47 };

    it('keeps a phone dialog 8 px inside a landscape phone\'s side insets', () => {
        expect(getDuplicateSheetFrame({ width: 844, height: 390 }, true, landscapeInsets)).toEqual({
            width: 844 - 2 * 8 - 47 - 47,
            maxHeight: 332,
        });
    });

    it('caps the centered sheet within the width the side insets leave', () => {
        expect(getDuplicateSheetFrame({ width: 844, height: 390 }, false, landscapeInsets)).toEqual({
            width: 560,
            maxHeight: 332,
        });
        expect(getDuplicateSheetFrame({ width: 600, height: 900 }, false, landscapeInsets)).toEqual({
            width: 600 - 2 * 16 - 47 - 47,
            maxHeight: 765,
        });
    });
});
