import * as React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Avatar } from '@/components/Avatar';
import { layout } from '@/components/layout';
import { herdWebClasses } from '@/components/herd/motion';
import { Typography } from '@/constants/Typography';
import { PRODUCT } from '@/constants/product';
import { useProfile } from '@/sync/storage';
import { getAvatarUrl, getBio, getDisplayName } from '@/sync/profile';

/**
 * The mock's profile card (UI overhaul): one row with a ringed avatar, the
 * name and email, at the top of the Account page.
 */
export const SettingsProfileCard = React.memo(function SettingsProfileCard() {
    const { theme } = useUnistyles();
    const profile = useProfile();
    const displayName = getDisplayName(profile);
    const avatarUrl = getAvatarUrl(profile);
    const bio = getBio(profile);
    return (
        <View style={styles.wrap}>
            <View style={styles.card} testID="settings-profile-card">
                <View style={styles.avatar}>
                    {profile.firstName ? (
                        <Avatar id={profile.id} size={56} imageUrl={avatarUrl} thumbhash={profile.avatar?.thumbhash} />
                    ) : (
                        <View style={styles.logoTile}>
                            <Image
                                source={require('@/assets/images/logo-black.png')}
                                contentFit="contain"
                                style={{ width: 32, height: 32 }}
                                tintColor={theme.colors.kilv.accent}
                            />
                        </View>
                    )}
                    <View pointerEvents="none" style={styles.ring} />
                </View>
                <View style={styles.identity}>
                    <Text numberOfLines={1} style={styles.name}>{profile.firstName ? displayName : PRODUCT.displayName}</Text>
                    {profile.github?.email ? <Text numberOfLines={1} selectable style={styles.email}>{profile.github.email}</Text> : null}
                    {bio ? <Text numberOfLines={2} style={styles.bio}>{bio}</Text> : null}
                </View>
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    wrap: {
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
    },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        padding: 18,
        marginTop: 16,
        marginHorizontal: 16,
        borderRadius: theme.kilv.radiusCard,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        _web: { _classNames: herdWebClasses('herd-rise') },
    },
    avatar: {
        width: 56,
        height: 56,
        flexShrink: 0,
    },
    logoTile: {
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHighest,
    },
    // The mock's live ring: 2 px of molten, 3 px outside the avatar.
    ring: {
        position: 'absolute',
        top: -3,
        right: -3,
        bottom: -3,
        left: -3,
        borderRadius: 31,
        borderWidth: 2,
        borderColor: theme.colors.kilv.accent,
        _web: { boxShadow: theme.kilv.glowMoltenSoft },
    },
    identity: {
        flex: 1,
        minWidth: 0,
    },
    name: {
        ...Typography.default('semiBold'),
        fontSize: 19,
        lineHeight: 25,
        color: theme.colors.text,
    },
    email: {
        ...Typography.mono(),
        fontSize: 13.5,
        lineHeight: 19,
        color: theme.colors.kilv.inkFaint,
    },
    bio: {
        ...Typography.default(),
        marginTop: 2,
        fontSize: 13.5,
        lineHeight: 19,
        color: theme.colors.textSecondary,
    },
}));
