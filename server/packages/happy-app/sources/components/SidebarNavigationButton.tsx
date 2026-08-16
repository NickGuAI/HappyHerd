import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
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
}) => {
    const styles = stylesheet;

    return (
        <Pressable
            onPress={props.onPress}
            accessibilityRole="button"
            accessibilityLabel={props.label}
            style={({ pressed }) => [
                styles.button,
                props.highlighted && styles.buttonHighlighted,
                pressed && styles.buttonPressed,
            ]}
        >
            <Ionicons name={props.icon} size={16} color={stylesheet.label.color} />
            <Text style={styles.label}>{props.label}</Text>
            {props.trailing ? <View style={styles.trailing}>{props.trailing}</View> : null}
        </Pressable>
    );
});
