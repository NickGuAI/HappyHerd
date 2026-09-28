import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';

export type HerdSegmentOption<T extends string | number> = { value: T; label: string };

/**
 * Equal-width segmented control whose selection slides between options
 * (KILV overhaul). The thumb animates `left` on web; native snaps. A value
 * that matches no option selects nothing. `fit` sizes each segment to its
 * label and lets a label take two lines, for labels too long to share a
 * phone's width equally.
 */
export function HerdSegmentedControl<T extends string | number>(props: {
    options: ReadonlyArray<HerdSegmentOption<T>>;
    value: T | null;
    onChange: (value: T) => void;
    /** `touch`: 44 px segments for phones (UI overhaul). */
    size?: 'md' | 'sm' | 'touch';
    fit?: boolean;
    accessibilityLabel?: string;
    testID?: string;
}) {
    const { options, value, onChange, size = 'md', fit = false } = props;
    const count = Math.max(options.length, 1);
    const index = options.findIndex((option) => option.value === value);
    const width = `${100 / count}%` as const;
    const [layouts, setLayouts] = React.useState<Record<number, { x: number; width: number }>>({});
    const fitLayout = fit && index >= 0 ? layouts[index] : undefined;
    return (
        <View style={styles.track} accessibilityRole="radiogroup" accessibilityLabel={props.accessibilityLabel} testID={props.testID}>
            {index >= 0 && (!fit || fitLayout) ? (
                <View
                    pointerEvents="none"
                    style={[
                        styles.thumb,
                        fitLayout
                            ? { width: fitLayout.width, left: fitLayout.x }
                            : { width, left: `${(100 / count) * index}%` },
                    ]}
                />
            ) : null}
            {options.map((option, optionIndex) => {
                const selected = optionIndex === index;
                return (
                    <Pressable
                        key={String(option.value)}
                        accessibilityRole="radio"
                        aria-checked={selected}
                        accessibilityLabel={option.label}
                        onPress={() => onChange(option.value)}
                        onLayout={fit ? (event) => {
                            const { x, width: segmentWidth } = event.nativeEvent.layout;
                            setLayouts((current) => (
                                current[optionIndex]?.x === x && current[optionIndex]?.width === segmentWidth
                                    ? current
                                    : { ...current, [optionIndex]: { x, width: segmentWidth } }
                            ));
                        } : undefined}
                        style={[
                            styles.segment,
                            fit && styles.segmentFit,
                            size === 'sm' && styles.segmentSmall,
                            size === 'touch' && styles.segmentTouch,
                            optionIndex < options.length - 1 && styles.segmentDivider,
                        ]}
                    >
                        <Text
                            numberOfLines={fit ? 2 : 1}
                            style={[styles.label, fit && styles.labelFit, size === 'sm' && styles.labelSmall, selected && styles.labelSelected]}
                        >
                            {option.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    track: {
        flexDirection: 'row',
        position: 'relative',
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: theme.kilv.radius,
        backgroundColor: theme.colors.surface,
        overflow: 'hidden',
    },
    thumb: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        backgroundColor: theme.colors.button.primary.background,
        _web: {
            transition: `left ${theme.kilv.motionBase}ms ${theme.kilv.easeOut}, width ${theme.kilv.motionBase}ms ${theme.kilv.easeOut}`,
            boxShadow: theme.kilv.glowMoltenSoft,
        },
    },
    segment: {
        flex: 1,
        minHeight: 40,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 8,
    },
    // Sized to the label, and never narrower than its longest word.
    segmentFit: {
        flexBasis: 'auto',
        flexShrink: 1,
        _web: { minWidth: 'min-content' },
    },
    segmentSmall: {
        minHeight: 32,
    },
    segmentTouch: {
        minHeight: 44,
    },
    segmentDivider: {
        borderRightWidth: 1,
        borderRightColor: theme.colors.divider,
    },
    label: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.mono(),
        _web: { transition: `color ${theme.kilv.motionBase}ms ${theme.kilv.easeOut}` },
    },
    labelFit: {
        textAlign: 'center',
    },
    labelSmall: {
        fontSize: 12,
    },
    labelSelected: {
        color: theme.colors.button.primary.tint,
        ...Typography.mono('semiBold'),
    },
}));
