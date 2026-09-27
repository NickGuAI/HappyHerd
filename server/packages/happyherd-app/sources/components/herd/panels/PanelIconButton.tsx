import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { herdWebClasses } from '@/components/herd/motion';
import { panelHoverWash } from './panelColors';

/**
 * Square icon action of the side panel and Workspace strips (UI overhaul,
 * mock `.icon-btn`): transparent until hovered, molten while the panel or
 * menu it controls is open.
 */
export const HerdPanelIconButton = React.forwardRef<View, {
    accessibilityLabel: string;
    onPress: () => void;
    renderIcon: (color: string) => React.ReactNode;
    active?: boolean;
    expanded?: boolean;
    disabled?: boolean;
    busy?: boolean;
    size?: number;
    testID?: string;
}>(function HerdPanelIconButton(props, ref) {
    const { theme } = useUnistyles();
    const [hovered, setHovered] = React.useState(false);
    const size = props.size ?? 30;
    const color = props.active
        ? theme.colors.textLink
        : hovered ? theme.colors.text : theme.colors.textSecondary;
    return (
        <Pressable
            ref={ref}
            accessibilityRole="button"
            accessibilityLabel={props.accessibilityLabel}
            aria-expanded={props.expanded}
            disabled={props.disabled || props.busy}
            onPress={props.onPress}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            hitSlop={4}
            testID={props.testID}
            style={[
                styles.button,
                { width: size, height: size },
                hovered && !props.active ? styles.hovered : null,
                props.active ? styles.active : null,
                props.disabled ? styles.disabled : null,
            ]}
        >
            {props.busy
                ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                : props.renderIcon(color)}
        </Pressable>
    );
});

const styles = StyleSheet.create((theme) => ({
    button: {
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.kilv.radius,
        _web: {
            cursor: 'pointer',
            _classNames: herdWebClasses('herd-transition', 'herd-press'),
        },
    },
    hovered: {
        backgroundColor: panelHoverWash(theme),
    },
    active: {
        backgroundColor: theme.colors.selection.background,
    },
    disabled: {
        opacity: theme.kilv.disabledOpacity,
    },
}));
