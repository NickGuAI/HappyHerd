import * as React from 'react';
import { Modal as RNModal, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { AnimatedPopup, LocalBlurHalo } from './AnimatedOverlay';
import { MobileGlassSurface } from './MobileGlass';

export type AttachmentInputMenuAnchor = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type AttachmentInputMenuProps = {
    anchor: AttachmentInputMenuAnchor;
    onClose: () => void;
    onPickDeviceFiles: () => void;
    onPickPhotos: () => void;
    visible: boolean;
};

const WEB_MENU_WIDTH = 272;
const WEB_MENU_MARGIN = 12;
const WEB_MENU_ESTIMATED_HEIGHT = 148;
const WEB_MENU_ANCHOR_GAP = 8;

export function getAttachmentInputMenuFrame({
    anchor,
    windowHeight,
    windowWidth,
}: {
    anchor: AttachmentInputMenuAnchor;
    windowHeight: number;
    windowWidth: number;
}) {
    const width = Math.max(0, Math.min(WEB_MENU_WIDTH, windowWidth - WEB_MENU_MARGIN * 2));
    const maxLeft = Math.max(WEB_MENU_MARGIN, windowWidth - width - WEB_MENU_MARGIN);
    const left = Math.max(WEB_MENU_MARGIN, Math.min(maxLeft, anchor.x));
    const below = anchor.y + anchor.height + WEB_MENU_ANCHOR_GAP;
    const above = anchor.y - WEB_MENU_ESTIMATED_HEIGHT - WEB_MENU_ANCHOR_GAP;
    const top = below + WEB_MENU_ESTIMATED_HEIGHT <= windowHeight - WEB_MENU_MARGIN
        ? below
        : Math.max(WEB_MENU_MARGIN, above);

    return { left, top, width };
}

export function AttachmentInputMenu({
    anchor,
    onClose,
    onPickDeviceFiles,
    onPickPhotos,
    visible,
}: AttachmentInputMenuProps) {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const { height: windowHeight, width: windowWidth } = useWindowDimensions();
    const firstActionRef = React.useRef<View>(null);
    const frame = React.useMemo(() => getAttachmentInputMenuFrame({
        anchor,
        windowHeight,
        windowWidth,
    }), [anchor, windowHeight, windowWidth]);

    React.useEffect(() => {
        if (!visible) return;
        const focusTimer = setTimeout(() => firstActionRef.current?.focus(), 0);
        return () => clearTimeout(focusTimer);
    }, [visible]);

    React.useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined' || !visible) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            onClose();
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [onClose, visible]);

    if (!visible) return null;

    const invoke = (action: () => void) => {
        onClose();
        action();
    };
    const actionRows = (
        <>
            <Pressable
                ref={firstActionRef}
                accessibilityLabel={t('happyHerd.composer.photos')}
                accessibilityRole="menuitem"
                onPress={() => invoke(onPickPhotos)}
                style={({ pressed }) => [styles.actionRow, styles.actionDivider, pressed && styles.actionRowPressed]}
                testID="attachment-menu-photos"
            >
                <Ionicons color={theme.colors.text} name="images-outline" size={20} />
                <Text numberOfLines={1} style={styles.actionLabel}>{t('happyHerd.composer.photos')}</Text>
            </Pressable>
            <Pressable
                accessibilityLabel={t('happyHerd.composer.deviceFiles')}
                accessibilityRole="menuitem"
                onPress={() => invoke(onPickDeviceFiles)}
                style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
                testID="attachment-menu-device-files"
            >
                <Ionicons color={theme.colors.text} name="document-outline" size={20} />
                <Text numberOfLines={1} style={styles.actionLabel}>{t('happyHerd.composer.deviceFiles')}</Text>
            </Pressable>
        </>
    );
    const menuContent = (
        <View
            accessibilityLabel={t('happyHerd.composer.addAttachment')}
            accessibilityRole="menu"
            accessibilityViewIsModal
        >
            {Platform.OS !== 'web' && (
                <View style={[styles.handle, { backgroundColor: theme.colors.textSecondary }]} />
            )}
            <View style={styles.titleRow}>
                <Text style={styles.title}>{t('happyHerd.composer.addAttachment')}</Text>
            </View>
            {actionRows}
        </View>
    );

    if (Platform.OS === 'web') {
        return (
            <RNModal animationType="none" onRequestClose={onClose} transparent visible>
                <View style={styles.webContainer} testID="attachment-menu-web">
                    <Pressable
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        onPress={onClose}
                        style={[
                            styles.backdrop,
                            {
                                backgroundColor: theme.dark
                                    ? 'rgba(0, 0, 0, 0.28)'
                                    : 'rgba(0, 0, 0, 0.12)',
                            },
                        ]}
                        testID="attachment-menu-backdrop"
                    />
                    <View style={[styles.webMenu, frame]}>
                        <View
                            style={[
                                styles.surface,
                                { backgroundColor: theme.colors.header.background },
                            ]}
                            testID="attachment-menu-surface"
                        >
                            {menuContent}
                        </View>
                    </View>
                </View>
            </RNModal>
        );
    }

    return (
        <RNModal
            animationType="fade"
            navigationBarTranslucent
            onRequestClose={onClose}
            statusBarTranslucent
            transparent
            visible
        >
            <View style={styles.nativeContainer} testID="attachment-menu-native">
                <Pressable
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    onPress={onClose}
                    style={styles.backdrop}
                    testID="attachment-menu-backdrop"
                >
                    <View
                        pointerEvents="none"
                        style={[
                            styles.backdropScrim,
                            {
                                backgroundColor: theme.dark
                                    ? 'rgba(0, 0, 0, 0.48)'
                                    : 'rgba(0, 0, 0, 0.18)',
                            },
                        ]}
                    />
                </Pressable>
                <AnimatedPopup style={styles.nativeSheetFrame}>
                    <LocalBlurHalo borderRadius={22} expansion={14} />
                    <MobileGlassSurface
                        enabled
                        glassEffectStyle="regular"
                        intensity={88}
                        nativeEffect
                        style={[
                            styles.surface,
                            styles.nativeSheet,
                            {
                                backgroundColor: theme.colors.glass.backgroundStrong,
                                paddingBottom: Math.max(16, safeArea.bottom),
                            },
                        ]}
                        testID="attachment-menu-surface"
                        tintColor={theme.colors.glass.overlayTint}
                    >
                        {menuContent}
                    </MobileGlassSurface>
                </AnimatedPopup>
            </View>
        </RNModal>
    );
}

