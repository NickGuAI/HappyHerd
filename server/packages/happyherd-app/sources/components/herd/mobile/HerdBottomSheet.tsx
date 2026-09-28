import * as React from 'react';
import { Animated, Modal, PanResponder, Platform, Pressable, ScrollView, View, useWindowDimensions, type Role } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { StyleSheet } from 'react-native-unistyles';

import { herdWebClasses } from '@/components/herd/motion';
import { HerdExitLayer } from '@/components/herd/HerdExitLayer';
import { HERD_EXIT, useHerdExit } from '@/components/herd/presence';
import { useWindowSafeAreaInsets } from '@/components/herd/shell/windowInsets';
import { t } from '@/text';

/**
 * True inside a phone menu (this sheet, or a popover card on Web Mobile), so
 * menu rows grow to touch size and put their content on the 16 px gutter.
 */
export const HerdTouchMenuContext = React.createContext(false);

export function useHerdTouchMenu(): boolean {
    return React.useContext(HerdTouchMenuContext);
}

/** A drag past this distance, or a fast downward flick, dismisses the sheet. */
export const HERD_SHEET_DISMISS_DISTANCE = 72;
export const HERD_SHEET_DISMISS_VELOCITY = 0.9;

export function shouldDismissHerdSheet(dy: number, vy: number): boolean {
    return dy > HERD_SHEET_DISMISS_DISTANCE || vy > HERD_SHEET_DISMISS_VELOCITY;
}

/**
 * The window-filling layer under the scrim and the sheet. On native it is the
 * keyboard-aware container New Session uses: the sheet rises above the
 * keyboard that a field in it opens, such as a picker's Search, and a sheet
 * taller than the room left shrinks to fit below the status bar.
 */
function HerdSheetFrame({ topInset, children }: { topInset: number; children: React.ReactNode }) {
    if (Platform.OS === 'web') {
        return <View style={styles.root}>{children}</View>;
    }
    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={[styles.root, { paddingTop: topInset }]}
        >
            {children}
        </KeyboardAvoidingView>
    );
}

/**
 * Native phone presentation for menus and pickers (UI overhaul): a bottom
 * sheet over a scrim with a drag handle. Dragging the handle down past the
 * threshold dismisses it; the handle is also a labelled Cancel button for
 * assistive technology. The sheet clears the home indicator. Native fades it
 * in and out; on the web it slides up and back down.
 */
