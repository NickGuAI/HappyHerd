import * as React from 'react';
import { Animated, Easing } from 'react-native';
import { FOCUS_PIXEL_SWAP, FOCUS_PIXEL_SWAP_SPREAD, type FocusPixelSwapTile } from './focusPixelSwapTiming';

const easing = Easing.bezier(...FOCUS_PIXEL_SWAP.easing);

/**
 * Native: one tile grows in on its diagonal delay, holds, then clears on the
 * same diagonal one swap later, on the native driver.
 */
export function PixelSwapTile({ tile, color, onDone }: { tile: FocusPixelSwapTile; color: string; onDone?: () => void }) {
    const progress = React.useRef(new Animated.Value(0)).current;
    React.useEffect(() => {
        const animation = Animated.sequence([
            Animated.timing(progress, { toValue: 1, duration: FOCUS_PIXEL_SWAP.pixelDuration, delay: tile.delay, easing, useNativeDriver: true }),
            Animated.timing(progress, { toValue: 0, duration: FOCUS_PIXEL_SWAP.pixelDuration, delay: FOCUS_PIXEL_SWAP_SPREAD, easing, useNativeDriver: true }),
        ]);
        animation.start(({ finished }) => {
            if (finished) onDone?.();
        });
        return () => animation.stop();
    }, [onDone, progress, tile.delay]);
    return (
        <Animated.View
            testID="focus-mode-pixel-swap-tile"
            style={{
                position: 'absolute',
                left: tile.left,
                top: tile.top,
                // One px of overlap hides seams between neighbours.
                width: tile.size + 1,
                height: tile.size + 1,
                backgroundColor: color,
                // React Bits fades a tile in over the first 62.5% of its eased growth.
                opacity: progress.interpolate({ inputRange: [0, 0.625, 1], outputRange: [0, 1, 1] }),
                transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [FOCUS_PIXEL_SWAP.pixelScale, 1] }) }],
            }}
        />
    );
}
