import * as React from 'react';
import { Pressable, Modal as RNModal, Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { useSessionQuickActions, SessionActionItem } from '@/hooks/useSessionQuickActions';
import { useSession } from '@/sync/storage';
import {
    formatShortcutChord,
    getPreferredShortcutModifier,
    matchesShortcutChord,
    SESSION_ACTION_SHORTCUTS,
} from '@/keyboard/shortcuts';
import { MobileGlassSurface } from './MobileGlass';
import { AnimatedPopup, LocalBlurHalo } from './AnimatedOverlay';
import { herdWebClasses } from './herd/motion';
import { HerdMenuSeparator, useHerdEscapeToClose } from './herd/HerdPopover';
import { HerdExitLayer } from './herd/HerdExitLayer';
import { HERD_EXIT, useHerdExit } from './herd/presence';
import { HERD_PHONE_FLOAT_MARGIN, isHerdPhoneWeb } from './herd/mobile/useHerdPhone';
import { getSessionName } from '@/utils/sessionUtils';

export type SessionActionsAnchor =
    | {
        type: 'point';
        x: number;
        y: number;
    }
    | {
        type: 'rect';
        x: number;
        y: number;
        width: number;
        height: number;
    };

interface SessionActionsPopoverProps {
    anchor: SessionActionsAnchor | null;
    onAfterArchive?: () => void;
    onAfterDelete?: () => void;
    onClose: () => void;
    sessionId: string;
    visible: boolean;
}


const WEB_MENU_WIDTH = 288;
const WEB_MENU_ITEM_HEIGHT = 40;
const WEB_MENU_PADDING = 6;
const WEB_MENU_MARGIN = 12;
// Phone Web (UI overhaul): the same card, titled with the session, with
// touch-size rows, as wide as the window allows up to the mock's 330 px.
const PHONE_MENU_WIDTH = 330;
const PHONE_MENU_ITEM_HEIGHT = 48;
const PHONE_MENU_PADDING = 8;
const PHONE_MENU_TITLE_HEIGHT = 28;
const PHONE_MENU_SEPARATOR_HEIGHT = 13;
// The card's 1 px rim, above and below.
const PHONE_MENU_RIM = 2;

const stylesheet = StyleSheet.create((theme) => ({
    backdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
    },
    backdropScrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: theme.colors.kilv.scrim,
    },
    webBackdrop: {
        backgroundColor: theme.colors.kilv.scrim,
    },
    card: {
        borderRadius: theme.kilv.radiusCard,
        overflow: 'hidden',
        backgroundColor: Platform.select({
            web: theme.colors.surface,
            ios: theme.colors.glass.overlay,
            android: theme.colors.glass.backgroundStrong,
            default: theme.colors.surface,
        }),
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
        shadowColor: theme.colors.shadow.color,
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 18,
        shadowOffset: {
            width: 0,
            height: 8,
        },
        elevation: 10,
    },
    handle: {
        width: 40,
        height: 4,
        borderRadius: 999,
        marginTop: 10,
        marginBottom: 8,
        alignSelf: 'center',
    },
    menuItem: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        gap: 12,
    },
    menuItemPressed: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    // Web: a floating menu of rounded rows that tint on hover (HappyHerd fluid shell).
    webMenuCard: (exiting: boolean) => ({
        padding: WEB_MENU_PADDING,
        _web: {
            boxShadow: theme.kilv.shadow,
            _classNames: herdWebClasses(exiting ? 'herd-pop-out' : 'herd-pop'),
        },
    }),
    webMenuItem: {
        minHeight: WEB_MENU_ITEM_HEIGHT,
        paddingHorizontal: 10,
        borderRadius: theme.kilv.radius,
        _web: { _classNames: herdWebClasses('herd-transition') },
    },
    webMenuItemHovered: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    menuItemDivider: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    menuItemLabel: {
        flex: 1,
        fontSize: 15,
        lineHeight: 20,
        ...Typography.default(),
    },
    menuItemShortcut: {
        flexShrink: 0,
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 18,
        ...Typography.default('semiBold'),
    },
    // Phone Web: the card is titled with the session name in the menu title's
    // mono voice. Rows pad 8 px inside 8 px of card, so content sits on the
    // 16 px gutter.
    phoneMenuCard: {
        padding: PHONE_MENU_PADDING,
    },
    phoneTitle: {
        flexShrink: 0,
        paddingHorizontal: 8,
        paddingTop: 6,
        paddingBottom: 6,
        fontSize: 11,
        lineHeight: 16,
        letterSpacing: 1.2,
        color: theme.colors.kilv.inkFaint,
        ...Typography.mono(),
    },
    // Bounded by the card, so every action stays reachable in a short window.
    phoneMenuRows: {
        flexGrow: 0,
        flexShrink: 1,
        minHeight: 0,
    },
    phoneMenuItem: {
        minHeight: PHONE_MENU_ITEM_HEIGHT,
        paddingHorizontal: 8,
    },
    phoneMenuItemLabel: {
        fontSize: 16,
        lineHeight: 22,
    },
    nativeContainer: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    nativeSheet: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        overflow: 'hidden',
    },
    webContainer: {
        flex: 1,
    },
    webMenu: {
        position: 'absolute',
        width: WEB_MENU_WIDTH,
    },
}));

