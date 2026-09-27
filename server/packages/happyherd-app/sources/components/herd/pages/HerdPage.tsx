import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { herdStaggerClass, herdWebClasses } from '@/components/herd/motion';

/**
 * Shared building blocks for the overhauled secondary pages (Automations,
 * Commanders, Projects, Inbox, Machine, Session details, What's New). They
 * carry the page head, buttons, chips, notices and empty states of the
 * approved mock so each page composes them instead of restyling locally.
 */

/** Desktop web / macOS at the width where pages switch to their wide layout. */
export function useHerdWideLayout(): boolean {
    const { width } = useWindowDimensions();
    return (Platform.OS === 'web' || Platform.OS === 'macos') && width >= 900;
}

export function HerdPageHeader({
    title,
    subtitle,
    subtitleMono = false,
    leading,
    actions,
    compact = false,
    testID,
}: {
    title?: string;
    subtitle?: string | null;
    subtitleMono?: boolean;
    leading?: React.ReactNode;
    actions?: React.ReactNode;
    compact?: boolean;
    testID?: string;
}) {
    return (
        <View testID={testID} style={[styles.head, compact && styles.headCompact]}>
            {leading ? <View style={styles.headLeading}>{leading}</View> : null}
            <View style={styles.headCopy}>
                {title ? (
                    <Text accessibilityRole="header" style={[styles.title, compact && styles.titleCompact]} numberOfLines={2}>
                        {title}
                    </Text>
                ) : null}
                {subtitle ? (
                    <Text style={[styles.subtitle, subtitleMono && styles.subtitleMono, !title && styles.subtitleAlone]}>
                        {subtitle}
                    </Text>
                ) : null}
            </View>
            {actions ? <View style={[styles.headActions, compact && styles.headActionsCompact]}>{actions}</View> : null}
        </View>
    );
}

export type HerdButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';

export function HerdButton({
    label,
    icon,
    onPress,
    variant = 'default',
    size = 'md',
    disabled = false,
    loading = false,
    selected,
    accessibilityLabel,
    testID,
    style,
}: {
    label?: string;
    icon?: React.ComponentProps<typeof Ionicons>['name'];
    onPress?: () => void;
    variant?: HerdButtonVariant;
    size?: 'md' | 'sm';
    disabled?: boolean;
    loading?: boolean;
    selected?: boolean;
    accessibilityLabel?: string;
    testID?: string;
    style?: StyleProp<ViewStyle>;
}) {
    const { theme } = useUnistyles();
    const tint = variant === 'primary'
        ? theme.colors.button.primary.tint
        : variant === 'danger'
            ? theme.colors.textDestructive
            : selected
                ? theme.colors.textLink
                : theme.colors.text;
    const iconSize = size === 'sm' ? 14 : 16;
    return (
        <Pressable
            testID={testID}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityState={{ disabled: disabled || loading, ...(selected === undefined ? {} : { selected }) }}
            aria-pressed={selected}
            disabled={disabled || loading}
            onPress={onPress}
            style={({ pressed }) => [
                styles.button,
                size === 'sm' && styles.buttonSmall,
                !label && (size === 'sm' ? styles.buttonIconSmall : styles.buttonIcon),
                variant === 'primary' && styles.buttonPrimary,
                variant === 'ghost' && styles.buttonGhost,
                variant === 'danger' && styles.buttonDanger,
                selected && styles.buttonSelected,
                pressed && styles.buttonPressed,
                (disabled || loading) && styles.disabled,
                style,
            ]}
        >
            {loading ? (
                <ActivityIndicator size="small" color={tint} />
            ) : icon ? (
                <Ionicons name={icon} size={iconSize} color={tint} />
            ) : null}
            {label ? (
                <Text numberOfLines={1} style={[styles.buttonText, size === 'sm' && styles.buttonTextSmall, { color: tint }, variant === 'primary' && styles.buttonTextPrimary]}>
                    {label}
                </Text>
            ) : null}
        </Pressable>
    );
}

