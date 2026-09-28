import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { herdWebClasses } from '@/components/herd/motion';
import { useHerdPhoneLayout } from '@/components/herd/mobile/useHerdPhone';

/**
 * Session header control (UI overhaul): hairline-bordered button with an
 * optional label and a molten count badge. `active` marks the panel or menu it
 * controls as open. On phones the same 36 px button sits in a 44 px target.
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
    const phone = useHerdPhoneLayout();
    const [hovered, setHovered] = React.useState(false);
    const iconOnly = !props.label;
    // An icon-only button with a count grows just enough to hold its badge.
    const iconWithCount = iconOnly && Boolean(props.count);
    const color = props.active
        ? theme.colors.textLink
        : hovered ? theme.colors.text : theme.colors.textSecondary;
    const visual = (pressed: boolean) => [
        styles.button,
        iconOnly && (iconWithCount ? styles.iconWithCount : styles.iconOnly),
        (hovered || pressed) && !props.active && styles.hovered,
        props.active && styles.active,
    ];
    const content = (
        <>
            {props.renderIcon(color)}
            {props.label ? (
                <Text numberOfLines={1} style={[styles.label, { color }]}>{props.label}</Text>
            ) : null}
            {props.count ? (
                <View style={styles.badge}>
                    <Text style={styles.badgeText}>{props.count}</Text>
                </View>
            ) : null}
        </>
    );
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
            style={phone ? styles.phoneTarget : ({ pressed }: any) => visual(pressed)}
        >
            {phone ? ({ pressed }: any) => <View style={visual(pressed)}>{content}</View> : content}
        </Pressable>
    );
});

const styles = StyleSheet.create((theme) => ({
    phoneTarget: {
        minWidth: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
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
    iconWithCount: {
        minWidth: 36,
        paddingHorizontal: 8,
        gap: 5,
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