export function SessionActionsPopover({
    anchor,
    onAfterArchive,
    onAfterDelete,
    onClose,
    sessionId,
    visible,
}: SessionActionsPopoverProps) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const { height: windowHeight, width: windowWidth } = useWindowDimensions();
    const session = useSession(sessionId);
    const { actionItems: actions } = useSessionQuickActions(session!, {
        onAfterArchive,
        onAfterDelete,
    });
    const preferredModifier = React.useMemo(() => getPreferredShortcutModifier(
        typeof navigator === 'undefined' ? undefined : navigator
    ), []);
    const phoneWeb = isHerdPhoneWeb(windowWidth);
    const menuMargin = phoneWeb ? HERD_PHONE_FLOAT_MARGIN : WEB_MENU_MARGIN;
    const menuWidth = phoneWeb ? Math.min(PHONE_MENU_WIDTH, windowWidth - menuMargin * 2) : WEB_MENU_WIDTH;
    // Phones: the card never grows past the window less its margins; its rows scroll instead.
    const phoneMaxHeight = windowHeight - menuMargin * 2;
    // The web card stays mounted, with its last anchor, while it leaves; a
    // closed menu mounts nothing.
    const presence = useHerdExit(visible && anchor ? anchor : null, HERD_EXIT.pop);
    const shownAnchor = presence.value;
    const destructiveBreaks = actions.filter((action, index) => action.destructive && index > 0).length;

    const position = React.useMemo(() => {
        if (!shownAnchor) {
            return null;
        }
        const anchor = shownAnchor;

        const estimatedHeight = phoneWeb
            ? Math.min(phoneMaxHeight, PHONE_MENU_TITLE_HEIGHT + actions.length * PHONE_MENU_ITEM_HEIGHT
                + destructiveBreaks * PHONE_MENU_SEPARATOR_HEIGHT + PHONE_MENU_PADDING * 2 + PHONE_MENU_RIM)
            : actions.length * WEB_MENU_ITEM_HEIGHT + WEB_MENU_PADDING * 2;
        const leftBase = anchor.type === 'point'
            ? anchor.x
            : anchor.x + anchor.width - menuWidth;

        let topBase = anchor.type === 'point'
            ? anchor.y
            : anchor.y + anchor.height + 8;

        if (anchor.type === 'rect' && topBase + estimatedHeight > windowHeight - menuMargin) {
            topBase = anchor.y - estimatedHeight - 8;
        }

        return {
            left: Math.max(menuMargin, Math.min(windowWidth - menuWidth - menuMargin, leftBase)),
            top: Math.max(menuMargin, Math.min(windowHeight - estimatedHeight - menuMargin, topBase)),
        };
    }, [actions.length, destructiveBreaks, menuMargin, menuWidth, phoneMaxHeight, phoneWeb, shownAnchor, windowHeight, windowWidth]);

    // Escape closes the menu instead of reaching the app's Back handling.
    useHerdEscapeToClose(visible && !!anchor, onClose);

    // A closed menu never runs an action, even from a press that lands while it leaves.
    const visibleRef = React.useRef(visible);
    visibleRef.current = visible;
    const handleActionPress = React.useCallback((action: SessionActionItem) => {
        if (!visibleRef.current) return;
        onClose();
        action.onPress();
    }, [onClose]);

    React.useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined' || !visible || !anchor || !session) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            const action = actions.find((candidate) => candidate.id !== 'context-window' && matchesShortcutChord(
                event,
                preferredModifier,
                SESSION_ACTION_SHORTCUTS[candidate.id],
            ));
            if (!action) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            handleActionPress(action);
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [actions, anchor, handleActionPress, preferredModifier, session, visible]);

    if (!session || !shownAnchor) {
        return null;
    }

    const actionItems = actions.map((action, index) => {
        const isLast = index === actions.length - 1;
        const color = action.destructive ? theme.colors.status.error : theme.colors.text;
        const shortcutLabel = action.id === 'context-window' ? '' : formatShortcutChord(
            preferredModifier,
            SESSION_ACTION_SHORTCUTS[action.id],
        );

        return (
            <Pressable
                key={action.id}
                accessibilityRole="button"
                onPress={() => handleActionPress(action)}
                style={({ pressed, hovered }: any) => Platform.OS === 'web' ? [
                    styles.menuItem,
                    styles.webMenuItem,
                    phoneWeb && styles.phoneMenuItem,
                    hovered && styles.webMenuItemHovered,
                    pressed && styles.menuItemPressed,
                ] : [
                    styles.menuItem,
                    !isLast && styles.menuItemDivider,
                    pressed && styles.menuItemPressed,
                ]}
            >
                <Ionicons
                    color={color}
                    name={action.icon as keyof typeof Ionicons.glyphMap}
                    size={18}
                />
                <Text numberOfLines={1} style={[styles.menuItemLabel, phoneWeb && styles.phoneMenuItemLabel, { color }]}>
                    {action.label}
                </Text>
                {/* A phone has no keyboard for the chord; the action itself stays. */}
                {Platform.OS === 'web' && !phoneWeb && (
                    <Text style={styles.menuItemShortcut}>{shortcutLabel}</Text>
                )}
            </Pressable>
        );
    });

    const nativeContent = (
        <>
            <LocalBlurHalo borderRadius={theme.kilv.radiusCard} expansion={14} />
            <MobileGlassSurface
                enabled
                nativeEffect
                glassEffectStyle="regular"
                intensity={88}
                tintColor={theme.colors.glass.overlayTint}
                style={styles.card}
            >
                {Platform.OS !== 'web' && (
                    <View style={[styles.handle, { backgroundColor: theme.colors.textSecondary }]} />
                )}
                {actionItems}
            </MobileGlassSurface>
        </>
    );

    if (Platform.OS === 'web' && position) {
        const menu = (
            <View
                style={[
                    styles.webMenu,
                    {
                        left: position.left,
                        top: position.top,
                        width: menuWidth,
                    },
                ]}
            >
                <View
                    testID="session-actions-menu"
                    style={[
                        styles.card,
                        styles.webMenuCard(presence.exiting),
                        phoneWeb && styles.phoneMenuCard,
                        phoneWeb && { maxHeight: phoneMaxHeight },
                        { backgroundColor: theme.colors.header.background },
                    ]}
                >
                    {phoneWeb ? (
                        <>
                            <Text numberOfLines={1} style={styles.phoneTitle}>{getSessionName(session)}</Text>
                            {/* In a short window the title stays and the actions scroll below it. */}
                            <ScrollView style={styles.phoneMenuRows}>
                                {/* A separator sets the destructive action apart, as in the mock. */}
                                {actionItems.map((item, index) => actions[index].destructive && index > 0 ? (
                                    <React.Fragment key={actions[index].id}>
                                        <HerdMenuSeparator />
                                        {item}
                                    </React.Fragment>
                                ) : item)}
                            </ScrollView>
                        </>
                    ) : actionItems}
                </View>
            </View>
        );
        // Closing ends the Modal at once; the card scales out on an inert layer.
        if (presence.exiting) {
            return <HerdExitLayer>{menu}</HerdExitLayer>;
        }
        return (
            <RNModal
                animationType="none"
                onRequestClose={onClose}
                transparent
                visible
            >
                <View style={styles.webContainer}>
                    <Pressable onPress={onClose} style={[styles.backdrop, styles.webBackdrop]} />
                    {menu}
                </View>
            </RNModal>
        );
    }

    return (
        <RNModal
            animationType="fade"
            onRequestClose={onClose}
            transparent
            visible={visible}
        >
            <View style={styles.nativeContainer}>
                <Pressable onPress={onClose} style={styles.backdrop}>
                    <View pointerEvents="none" style={styles.backdropScrim} />
                </Pressable>
                <AnimatedPopup
                    style={[
                        styles.nativeSheet,
                        {
                            paddingBottom: Math.max(16, safeArea.bottom),
                        },
                    ]}
                >
                    {nativeContent}
                </AnimatedPopup>
            </View>
        </RNModal>
    );
}
