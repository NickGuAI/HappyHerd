import * as React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';

const stylesheet = StyleSheet.create((theme) => ({
    button: {
        width: '100%',
        minHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        gap: 8,
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
    buttonHighlighted: {
        backgroundColor: theme.colors.surfacePressed,
    },
    label: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
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
}) => {
    const styles = stylesheet;
    const setIconHint = React.useCallback((node: View | null) => {
        if (node && Platform.OS === 'web') {
            // React Native Web filters title out of forwarded View props.
            // Use the native browser hint on the same accessible button.
            (node as unknown as HTMLElement).setAttribute('title', props.label);
        }
    }, [props.label]);

    return (
        <Pressable
            ref={props.iconOnly ? setIconHint : undefined}
            onPress={props.onPress}
            accessibilityRole="button"
            accessibilityLabel={props.label}
            style={({ pressed }) => [
                styles.button,
                props.iconOnly && styles.iconButton,
                props.highlighted && styles.buttonHighlighted,
                pressed && styles.buttonPressed,
            ]}
        >
            <Ionicons name={props.icon} size={props.iconOnly ? 20 : 16} color={stylesheet.label.color} />
            {!props.iconOnly && <Text style={styles.label}>{props.label}</Text>}
            {props.trailing ? <View style={styles.trailing}>{props.trailing}</View> : null}
        </Pressable>
    );
});