const styles = StyleSheet.create((theme) => ({
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    backdropScrim: {
        ...StyleSheet.absoluteFillObject,
    },
    surface: {
        overflow: 'hidden',
        borderRadius: 18,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.glass.border,
        shadowColor: theme.colors.glass.shadow,
        shadowOpacity: 1,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
        elevation: 10,
    },
    titleRow: {
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    title: {
        color: theme.colors.text,
        fontSize: 14,
        lineHeight: 20,
        ...Typography.default('semiBold'),
    },
    actionRow: {
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
    },
    actionRowPressed: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    actionDivider: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    actionLabel: {
        flex: 1,
        color: theme.colors.text,
        fontSize: 15,
        lineHeight: 20,
        ...Typography.default(),
    },
    handle: {
        width: 40,
        height: 4,
        borderRadius: 999,
        marginTop: 10,
        marginBottom: 4,
        alignSelf: 'center',
    },
    webContainer: {
        flex: 1,
    },
    webMenu: {
        position: 'absolute',
    },
    nativeContainer: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    nativeSheetFrame: {
        width: '100%',
        maxWidth: 560,
        alignSelf: 'center',
        paddingHorizontal: 12,
        paddingBottom: 8,
    },
    nativeSheet: {
        borderRadius: 22,
    },
}));
