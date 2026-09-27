import * as React from 'react';
import { Modal as RNModal, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';
import { useIsTablet } from '@/utils/responsive';
import { herdWebClasses } from './motion';
import { HERD_EXIT, useHerdExit } from './presence';
import { useHerdEscapeToClose } from './escape';
import { HerdExitLayer } from './HerdExitLayer';
import { HerdBottomSheet, HerdTouchMenuContext, useHerdTouchMenu } from './mobile/HerdBottomSheet';
import { HERD_PHONE_FLOAT_MARGIN, isHerdPhoneWeb } from './mobile/useHerdPhone';

// Existing callers import the Escape hook from here.
export { useHerdEscapeToClose };

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

/** Below this much room under the trigger, an `auto` popover opens upward when there is more room above. */
const POPOVER_FLIP_THRESHOLD = 280;

/**
 * Places a popover below its trigger, aligned to the trigger's start or end
 * edge and kept inside the window. `auto` placement opens upward instead when
 * the trigger sits near the bottom of the window. Phones pass a narrower
 * `margin`, and a popover never grows wider than the window less its margins.
 */
export function resolveHerdPopoverPosition(input: {
    anchor: HerdAnchorRect;
    width: number;
    align: 'start' | 'end';
    windowWidth: number;
    windowHeight: number;
    placement?: 'below' | 'auto';
    margin?: number;
}): { left: number; width: number; top?: number; bottom?: number; maxHeight: number } {
    const { anchor, align, windowWidth, windowHeight } = input;
    const margin = input.margin ?? POPOVER_MARGIN;
    const width = Math.min(input.width, windowWidth - margin * 2);
    const preferredLeft = align === 'end' ? anchor.x + anchor.width - width : anchor.x;
    const left = Math.max(margin, Math.min(windowWidth - width - margin, preferredLeft));
    const top = anchor.y + anchor.height + POPOVER_GAP;
    const roomBelow = windowHeight - top - margin;
    const roomAbove = anchor.y - POPOVER_GAP - margin;
    if (input.placement === 'auto' && roomBelow < POPOVER_FLIP_THRESHOLD && roomAbove > roomBelow) {
        return {
            left,
            width,
            bottom: windowHeight - anchor.y + POPOVER_GAP,
            maxHeight: Math.max(POPOVER_MIN_HEIGHT, roomAbove),
        };
    }
    return {
        left,
        width,
        top,
        maxHeight: Math.max(POPOVER_MIN_HEIGHT, roomBelow),
    };
}


/**
 * Anchored dropdown used by the top bar menus. It scales in from its trigger
 * and out again, closes on an outside press or Escape, and never dims the page
 * behind it. On a phone-width Web window it stays anchored, 8 px from the
 * window's edges, with touch-size rows. Native phones present the same
 * content as a bottom sheet that clears the home indicator.
 */
export function HerdPopover(props: {
    visible: boolean;
    anchor: HerdAnchorRect | null;
    onClose: () => void;
    width: number;
    align?: 'start' | 'end';
    placement?: 'below' | 'auto';
    accessibilityLabel?: string;
    testID?: string;
    children: React.ReactNode;
}) {
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const isTablet = useIsTablet();
    const open = props.visible && !!props.anchor;
    useHerdEscapeToClose(open, props.onClose);
    const nativePhone = Platform.OS !== 'web' && !isTablet;
    const phoneWeb = isHerdPhoneWeb(windowWidth);
    // The card stays mounted with its last anchor while it leaves; a closed
    // popover mounts nothing.
    const presence = useHerdExit(open ? props.anchor : null, HERD_EXIT.pop);
    const anchor = presence.value;
    if (!anchor) {
        return null;
    }
    if (nativePhone) {
        return (
            <HerdBottomSheet
                visible={open}
                onClose={props.onClose}
                role="menu"
                accessibilityLabel={props.accessibilityLabel}
                testID={props.testID}
            >
                {props.children}
            </HerdBottomSheet>
        );
    }
    const position = resolveHerdPopoverPosition({
        anchor,
        width: props.width,
        align: props.align ?? 'end',
        windowWidth,
        windowHeight,
        placement: props.placement,
        margin: phoneWeb ? HERD_PHONE_FLOAT_MARGIN : undefined,
    });

    const card = (
        <View
            accessibilityRole="menu"
            accessibilityLabel={props.accessibilityLabel}
            testID={props.testID}
            style={[styles.card(presence.exiting), phoneWeb && styles.cardPhone, {
                left: position.left,
                top: position.top,
                bottom: position.bottom,
                width: position.width,
                maxHeight: position.maxHeight,
            }]}
        >
            <HerdTouchMenuContext.Provider value={phoneWeb}>
                {props.children}
            </HerdTouchMenuContext.Provider>
        </View>
    );
    // Closing ends the Modal at once; the card scales out on an inert layer.
    if (presence.exiting) {
        return <HerdExitLayer>{card}</HerdExitLayer>;
    }
    return (
        <RNModal transparent animationType="none" visible onRequestClose={props.onClose}>
            <View style={styles.root}>
                <Pressable
                    accessible={false}
                    onPress={props.onClose}
                    style={styles.backdrop}
                    testID={props.testID ? `${props.testID}-backdrop` : undefined}
                />
                {card}
            </View>
        </RNModal>
    );
}

/** Small mono section label at the top of a popover group. */
export function HerdMenuTitle({ children }: { children: React.ReactNode }) {
    const touch = useHerdTouchMenu();
    return <Text style={[styles.title, touch && styles.titleTouch]}>{children}</Text>;
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
    const touch = useHerdTouchMenu();
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
                touch && styles.itemTouch,
                props.selected && styles.itemSelected,
                (hovered || pressed) && !props.disabled && styles.itemHovered,
                props.disabled && styles.itemDisabled,
            ]}
        >
            {props.leading ?? (props.icon ? (
                <Ionicons name={props.icon} size={touch ? 18 : 16} color={theme.colors.textSecondary} />
            ) : null)}
            <Text numberOfLines={1} style={[styles.itemLabel, touch && styles.itemLabelTouch, props.selected && styles.itemLabelSelected]}>
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
    card: (exiting: boolean) => ({
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
            _classNames: herdWebClasses(exiting ? 'herd-pop-out' : 'herd-pop'),
        },
    }),
    // Phones: rows pad 8 px inside 8 px of card, so their content sits on the 16 px gutter.
    cardPhone: {
        padding: 8,
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
    titleTouch: {
        paddingHorizontal: 8,
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
    // Phone menus: touch-size rows (48 px) and 16 px labels, content on the gutter.
    itemTouch: {
        minHeight: 48,
        gap: 12,
        paddingHorizontal: 8,
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
    itemLabelTouch: {
        fontSize: 16,
        lineHeight: 22,
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
