import * as React from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { AvatarSkia } from "./AvatarSkia";
import { AvatarGradient } from "./AvatarGradient";
import { AvatarBrutalist } from "./AvatarBrutalist";
import { useSetting } from '@/sync/storage';
import { StyleSheet } from 'react-native-unistyles';
import { resolveAvatarHarness, type AvatarHarnessIcon } from '@/utils/avatarHarness';
import { HarnessBadgeIcon } from './HarnessBadgeIcon';
import { normalizeAvatarStyle } from '@/utils/avatarStyle';

export type AvatarBadgeLocation = 'sessionHeader' | 'sessionList' | 'none';

interface AvatarProps {
    id: string;
    title?: boolean;
    square?: boolean;
    size?: number;
    monochrome?: boolean;
    flavor?: string | null;
    clientId?: string | null;
    /** Where this avatar is rendered; omitted avatars never get a harness badge. */
    badgeLocation?: AvatarBadgeLocation;
    imageUrl?: string | null;
    thumbhash?: string | null;
    onImageError?: () => void;
}

// One badge geometry for every place an avatar carries a harness icon. The
// glyph ratios keep clear air between glyph and circle edge. The Happy "H"
// is a square mark, so its corners reach √2 further than its width — at
// 0.30 in a 0.42 circle the diagonal touched the rim exactly; 0.26 leaves a
// real margin.
function harnessBadgeSizes(size: number, harness: AvatarHarnessIcon) {
    const circleSize = Math.round(size * 0.42);
    const iconSize = harness === 'rig'
        ? Math.round(size * 0.26)
        : harness === 'codex'
            ? Math.round(size * 0.3)
            : harness === 'claude'
                ? Math.round(size * 0.34)
                : Math.round(size * 0.42);
    return { circleSize, iconSize };
}
const styles = StyleSheet.create((theme) => ({
    container: {
        position: 'relative',
    },
    harnessIcon: {
        position: 'absolute',
        bottom: -2,
        right: -2,
        backgroundColor: theme.colors.surface,
        borderRadius: 100,
        padding: 2,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
        elevation: 3,
    },
}));

export const Avatar = React.memo((props: AvatarProps) => {
    const { flavor, clientId, badgeLocation = 'none', size = 48, imageUrl, thumbhash, onImageError, ...avatarProps } = props;
    const avatarStyle = normalizeAvatarStyle(useSetting('avatarStyle'));
    // The black-and-white preference applies to every generated style; a
    // caller passing monochrome explicitly (e.g. offline rows) still wins.
    const monochromeSetting = useSetting('avatarMonochrome');
    if (monochromeSetting) {
        avatarProps.monochrome = true;
    }
    const showFlavorIcons = useSetting('showFlavorIcons');
    const showHarnessIconInSessionHeader = useSetting('showHarnessIconInSessionHeader');
    const showHarnessIcon = badgeLocation === 'sessionHeader'
        ? showHarnessIconInSessionHeader
        : badgeLocation === 'sessionList'
            ? showFlavorIcons
            : false;
    const effectiveHarness = resolveAvatarHarness(flavor, clientId);

    // Render custom image if provided
    if (imageUrl) {
        const imageElement = (
            <Image
                source={{ uri: imageUrl, thumbhash: thumbhash || undefined }}
                placeholder={thumbhash ? { thumbhash: thumbhash } : undefined}
                cachePolicy={imageUrl.startsWith('data:') ? 'memory' : 'disk'}
                contentFit="cover"
                onError={onImageError}
                style={{
                    width: size,
                    height: size,
                    borderRadius: avatarProps.square ? 0 : size / 2
                }}
            />
        );

        // Add harness icon overlay if enabled
        if (showHarnessIcon && effectiveHarness) {
            const { circleSize, iconSize } = harnessBadgeSizes(size, effectiveHarness);

            return (
                <View style={[styles.container, { width: size, height: size }]}>
                    {imageElement}
                    <View style={[styles.harnessIcon, {
                        width: circleSize,
                        height: circleSize,
                        alignItems: 'center',
                        justifyContent: 'center'
                    }]}>
                        <HarnessBadgeIcon harness={effectiveHarness} size={iconSize} />
                    </View>
                </View>
            );
        }

        return imageElement;
    }

    // Original generated avatar logic
    // Determine which avatar variant to render
    let AvatarComponent: React.ComponentType<any>;
    if (avatarStyle === 'pixelated') {
        AvatarComponent = AvatarSkia;
    } else if (avatarStyle === 'brutalist') {
        AvatarComponent = AvatarBrutalist;
    } else {
        AvatarComponent = AvatarGradient;
    }

    // Determine harness icon for generated avatars
    const { circleSize, iconSize } = effectiveHarness
        ? harnessBadgeSizes(size, effectiveHarness)
        : { circleSize: 0, iconSize: 0 };

    // Only wrap in a container when this caller explicitly opts into a badge
    // location and the session has an identifiable harness.
    if (showHarnessIcon && effectiveHarness) {
        return (
            <View style={[styles.container, { width: size, height: size }]}>
                <AvatarComponent {...avatarProps} size={size} />
                <View style={[styles.harnessIcon, {
                    width: circleSize,
                    height: circleSize,
                    alignItems: 'center',
                    justifyContent: 'center'
                }]}>
                    <HarnessBadgeIcon harness={effectiveHarness} size={iconSize} />
                </View>
            </View>
        );
    }

    // Return avatar without wrapper when not showing harness icons
    return <AvatarComponent {...avatarProps} size={size} />;
});
