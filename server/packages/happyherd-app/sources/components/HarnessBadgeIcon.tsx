import * as React from 'react';
import { Image } from 'expo-image';
import { useUnistyles } from 'react-native-unistyles';

import type { AvatarHarnessIcon } from '@/utils/avatarHarness';
import { ProviderIcon } from '@/components/ProviderIcon';

const harnessImages: Record<Exclude<AvatarHarnessIcon, 'grok' | 'dsh'>, number> = {
    claude: require('@/assets/images/icon-claude.png'),
    codex: require('@/assets/images/icon-gpt.png'),
    agy: require('@/assets/images/icon-agy.png'),
    rig: require('@/assets/images/logo-black.png'),
};

function RasterHarnessBadgeIcon({
    harness,
    size,
}: {
    harness: Exclude<AvatarHarnessIcon, 'grok' | 'dsh'>;
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

export function HarnessBadgeIcon({
    harness,
    size,
}: {
    harness: AvatarHarnessIcon;
    size: number;
}) {
    if (harness === 'grok' || harness === 'dsh') return <ProviderIcon kind={harness} size={size} />;
    return <RasterHarnessBadgeIcon harness={harness} size={size} />;
}