export function HerdChip({
    label,
    selected = false,
    onPress,
    disabled = false,
    leading,
    mono = false,
    accessibilityRole = 'radio',
    accessibilityLabel,
    testID,
}: {
    label: string;
    selected?: boolean;
    onPress?: () => void;
    disabled?: boolean;
    leading?: React.ReactNode;
    mono?: boolean;
    accessibilityRole?: 'radio' | 'button';
    accessibilityLabel?: string;
    testID?: string;
}) {
    return (
        <Pressable
            testID={testID}
            disabled={disabled}
            onPress={onPress}
            accessibilityRole={accessibilityRole}
            accessibilityLabel={accessibilityLabel}
            accessibilityState={accessibilityRole === 'radio' ? { selected, checked: selected, disabled } : { selected, disabled }}
            // react-native-web reads ARIA props, not accessibilityState.
            aria-checked={accessibilityRole === 'radio' ? selected : undefined}
            aria-pressed={accessibilityRole === 'button' ? selected : undefined}
            style={({ pressed }) => [
                styles.chip,
                selected && styles.chipSelected,
                pressed && styles.buttonPressed,
                disabled && styles.disabled,
            ]}
        >
            {leading}
            <Text numberOfLines={1} style={[styles.chipText, mono && styles.chipTextMono, selected && styles.chipTextSelected]}>
                {label}
            </Text>
        </Pressable>
    );
}

/** Mono amber section label (`.lbl` in the mock). */
export function HerdSectionLabel({ children, first = false }: { children: string; first?: boolean }) {
    return <Text style={[styles.sectionLabel, first && styles.sectionLabelFirst]}>{children}</Text>;
}

