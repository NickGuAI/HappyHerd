import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import React, { useEffect, useRef } from 'react';
import {
    View,
    Modal,
    TouchableWithoutFeedback,
    Animated,
    KeyboardAvoidingView,
    Platform
} from 'react-native';
import { LocalBlurHalo } from '@/components/AnimatedOverlay';
import { HERD_PHONE_FLOAT_MARGIN, useHerdPhoneWeb } from '@/components/herd/mobile/useHerdPhone';
import { useWindowSafeAreaInsets } from '@/components/herd/shell/windowInsets';

interface CommandPaletteModalProps {
    visible: boolean;
    onClose?: () => void;
    children: React.ReactNode;
}

export function CommandPaletteModal({
    visible,
    onClose,
    children
}: CommandPaletteModalProps) {
    const { theme } = useUnistyles();
    // Phones (UI overhaul): the palette spans the window, 8 px from its edges.
    const phone = useHerdPhoneWeb();
    const windowInsets = useWindowSafeAreaInsets();
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const scaleAnim = useRef(new Animated.Value(0.95)).current;
    const [isModalVisible, setIsModalVisible] = React.useState(true);

    useEffect(() => {
        if (visible) {
            // Opening animation
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 200,
                    useNativeDriver: true
                }),
                Animated.spring(scaleAnim, {
                    toValue: 1,
                    friction: 10,
                    tension: 60,
                    useNativeDriver: true
                })
            ]).start();
        }
    }, [visible, fadeAnim, scaleAnim]);

    const handleClose = React.useCallback(() => {
        // Closing animation
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 150,
                useNativeDriver: true
            }),
            Animated.timing(scaleAnim, {
                toValue: 0.95,
                duration: 150,
                useNativeDriver: true
            })
        ]).start(() => {
            setIsModalVisible(false);
            // Small delay to ensure modal is hidden before calling onClose
            setTimeout(() => {
                if (onClose) {
                    onClose();
                }
            }, 50);
        });
    }, [fadeAnim, scaleAnim, onClose]);

    const handleBackdropPress = () => {
        handleClose();
    };

    if (!isModalVisible) {
        return null;
    }

    return (
        <Modal
            visible={isModalVisible}
            transparent={true}
            animationType="none"
            onRequestClose={handleClose}
        >
            <KeyboardAvoidingView
                style={[
                    styles.container,
                    phone && {
                        paddingTop: windowInsets.top + HERD_PHONE_FLOAT_MARGIN,
                        paddingHorizontal: HERD_PHONE_FLOAT_MARGIN,
                    },
                ]}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <TouchableWithoutFeedback onPress={handleBackdropPress}>
                    <Animated.View
                        style={[
                            Platform.OS === 'web' ? styles.backdrop : styles.nativeBackdrop,
                            {
                                opacity: fadeAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0, 0.7]
                                })
                            }
                        ]}
                    >
                        {Platform.OS !== 'web' && <View pointerEvents="none" style={styles.backdropScrim} />}
                    </Animated.View>
                </TouchableWithoutFeedback>

                <Animated.View
                    style={[
                        styles.content,
                        phone && styles.contentPhone,
                        {
                            opacity: fadeAnim,
                            transform: [{ scale: scaleAnim }]
                        }
                    ]}
                >
                    {Platform.OS !== 'web' && <LocalBlurHalo borderRadius={theme.kilv.radiusSheet} expansion={18} blurIntensity={38} />}
                    {children}
                </Animated.View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        justifyContent: 'flex-start',
        alignItems: 'center',
        // Sit high in the viewport so results have room to grow
        ...(Platform.OS === 'web' ? {
            paddingTop: '12vh',
        } as any : {
            paddingTop: 200, // Fallback for native
        })
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: theme.colors.kilv.scrimStrong,
        _web: { backdropFilter: 'blur(2px)' },
    },
    nativeBackdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    backdropScrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: theme.colors.kilv.scrim,
    },
    content: {
        zIndex: 1,
        width: '92%',
        maxWidth: 640,
        alignItems: 'center',
    },
    contentPhone: {
        width: '100%',
    },
}));
