import * as React from 'react';
import { Pressable, Modal as RNModal, Platform, Text, View, useWindowDimensions } from 'react-native';
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
import { HerdBottomSheet } from './herd/mobile/HerdBottomSheet';
import { isHerdPhoneWeb } from './herd/mobile/useHerdPhone';
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
    // Phone Web: the same actions in a bottom sheet with touch-size rows,
    // titled with the session name in the menu title's mono voice.
    sheetTitle: {
        paddingHorizontal: 12,
        paddingTop: 2,
        paddingBottom: 6,
        fontSize: 11,
        lineHeight: 16,
        letterSpacing: 1.2,
        color: theme.colors.kilv.inkFaint,
        ...Typography.mono(),
    },
    sheetItem: {
        minHeight: 48,
        gap: 10,
        paddingHorizontal: 12,
        borderRadius: theme.kilv.radius,
        _web: { _classNames: herdWebClasses('herd-transition') },
    },
    sheetItemLabel: {
        fontSize: 16,
        lineHeight: 22,
    },
    sheetItemShortcut: {
        fontSize: 11,
        color: theme.colors.kilv.inkFaint,
        ...Typography.mono(),
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
    const phoneSheet = isHerdPhoneWeb(windowWidth);
    // The web card and the phone sheet stay mounted, with their last anchor,
    // while they leave; a closed menu mounts neither.
    const presence = useHerdExit(visible && anchor ? anchor : null, phoneSheet ? HERD_EXIT.sheetDown : HERD_EXIT.pop);
    const shownAnchor = presence.value;

    const position = React.useMemo(() => {
        if (!shownAnchor) {
            return null;
        }
        const anchor = shownAnchor;

        const estimatedHeight = actions.length * WEB_MENU_ITEM_HEIGHT + WEB_MENU_PADDING * 2;
        const leftBase = anchor.type === 'point'
            ? anchor.x
            : anchor.x + anchor.width - WEB_MENU_WIDTH;

        let topBase = anchor.type === 'point'
            ? anchor.y
            : anchor.y + anchor.height + 8;

        if (anchor.type === 'rect' && topBase + estimatedHeight > windowHeight - WEB_MENU_MARGIN) {
            topBase = anchor.y - estimatedHeight - 8;
        }

        return {
            left: Math.max(WEB_MENU_MARGIN, Math.min(windowWidth - WEB_MENU_WIDTH - WEB_MENU_MARGIN, leftBase)),
            top: Math.max(WEB_MENU_MARGIN, Math.min(windowHeight - estimatedHeight - WEB_MENU_MARGIN, topBase)),
        };
    }, [actions.length, shownAnchor, windowHeight, windowWidth]);

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
            const action = actions.find((candidate) => matchesShortcutChord(
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
        const shortcutLabel = formatShortcutChord(
            preferredModifier,
            SESSION_ACTION_SHORTCUTS[action.id],
        );

        return (
            <Pressable
                key={action.id}
                accessibilityRole="button"
                onPress={() => handleActionPress(action)}
                style={({ pressed, hovered }: any) => phoneSheet ? [
                    styles.menuItem,
                    styles.sheetItem,
                    (hovered || pressed) && styles.webMenuItemHovered,
                ] : Platform.OS === 'web' ? [
                    styles.menuItem,
                    styles.webMenuItem,
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
                <Text numberOfLines={1} style={[styles.menuItemLabel, phoneSheet && styles.sheetItemLabel, { color }]}>
                    {action.label}
                </Text>
                {Platform.OS === 'web' && (
                    <Text style={[styles.menuItemShortcut, phoneSheet && styles.sheetItemShortcut]}>{shortcutLabel}</Text>
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

    if (phoneSheet) {
        return (
            <HerdBottomSheet
                visible={visible && !!anchor}
                onClose={onClose}
                accessibilityLabel={getSessionName(session)}
                testID="session-actions-sheet"
            >
                <Text numberOfLines={1} style={styles.sheetTitle}>{getSessionName(session)}</Text>
                {actionItems.map((item, index) => actions[index].destructive && index > 0 ? (
                    <React.Fragment key={actions[index].id}>
                        <HerdMenuSeparator />
                        {item}
                    </React.Fragment>
                ) : item)}
            </HerdBottomSheet>
        );
    }

    if (Platform.OS === 'web' && position) {
        const menu = (
            <View
                style={[
                    styles.webMenu,
                    {
                        left: position.left,
                        top: position.top,
                    },
                ]}
            >
                <View style={[styles.card, styles.webMenuCard(presence.exiting), { backgroundColor: theme.colors.header.background }]}>
                    {actionItems}
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
