import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';
import { useHerdPhoneLayout } from '@/components/herd/mobile/useHerdPhone';
import { HerdShellIcon, type HerdShellIconName } from '@/components/herd/shell/HerdShellIcon';
import { HerdTooltip } from './herd/shell/HerdTooltip';

// The approved mock's left panel controls (UI overhaul): `.sb-nav-btn`,
// `.sb-new` (emphasis) and `.sb-settings` (quiet).
const stylesheet = StyleSheet.create((theme) => ({
    button: {
        width: '100%',
        minHeight: 42,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: theme.kilv.radius,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        gap: 10,
        _web: { _classNames: ['herd-transition', 'herd-press'] },
    },
    buttonHovered: {
        borderColor: theme.colors.kilv.rimLine,
    },
    buttonPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    iconButton: {
        flex: 1,
        width: 'auto',
        justifyContent: 'center',
        paddingHorizontal: 10,
    },
    // New session: the panel's primary action.
    emphasis: {
        minHeight: 44,
        paddingLeft: 14,
        paddingRight: 12,
        borderColor: theme.colors.kilv.rimLine,
    },
    emphasisHovered: {
        borderColor: theme.colors.selection.border,
        _web: { boxShadow: theme.kilv.glowMoltenSoft },
    },
    // Settings: a plain row at the foot of the panel.
    quiet: {
        paddingHorizontal: 12,
        borderColor: 'transparent',
        backgroundColor: 'transparent',
    },
    // Phones: with the 8 px bottom row, the icon lands on the 16 px gutter.
    quietPhone: {
        paddingHorizontal: 7,
    },
    quietHovered: {
        borderColor: 'transparent',
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    buttonActive: {
        borderColor: theme.colors.selection.border,
        backgroundColor: theme.colors.selection.background,
        _web: { boxShadow: theme.kilv.glowMoltenSoft },
    },
    quietActive: {
        borderColor: 'transparent',
        backgroundColor: theme.colors.selection.background,
        _web: { boxShadow: 'none' },
    },
    buttonHighlighted: {
        backgroundColor: theme.colors.surfaceSelected,
        borderColor: theme.colors.kilv.accent,
    },
    label: {
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.logo(),
    },
    labelQuiet: {
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    labelHovered: {
        color: theme.colors.text,
    },
    labelActive: {
        color: theme.colors.textLink,
    },
    trailing: {
        marginLeft: 'auto',
    },
}));

export const SidebarNavigationButton = React.memo((props: {
    icon: HerdShellIconName;
    label: string;
    onPress: () => void;
    trailing?: React.ReactNode;
    highlighted?: boolean;
    iconOnly?: boolean;
    /** The current route belongs to this destination. */
    active?: boolean;
    emphasis?: boolean;
    quiet?: boolean;
    /** A toggle's pressed state (web: aria-pressed). */
    pressed?: boolean;
    testID?: string;
}) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const phone = useHerdPhoneLayout();

    return (
        <Pressable
            onPress={props.onPress}
            accessibilityRole="button"
            accessibilityLabel={props.label}
            aria-selected={props.active ? true : undefined}
            aria-pressed={props.pressed}
            testID={props.testID}
            style={({ pressed, hovered }: any) => [
                styles.button,
                props.iconOnly && styles.iconButton,
                props.emphasis && styles.emphasis,
                props.quiet && styles.quiet,
                props.quiet && phone && styles.quietPhone,
                hovered && (props.quiet ? styles.quietHovered : props.emphasis ? styles.emphasisHovered : styles.buttonHovered),
                props.active && (props.quiet ? styles.quietActive : styles.buttonActive),
                props.highlighted && styles.buttonHighlighted,
                pressed && styles.buttonPressed,
            ]}
        >
            {({ hovered }: any) => {
                const tint = props.active || props.pressed
                    ? theme.colors.textLink
                    : props.emphasis || hovered ? theme.colors.text : theme.colors.textSecondary;
                return (
                    <>
                        <HerdShellIcon name={props.icon} size={props.iconOnly ? 19 : props.quiet ? 18 : 17} color={tint} />
                        {!props.iconOnly && (
                            <Text style={[
                                styles.label,
                                props.quiet && styles.labelQuiet,
                                props.quiet && hovered && styles.labelHovered,
                                props.active && styles.labelActive,
                            ]}>
                                {props.label}
                            </Text>
                        )}
                        {props.trailing ? <View style={styles.trailing}>{props.trailing}</View> : null}
                        {props.iconOnly && hovered && !phone && <HerdTooltip label={props.label} />}
                    </>
                );
            }}
        </Pressable>
    );
});
