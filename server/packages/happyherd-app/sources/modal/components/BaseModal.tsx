import React, { useEffect, useRef } from 'react';
import {
    View,
    Modal,
    TouchableWithoutFeedback,
    Animated,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    useWindowDimensions
} from 'react-native';
import { AnimatedBlurBackdrop } from '@/components/AnimatedOverlay';
import { HERD_PHONE_FLOAT_MARGIN, useHerdPhoneLayout } from '@/components/herd/mobile/useHerdPhone';
import { HerdPhoneDialogContext } from '@/components/herd/mobile/phoneDialog';
import { useWindowSafeAreaInsets } from '@/components/herd/shell/windowInsets';
import { HerdModalContentWidthContext, resolveModalContentWidth } from '@/components/herd/modalArea';

// On web, stop events from propagating to expo-router's modal overlay
// which intercepts clicks when it applies pointer-events: none to body
const stopPropagation = (e: { stopPropagation: () => void }) => e.stopPropagation();
const webEventHandlers = Platform.OS === 'web'
    ? { onClick: stopPropagation, onPointerDown: stopPropagation, onTouchStart: stopPropagation }
    : {};

// The centered placement's distance from the window's edges.
const CENTERED_PADDING = 20;

interface BaseModalProps {
    visible: boolean;
    onClose?: () => void;
    children: React.ReactNode;
    animationType?: 'fade' | 'slide' | 'none';
    transparent?: boolean;
    closeOnBackdrop?: boolean;
    /**
     * `dialog`: on phones (UI overhaul) the content rests on the bottom edge,
     * 8 px from the window's sides and bottom plus their safe-area insets, and
     * spans that width. Previews and other large content keep the centered
     * default.
     */
    placement?: 'center' | 'dialog';
}

export function BaseModal({
    visible,
    onClose,
    children,
    animationType = 'fade',
    transparent = true,
    closeOnBackdrop = true,
    placement = 'center',
}: BaseModalProps) {
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const phoneLayout = useHerdPhoneLayout();
    const windowInsets = useWindowSafeAreaInsets();
    const phoneDialog = placement === 'dialog' && phoneLayout;
    // Both placements also clear the window's side insets, such as a
    // landscape phone's notch. Desktops and tablets have none.
    const sidePadding = phoneDialog ? HERD_PHONE_FLOAT_MARGIN : CENTERED_PADDING;
    const { width: windowWidth } = useWindowDimensions();
    // Previews and other sized content fit this, so a notch never pushes them off-screen.
    const contentWidth = resolveModalContentWidth({
        windowWidth,
        sidePadding,
        insetLeft: windowInsets.left,
        insetRight: windowInsets.right,
    });

    useEffect(() => {
        if (visible) {
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 200,
                useNativeDriver: true
            }).start();
        } else {
            Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true
            }).start();
        }
    }, [visible, fadeAnim]);

    const handleBackdropPress = () => {
        if (closeOnBackdrop && onClose) {
            onClose();
        }
    };

    return (
        <Modal
            visible={visible}
            transparent={transparent}
            animationType={animationType}
            onRequestClose={onClose}
        >
            <KeyboardAvoidingView
                style={[
                    styles.container,
                    phoneDialog && {
                        justifyContent: 'flex-end',
                        padding: HERD_PHONE_FLOAT_MARGIN,
                        // iOS keyboard avoidance owns this edge: it sets the padding to the
                        // keyboard's height, 0 while it is closed. The gap is the content's margin.
                        paddingBottom: 0,
                    },
                    // Last: react-native-web expands an inline `padding` in
                    // key order, so it would override sides set before it.
                    {
                        paddingLeft: sidePadding + windowInsets.left,
                        paddingRight: sidePadding + windowInsets.right,
                    },
                ]}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                {...webEventHandlers}
            >
                {Platform.OS === 'web' ? (
                    <TouchableWithoutFeedback onPress={handleBackdropPress}>
                        <Animated.View
                            style={[
                                styles.backdrop,
                                {
                                    opacity: fadeAnim.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [0, 0.5],
                                    }),
                                },
                            ]}
                        />
                    </TouchableWithoutFeedback>
                ) : (
                    <AnimatedBlurBackdrop
                        blurIntensity={44}
                        dimColor="rgba(0, 0, 0, 0.42)"
                        onPress={handleBackdropPress}
                    />
                )}
                
                <Animated.View
                    style={[
                        styles.content,
                        phoneDialog && styles.contentPhoneDialog,
                        phoneDialog && { marginBottom: HERD_PHONE_FLOAT_MARGIN + windowInsets.bottom },
                        {
                            opacity: fadeAnim,
                            transform: [{
                                scale: fadeAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0.9, 1]
                                })
                            }]
                        }
                    ]}
                >
                    <HerdPhoneDialogContext.Provider value={phoneDialog}>
                        <HerdModalContentWidthContext.Provider value={contentWidth}>
                            {children}
                        </HerdModalContentWidthContext.Provider>
                    </HerdPhoneDialogContext.Provider>
                </Animated.View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: CENTERED_PADDING,
        // On web, ensure modal can receive pointer events when body has pointer-events: none
        ...Platform.select({ web: { pointerEvents: 'auto' as const } })
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'black',
    },
    content: {
        zIndex: 1,
        maxWidth: '100%'
    },
    contentPhoneDialog: {
        width: '100%',
    },
});
