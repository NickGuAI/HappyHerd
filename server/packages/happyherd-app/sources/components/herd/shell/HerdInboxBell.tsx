import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { FeedItemCard } from '@/components/FeedItemCard';
import { UpdateBanner } from '@/components/UpdateBanner';
import { Typography } from '@/constants/Typography';
import { useInboxHasContent } from '@/hooks/useInboxHasContent';
import { useFeedItems, useFriendRequests } from '@/sync/storage';
import { t } from '@/text';
import { HerdPopover, measureHerdAnchor, type HerdAnchorRect } from '../HerdPopover';
import { herdStaggerClass, herdWebClasses } from '../motion';
import { HerdShellIcon } from './HerdShellIcon';
import { HerdTopBarIconButton } from './HerdTopBarIconButton';

const INBOX_PREVIEW_LIMIT = 6;
const INBOX_POPOVER_WIDTH = 380;

/**
 * Inbox bell: a count of pending friend requests (a dot for other unread
 * inbox content such as an update or unread What's New) and a dropdown with
 * the latest updates. The full Inbox page stays one press away.
 */
export function HerdInboxBell() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const triggerRef = React.useRef<View>(null);
    const [anchor, setAnchor] = React.useState<HerdAnchorRect | null>(null);
    const friendRequests = useFriendRequests();
    const feedItems = useFeedItems();
    const hasContent = useInboxHasContent();
    const count = friendRequests.length;
    const pathname = usePathname();
    // Any destination opened from the dropdown (a feed item, What's New) closes it.
    React.useEffect(() => setAnchor(null), [pathname]);

    const open = React.useCallback(async () => {
        if (anchor) {
            setAnchor(null);
            return;
        }
        setAnchor(await measureHerdAnchor(triggerRef.current));
    }, [anchor]);
    const close = React.useCallback(() => setAnchor(null), []);
    const openInbox = React.useCallback(() => {
        setAnchor(null);
        router.push('/inbox');
    }, [router]);

    const preview = feedItems.slice(0, INBOX_PREVIEW_LIMIT);

    return (
        <>
            <View ref={triggerRef} collapsable={false}>
                <HerdTopBarIconButton
                    label={t('tabs.inbox')}
                    active={!!anchor}
                    expanded={!!anchor}
                    onPress={open}
                    testID="herd-inbox-bell"
                >
                    <HerdShellIcon name="bell" size={18} color={anchor ? theme.colors.textLink : theme.colors.header.tint} />
                    {count > 0 ? (
                        <View style={styles.badge} testID="herd-inbox-count">
                            <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
                        </View>
                    ) : hasContent ? (
                        <View style={styles.dot} testID="herd-inbox-dot" />
                    ) : null}
                </HerdTopBarIconButton>
            </View>
            <HerdPopover
                visible={!!anchor}
                anchor={anchor}
                onClose={close}
                width={INBOX_POPOVER_WIDTH}
                accessibilityLabel={t('inbox.updates')}
                testID="herd-inbox-popover"
            >
                <View style={styles.header}>
                    <Text style={styles.title}>{t('inbox.updates')}</Text>
                    <Pressable
                        accessibilityRole="button"
                        onPress={openInbox}
                        testID="herd-inbox-open-page"
                        style={({ hovered, pressed }: any) => [styles.pageLink, (hovered || pressed) && styles.pageLinkHovered]}
                    >
                        <Text style={styles.pageLinkText}>{t('tabs.inbox')}</Text>
                        <Ionicons name="chevron-forward" size={13} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>
                <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                    <UpdateBanner />
                    {count > 0 && (
                        <Pressable
                            accessibilityRole="button"
                            onPress={openInbox}
                            style={({ hovered, pressed }: any) => [styles.requests, (hovered || pressed) && styles.pageLinkHovered]}
                        >
                            <Ionicons name="person-add-outline" size={16} color={theme.colors.textLink} />
                            <Text numberOfLines={1} style={styles.requestsText}>{t('friends.pendingRequests')}</Text>
                            <Text style={styles.requestsCount}>{count}</Text>
                        </Pressable>
                    )}
                    {preview.map((item, index) => (
                        <View key={item.id} style={styles.item(index)}>
                            <FeedItemCard item={item} />
                        </View>
                    ))}
                    {preview.length === 0 && count === 0 && !hasContent && (
                        <Text style={styles.empty}>{t('inbox.emptyTitle')}</Text>
                    )}
                </ScrollView>
            </HerdPopover>
        </>
    );
}

const styles = StyleSheet.create((theme) => ({
    // The mock's `.badge`: molten, 3 px inside the bell's corner.
    badge: {
        position: 'absolute',
        top: 3,
        right: 3,
        minWidth: 16,
        height: 16,
        paddingHorizontal: 4,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.kilv.accent,
        _web: {
            boxShadow: theme.kilv.glowMoltenSoft,
            _classNames: herdWebClasses('herd-check'),
        },
    },
    badgeText: {
        fontSize: 10,
        lineHeight: 12,
        color: theme.colors.kilv.accentInk,
        ...Typography.mono('semiBold'),
    },
    dot: {
        position: 'absolute',
        top: 7,
        right: 7,
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: theme.colors.kilv.accent,
        _web: { boxShadow: theme.kilv.glowMoltenSoft },
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingTop: 6,
        paddingBottom: 8,
    },
    title: {
        flex: 1,
        fontSize: 10.5,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
        color: theme.colors.textLink,
        ...Typography.mono(),
    },
    pageLink: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        height: 28,
        paddingHorizontal: 8,
        borderRadius: theme.kilv.radius,
    },
    pageLinkHovered: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    pageLinkText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    body: {
        flexGrow: 0,
        flexShrink: 1,
        minHeight: 0,
    },
    bodyContent: {
        gap: 4,
        paddingBottom: 4,
    },
    requests: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 44,
        paddingHorizontal: 10,
        borderRadius: theme.kilv.radius,
    },
    requestsText: {
        flex: 1,
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default(),
    },
    requestsCount: {
        fontSize: 12,
        color: theme.colors.textLink,
        ...Typography.mono('semiBold'),
    },
    item: (index: number) => ({
        borderRadius: theme.kilv.radius,
        overflow: 'hidden',
        _web: { _classNames: herdWebClasses('herd-rise-sm', herdStaggerClass(index)) },
    }),
    empty: {
        paddingHorizontal: 10,
        paddingVertical: 18,
        textAlign: 'center',
        fontSize: 14,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));
