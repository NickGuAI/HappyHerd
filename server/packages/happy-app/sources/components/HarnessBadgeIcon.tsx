import * as React from 'react';
import { Image } from 'expo-image';
import { useUnistyles } from 'react-native-unistyles';

import type { AvatarHarnessIcon } from '@/utils/avatarHarness';

const harnessImages: Record<AvatarHarnessIcon, number> = {
    claude: require('@/assets/images/icon-claude.png'),
    codex: require('@/assets/images/icon-gpt.png'),
    agy: require('@/assets/images/icon-agy.png'),
    rig: require('@/assets/images/logo-black.png'),
};

export function HarnessBadgeIcon({
    harness,
    size,
}: {
    harness: AvatarHarnessIcon;
    size: number;
}) {
    const { theme } = useUnistyles();
    return (
        <Image
            accessible={false}
            source={harnessImages[harness]}
            contentFit="contain"
            style={{ height: size, width: size }}
            tintColor={harness === 'codex' || harness === 'rig' ? theme.colors.text : undefined}
        />
    );
}
