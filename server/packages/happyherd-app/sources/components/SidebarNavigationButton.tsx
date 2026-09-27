import * as React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';
import { useIsTablet } from '@/utils/responsive';

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
    // New session: the sidebar's primary action.
    emphasis: {
        minHeight: 44,
        borderColor: theme.colors.kilv.rimLine,
    },
    emphasisHovered: {
        borderColor: theme.colors.selection.border,
        _web: { boxShadow: theme.kilv.glowMoltenSoft },
    },
    // Settings: a plain row at the foot of the panel.
    quiet: {
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
    buttonHighlighted: {
        backgroundColor: theme.colors.surfaceSelected,
        borderColor: theme.colors.kilv.accent,
    },
    label: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    labelEmphasis: {
        fontSize: 15,
    },
    labelActive: {
        color: theme.colors.textLink,
    },
    trailing: {
        marginLeft: 'auto',
    },
}));

export const SidebarNavigationButton = React.memo((props: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    onPress: () => void;
    trailing?: React.ReactNode;
    highlighted?: boolean;
    iconOnly?: boolean;
    /** The current route belongs to this destination. */
    active?: boolean;
    emphasis?: boolean;
    quiet?: boolean;
}) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const phone = !useIsTablet();
    const setIconHint = React.useCallback((node: View | null) => {
        if (node && Platform.OS === 'web') {
            // React Native Web filters title out of forwarded View props.
            // Use the native browser hint on the same accessible button.
            (node as unknown as HTMLElement).setAttribute('title', props.label);
        }
    }, [props.label]);
    const tint = props.active ? theme.colors.textLink : theme.colors.text;

    return (
        <Pressable
            ref={props.iconOnly ? setIconHint : undefined}
            onPress={props.onPress}
            accessibilityRole="button"
            accessibilityLabel={props.label}
            aria-selected={props.active ? true : undefined}
            style={({ pressed, hovered }: any) => [
                styles.button,
                props.iconOnly && styles.iconButton,
                props.emphasis && styles.emphasis,
                props.quiet && styles.quiet,
                props.quiet && phone && styles.quietPhone,
                hovered && (props.quiet ? styles.quietHovered : props.emphasis ? styles.emphasisHovered : styles.buttonHovered),
                props.active && styles.buttonActive,
                props.highlighted && styles.buttonHighlighted,
                pressed && styles.buttonPressed,
            ]}
        >
            <Ionicons name={props.icon} size={props.iconOnly ? 19 : 17} color={tint} />
            {!props.iconOnly && (
                <Text style={[styles.label, props.emphasis && styles.labelEmphasis, props.active && styles.labelActive]}>
                    {props.label}
                </Text>
            )}
            {props.trailing ? <View style={styles.trailing}>{props.trailing}</View> : null}
        </Pressable>
    );
});
