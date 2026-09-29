import * as React from 'react';
import { Pressable, View } from 'react-native';
import { FeedItem } from '@/sync/feedTypes';
import { Ionicons } from '@expo/vector-icons';
import { t } from '@/text';
import { useRouter } from 'expo-router';
import { useUser } from '@/sync/storage';
import { Avatar } from './Avatar';
import { HerdItem as Item } from './herd/pages/HerdList';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from './StyledText';
import { Typography } from '@/constants/Typography';

interface FeedItemCardProps {
    item: FeedItem;
    /**
     * `card` (the Inbox page, UI overhaul): each update is its own card with an
     * icon tile and the time at the top right, as in the mock. `row` (default)
     * keeps the grouped list row the Inbox bell's menu uses.
     */
    variant?: 'row' | 'card';
}

/** One Inbox update as the mock's card: icon tile, title, and time at the top right. */
function FeedCard({ title, time, tile, onPress, testID }: {
    title: string;
    time: string;
    tile: React.ReactNode;
    onPress?: () => void;
    testID: string;
}) {
    const body = (
        <>
            <View style={styles.tile}>{tile}</View>
            <Text style={styles.title} numberOfLines={3}>{title}</Text>
            <Text style={styles.time} numberOfLines={1}>{time}</Text>
        </>
    );
    return onPress ? (
        <Pressable
            testID={testID}
            accessibilityRole="button"
            accessibilityLabel={title}
            onPress={onPress}
            style={({ hovered, pressed }: any) => [styles.card, (hovered || pressed) && styles.cardHovered]}
        >
            {body}
        </Pressable>
    ) : (
        <View testID={testID} style={styles.card}>{body}</View>
    );
}

export const FeedItemCard = React.memo(({ item, variant = 'row' }: FeedItemCardProps) => {
    const { theme } = useUnistyles();
    const router = useRouter();

    // Get user profile from global users cache for friend-related items
    // User MUST exist for friend-related items or they would have been filtered out
    const user = useUser(
        (item.body.kind === 'friend_request' || item.body.kind === 'friend_accepted')
            ? item.body.uid
            : undefined
    );

    const getTimeAgo = (timestamp: number) => {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return t('time.justNow');
        if (minutes < 60) return t('time.minutesAgo', { count: minutes });
        if (hours < 24) return t('time.hoursAgo', { count: hours });
        return t('sessionHistory.daysAgo', { count: days });
    };

    switch (item.body.kind) {
        case 'friend_request': {
            const avatarElement = user!.avatar ? (
                <Avatar
                    id={user!.id}
                    imageUrl={user!.avatar.url}
                    size={variant === 'card' ? 36 : 40}
                />
            ) : (
                <Ionicons name="person" size={20} color={theme.colors.textSecondary} />
            );

            const title = t('feed.friendRequestFrom', { name: user!.firstName || user!.username });
            if (variant === 'card') {
                return <FeedCard testID={`feed-card-${item.id}`} title={title} time={getTimeAgo(item.createdAt)} tile={avatarElement} onPress={() => router.push(`/user/${user!.id}`)} />;
            }
            return (
                <Item
                    title={title}
                    subtitle={getTimeAgo(item.createdAt)}
                    leftElement={avatarElement}
                    onPress={() => router.push(`/user/${user!.id}`)}
                    showChevron={true}
                />
            );
        }

        case 'friend_accepted': {
            const avatarElement = user!.avatar ? (
                <Avatar
                    id={user!.id}
                    imageUrl={user!.avatar.url}
                    size={variant === 'card' ? 36 : 40}
                />
            ) : (
                <Ionicons name="checkmark-circle" size={20} color={theme.colors.status.connected} />
            );

            const title = t('feed.friendAccepted', { name: user!.firstName || user!.username });
            if (variant === 'card') {
                return <FeedCard testID={`feed-card-${item.id}`} title={title} time={getTimeAgo(item.createdAt)} tile={avatarElement} onPress={() => router.push(`/user/${user!.id}`)} />;
            }
            return (
                <Item
                    title={title}
                    subtitle={getTimeAgo(item.createdAt)}
                    leftElement={avatarElement}
                    onPress={() => router.push(`/user/${user!.id}`)}
                    showChevron={true}
                />
            );
        }

        case 'automation_blocked': {
            const title = t('feed.automationBlocked', { name: item.body.automationName, runId: item.body.runId });
            const icon = <Ionicons name="warning-outline" size={20} color={theme.colors.textSecondary} />;
            const { machineId, automationId } = item.body;
            const onPress = () => router.push({ pathname: '/automations', params: { machineId, automationId } });
            if (variant === 'card') {
                return <FeedCard testID={`feed-card-${item.id}`} title={title} time={getTimeAgo(item.createdAt)} tile={icon} onPress={onPress} />;
            }
            return <Item title={title} subtitle={getTimeAgo(item.createdAt)} icon={icon} onPress={onPress} showChevron={true} />;
        }

        case 'text':
            if (variant === 'card') {
                return (
                    <FeedCard
                        testID={`feed-card-${item.id}`}
                        title={item.body.text}
                        time={getTimeAgo(item.createdAt)}
                        tile={<Ionicons name="information-circle-outline" size={17} color={theme.colors.textSecondary} />}
                    />
                );
            }
            return (
                <Item
                    title={item.body.text}
                    subtitle={getTimeAgo(item.createdAt)}
                    icon={<Ionicons name="information-circle" size={20} color={theme.colors.textSecondary} />}
                    showChevron={false}
                />
            );

        default:
            return null;
    }
});

const styles = StyleSheet.create((theme) => ({
    // The mock's `.ibx` card: raised, hairline border, 14/16 padding, 14 px gap.
    card: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 14,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: theme.kilv.radiusCard,
        backgroundColor: theme.colors.surface,
    },
    cardHovered: {
        borderColor: theme.colors.kilv.rimLine,
    },
    tile: {
        width: 36,
        height: 36,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        backgroundColor: theme.colors.surfaceHighest,
    },
    title: {
        ...Typography.default('semiBold'),
        flex: 1,
        minWidth: 0,
        fontSize: 15,
        lineHeight: 21,
        color: theme.colors.text,
    },
    time: {
        ...Typography.mono(),
        flexShrink: 0,
        fontSize: 11.5,
        lineHeight: 21,
        color: theme.colors.kilv.inkFaint,
    },
}));