export function HerdNotice({ message, tone = 'warning', testID }: {
    message: string;
    tone?: 'warning' | 'error';
    testID?: string;
}) {
    const { theme } = useUnistyles();
    const colors = tone === 'error' ? theme.colors.box.error : theme.colors.box.warning;
    return (
        <View testID={testID} accessibilityRole="alert" style={[styles.notice, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <Ionicons name={tone === 'error' ? 'alert-circle-outline' : 'warning-outline'} size={17} color={colors.text} />
            <Text style={[styles.noticeText, { color: colors.text }]}>{message}</Text>
        </View>
    );
}

export function HerdEmptyState({ title, description, action, icon, testID }: {
    title?: string;
    description?: string;
    action?: React.ReactNode;
    icon?: React.ComponentProps<typeof Ionicons>['name'];
    testID?: string;
}) {
    const { theme } = useUnistyles();
    return (
        <View testID={testID} style={styles.empty}>
            {icon ? <Ionicons name={icon} size={28} color={theme.colors.textSecondary} /> : null}
            {title ? <Text style={styles.emptyTitle}>{title}</Text> : null}
            {description ? <Text style={styles.emptyDescription}>{description}</Text> : null}
            {action ? <View style={styles.emptyAction}>{action}</View> : null}
        </View>
    );
}

/** Status dot (`.dot` in the mock): active glows, idle is faint. */
export function HerdDot({ tone }: { tone: 'ok' | 'accent' | 'off' | 'warn' | 'error' }) {
    return <View style={[styles.dot, styles[`dot_${tone}`]]} />;
}

/** Keyboard key cap used in hints. */
export function HerdKey({ label }: { label: string }) {
    return (
        <View style={styles.key}>
            <Text style={styles.keyText}>{label}</Text>
        </View>
    );
}

/**
 * Entrance motion for the n-th card or row of a page (web only). Unistyles
 * merges `_web` objects key by key, so two styles with `_classNames` in one
 * style list do not combine: use this only on elements without other web
 * classes, and fold the classes into one dynamic style otherwise.
 */
export const herdEnterStyles = StyleSheet.create(() => ({
    rise: (index: number) => ({
        _web: { _classNames: herdWebClasses('herd-rise-sm', herdStaggerClass(index)) },
    }),
    riseLarge: (index: number) => ({
        _web: { _classNames: herdWebClasses('herd-rise', herdStaggerClass(index)) },
    }),
}));

const styles = StyleSheet.create((theme) => ({
    head: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 20,
        marginBottom: 18,
        _web: { _classNames: herdWebClasses('herd-rise-sm') },
    },
    headCompact: {
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 14,
    },
    headLeading: {
        alignSelf: 'center',
    },
    headCopy: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 28,
        lineHeight: 34,
        letterSpacing: -0.4,
        color: theme.colors.text,
    },
    titleCompact: {
        fontSize: 23,
        lineHeight: 29,
    },
    subtitle: {
        ...Typography.default(),
        marginTop: 6,
        maxWidth: 720,
        fontSize: 14.5,
        lineHeight: 21,
        color: theme.colors.textSecondary,
    },
    subtitleMono: {
        ...Typography.mono(),
        fontSize: 13,
        lineHeight: 19,
    },
    subtitleAlone: {
        marginTop: 0,
    },
    headActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
    },
    headActionsCompact: {
        flexWrap: 'wrap',
    },
    button: {
        minHeight: 36,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        borderRadius: theme.borderRadius.md,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        _web: {
            _classNames: herdWebClasses('herd-transition', 'herd-press'),
            cursor: 'pointer',
            _hover: { borderColor: theme.colors.kilv.rimLine },
        },
    },
    buttonSmall: {
        minHeight: 30,
        paddingHorizontal: 11,
        gap: 6,
        borderRadius: theme.borderRadius.sm,
    },
    buttonIcon: {
        width: 36,
        paddingHorizontal: 0,
    },
    buttonIconSmall: {
        width: 30,
        paddingHorizontal: 0,
    },
    buttonPrimary: {
        borderColor: theme.colors.button.primary.background,
        backgroundColor: theme.colors.button.primary.background,
        _web: {
            _hover: {
                borderColor: theme.colors.kilv.accentHot,
                backgroundColor: theme.colors.kilv.accentHot,
                boxShadow: theme.kilv.glowMoltenSoft,
            },
        },
    },
    buttonGhost: {
        borderColor: 'transparent',
        backgroundColor: 'transparent',
        _web: { _hover: { borderColor: 'transparent', backgroundColor: theme.colors.surfacePressedOverlay } },
    },
    buttonDanger: {
        _web: { _hover: { borderColor: theme.colors.textDestructive } },
    },
    buttonSelected: {
        borderColor: theme.colors.selection.border,
        backgroundColor: theme.colors.selection.background,
    },
    buttonPressed: {
        opacity: 0.86,
    },
    buttonText: {
        ...Typography.default('semiBold'),
        fontSize: 14,
    },
    buttonTextSmall: {
        fontSize: 13,
    },
    buttonTextPrimary: {
        ...Typography.default('semiBold'),
    },
    disabled: {
        opacity: theme.kilv.disabledOpacity,
    },
    chip: {
        minHeight: 36,
        maxWidth: 280,
        paddingHorizontal: 13,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: theme.borderRadius.sm,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        _web: {
            _classNames: herdWebClasses('herd-transition', 'herd-press'),
            cursor: 'pointer',
            _hover: { borderColor: theme.colors.kilv.rimLine },
        },
    },
    chipSelected: {
        borderColor: theme.colors.selection.border,
        backgroundColor: theme.colors.selection.background,
        _web: { boxShadow: theme.colors.selection.ring },
    },
    chipText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    chipTextMono: {
        ...Typography.mono(),
        fontSize: 13,
    },
    chipTextSelected: {
        color: theme.colors.text,
    },
    sectionLabel: {
        ...Typography.mono('semiBold'),
        marginTop: 22,
        marginBottom: 10,
        fontSize: 11,
        lineHeight: 15,
        letterSpacing: 2,
        textTransform: 'uppercase',
        color: theme.colors.textLink,
    },
    sectionLabelFirst: {
        marginTop: 0,
    },
    notice: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderWidth: 1,
        borderRadius: theme.kilv.radiusCard,
        _web: { _classNames: herdWebClasses('herd-rise-sm') },
    },
    noticeText: {
        ...Typography.default(),
        flex: 1,
        fontSize: 14,
        lineHeight: 20,
    },
    empty: {
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 20,
        paddingVertical: 44,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: theme.colors.divider,
        borderRadius: theme.kilv.radiusCard,
        _web: { _classNames: herdWebClasses('herd-rise') },
    },
    emptyTitle: {
        ...Typography.default('semiBold'),
        fontSize: 17,
        color: theme.colors.text,
        textAlign: 'center',
    },
    emptyDescription: {
        ...Typography.default(),
        fontSize: 14.5,
        lineHeight: 21,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        maxWidth: 520,
    },
    emptyAction: {
        marginTop: 10,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    dot_ok: {
        backgroundColor: theme.colors.diff.success,
        _web: { boxShadow: `0 0 10px ${theme.colors.diff.success}` },
    },
    dot_accent: {
        backgroundColor: theme.colors.kilv.accent,
        _web: { boxShadow: theme.kilv.glowMoltenSoft },
    },
    dot_off: {
        backgroundColor: theme.colors.divider,
    },
    dot_warn: {
        backgroundColor: theme.colors.warning,
    },
    dot_error: {
        backgroundColor: theme.colors.textDestructive,
    },
    key: {
        minWidth: 20,
        height: 20,
        paddingHorizontal: 5,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.borderRadius.sm,
        borderWidth: 1,
        borderBottomWidth: 2,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    keyText: {
        ...Typography.mono(),
        fontSize: 11,
        lineHeight: 14,
        color: theme.colors.textSecondary,
    },
}));
