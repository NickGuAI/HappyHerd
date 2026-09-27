import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useHerdTopBarLayout } from './topBarLayout';

function useWebTitle(label: string) {
    return React.useCallback((node: View | null) => {
        if (node && Platform.OS === 'web') {
            // React Native Web drops `title` from forwarded View props.
            (node as unknown as HTMLElement).setAttribute('title', label);
        }
    }, [label]);
}

/** Square icon control used across the top bar: 34 px on desktop, a 44 px touch target on phones. */
export function HerdTopBarIconButton(props: {
    label: string;
    onPress: () => void;
    children: React.ReactNode;
    active?: boolean;
    disabled?: boolean;
    hint?: string;
    expanded?: boolean;
    testID?: string;
}) {
    const titleRef = useWebTitle(props.hint ? `${props.label}  ${props.hint}` : props.label);
    const phone = useHerdTopBarLayout() === 'phone';
    return (
        <Pressable
            ref={titleRef}
            onPress={props.onPress}
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
                (hovered || pressed) && !props.disabled && styles.iconButtonHovered,
                props.disabled && styles.iconButtonDisabled,
            ]}
        >
            {props.children}
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
