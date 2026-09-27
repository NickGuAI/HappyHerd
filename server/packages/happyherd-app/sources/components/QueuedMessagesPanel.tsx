import { Text } from '@/components/StyledText';
import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';
import type { QueuedMessageProjectionItem, SessionQueueProjection } from '@/sync/queueProjection';
import { t } from '@/text';
import { herdWebClasses } from './herd/motion';
import { useIsTablet } from '@/utils/responsive';

function attachmentNames(item: QueuedMessageProjectionItem): string[] {
    return item.attachments.flatMap((attachment) => {
        const name = attachment.tool.input?.name;
        return typeof name === 'string' && name.trim() ? [name] : [];
    });
}

/**
 * One queued message on a single line (UI overhaul). The next message to be
 * delivered also says when it goes out and how many are waiting.
 */
const QueueItem = React.memo(function QueueItem(props: {
    item: QueuedMessageProjectionItem;
    current: boolean;
    position: number;
    tag?: string | null;
}) {
    const { theme } = useUnistyles();
    const text = props.item.message.displayText ?? props.item.message.text;
    const names = attachmentNames(props.item);
    const firstLine = text.trim().split('\n')[0] ?? '';

    return (
        <View style={styles.item} testID={`queue-item-${props.item.id}`}>
            <View style={styles.itemMarker}>
                <Ionicons
                    name={props.current ? 'play-circle-outline' : props.position === 1 ? 'list-outline' : 'time-outline'}
                    size={15}
                    color={theme.colors.textLink}
                />
            </View>
            <Text style={styles.preview} numberOfLines={1}>
                {firstLine}
            </Text>
            {names.length > 0 ? (
                <View style={styles.attachment}>
                    <Ionicons name="attach-outline" size={13} color={theme.colors.textSecondary} />
                    <Text style={styles.attachmentName} numberOfLines={1}>
                        {names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0]}
                    </Text>
                </View>
            ) : null}
            {props.tag ? (
                <Text style={styles.tag} numberOfLines={1}>{props.tag}</Text>
            ) : null}
        </View>
    );
});

/** Read-only projection of runtime-owned queue state. */
export const QueuedMessagesPanel = React.memo(function QueuedMessagesPanel(props: {
    projection: SessionQueueProjection;
}) {
    const { width } = useWindowDimensions();
    const phone = !useIsTablet();
    const totalCount = props.projection.pendingCount + props.projection.currentCount;
    if (totalCount === 0) return null;
    // Narrow docks keep the count and drop the timing, so the message stays readable.
    const queued = t('uiCopy.valueQueued', { value1: props.projection.pendingCount });
    const nextTag = props.projection.pendingCount > 0
        ? width < 520 ? queued : `${t('message.sendsAfterThisTurn')} · ${queued}`
        : null;

    return (
        <View
            style={[styles.panel, phone && styles.panelPhone]}
            testID="queued-messages-panel"
            accessible
            accessibilityLabel={`${t('happyHerd.composer.queueMessage')}. ${t('uiCopy.valueQueued', { value1: totalCount })}`}
        >
            <ScrollView
                style={styles.itemsViewport}
                contentContainerStyle={styles.items}
                nestedScrollEnabled
                showsVerticalScrollIndicator={totalCount > 4}
            >
                {props.projection.currentItems.map((item) => (
                    <QueueItem key={`current-${item.id}`} item={item} current position={0} />
                ))}
                {props.projection.pendingItems.map((item, index) => (
                    <QueueItem
                        key={`pending-${item.id}`}
                        item={item}
                        current={false}
                        position={index + 1}
                        tag={index === 0 ? nextTag : null}
                    />
                ))}
            </ScrollView>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    // Phones: the dock already sits on the 16 px gutter, level with the composer.
    panelPhone: {
        marginHorizontal: 0,
    },
    panel: {
        marginHorizontal: 8,
        marginBottom: 6,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: theme.colors.divider,
        borderRadius: theme.borderRadius.md,
        backgroundColor: 'transparent',
        overflow: 'hidden',
        _web: {
            _classNames: herdWebClasses('herd-rise-sm'),
        },
    },
    itemsViewport: {
        maxHeight: 160,
    },
    items: {
        paddingVertical: 2,
    },
    item: {
        minHeight: 38,
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    itemMarker: {
        width: 18,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    preview: {
        flex: 1,
        minWidth: 0,
        color: theme.colors.textSecondary,
        fontSize: 13.5,
        lineHeight: 18,
    },
    attachment: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        flexShrink: 1,
        maxWidth: '35%',
    },
    attachmentName: {
        flexShrink: 1,
        color: theme.colors.textSecondary,
        fontSize: 11.5,
        ...Typography.mono(),
    },
    tag: {
        flexShrink: 0,
        color: theme.colors.kilv.inkFaint,
        fontSize: 11.5,
        ...Typography.mono(),
    },
}));
