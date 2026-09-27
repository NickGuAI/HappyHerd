import * as React from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { herdWebClasses } from '@/components/herd/motion';
import { useHerdWideLayout } from './HerdPage';

/**
 * Modal sheet for page-owned forms and readers (UI overhaul). Wide layouts get a
 * centered card that scales in; phones get a bottom sheet with a drag handle.
 * The Modal host keeps Escape/back dismissal and the web focus trap.
 */
export function HerdSheet({
    visible,
    title,
    subtitle,
    leading,
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
    closeLabel: string;
    onClose: () => void;
    footer?: React.ReactNode;
    wide?: boolean;
    testID?: string;
    children: React.ReactNode;
}) {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const wideLayout = useHerdWideLayout();
    if (!visible) return null;
    return (
        <Modal visible transparent animationType="none" onRequestClose={onClose}>
            <View style={[styles.root, wideLayout ? styles.rootCentered : styles.rootBottom]}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={closeLabel}
                    onPress={onClose}
                    style={styles.scrim}
                />
                <View
                    testID={testID}
                    role="dialog"
                    aria-modal
                    accessibilityLabel={title}
                    style={[
                        styles.sheet,
                        wideLayout ? styles.sheetCentered : styles.sheetBottom,
                        wideLayout && wide && styles.sheetWide,
                        !wideLayout && { paddingBottom: Math.max(safeArea.bottom, 12) },
                    ]}
                >
                    {!wideLayout ? <View style={styles.handle} /> : null}
                    <View style={styles.header}>
                        {leading}
                        <View style={styles.headerCopy}>
                            <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>{title}</Text>
                            {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
                        </View>
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
                    <ScrollView
                        style={styles.body}
                        contentContainerStyle={styles.bodyContent}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator
                    >
                        {children}
                    </ScrollView>
                    {footer ? <View style={styles.footer}>{footer}</View> : null}
                </View>
            </View>
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
    scrim: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: theme.colors.kilv.scrim,
        _web: { _classNames: herdWebClasses('herd-fade') },
    },
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
    sheetCentered: {
        maxWidth: 560,
        maxHeight: '88%',
        borderRadius: theme.kilv.radiusSheet,
        _web: { _classNames: herdWebClasses('herd-sheet'), boxShadow: theme.kilv.shadow },
    },
    sheetWide: {
        maxWidth: 720,
    },
    sheetBottom: {
        maxHeight: '92%',
        borderBottomWidth: 0,
        borderTopLeftRadius: theme.kilv.radiusSheet + 4,
        borderTopRightRadius: theme.kilv.radiusSheet + 4,
        _web: { _classNames: herdWebClasses('herd-sheet-up') },
    },
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
    headerCopy: {
        flex: 1,
        minWidth: 0,
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
}));
