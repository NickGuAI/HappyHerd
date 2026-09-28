import * as React from 'react';
import { Modal, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { herdWebClasses } from '@/components/herd/motion';
import { HerdExitLayer } from '@/components/herd/HerdExitLayer';
import { HERD_EXIT, useHerdExit } from '@/components/herd/presence';
import { HERD_PHONE_FLOAT_MARGIN, useHerdPhoneLayout } from '@/components/herd/mobile/useHerdPhone';
import { HERD_PHONE_TOP_BAR_HEIGHT } from '@/components/herd/shell/topBarLayout';
import { useWindowSafeAreaInsets } from '@/components/herd/shell/windowInsets';
import { useHerdWideLayout } from './HerdPage';

/**
 * React Native Web closes the topmost Modal on the Escape keyup, so an alert
 * opened from a sheet closes before the sheet does. Global navigation reads
 * the keydown as Back; marking it handled keeps closing a sheet from also
 * leaving the page.
 */
export function useSheetEscapeKeydown(active: boolean): void {
    React.useEffect(() => {
        if (!active || Platform.OS !== 'web' || typeof window === 'undefined') return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') event.preventDefault();
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [active]);
}

/**
 * Modal sheet for page-owned forms and readers (UI overhaul). Wide layouts get a
 * centered card that scales in. Phones get the same card resting on the bottom
 * edge, 8 px from the window's sides and bottom and below the top bar. Other
 * narrow layouts get a bottom sheet with a drag handle. The Modal host keeps
 * Escape/back dismissal and the web focus trap.
 */
export function HerdSheet({
    visible,
    title,
    subtitle,
    leading,
    actions,
    closeLabel,
    onClose,
    footer,
    wide = false,
    testID,
    children,
}: {
    visible: boolean;
    title: string;
    subtitle?: string;
    leading?: React.ReactNode;
    /** Header controls drawn before the close button. */
    actions?: React.ReactNode;
    closeLabel: string;
    onClose: () => void;
    footer?: React.ReactNode;
    wide?: boolean;
    testID?: string;
    children: React.ReactNode;
}) {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const windowInsets = useWindowSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    const wideLayout = useHerdWideLayout();
    const phoneLayout = useHerdPhoneLayout();
    const phone = !wideLayout && phoneLayout;
    const card = wideLayout || phone;
    useSheetEscapeKeydown(visible);
    // On the web the sheet plays its exit before it unmounts; native fades.
    const presence = useHerdExit(visible ? true : null, card ? HERD_EXIT.sheet : HERD_EXIT.sheetDown);
    if (!presence.value) return null;
    const exiting = presence.exiting;
    const layer = (
        <View
            style={[
                styles.root,
                wideLayout ? styles.rootCentered : styles.rootBottom,
                phone && {
                    paddingHorizontal: HERD_PHONE_FLOAT_MARGIN,
                    paddingBottom: HERD_PHONE_FLOAT_MARGIN + windowInsets.bottom,
                },
            ]}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={closeLabel}
                onPress={onClose}
                style={styles.scrim(exiting)}
            />
            <View
                testID={testID}
                role="dialog"
                aria-modal
                accessibilityLabel={title}
                style={[
                    styles.sheet,
                    card ? styles.sheetCentered(exiting) : styles.sheetBottom(exiting),
                    wideLayout && wide && styles.sheetWide,
                    // Phones keep the top bar in view, as the mock's 20 px of it does.
                    phone && {
                        maxWidth: '100%',
                        maxHeight: windowHeight - windowInsets.top - HERD_PHONE_TOP_BAR_HEIGHT
                            - windowInsets.bottom - HERD_PHONE_FLOAT_MARGIN - 20,
                    },
                    !card && { paddingBottom: Math.max(safeArea.bottom, 12) },
                ]}
            >
                {!card ? <View style={styles.handle} /> : null}
                <View style={[styles.header, phone && styles.headerPhone]}>
                    {leading}
                    <View style={styles.headerCopy}>
                        <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>{title}</Text>
                        {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
                    </View>
                    {!phone ? actions : null}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={closeLabel}
                        onPress={onClose}
                        hitSlop={8}
                        style={({ pressed }) => [styles.close, pressed && styles.pressed]}
                    >
                        <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>
                {/* Phones give header actions their own row, so the title keeps its width. */}
                {phone && actions ? <View style={styles.actionsPhone}>{actions}</View> : null}
                <ScrollView
                    style={styles.body}
                    contentContainerStyle={[styles.bodyContent, phone && styles.bodyContentPhone]}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator
                >
                    {children}
                </ScrollView>
                {footer ? <View style={[styles.footer, phone && styles.footerPhone]}>{footer}</View> : null}
            </View>
        </View>
    );
    // Closing ends the Modal at once; the sheet leaves on an inert layer.
    if (exiting) {
        return <HerdExitLayer>{layer}</HerdExitLayer>;
    }
    return (
        <Modal visible transparent animationType={Platform.OS === 'web' ? 'none' : 'fade'} onRequestClose={onClose}>
            {layer}
        </Modal>
    );
}

const styles = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
    },
    rootCentered: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    rootBottom: {
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
    sheet: {
        width: '100%',
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        backgroundColor: theme.colors.surface,
        shadowColor: theme.colors.shadow.color,
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 40,
        shadowOffset: { width: 0, height: 24 },
        elevation: 16,
    },
    sheetCentered: (exiting: boolean) => ({
        maxWidth: 560,
        maxHeight: '88%',
        borderRadius: theme.kilv.radiusSheet,
        _web: { _classNames: herdWebClasses(exiting ? 'herd-sheet-out' : 'herd-sheet'), boxShadow: theme.kilv.shadow },
    }),
    sheetWide: {
        maxWidth: 720,
    },
    sheetBottom: (exiting: boolean) => ({
        maxHeight: '92%',
        borderBottomWidth: 0,
        borderTopLeftRadius: theme.kilv.radiusBottomSheet,
        borderTopRightRadius: theme.kilv.radiusBottomSheet,
        _web: { _classNames: herdWebClasses(exiting ? 'herd-sheet-down' : 'herd-sheet-up') },
    }),
    handle: {
        alignSelf: 'center',
        width: 38,
        height: 4,
        marginTop: 8,
        borderRadius: theme.kilv.radiusPill,
        backgroundColor: theme.colors.divider,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 20,
        paddingTop: 18,
        paddingBottom: 12,
    },
    // Phones: the card's content sits on the 16 px gutter.
    headerPhone: {
        paddingHorizontal: 16,
        paddingTop: 20,
    },
    headerCopy: {
        flex: 1,
        minWidth: 0,
    },
    actionsPhone: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
        paddingHorizontal: 16,
        paddingBottom: 12,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 20,
        lineHeight: 26,
        letterSpacing: -0.2,
        color: theme.colors.text,
    },
    subtitle: {
        ...Typography.default(),
        marginTop: 3,
        fontSize: 13.5,
        lineHeight: 19,
        color: theme.colors.textSecondary,
    },
    close: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.kilv.radius,
        _web: { cursor: 'pointer', _hover: { backgroundColor: theme.colors.surfacePressedOverlay } },
    },
    pressed: {
        opacity: 0.7,
    },
    body: {
        flexGrow: 0,
        flexShrink: 1,
    },
    bodyContent: {
        paddingHorizontal: 20,
        paddingBottom: 18,
    },
    bodyContentPhone: {
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        flexWrap: 'wrap',
        gap: 8,
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    footerPhone: {
        paddingHorizontal: 16,
    },
}));
