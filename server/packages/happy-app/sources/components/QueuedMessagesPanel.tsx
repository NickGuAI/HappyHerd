import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { QueuedMessageProjectionItem, SessionQueueProjection } from '@/sync/queueProjection';
import { t } from '@/text';

function attachmentNames(item: QueuedMessageProjectionItem): string[] {
    return item.attachments.flatMap((attachment) => {
        const name = attachment.tool.input?.name;
        return typeof name === 'string' && name.trim() ? [name] : [];
    });
}

const QueueItem = React.memo(function QueueItem(props: {
    item: QueuedMessageProjectionItem;
    current: boolean;
    position: number;
}) {
    const { theme } = useUnistyles();
    const text = props.item.message.displayText ?? props.item.message.text;
    const names = attachmentNames(props.item);

    return (
        <View style={styles.item} testID={`queue-item-${props.item.id}`}>
            <View style={styles.itemMarker}>
                <Ionicons
                    name={props.current ? 'play-circle-outline' : 'time-outline'}
                    size={15}
                    color={props.current ? theme.colors.text : theme.colors.textSecondary}
                />
                {!props.current && (
                    <Text style={styles.position}>{props.position}</Text>
                )}
            </View>
            <View style={styles.itemContent}>
                {!!text.trim() && (
                    <Text style={styles.preview} numberOfLines={3}>{text}</Text>
                )}
                {names.map((name) => (
                    <View key={name} style={styles.attachmentRow}>
                        <Ionicons name="attach-outline" size={13} color={theme.colors.textSecondary} />
                        <Text style={styles.attachmentName} numberOfLines={1}>{name}</Text>
                    </View>
                ))}
            </View>
        </View>
    );
});

/** Read-only projection of runtime-owned queue state. */
export const QueuedMessagesPanel = React.memo(function QueuedMessagesPanel(props: {
    projection: SessionQueueProjection;
}) {
    const totalCount = props.projection.pendingCount + props.projection.currentCount;
    if (totalCount === 0) return null;

    return (
        <View
            style={styles.panel}
            testID="queued-messages-panel"
            accessible
            accessibilityLabel={`${t('happyHerd.composer.queueMessage')}. ${t('uiCopy.valueQueued', { value1: totalCount })}`}
        >
            <View style={styles.header}>
                <View style={styles.titleRow}>
                    <Ionicons name="list-outline" size={16} style={styles.titleIcon} />
                    <Text style={styles.title}>{t('happyHerd.composer.queueMessage')}</Text>
                </View>
                <Text style={styles.count}>{t('uiCopy.valueQueued', { value1: totalCount })}</Text>
            </View>
            <ScrollView
                style={styles.itemsViewport}
                contentContainerStyle={styles.items}
                nestedScrollEnabled
                showsVerticalScrollIndicator={totalCount > 3}
            >
                {props.projection.currentItems.map((item) => (
                    <QueueItem key={`current-${item.id}`} item={item} current position={0} />
                ))}
                {props.projection.pendingItems.map((item, index) => (
                    <QueueItem key={`pending-${item.id}`} item={item} current={false} position={index + 1} />
                ))}
            </ScrollView>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    panel: {
        marginHorizontal: 8,
        marginBottom: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        borderRadius: 14,
        backgroundColor: theme.colors.surfaceHigh,
        overflow: 'hidden',
    },
    header: {
        minHeight: 36,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    titleIcon: {
        color: theme.colors.text,
    },
    title: {
        color: theme.colors.text,
        fontSize: 13,
        fontWeight: '600',
    },
    count: {
        color: theme.colors.textSecondary,
        fontSize: 11,
        fontWeight: '500',
    },
    itemsViewport: {
        maxHeight: 184,
    },
    items: {
        paddingVertical: 4,
    },
    item: {
        minHeight: 42,
        paddingHorizontal: 12,
        paddingVertical: 7,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
    },
    itemMarker: {
        width: 18,
        minHeight: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    position: {
        color: theme.colors.textSecondary,
        fontSize: 9,
        lineHeight: 10,
    },
    itemContent: {
        flex: 1,
        gap: 3,
    },
    preview: {
        color: theme.colors.text,
        fontSize: 13,
        lineHeight: 18,
    },
    attachmentRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    attachmentName: {
        flex: 1,
        color: theme.colors.textSecondary,
        fontSize: 11,
    },
}));
