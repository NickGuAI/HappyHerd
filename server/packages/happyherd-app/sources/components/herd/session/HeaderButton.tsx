import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { herdWebClasses } from '@/components/herd/motion';

/**
 * Session header control (UI overhaul): hairline-bordered button with an
 * optional label and a molten count badge. `active` marks the panel or menu it
 * controls as open.
 */
export const HerdHeaderButton = React.forwardRef<View, {
    renderIcon: (color: string) => React.ReactNode;
    accessibilityLabel: string;
    label?: string;
    count?: number;
    active?: boolean;
    expanded?: boolean;
    onPress: () => void;
    testID?: string;
}>(function HerdHeaderButton(props, ref) {
    const { theme } = useUnistyles();
    const [hovered, setHovered] = React.useState(false);
    const iconOnly = !props.label;
    const color = props.active
        ? theme.colors.textLink
        : hovered ? theme.colors.text : theme.colors.textSecondary;
    return (
        <Pressable
            ref={ref}
            accessibilityRole="button"
            accessibilityLabel={props.accessibilityLabel}
            accessibilityState={props.expanded === undefined ? undefined : { expanded: props.expanded }}
            aria-expanded={props.expanded}
            onPress={props.onPress}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            hitSlop={4}
            testID={props.testID}
            style={({ pressed }: any) => [
                styles.button,
                iconOnly && styles.iconOnly,
                (hovered || pressed) && !props.active && styles.hovered,
                props.active && styles.active,
            ]}
        >
            {props.renderIcon(color)}
            {props.label ? (
                <Text numberOfLines={1} style={[styles.label, { color }]}>{props.label}</Text>
            ) : null}
            {props.count ? (
                <View style={styles.badge}>
                    <Text style={styles.badgeText}>{props.count}</Text>
                </View>
            ) : null}
        </Pressable>
    );
});

const styles = StyleSheet.create((theme) => ({
    button: {
        height: 36,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: theme.kilv.radius,
        backgroundColor: 'transparent',
        _web: {
            _classNames: herdWebClasses('herd-transition', 'herd-press'),
            cursor: 'pointer',
        },
    },
    iconOnly: {
        width: 36,
        paddingHorizontal: 0,
    },
    hovered: {
        borderColor: theme.colors.kilv.rimLine,
    },
    active: {
        borderColor: theme.colors.selection.border,
        backgroundColor: theme.colors.selection.background,
    },
    label: {
        fontSize: 14,
        lineHeight: 18,
        ...Typography.default('semiBold'),
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