export function HerdBottomSheet({
    visible,
    onClose,
    role = 'dialog',
    accessibilityLabel,
    testID,
    children,
}: {
    visible: boolean;
    onClose: () => void;
    role?: Role;
    accessibilityLabel?: string;
    testID?: string;
    children: React.ReactNode;
}) {
    // The sheet covers the window, so it clears the window's own status bar and
    // home indicator. A screen under the phone top bar sees a zero top inset.
    const safeArea = useWindowSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    const drag = React.useRef(new Animated.Value(0)).current;
    const onCloseRef = React.useRef(onClose);
    onCloseRef.current = onClose;
    // Set once a press on the handle moves: react-native-web still delivers the
    // click that ends a mouse drag (it drops PanResponder's onClickCapture).
    const draggedRef = React.useRef(false);

    const dragResponder = React.useMemo(() => PanResponder.create({
        // On the web the handle claims the gesture on press, so a fast flick that
        // leaves the handle on its first move still drags. Taps still reach the
        // handle button through the click.
        onStartShouldSetPanResponderCapture: () => Platform.OS === 'web',
        onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderGrant: () => {
            draggedRef.current = false;
        },
        onPanResponderMove: (_event, gesture) => {
            if (Math.abs(gesture.dy) > 4) draggedRef.current = true;
            drag.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_event, gesture) => {
            if (shouldDismissHerdSheet(gesture.dy, gesture.vy)) {
                onCloseRef.current();
                return;
            }
            Animated.spring(drag, { toValue: 0, bounciness: 0, useNativeDriver: false }).start();
        },
        onPanResponderTerminate: () => {
            Animated.spring(drag, { toValue: 0, bounciness: 0, useNativeDriver: false }).start();
        },
    }), [drag]);

    const handlePress = React.useCallback(() => {
        if (draggedRef.current) {
            draggedRef.current = false;
            return;
        }
        onCloseRef.current();
    }, []);

    React.useEffect(() => {
        if (visible) drag.setValue(0);
    }, [drag, visible]);

    const presence = useHerdExit(visible ? true : null, HERD_EXIT.sheetDown);
    if (!presence.value) return null;
    const exiting = presence.exiting;
    const layer = (
        <HerdTouchMenuContext.Provider value>
            <HerdSheetFrame topInset={safeArea.top}>
                <Pressable
                    accessible={false}
                    onPress={onClose}
                    style={styles.scrim(exiting)}
                    testID={testID ? `${testID}-backdrop` : undefined}
                />
                {/* The drag moves this layer; the sheet inside keeps its entrance motion. */}
                <Animated.View style={[styles.position, { transform: [{ translateY: drag }] }]}>
                    <View
                        role={role}
                        aria-label={accessibilityLabel}
                        testID={testID}
                        style={[
                            styles.sheet(exiting),
                            {
                                maxHeight: Math.round(windowHeight * 0.92),
                                paddingBottom: Math.max(safeArea.bottom, 12) + 8,
                            },
                        ]}
                    >
                        <View {...dragResponder.panHandlers} style={styles.handleZone}>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t('common.cancel')}
                                testID={testID ? `${testID}-handle` : undefined}
                                onPress={handlePress}
                                style={styles.handleHit}
                            >
                                <View style={styles.handle} />
                            </Pressable>
                        </View>
                        <ScrollView
                            style={styles.body}
                            bounces={false}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}
                        >
                            {children}
                        </ScrollView>
                    </View>
                </Animated.View>
            </HerdSheetFrame>
        </HerdTouchMenuContext.Provider>
    );
    // Closing ends the Modal at once; the sheet slides down on an inert layer.
    if (exiting) {
        return <HerdExitLayer>{layer}</HerdExitLayer>;
    }
    return (
        <Modal transparent animationType={Platform.OS === 'web' ? 'none' : 'fade'} visible onRequestClose={onClose}>
            {layer}
        </Modal>
    );
}

const styles = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    scrim: (exiting: boolean) => ({
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: theme.colors.kilv.scrim,
        _web: { _classNames: herdWebClasses(exiting ? 'herd-fade-out' : 'herd-fade') },
    }),
    // Both shrink to the room above an open keyboard; the body then scrolls.
    position: {
        width: '100%',
        flexShrink: 1,
    },
    sheet: (exiting: boolean) => ({
        width: '100%',
        flexShrink: 1,
        overflow: 'hidden',
        // With the rows' own 8 px, content sits on the 16 px gutter.
        paddingHorizontal: 8,
        borderTopLeftRadius: theme.kilv.radiusBottomSheet,
        borderTopRightRadius: theme.kilv.radiusBottomSheet,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: theme.colors.kilv.rimLine,
        backgroundColor: theme.colors.surface,
        shadowColor: theme.colors.shadow.color,
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 30,
        shadowOffset: { width: 0, height: -8 },
        elevation: 16,
        _web: { _classNames: herdWebClasses(exiting ? 'herd-sheet-down' : 'herd-sheet-up'), boxShadow: theme.kilv.shadow },
    }),
    handleZone: {
        alignItems: 'center',
        // A mouse drag from the handle must not start a text selection, which
        // would end the gesture on the web.
        _web: { cursor: 'grab', touchAction: 'none', userSelect: 'none' },
    },
    handleHit: {
        width: '100%',
        height: 26,
        alignItems: 'center',
        justifyContent: 'center',
    },
    handle: {
        width: 40,
        height: 5,
        borderRadius: 3,
        backgroundColor: theme.colors.divider,
    },
    body: {
        flexGrow: 0,
        flexShrink: 1,
    },
}));
