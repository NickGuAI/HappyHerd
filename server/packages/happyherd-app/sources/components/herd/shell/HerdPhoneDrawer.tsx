import * as React from 'react';
import { Animated, BackHandler, Easing, PanResponder, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

import { SidebarView } from '@/components/SidebarView';
import { t } from '@/text';
import { useHerdEscapeToClose } from '../escape';
import { HERD_MOTION } from '../motion';
import { HERD_EXIT } from '../presence';
import { useHerdPhoneShell } from './phoneShell';

/** The drawer is the desktop panel at 92% of the phone's width, at most 360 px. */
export function herdPhoneDrawerWidth(windowWidth: number): number {
    return Math.min(Math.round(windowWidth * 0.92), 360);
}

/** A drag or flick left past either threshold closes the drawer; a swipe in past the distance opens it. */
export const HERD_PHONE_DRAWER_SWIPE_DISTANCE = 70;
export const HERD_PHONE_DRAWER_SWIPE_VELOCITY = 0.5;
/** Web touch: a swipe that starts this close to the left edge pulls the drawer in. */
export const HERD_PHONE_DRAWER_EDGE = 20;

/** Keeps the shadow of a closed panel off screen too. */
const OFFSCREEN_MARGIN = 24;
const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN = Easing.bezier(0.55, 0, 1, 0.45);

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Phones (UI overhaul): the desktop left panel as a drawer that slides in over
 * a scrim below the top bar. The top bar's panel toggle opens it; the scrim,
 * a drag or flick to the left, Escape, Android Back and any navigation close
 * it. On web, a touch swipe from the left edge pulls it in. Native leaves that
 * edge to the stack's own back swipe. Motion runs through `Animated` so web
 * and native slide alike, and reduced motion makes both instant.
 */
export function HerdPhoneDrawer({ edgeSwipe }: { edgeSwipe: boolean }) {
    const open = useHerdPhoneShell((state) => state.drawerOpen);
    const openDrawer = useHerdPhoneShell((state) => state.openDrawer);
    const closeDrawer = useHerdPhoneShell((state) => state.closeDrawer);
    const { width: windowWidth } = useWindowDimensions();
    const width = herdPhoneDrawerWidth(windowWidth);
    const reduceMotion = useReducedMotion();
    const progress = React.useRef(new Animated.Value(0)).current;
    const panelRef = React.useRef<View>(null);
    const dragged = React.useRef(false);
    // The panel mounts on first use, so a phone that never opens it renders one session list.
    const [mounted, setMounted] = React.useState(open);
    if (open && !mounted) setMounted(true);

    const settle = React.useCallback((toValue: 0 | 1, duration: number) => {
        Animated.timing(progress, {
            toValue,
            duration: reduceMotion ? 0 : duration,
            easing: toValue === 1 ? EASE_OUT : EASE_IN,
            useNativeDriver: Platform.OS !== 'web',
        }).start();
    }, [progress, reduceMotion]);

    React.useEffect(() => {
        settle(open ? 1 : 0, open ? HERD_MOTION.slow : HERD_EXIT.sheetDown);
    }, [open, settle]);

    useHerdEscapeToClose(open, closeDrawer);

    React.useEffect(() => {
        if (!open || Platform.OS !== 'android') return;
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            closeDrawer();
            return true;
        });
        return () => subscription.remove();
    }, [closeDrawer, open]);

    // Web: a closed panel is off screen but still in the page; keep Tab out of it.
    React.useEffect(() => {
        const node = panelRef.current as unknown as HTMLElement | null;
        if (Platform.OS === 'web' && node) node.inert = !open;
    }, [mounted, open]);

    // Web: React Native Web presses on the browser's click, which a drag that
    // started on a row still produces. That click belongs to the drag, not the row.
    // (Native cancels the row's press when the drag takes the responder.)
    React.useEffect(() => {
        const node = panelRef.current as unknown as HTMLElement | null;
        if (Platform.OS !== 'web' || !node) return;
        const reset = () => { dragged.current = false; };
        const swallow = (event: MouseEvent) => {
            if (!dragged.current) return;
            dragged.current = false;
            event.stopPropagation();
            event.preventDefault();
        };
        node.addEventListener('pointerdown', reset, true);
        node.addEventListener('click', swallow, true);
        return () => {
            node.removeEventListener('pointerdown', reset, true);
            node.removeEventListener('click', swallow, true);
        };
    }, [mounted]);

    const panResponder = React.useMemo(() => PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) => gesture.dx < -8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
        onPanResponderGrant: () => {
            dragged.current = true;
            progress.stopAnimation();
        },
        onPanResponderMove: (_event, gesture) => progress.setValue(clamp(1 + Math.min(0, gesture.dx) / width)),
        onPanResponderRelease: (_event, gesture) => {
            if (-gesture.dx > HERD_PHONE_DRAWER_SWIPE_DISTANCE || gesture.vx < -HERD_PHONE_DRAWER_SWIPE_VELOCITY) {
                closeDrawer();
            } else {
                settle(1, HERD_MOTION.base);
            }
        },
        onPanResponderTerminate: () => settle(1, HERD_MOTION.base),
    }), [closeDrawer, progress, settle, width]);

    // Web touch: follow a swipe that starts at the left edge, then open or fall back.
    React.useEffect(() => {
        if (Platform.OS !== 'web' || !edgeSwipe || open || typeof window === 'undefined') return;
        let start: { x: number; y: number } | null = null;
        let dragging = false;
        const onStart = (event: TouchEvent) => {
            const touch = event.touches[0];
            start = event.touches.length === 1 && touch.clientX <= HERD_PHONE_DRAWER_EDGE
                ? { x: touch.clientX, y: touch.clientY }
                : null;
            dragging = false;
        };
        const onMove = (event: TouchEvent) => {
            if (!start) return;
            const touch = event.touches[0];
            const dx = touch.clientX - start.x;
            if (!dragging) {
                if (Math.abs(touch.clientY - start.y) > Math.abs(dx)) {
                    start = null;
                    return;
                }
                if (dx < 8) return;
                dragging = true;
                setMounted(true);
            }
            progress.setValue(clamp(dx / width));
        };
        const onEnd = (event: TouchEvent) => {
            if (start && dragging) {
                const dx = event.changedTouches[0].clientX - start.x;
                if (dx > HERD_PHONE_DRAWER_SWIPE_DISTANCE) openDrawer();
                else settle(0, HERD_EXIT.sheetDown);
            }
            start = null;
            dragging = false;
        };
        window.addEventListener('touchstart', onStart, { passive: true });
        window.addEventListener('touchmove', onMove, { passive: true });
        window.addEventListener('touchend', onEnd);
        window.addEventListener('touchcancel', onEnd);
        return () => {
            window.removeEventListener('touchstart', onStart);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onEnd);
            window.removeEventListener('touchcancel', onEnd);
        };
    }, [edgeSwipe, open, openDrawer, progress, settle, width]);

    if (!mounted) return null;

    const translateX = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [-(width + OFFSCREEN_MARGIN), 0],
    });

    return (
        <View pointerEvents="box-none" style={styles.layer} testID="herd-phone-drawer-layer">
            <Animated.View pointerEvents={open ? 'auto' : 'none'} style={[styles.scrim, { opacity: progress }]}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('navigation.collapseSidebar')}
                    onPress={closeDrawer}
                    style={styles.fill}
                    testID="herd-phone-drawer-scrim"
                />
            </Animated.View>
            <Animated.View
                ref={panelRef}
                {...panResponder.panHandlers}
                aria-hidden={!open}
                accessibilityViewIsModal={open}
                accessibilityElementsHidden={!open}
                importantForAccessibility={open ? 'yes' : 'no-hide-descendants'}
                style={[styles.panel(open), { width, transform: [{ translateX }] }]}
                testID="herd-phone-drawer"
            >
                <SidebarView />
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    layer: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 40,
    },
    fill: {
        flex: 1,
    },
    scrim: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: theme.colors.kilv.scrim,
    },
    panel: (open: boolean) => ({
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        backgroundColor: theme.colors.surface,
        shadowColor: '#000',
        shadowOpacity: open ? 0.35 : 0,
        shadowRadius: 24,
        shadowOffset: { width: 8, height: 0 },
        elevation: open ? 16 : 0,
        _web: { boxShadow: open ? theme.kilv.shadow : 'none' },
    }),
}));
