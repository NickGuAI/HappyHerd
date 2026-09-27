import * as React from 'react';
import { Modal as RNModal, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';
import { herdWebClasses } from './motion';

/** A trigger's rectangle in window coordinates. */
export type HerdAnchorRect = { x: number; y: number; width: number; height: number };

const POPOVER_MARGIN = 12;
const POPOVER_GAP = 8;
const POPOVER_MIN_HEIGHT = 160;

/** Measures a trigger so a popover can open against it. */
export function measureHerdAnchor(node: View | null): Promise<HerdAnchorRect | null> {
    return new Promise((resolveRect) => {
        if (!node) {
            resolveRect(null);
            return;
        }
        node.measureInWindow((x, y, width, height) => resolveRect({ x, y, width, height }));
    });
}

/**
 * Places a popover below its trigger, aligned to the trigger's start or end
 * edge and kept inside the window.
 */
export function resolveHerdPopoverPosition(input: {
    anchor: HerdAnchorRect;
    width: number;
    align: 'start' | 'end';
    windowWidth: number;
    windowHeight: number;
}): { left: number; top: number; maxHeight: number } {
    const { anchor, width, align, windowWidth, windowHeight } = input;
    const preferredLeft = align === 'end' ? anchor.x + anchor.width - width : anchor.x;
    const left = Math.max(POPOVER_MARGIN, Math.min(windowWidth - width - POPOVER_MARGIN, preferredLeft));
    const top = anchor.y + anchor.height + POPOVER_GAP;
    return {
        left,
        top,
        maxHeight: Math.max(POPOVER_MIN_HEIGHT, windowHeight - top - POPOVER_MARGIN),
    };
}

/**
 * Web: Escape closes the popover and is consumed. The app's global
 * navigation treats an unhandled Escape as Back (and exits Zen), and it
 * runs on keydown, before React Native Web's Modal sees the keyup.
 */
export function useHerdEscapeToClose(visible: boolean, onClose: () => void): void {
    const onCloseRef = React.useRef(onClose);
    onCloseRef.current = onClose;
    React.useEffect(() => {
        if (!visible || Platform.OS !== 'web' || typeof window === 'undefined') return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            onCloseRef.current();
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [visible]);
}

/**
 * Anchored dropdown used by the top bar menus. It scales in from its trigger,
 * closes on an outside press or Escape, and never dims the page behind it.
 */
export function HerdPopover(props: {
    visible: boolean;
    anchor: HerdAnchorRect | null;
    onClose: () => void;
    width: number;
    align?: 'start' | 'end';
    accessibilityLabel?: string;
    testID?: string;
    children: React.ReactNode;
}) {
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    useHerdEscapeToClose(props.visible && !!props.anchor, props.onClose);
    if (!props.visible || !props.anchor) {
        return null;
    }
    const position = resolveHerdPopoverPosition({
        anchor: props.anchor,
        width: props.width,
        align: props.align ?? 'end',
        windowWidth,
        windowHeight,
    });

    return (
        <RNModal transparent animationType="none" visible onRequestClose={props.onClose}>
            <View style={styles.root}>
                <Pressable
                    accessible={false}
                    onPress={props.onClose}
                    style={styles.backdrop}
                    testID={props.testID ? `${props.testID}-backdrop` : undefined}
                />
                <View
                    accessibilityRole="menu"
                    accessibilityLabel={props.accessibilityLabel}
                    testID={props.testID}
                    style={[styles.card, {
                        left: position.left,
                        top: position.top,
                        width: props.width,
                        maxHeight: position.maxHeight,
                    }]}
                >
                    {props.children}
                </View>
            </View>
        </RNModal>
    );
}

/** Small mono section label at the top of a popover group. */
export function HerdMenuTitle({ children }: { children: React.ReactNode }) {
    return <Text style={styles.title}>{children}</Text>;
}

export function HerdMenuSeparator() {
    return <View style={styles.separator} />;
}

/** One row of a top bar menu: icon or status dot, label, and a trailing hint. */
export function HerdMenuItem(props: {
    label: string;
    onPress: () => void;
    icon?: React.ComponentProps<typeof Ionicons>['name'];
    leading?: React.ReactNode;
    hint?: string;
    selected?: boolean;
    disabled?: boolean;
    testID?: string;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            accessibilityRole="menuitem"
            accessibilityLabel={props.label}
            aria-selected={!!props.selected}
            disabled={props.disabled}
            onPress={props.onPress}
            testID={props.testID}
            style={({ pressed, hovered }: any) => [
                styles.item,
                props.selected && styles.itemSelected,
                (hovered || pressed) && !props.disabled && styles.itemHovered,
                props.disabled && styles.itemDisabled,
            ]}
        >
            {props.leading ?? (props.icon ? (
                <Ionicons name={props.icon} size={16} color={theme.colors.textSecondary} />
            ) : null)}
            <Text numberOfLines={1} style={[styles.itemLabel, props.selected && styles.itemLabelSelected]}>
                {props.label}
            </Text>
            {props.hint ? <Text numberOfLines={1} style={styles.itemHint}>{props.hint}</Text> : null}
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
    },
    backdrop: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
    },
    card: {
        position: 'absolute',
        padding: 6,
        overflow: 'hidden',
        borderRadius: theme.kilv.radiusCard,
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        backgroundColor: theme.colors.surface,
        shadowColor: theme.colors.shadow.color,
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
        elevation: 12,
        _web: {
            boxShadow: theme.kilv.shadow,
            _classNames: herdWebClasses('herd-pop'),
        },
    },
    title: {
        paddingHorizontal: 10,
        paddingTop: 8,
        paddingBottom: 6,
        fontSize: 10.5,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
        color: theme.colors.kilv.inkFaint,
        ...Typography.mono(),
    },
    separator: {
        height: 1,
        marginVertical: 6,
        marginHorizontal: 4,
        backgroundColor: theme.colors.divider,
    },
    item: {
        minHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 10,
        borderRadius: theme.kilv.radius,
    },
    itemHovered: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    itemSelected: {
        backgroundColor: theme.colors.selection.background,
    },
    itemDisabled: {
        opacity: theme.kilv.disabledOpacity,
    },
    itemLabel: {
        flex: 1,
        minWidth: 0,
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text,
        ...Typography.default(),
    },
    itemLabelSelected: {
        color: theme.colors.textLink,
    },
    itemHint: {
        flexShrink: 0,
        maxWidth: '50%',
        fontSize: 12,
        lineHeight: 18,
        color: theme.colors.kilv.inkFaint,
        ...Typography.mono(),
    },
}));
