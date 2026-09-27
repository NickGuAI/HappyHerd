import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { FocusModeControl } from '@/components/FocusModeControl';
import { HeaderLogo } from '@/components/HeaderLogo';
import { StatusDot } from '@/components/StatusDot';
import { herdWebClasses } from '@/components/herd/motion';
import { HerdMachineMenu } from '@/components/herd/shell/HerdMachineMenu';
import { shouldShowHomeConnectionStatus } from '@/components/homeConnectionStatus';
import { Typography } from '@/constants/Typography';
import { useFocusMode } from '@/hooks/useFocusMode';
import { useSocketStatus } from '@/sync/storage';
import { t } from '@/text';

/** Space the session list leaves under its last row for the New session button. */
export const MOBILE_FAB_CLEARANCE = 88;

const STATUS_LABELS = {
    connected: 'status.connected',
    connecting: 'status.connecting',
    disconnected: 'status.disconnected',
    error: 'status.error',
} as const;

/**
 * Web Mobile home header (UI overhaul): the HappyHerd mark and the tab title
 * on the left, the tab's icon buttons on the right. An unhealthy connection
 * shows under the title, as the previous centered header did.
 */
export function MobileHomeHeader({ title, actions }: { title: string; actions?: React.ReactNode }) {
    const insets = useSafeAreaInsets();
    const { theme } = useUnistyles();
    const { status } = useSocketStatus();
    const showStatus = shouldShowHomeConnectionStatus(status);
    const statusColor = theme.colors.status[status];
    return (
        <View testID="mobile-home-header" style={[styles.header, { paddingTop: insets.top }]}>
            <View style={styles.headerRow}>
                <View style={styles.brand}>
                    <HeaderLogo />
                    <View style={styles.titleColumn}>
                        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{title}</Text>
                        {showStatus ? (
                            <View style={styles.status}>
                                <StatusDot color={statusColor} isPulsing={status === 'connecting'} size={6} />
                                <Text numberOfLines={1} style={[styles.statusText, { color: statusColor }]}>
                                    {t(STATUS_LABELS[status])}
                                </Text>
                            </View>
                        ) : null}
                    </View>
                </View>
                {actions ? <View style={styles.actions}>{actions}</View> : null}
            </View>
        </View>
    );
}

/** A 40 px icon button of the phone header. */
export function MobileHeaderIconButton({
    icon,
    label,
    onPress,
    testID,
}: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    onPress: () => void;
    testID?: string;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            testID={testID}
            style={({ pressed, hovered }: any) => [styles.iconButton, (pressed || hovered) && styles.iconButtonActive]}
        >
            <Ionicons name={icon} size={20} color={theme.colors.header.tint} />
        </Pressable>
    );
}

/**
 * The phone home's second row: Focus mode on the left (its countdown pill
 * while active) and the machine New Session uses on the right.
 */
export function MobileFocusRow() {
    const focus = useFocusMode();
    return (
        <View testID="mobile-focus-row" style={styles.focusRow}>
            <View style={styles.focusControl}>
                <FocusModeControl />
                {!focus ? <Text numberOfLines={1} style={styles.focusCaption}>{t('focusMode.enter')}</Text> : null}
            </View>
            <HerdMachineMenu compact />
        </View>
    );
}

/** Floating New session button above the tab bar. */
export function MobileNewSessionFab({ onPress }: { onPress: () => void }) {
    const { theme } = useUnistyles();
    // The entrance animates the wrapper so it cannot mask the pressed state.
    return (
        <View style={styles.fabPosition}>
            <Pressable
                testID="mobile-new-session-fab"
                accessibilityRole="button"
                accessibilityLabel={t('sidebar.newSession')}
                onPress={onPress}
                style={styles.fab}
            >
                <Ionicons name="create-outline" size={22} color={theme.colors.kilv.accentInk} />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    header: {
        backgroundColor: theme.colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    headerRow: {
        height: 58,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingLeft: 10,
        paddingRight: 8,
    },
    brand: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    titleColumn: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 17,
        lineHeight: 22,
        color: theme.colors.header.tint,
    },
    status: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    statusText: {
        ...Typography.default(),
        fontSize: 12,
        lineHeight: 16,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    iconButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.kilv.radius,
        _web: { _classNames: herdWebClasses('herd-transition'), cursor: 'pointer' },
    },
    iconButtonActive: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    focusRow: {
        height: 46,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        paddingLeft: 6,
        paddingRight: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    focusControl: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        minWidth: 0,
        flexShrink: 1,
    },
    focusCaption: {
        ...Typography.default(),
        fontSize: 13.5,
        color: theme.colors.textSecondary,
    },
    fabPosition: {
        position: 'absolute',
        right: 16,
        bottom: 16,
        zIndex: 6,
        _web: { _classNames: herdWebClasses('herd-check') },
    },
    fab: {
        width: 56,
        height: 56,
        borderRadius: theme.kilv.radiusSheet,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.kilv.accent,
        shadowColor: theme.colors.shadow.color,
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 8,
        _web: {
            _classNames: herdWebClasses('herd-transition', 'herd-press'),
            boxShadow: `${theme.kilv.glowMolten}, ${theme.kilv.shadow}`,
            cursor: 'pointer',
        },
    },
}));
