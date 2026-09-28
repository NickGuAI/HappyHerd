import * as React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { endFocusPixelSwap, focusPixelSwapTiles, useFocusPixelSwap } from './focusPixelSwapTiming';
import { FocusPixelSwapLayer } from './FocusPixelSwapLayer';
import { PixelSwapTile } from './FocusPixelSwapTile';

/**
 * The amber pixel swap that plays when Focus mode starts: the tiles sweep in
 * from the top-left on React Bits' diagonal, then clear the same way onto the
 * app in Focus. Decorative: hidden from assistive tech, never a pointer target.
 */
export function FocusPixelSwap({ onDone }: { onDone: () => void }) {
    const { theme } = useUnistyles();
    const { width, height } = useWindowDimensions();
    // The window at Start; a resize mid-swap doesn't restart it.
    const [tiles] = React.useState(() => focusPixelSwapTiles(width, height));
    const last = tiles.reduce((latest, tile) => (tile.delay >= latest.delay ? tile : latest), tiles[0]);
    return (
        <FocusPixelSwapLayer>
            <View
                testID="focus-mode-pixel-swap"
                aria-hidden
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' }}
            >
                {tiles.map((tile) => (
                    <PixelSwapTile key={tile.index} tile={tile} color={theme.colors.kilv.molten} onDone={tile === last ? onDone : undefined} />
                ))}
            </View>
        </FocusPixelSwapLayer>
    );
}

/** Hosts the one Focus pixel swap that playFocusPixelSwap() starts. */
export function FocusPixelSwapHost() {
    const run = useFocusPixelSwap((state) => state.run);
    const onDone = React.useCallback(() => {
        if (run !== null) endFocusPixelSwap(run);
    }, [run]);
    if (run === null) return null;
    return <FocusPixelSwap key={run} onDone={onDone} />;
}
