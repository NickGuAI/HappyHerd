import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { herdWebClasses } from '@/components/herd/motion';
import type { Theme } from '@/theme';
import { panelHoverWash, panelRimFaint } from './panelColors';

/**
 * Pill tab of the side panel and Workspace strips (UI overhaul, mock
 * `.rtab`): icon, one-line label, optional meta (count or +N −N) and a close
 * button that shows while the tab is hovered or active. Tabs without an
 * explicit label keep their visible text as the accessible name.
 */
export function HerdPanelTab(props: {
    label: string;
    active: boolean;
    onPress: () => void;
    renderIcon?: (color: string) => React.ReactNode;
    meta?: React.ReactNode;
    onClose?: () => void;
    closeLabel?: string;
    accessibilityLabel?: string;
    accessibilityRole?: 'tab' | 'button';
    disabled?: boolean;
    maxWidth?: number;
    entrance?: boolean;
    testID?: string;
}) {
    const { theme } = useUnistyles();
    const [hovered, setHovered] = React.useState(false);
    const color = props.active || hovered ? theme.colors.text : theme.colors.textSecondary;
    const role = props.accessibilityRole ?? 'tab';
    return (
        <Pressable
            accessibilityRole={role}
            accessibilityLabel={props.accessibilityLabel}
            aria-selected={role === 'tab' ? props.active : undefined}
            disabled={props.disabled}
            onPress={props.onPress}
            // Pointer enter/leave rather than hover in/out: leave fires only
            // when the pointer exits the tab and its close button, so moving
            // onto the close button does not hide it.
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            testID={props.testID}
            style={[
                props.entrance ? styles.tabEntrance : styles.tab,
                props.onClose ? styles.tabWithClose : null,
                props.maxWidth !== undefined ? { maxWidth: props.maxWidth } : null,
                hovered && !props.active ? styles.tabHovered : null,
                props.active ? styles.tabActive : null,
                props.disabled ? styles.tabDisabled : null,
            ]}
        >
            {props.renderIcon?.(color)}
            <Text numberOfLines={1} style={[styles.label, { color }, props.active && styles.labelActive]}>
                {props.label}
            </Text>
            {props.meta}
            {props.onClose ? (
                <Pressable
                    onPress={(event) => {
                        event.stopPropagation?.();
                        props.onClose?.();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={props.closeLabel}
                    hitSlop={6}
                    style={({ hovered: closeHovered }: any) => [
                        styles.close,
                        !(hovered || props.active) && styles.closeHidden,
                        closeHovered && styles.closeHovered,
                    ]}
                >
                    <Octicons name="x" size={12} color={theme.colors.kilv.inkFaint} />
                </Pressable>
            ) : null}
        </Pressable>
    );
}

/** +N −N line counts in a tab or a Changes row. */
export function HerdLineCounts(props: { added: number; removed: number; size?: number }) {
    const size = props.size ?? 11;
    if (props.added <= 0 && props.removed <= 0) return null;
    return (
        <View style={styles.counts}>
            {props.added > 0 ? (
                <Text style={[styles.count, styles.added, { fontSize: size }]}>+{props.added}</Text>
            ) : null}
            {props.removed > 0 ? (
                <Text style={[styles.count, styles.removed, { fontSize: size }]}>−{props.removed}</Text>
            ) : null}
        </View>
    );
}

/** Molten count badge (same look as the session header's Side chats count). */
export function HerdCountBadge(props: { count: number }) {
    if (props.count <= 0) return null;
    return (
        <View style={styles.badge}>
            <Text style={styles.badgeText}>{props.count}</Text>
        </View>
    );
}

const tabBase = (theme: Theme) => ({
    height: 32,
    flexShrink: 0,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 7,
    paddingLeft: 10,
    paddingRight: 10,
    borderRadius: theme.kilv.radius,
    borderWidth: 1,
    borderColor: 'transparent',
});

const styles = StyleSheet.create((theme) => ({
    tab: {
        ...tabBase(theme),
        _web: {
            cursor: 'pointer',
            _classNames: herdWebClasses('herd-transition'),
        },
    },
    // One `_web` block per element: Unistyles does not merge class lists.
    tabEntrance: {
        ...tabBase(theme),
        _web: {
            cursor: 'pointer',
            _classNames: herdWebClasses('herd-transition', 'herd-rise-sm'),
        },
    },
    tabWithClose: {
        paddingRight: 6,
    },
    tabHovered: {
        backgroundColor: panelHoverWash(theme),
    },
    tabActive: {
        backgroundColor: theme.colors.surfaceHighest,
        borderColor: panelRimFaint(theme),
    },
    tabDisabled: {
        opacity: theme.kilv.disabledOpacity,
    },
    label: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 13,
        lineHeight: 18,
        ...Typography.default(),
    },
    labelActive: {
        ...Typography.default('semiBold'),
    },
    close: {
        width: 18,
        height: 18,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        _web: {
            transition: `opacity ${theme.kilv.motionFast}ms ${theme.kilv.easeOut}`,
        },
    },
    closeHidden: {
        opacity: 0,
    },
    closeHovered: {
        backgroundColor: panelHoverWash(theme),
    },
    counts: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    count: {
        lineHeight: 16,
        ...Typography.mono('semiBold'),
    },
    added: {
        color: theme.colors.gitAddedText,
    },
    removed: {
        color: theme.colors.gitRemovedText,
    },
    badge: {
        minWidth: 18,
        height: 18,
        paddingHorizontal: 5,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.button.primary.background,
    },
    badgeText: {
        fontSize: 11,
        lineHeight: 14,
        color: theme.colors.button.primary.tint,
        ...Typography.mono('semiBold'),
    },
}));
