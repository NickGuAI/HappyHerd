import * as React from 'react';
import { Image } from 'expo-image';
import { useUnistyles } from 'react-native-unistyles';

/**
 * Native tablets show the landing without the web horizon, which relies on CSS
 * masks and layered box shadows (see HerdLandingArt.web.tsx).
 */
export function HerdHorizon() {
    return null;
}

/** The brush mark in the accent color; the web fills it with the molten gradient. */
export function HerdBrandMark({ size }: { size: number }) {
    const { theme } = useUnistyles();
    return (
        <Image
            accessible={false}
            testID="herd-landing-mark"
            source={require('@/assets/images/logo-black.png')}
            contentFit="contain"
            style={{ width: size, height: size }}
            tintColor={theme.colors.kilv.accent}
        />
    );
}
