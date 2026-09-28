import { describe, expect, it } from 'vitest';
import {
    FOCUS_PIXEL_SWAP,
    FOCUS_PIXEL_SWAP_SPREAD,
    FOCUS_PIXEL_SWAP_TOTAL,
    focusPixelSwapDelay,
    focusPixelSwapOffset,
    focusPixelSwapTileSize,
    focusPixelSwapTiles,
} from './focusPixelSwapTiming';

describe('Focus pixel swap timing (React Bits diagonal)', () => {
    it('keeps React Bits defaults: 1.4 s per swap, 450 ms per tile, a 950 ms spread, cover then clear', () => {
        expect(FOCUS_PIXEL_SWAP.duration).toBe(1400);
        expect(FOCUS_PIXEL_SWAP.pixelDuration).toBe(450);
        expect(FOCUS_PIXEL_SWAP.pixelScale).toBe(0.35);
        expect(FOCUS_PIXEL_SWAP.easing).toEqual([0.22, 1, 0.36, 1]);
        expect(FOCUS_PIXEL_SWAP_SPREAD).toBe(950);
        expect(FOCUS_PIXEL_SWAP_TOTAL).toBe(2800);
    });

    it('tiles the window with about 200 squares, never under 64 px', () => {
        expect(focusPixelSwapTileSize(1440, 900)).toBe(81);
        expect(focusPixelSwapTileSize(390, 844)).toBe(64);
        const desktop = focusPixelSwapTiles(1440, 900);
        expect(desktop).toHaveLength(18 * 12);
        const phone = focusPixelSwapTiles(390, 844);
        expect(phone).toHaveLength(7 * 14);
        // The last tile reaches the window's far corner.
        const last = desktop[desktop.length - 1];
        expect(last.left + last.size).toBeGreaterThanOrEqual(1440);
        expect(last.top + last.size).toBeGreaterThanOrEqual(900);
    });

    it('starts at the top-left, ends at the bottom-right 950 ms later, and rises along x + y', () => {
        const tiles = focusPixelSwapTiles(1440, 900);
        expect(tiles[0].delay).toBe(0);
        expect(tiles[tiles.length - 1].delay).toBe(950);
        expect(Math.max(...tiles.map((tile) => tile.delay))).toBe(950);
        const columns = 18;
        for (const tile of tiles) {
            const column = tile.index % columns;
            const row = Math.floor(tile.index / columns);
            if (column + 1 < columns) expect(tiles[tile.index + 1].delay).toBeGreaterThan(tile.delay);
            if (row + 1 < 12) expect(tiles[tile.index + columns].delay).toBeGreaterThan(tile.delay);
            expect(tile.delay).toBeCloseTo(((column / 17 + row / 11) / 2) * 950, 9);
        }
    });

    it('is equal along each anti-diagonal of a square grid', () => {
        for (let sum = 0; sum <= 8; sum += 1) {
            const delays = [];
            for (let column = 0; column <= 4; column += 1) {
                const row = sum - column;
                if (row >= 0 && row <= 4) delays.push(focusPixelSwapDelay(column, row, 5, 5));
            }
            expect(new Set(delays.map((delay) => delay.toFixed(9))).size).toBe(1);
            expect(delays[0]).toBeCloseTo((sum / 8) * 950, 9);
        }
    });

    it('does not divide by zero on a single row or column', () => {
        expect(focusPixelSwapOffset(0, 0, 1, 1)).toBe(0);
        expect(focusPixelSwapOffset(3, 0, 4, 1)).toBe(0.5);
        expect(focusPixelSwapOffset(0, 3, 1, 4)).toBe(0.5);
        const strip = focusPixelSwapTiles(64, 64);
        expect(strip).toEqual([{ index: 0, left: 0, top: 0, size: 64, delay: 0 }]);
        expect(focusPixelSwapTiles(1000, 40).every((tile) => Number.isFinite(tile.delay))).toBe(true);
    });
});
