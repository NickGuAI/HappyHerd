import { create } from 'zustand';

// App-only adaptation of React Bits Pixel Swap's diagonal pattern: staggered,
// growing windows. The incoming content is solid amber, so tiles need no cloned
// DOM or native snapshots.
// Copyright (c) 2026 David Haz. MIT + Commons Clause; see docs/licenses/react-bits-pixel-swap.txt.
// https://github.com/DavidHDev/react-bits/blob/c5df8610c0b47d7cd805cda480baba402f7267c1/src/ts-default/Animations/PixelSwap/PixelSwap.tsx

/** React Bits' defaults: one swap takes `duration`, each tile `pixelDuration`. */
export const FOCUS_PIXEL_SWAP = {
    duration: 1400,
    pixelDuration: 450,
    pixelScale: 0.35,
    easing: [0.22, 1, 0.36, 1] as const,
} as const;

/** The time window the tile delays spread over: duration − pixelDuration. */
export const FOCUS_PIXEL_SWAP_SPREAD = FOCUS_PIXEL_SWAP.duration - FOCUS_PIXEL_SWAP.pixelDuration;

/** The tiles cover the window, then clear the same way: two swaps. */
export const FOCUS_PIXEL_SWAP_TOTAL = FOCUS_PIXEL_SWAP.duration * 2;

export type FocusPixelSwapTile = {
    index: number;
    left: number;
    top: number;
    size: number;
    /** When this tile starts growing in, in ms; it starts clearing `duration` later. */
    delay: number;
};

/** About 200 tiles for the window, never smaller than 64 px. */
export function focusPixelSwapTileSize(width: number, height: number): number {
    return Math.max(64, Math.ceil(Math.sqrt((width * height) / 200)));
}

/** React Bits' diagonal pattern: (x + y) / 2 over positions normalized to 0…1. */
export function focusPixelSwapOffset(column: number, row: number, columns: number, rows: number): number {
    const x = columns > 1 ? column / (columns - 1) : 0;
    const y = rows > 1 ? row / (rows - 1) : 0;
    return (x + y) / 2;
}

export function focusPixelSwapDelay(column: number, row: number, columns: number, rows: number): number {
    return focusPixelSwapOffset(column, row, columns, rows) * FOCUS_PIXEL_SWAP_SPREAD;
}

/** The tiles covering a `width` × `height` window, top-left first. */
export function focusPixelSwapTiles(width: number, height: number): FocusPixelSwapTile[] {
    const size = focusPixelSwapTileSize(width, height);
    const columns = Math.max(1, Math.ceil(width / size));
    const rows = Math.max(1, Math.ceil(height / size));
    const tiles: FocusPixelSwapTile[] = [];
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            tiles.push({
                index: row * columns + column,
                left: column * size,
                top: row * size,
                size,
                delay: focusPixelSwapDelay(column, row, columns, rows),
            });
        }
    }
    return tiles;
}

/**
 * The one Focus pixel swap: Start in the Focus setup plays it, and the top
 * bar's Focus control hosts it. A new id replays it from the first tile.
 */
export const useFocusPixelSwap = create<{ run: number | null }>()(() => ({ run: null }));

let nextRun = 0;

export function playFocusPixelSwap(): void {
    nextRun += 1;
    useFocusPixelSwap.setState({ run: nextRun });
}

export function endFocusPixelSwap(run: number): void {
    if (useFocusPixelSwap.getState().run === run) useFocusPixelSwap.setState({ run: null });
}
