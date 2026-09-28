import * as React from 'react';
import { View } from 'react-native';
import { FOCUS_PIXEL_SWAP, FOCUS_PIXEL_SWAP_TOTAL, type FocusPixelSwapTile } from './focusPixelSwapTiming';

const easing = `cubic-bezier(${FOCUS_PIXEL_SWAP.easing.join(', ')})`;
const small = `scale(${FOCUS_PIXEL_SWAP.pixelScale})`;
// Keyframe offsets sit on the eased progress, as React Bits' opacity = min(1, eased × 1.6) does.
const GROW: Keyframe[] = [
    { opacity: 0, transform: small, offset: 0 },
    { opacity: 1, offset: 0.625 },
    { opacity: 1, transform: 'scale(1)', offset: 1 },
];
const CLEAR: Keyframe[] = [
    { opacity: 1, transform: 'scale(1)', offset: 0 },
    { opacity: 1, offset: 0.375 },
    { opacity: 0, transform: small, offset: 1 },
];

/**
 * Web: one tile grows in on its diagonal delay, holds, then clears on the same
 * diagonal one swap later, through the Web Animations API on the compositor.
 */
export function PixelSwapTile({ tile, color, onDone }: { tile: FocusPixelSwapTile; color: string; onDone?: () => void }) {
    const ref = React.useRef<View>(null);
    React.useEffect(() => {
        const node = ref.current as unknown as HTMLElement | null;
        if (!node || typeof node.animate !== 'function') {
            const timer = setTimeout(() => onDone?.(), FOCUS_PIXEL_SWAP_TOTAL);
            return () => clearTimeout(timer);
        }
        const timing = { duration: FOCUS_PIXEL_SWAP.pixelDuration, easing };
        const grow = node.animate(GROW, { ...timing, delay: tile.delay, fill: 'both' });
        // Forwards only: its first keyframe must not cover the grow during its delay.
        const clear = node.animate(CLEAR, { ...timing, delay: tile.delay + FOCUS_PIXEL_SWAP.duration, fill: 'forwards' });
        let active = true;
        clear.finished.then(() => {
            if (active) onDone?.();
        }, () => {});
        return () => {
            active = false;
            grow.cancel();
            clear.cancel();
        };
    }, [onDone, tile.delay]);
    return (
        <View
            ref={ref}
            testID="focus-mode-pixel-swap-tile"
            style={{
                position: 'absolute',
                left: tile.left,
                top: tile.top,
                // One px of overlap hides seams between neighbours.
                width: tile.size + 1,
                height: tile.size + 1,
                backgroundColor: color,
                opacity: 0,
            }}
        />
    );
}
