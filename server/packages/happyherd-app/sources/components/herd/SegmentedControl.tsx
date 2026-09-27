import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';

export type HerdSegmentOption<T extends string | number> = { value: T; label: string };

/**
 * Equal-width segmented control whose selection slides between options
 * (KILV overhaul). The thumb animates `left` on web; native snaps.
 */
export function HerdSegmentedControl<T extends string | number>(props: {
    options: ReadonlyArray<HerdSegmentOption<T>>;
    value: T;
    onChange: (value: T) => void;
    /** `touch`: 44 px segments for phones (UI overhaul). */
    size?: 'md' | 'sm' | 'touch';
    accessibilityLabel?: string;
    testID?: string;
}) {
    const { options, value, onChange, size = 'md' } = props;
    const count = Math.max(options.length, 1);
    const index = Math.max(0, options.findIndex((option) => option.value === value));
    const width = `${100 / count}%` as const;
    return (
        <View style={styles.track} accessibilityRole="radiogroup" accessibilityLabel={props.accessibilityLabel} testID={props.testID}>
            <View pointerEvents="none" style={[styles.thumb, { width, left: `${(100 / count) * index}%` }]} />
            {options.map((option, optionIndex) => {
                const selected = optionIndex === index;
                return (
                    <Pressable
                        key={String(option.value)}
                        accessibilityRole="radio"
                        aria-checked={selected}
                        accessibilityLabel={option.label}
                        onPress={() => onChange(option.value)}
                        style={[
                            styles.segment,
                            size === 'sm' && styles.segmentSmall,
                            size === 'touch' && styles.segmentTouch,
                            optionIndex < options.length - 1 && styles.segmentDivider,
                        ]}
                    >
                        <Text numberOfLines={1} style={[styles.label, size === 'sm' && styles.labelSmall, selected && styles.labelSelected]}>
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
            transition: `left ${theme.kilv.motionBase}ms ${theme.kilv.easeOut}`,
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
    labelSmall: {
        fontSize: 12,
    },
    labelSelected: {
        color: theme.colors.button.primary.tint,
        ...Typography.mono('semiBold'),
    },
}));
