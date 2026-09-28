import * as React from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

/**
 * A 44 px icon control for the end of a phone page's title row (UI overhaul).
 * The title row ends 4 px from the edge, so the 20 px icon lands on the 16 px
 * gutter.
 */
export function HerdHeaderIconButton(props: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    onPress: () => void;
    testID?: string;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.label}
            onPress={props.onPress}
            testID={props.testID}
            style={({ pressed, hovered }: any) => [styles.button, (pressed || hovered) && styles.pressed]}
        >
            <Ionicons name={props.icon} size={20} color={theme.colors.header.tint} />
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    button: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.kilv.radius,
        _web: { cursor: 'pointer' },
    },
    pressed: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
}));
