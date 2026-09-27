import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { herdWebClasses } from '@/components/herd/motion';
import { herdAlpha } from './color';

export type ComposerChipTone = 'agent' | 'neutral' | 'danger' | 'info' | 'accent' | 'warning';

/**
 * A composer settings chip (UI overhaul): mono label in a hairline pill that
 * opens its picker. `active` marks the chip whose popover is open.
 */
export const ComposerChip = React.forwardRef<View, {
    label: string;
    accessibilityLabel: string;
    /** Read-only chips announce as text. */
    accessibilityRole?: 'text';
    icon?: React.ReactNode;
    tone?: ComposerChipTone;
    active?: boolean;
    onPress?: () => void;
    testID?: string;
}>(function ComposerChip(props, ref) {
    const { theme } = useUnistyles();
    const [hovered, setHovered] = React.useState(false);
    const tone = props.tone ?? 'neutral';
    const toneColor = tone === 'agent' || tone === 'accent'
        ? theme.colors.textLink
        : tone === 'danger'
            ? theme.colors.textDestructive
            : tone === 'info'
                ? theme.colors.status.connecting
                : tone === 'warning'
                    ? theme.colors.warning
                    : null;
    const interactive = !!props.onPress;
    const color = toneColor ?? (hovered || props.active ? theme.colors.text : theme.colors.textSecondary);
    const borderColor = props.active
        ? herdAlpha(theme.colors.textLink, 0.55)
        : toneColor
            ? herdAlpha(toneColor, 0.45)
            : hovered ? theme.colors.kilv.rimLine : theme.colors.divider;
    const content = (
        <>
            {props.icon}
            <Text numberOfLines={1} style={[styles.label, { color }]}>{props.label}</Text>
        </>
    );
    if (!interactive) {
        return (
            <View
                ref={ref}
                accessibilityRole={props.accessibilityRole ?? 'text'}
                accessibilityLabel={props.accessibilityLabel}
                testID={props.testID}
                style={[styles.chip, { borderColor }]}
            >
                {content}
            </View>
        );
    }
    return (
        <Pressable
            ref={ref}
            accessibilityRole="button"
            accessibilityLabel={props.accessibilityLabel}
            accessibilityState={{ expanded: !!props.active }}
            aria-expanded={!!props.active}
            onPress={props.onPress}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            testID={props.testID}
            style={[styles.chip, styles.chipInteractive, { borderColor }, props.active && styles.chipActive]}
        >
            {content}
        </Pressable>
    );
});

/** Anchored popover above a composer chip, clamped inside the composer. */
export function ComposerChipPopover(props: {
    left: number;
    width: number;
    containerWidth: number;
    maxHeight?: number;
    children: React.ReactNode;
    testID?: string;
}) {
    const width = props.containerWidth > 0 ? Math.min(props.width, props.containerWidth) : props.width;
    const maxLeft = props.containerWidth > 0 ? Math.max(0, props.containerWidth - width) : props.left;
    const left = Math.max(0, Math.min(props.left, maxLeft));
    const maxHeight = props.maxHeight ?? 400;
    return (
        <View style={[styles.popover, { left, width }]} testID={props.testID} accessibilityRole="menu">
            <View style={[styles.popoverSurface, { maxHeight }]}>
                <ScrollView style={{ maxHeight }} keyboardShouldPersistTaps="always">
                    {props.children}
                </ScrollView>
            </View>
        </View>
    );
}

/**
 * Remaining context as a small ring plus "N% left" (UI overhaul). Pressing it
 * swaps the percentage for the exact token counts, as the gauge did before.
 */
export function ContextMeter(props: {
    remainingPercent: number;
    label: string;
    detail: string;
    /** `warning`/`critical` when the context is nearly full. */
    tone: 'normal' | 'warning' | 'critical';
    showText: boolean;
}) {
    const { theme } = useUnistyles();
    const ringColor = props.tone === 'critical'
        ? theme.colors.warningCritical
        : props.tone === 'warning' ? theme.colors.warning : theme.colors.textLink;
    const textColor = props.tone === 'normal' ? theme.colors.kilv.inkFaint : ringColor;
    const [precise, setPrecise] = React.useState(false);
    const size = 16;
    const strokeWidth = 3;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const remaining = Math.min(100, Math.max(0, props.remainingPercent));
    const text = precise ? props.detail : props.label;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={text}
            onPress={() => setPrecise((current) => !current)}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            style={({ hovered }: any) => [styles.meter, hovered && styles.meterHovered]}
            testID="composer-context-meter"
        >
            <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <Circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke={theme.colors.divider}
                    strokeWidth={strokeWidth}
                    fill="none"
                />
                <Circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke={ringColor}
                    strokeWidth={strokeWidth}
                    fill="none"
                    strokeDasharray={`${circumference} ${circumference}`}
                    strokeDashoffset={circumference * (1 - remaining / 100)}
                    rotation="-90"
                    originX={size / 2}
                    originY={size / 2}
                />
            </Svg>
            {props.showText ? (
                <Text style={[styles.meterText, { color: textColor }]} numberOfLines={1}>
                    {text}
                </Text>
            ) : null}
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 28,
        paddingHorizontal: 9,
        borderWidth: 1,
        borderRadius: theme.borderRadius.sm,
        backgroundColor: 'transparent',
        flexShrink: 1,
        minWidth: 0,
        maxWidth: 220,
    },
    chipInteractive: {
        _web: {
            cursor: 'pointer',
            _classNames: herdWebClasses('herd-transition', 'herd-press'),
        },
    },
    chipActive: {
        backgroundColor: theme.colors.selection.background,
    },
    label: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 12.5,
        lineHeight: 16,
        ...Typography.mono(),
    },
    popover: {
        position: 'absolute',
        bottom: '100%',
        marginBottom: 10,
        zIndex: 1000,
        _web: {
            _classNames: herdWebClasses('herd-pop'),
            transformOrigin: 'bottom left',
        },
    },
    popoverSurface: {
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        borderRadius: theme.kilv.radiusCard,
        backgroundColor: theme.colors.surface,
        paddingVertical: 6,
        overflow: 'hidden',
        _web: {
            boxShadow: theme.kilv.shadow,
        },
    },
    meter: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingHorizontal: 6,
        paddingVertical: 4,
        borderRadius: theme.borderRadius.sm,
        flexShrink: 0,
        _web: {
            cursor: 'pointer',
        },
    },
    meterHovered: {
        backgroundColor: theme.colors.glass.backgroundSubtle,
    },
    meterText: {
        fontSize: 12,
        lineHeight: 16,
        ...Typography.mono(),
    },
}));
