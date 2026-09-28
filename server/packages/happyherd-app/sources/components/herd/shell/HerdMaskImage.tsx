import * as React from 'react';
import { Image } from 'expo-image';

export type HerdMaskImageProps = {
    /** A `require()`d monochrome PNG; its alpha is the shape. */
    source: unknown;
    size: number;
    /** Native: the solid tint. */
    tint: string;
    /** Web: the CSS background painted through the shape (a color or a gradient). */
    fill?: string;
    testID?: string;
};

/**
 * A monochrome image painted in a theme color (UI overhaul). Native tints it
 * with expo-image; the web draws it as a CSS mask (HerdMaskImage.web.tsx).
 */
export function HerdMaskImage({ source, size, tint, testID }: HerdMaskImageProps) {
    return (
        <Image
            testID={testID}
            source={source as number}
            contentFit="contain"
            style={{ width: size, height: size }}
            tintColor={tint}
        />
    );
}
