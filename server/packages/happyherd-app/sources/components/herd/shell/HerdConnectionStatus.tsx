import * as React from 'react';
import { Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { StatusDot } from '@/components/StatusDot';
import { shouldShowHomeConnectionStatus } from '@/components/homeConnectionStatus';
import { Typography } from '@/constants/Typography';
import { useSocketStatus } from '@/sync/storage';
import { t } from '@/text';

const STATUS_LABELS = {
    connected: 'status.connected',
    connecting: 'status.connecting',
    disconnected: 'status.disconnected',
    error: 'status.error',
} as const;

/**
 * The phone session list's connection line (UI overhaul): the status the
 * phone home header used to carry, shown only while the connection is not
 * healthy, on the 16 px gutter above the list.
 */
export function HerdConnectionStatus() {
    const { theme } = useUnistyles();
    const { status } = useSocketStatus();
    if (!shouldShowHomeConnectionStatus(status)) return null;
    const color = theme.colors.status[status];
    return (
        <View
            accessibilityLiveRegion="polite"
            aria-live="polite"
            style={styles.row}
            testID="herd-connection-status"
        >
            <StatusDot color={color} isPulsing={status === 'connecting'} size={6} />
            <Text numberOfLines={1} style={[styles.label, { color }]}>{t(STATUS_LABELS[status])}</Text>
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 24,
        paddingHorizontal: 16,
        paddingBottom: 6,
    },
    label: {
        ...Typography.default(),
        flexShrink: 1,
        fontSize: 12,
        fontWeight: '500',
        lineHeight: 16,
    },
}));
