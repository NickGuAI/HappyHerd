import * as React from 'react';
import { Pressable, View } from 'react-native';
import { FeedItem } from '@/sync/feedTypes';
import { Ionicons } from '@expo/vector-icons';
import { t } from '@/text';
import { useRouter } from 'expo-router';
import { useMachine, useUser } from '@/sync/storage';
import { getMachineName } from '@/sync/machineChoices';
import { Avatar } from './Avatar';
import { HerdItem as Item } from './herd/pages/HerdList';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from './StyledText';
import { Typography } from '@/constants/Typography';
import { markFeedItemRead } from '@/sync/feedRead';
import { Modal } from '@/modal';

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
function FeedCard({ title, time, tile, unreadDot, onPress, testID }: {
    title: string;
    time: string;
    tile: React.ReactNode;
    unreadDot: React.ReactNode;
    onPress?: () => void;
    testID: string;
}) {
    const body = (
        <>
            <View style={styles.tile}>{tile}</View>
            <Text style={styles.title} numberOfLines={3}>{title}</Text>
            <View style={styles.metadata}>
                <Text style={styles.time} numberOfLines={1}>{time}</Text>
                {unreadDot}
            </View>
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

function AutomationBlockedFeedItem({ itemId, body, time, variant, unreadDot, onRead }: {
    itemId: string;
    body: Extract<FeedItem['body'], { kind: 'automation_blocked' }>;
    time: string;
    variant: 'row' | 'card';
    unreadDot: React.ReactNode;
    onRead: () => void;
}) {
    const machine = useMachine(body.machineId);
    const { theme } = useUnistyles();
    const router = useRouter();
    const title = machine
        ? t('feed.automationBlocked', { machine: getMachineName(machine), runId: body.runId })
        : t('feed.automationBlockedGeneric', { runId: body.runId });
    const icon = <Ionicons name="warning-outline" size={20} color={theme.colors.textSecondary} />;
    const { machineId, automationId } = body;
    const onPress = () => {
        router.push({ pathname: '/automations', params: { machineId, automationId } });
        onRead();
    };
    if (variant === 'card') {
        return <FeedCard testID={`feed-card-${itemId}`} title={title} time={time} tile={icon} unreadDot={unreadDot} onPress={onPress} />;
    }
    return (
        <Item
            title={title}
            accessibilityRole="button"
            accessibilityLabel={title}
            subtitle={time}
            icon={<View>{icon}{unreadDot && <View style={styles.iconUnreadDot}>{unreadDot}</View>}</View>}
            onPress={onPress}
            showChevron={true}
        />
    );
}

export const FeedItemCard = React.memo(({ item, variant = 'row' }: FeedItemCardProps) => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const reading = React.useRef(false);
    const read = async (userId?: string) => {
        if (userId) router.push(`/user/${userId}`);
        if (reading.current) return;
        reading.current = true;
        try {
            if (item.readAt == null) await markFeedItemRead(item.id);
        } catch {
            Modal.alert(t('common.error'), t('inbox.markReadFailed'));
        } finally {
            reading.current = false;
        }
    };
    const unreadDot = item.readAt == null
        ? <View testID={`feed-unread-${item.id}`} style={styles.unreadDot} />
        : null;

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
                return <FeedCard testID={`feed-card-${item.id}`} title={title} time={getTimeAgo(item.createdAt)} tile={avatarElement} unreadDot={unreadDot} onPress={() => { void read(user!.id); }} />;
            }
            return (
                <Item
                    title={title}
                    accessibilityRole="button"
                    accessibilityLabel={title}
                    subtitle={getTimeAgo(item.createdAt)}
                    leftElement={<View style={styles.rowIcon}>{avatarElement}{unreadDot}</View>}
                    onPress={() => { void read(user!.id); }}
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
                return <FeedCard testID={`feed-card-${item.id}`} title={title} time={getTimeAgo(item.createdAt)} tile={avatarElement} unreadDot={unreadDot} onPress={() => { void read(user!.id); }} />;
            }
            return (
                <Item
                    title={title}
                    accessibilityRole="button"
                    accessibilityLabel={title}
                    subtitle={getTimeAgo(item.createdAt)}
                    leftElement={<View style={styles.rowIcon}>{avatarElement}{unreadDot}</View>}
                    onPress={() => { void read(user!.id); }}
                    showChevron={true}
                />
            );
        }

        case 'automation_blocked': {
            return <AutomationBlockedFeedItem itemId={item.id} body={item.body} time={getTimeAgo(item.createdAt)} variant={variant} unreadDot={unreadDot} onRead={() => { void read(); }} />;
        }

        case 'text':
            if (variant === 'card') {
                return (
                    <FeedCard
                        testID={`feed-card-${item.id}`}
                        title={item.body.text}
                        time={getTimeAgo(item.createdAt)}
                        tile={<Ionicons name="information-circle-outline" size={17} color={theme.colors.textSecondary} />}
                        unreadDot={unreadDot}
                        onPress={() => { void read(); }}
                    />
                );
            }
            return (
                <Item
                    title={item.body.text}
                    accessibilityRole="button"
                    accessibilityLabel={item.body.text}
                    subtitle={getTimeAgo(item.createdAt)}
                    icon={<Ionicons name="information-circle" size={20} color={theme.colors.textSecondary} />}
                    rightElement={unreadDot}
                    onPress={() => { void read(); }}
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
    metadata: {
        alignItems: 'flex-end',
        gap: 6,
    },
    unreadDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: theme.colors.kilv.accent,
    },
    rowIcon: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    iconUnreadDot: {
        position: 'absolute',
        top: -3,
        right: -5,
    },
}));
