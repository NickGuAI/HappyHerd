import * as React from 'react';
import { Pressable } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { HerdTooltip, type HerdTooltipAlign } from './HerdTooltip';
import { useHerdTopBarLayout } from './topBarLayout';

/**
 * Square icon control used across the top bar: 34 px on desktop, a 44 px
 * touch target on phones. On the web a hover shows the mock's tooltip under
 * the control (label and shortcut) instead of the browser's `title` tooltip.
 */
export function HerdTopBarIconButton(props: {
    label: string;
    onPress: () => void;
    children: React.ReactNode;
    active?: boolean;
    disabled?: boolean;
    hint?: string;
    expanded?: boolean;
    testID?: string;
    tooltipAlign?: HerdTooltipAlign;
}) {
    const [pointerHovered, setPointerHovered] = React.useState(false);
    const phone = useHerdTopBarLayout() === 'phone';
    return (
        <Pressable
            onPress={props.onPress}
            onHoverIn={() => setPointerHovered(true)}
            onHoverOut={() => setPointerHovered(false)}
            onPointerEnter={(event) => {
                if (event.nativeEvent.pointerType !== 'touch') setPointerHovered(true);
            }}
            onPointerLeave={() => setPointerHovered(false)}
            disabled={props.disabled}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={props.label}
            // React Native Web maps aria-* props (not accessibilityState) onto the DOM.
            aria-expanded={props.expanded}
            testID={props.testID}
            style={({ pressed, hovered }: any) => [
                styles.iconButton,
                phone && styles.iconButtonPhone,
                props.active && styles.iconButtonActive,
                (pointerHovered || hovered || pressed) && !props.disabled && styles.iconButtonHovered,
                props.disabled && styles.iconButtonDisabled,
            ]}
        >
            {({ hovered: webHovered }: any) => (
                <>
                    {props.children}
                    {(pointerHovered || webHovered) && !phone && <HerdTooltip label={props.label} hint={props.hint} align={props.tooltipAlign} />}
                </>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    iconButton: {
        width: 34,
        height: 34,
        borderRadius: theme.kilv.radius,
        alignItems: 'center',
        justifyContent: 'center',
        _web: { _classNames: ['herd-transition', 'herd-press'] },
    },
    iconButtonPhone: {
        width: 44,
        height: 44,
    },
    iconButtonHovered: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    iconButtonActive: {
        backgroundColor: theme.colors.selection.background,
    },
    iconButtonDisabled: {
        opacity: 0.3,
    },
}));
