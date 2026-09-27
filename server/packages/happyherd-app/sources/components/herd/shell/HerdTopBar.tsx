import * as React from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useOverlayNav } from '@/-session/sessionOverlayNav';
import { FocusModeControl } from '@/components/FocusModeControl';
import { Typography } from '@/constants/Typography';
import { DEFAULT_APP_ZOOM } from '@/hooks/useTauriZoom';
import { formatShortcut } from '@/keyboard/shortcuts';
import { canRouteForward, canUseRouteBack, getNavigatorCanGoBack } from '@/navigation/browserNavigation';
import { useBrowserNavigationStore } from '@/navigation/browserNavigationStore';
import { useLocalSettingMutable } from '@/sync/storage';
import { t } from '@/text';
import { isTauri } from '@/utils/isTauri';
import { useHeaderHeight } from '@/utils/responsive';
import { useHerdCommandPalette } from './commandPaletteBridge';
import { HerdTopBarIconButton } from './HerdTopBarIconButton';
import { HerdInboxBell } from './HerdInboxBell';
import { HerdMachineMenu } from './HerdMachineMenu';
import {
    formatSidebarToggleShortcut,
    preferredShortcutModifier,
    toggleNavigationSidebarCollapsed,
    useSidebarToggleShortcut,
} from './sidebarShortcut';

/** macOS Tauri draws the traffic lights over the window's top-left corner. */
const TAURI_TRAFFIC_LIGHT_CLEARANCE = Math.ceil(92 / DEFAULT_APP_ZOOM);
/** Below this width the search control shrinks to an icon and the brand shows only its mark. */
export const HERD_TOP_BAR_COMPACT_WIDTH = 1100;

/**
 * The desktop top bar (HappyHerd-owned; replaces the inherited persistent
 * header overlay). Left to right: panel toggle, Zen, brand, history, command
 * search, then Focus mode, the Inbox bell and the machine menu.
 */
export const HerdTopBar = React.memo(function HerdTopBar() {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const headerHeight = useHeaderHeight();
    const router = useRouter();
    const { width: windowWidth } = useWindowDimensions();
    const [navigationSidebarCollapsed] = useLocalSettingMutable('navigationSidebarCollapsed');
    const [zenMode, setZenMode] = useLocalSettingMutable('zenMode');
    const openCommandPalette = useHerdCommandPalette();
    const inTauri = isTauri();
    const isMacTauri = inTauri && typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
    const compact = windowWidth < HERD_TOP_BAR_COMPACT_WIDTH;
    const modifier = React.useMemo(preferredShortcutModifier, []);
    const browserSafeShortcuts = Platform.OS === 'web' && !inTauri;

    useSidebarToggleShortcut(true);

    const routeHistory = useBrowserNavigationStore((state) => state.routeHistory);
    const overlayCanBack = useOverlayNav((state) => state.canBack);
    const overlayCanForward = useOverlayNav((state) => state.canForward);
    const canGoBack = overlayCanBack
        || (routeHistory ? canUseRouteBack(routeHistory, getNavigatorCanGoBack(router)) : false);
    const canGoForward = Platform.OS === 'web'
        && (overlayCanForward || (routeHistory ? canRouteForward(routeHistory) : false));

    const handleBack = React.useCallback(() => {
        // An open file diff or file view inside the session unwinds first.
        if (useOverlayNav.getState().back()) return;
        const nav = useBrowserNavigationStore.getState();
        if (!nav.routeHistory || !canUseRouteBack(nav.routeHistory, getNavigatorCanGoBack(router))) return;
        nav.markRouteBack();
        router.back();
    }, [router]);

    const handleForward = React.useCallback(() => {
        if (useOverlayNav.getState().forward()) return;
        if (Platform.OS !== 'web' || typeof window === 'undefined') return;
        const nav = useBrowserNavigationStore.getState();
        if (!nav.routeHistory || !canRouteForward(nav.routeHistory)) return;
        nav.markRouteForward();
        window.history.forward();
    }, []);

    const collapseLabel = navigationSidebarCollapsed ? t('navigation.expandSidebar') : t('navigation.collapseSidebar');
    const dragRegion = inTauri ? { dataSet: { tauriDragRegion: 'true' } } : {};
    const noDragRegion = inTauri ? { dataSet: { tauriDragRegion: 'false' } } : {};

    return (
        <View
            testID="herd-top-bar"
            style={[styles.bar, {
                height: safeArea.top + headerHeight,
                paddingTop: safeArea.top,
                paddingLeft: isMacTauri ? TAURI_TRAFFIC_LIGHT_CLEARANCE : 12,
            }]}
            {...dragRegion}
        >
            <View style={styles.cluster} {...noDragRegion}>
                <HerdTopBarIconButton
                    label={collapseLabel}
                    hint={formatSidebarToggleShortcut(modifier)}
                    expanded={!navigationSidebarCollapsed}
                    onPress={toggleNavigationSidebarCollapsed}
                    testID="navigation-sidebar-toggle"
                >
                    <Octicons
                        name={navigationSidebarCollapsed ? 'sidebar-expand' : 'sidebar-collapse'}
                        size={18}
                        color={theme.colors.header.tint}
                    />
                </HerdTopBarIconButton>
                <HerdTopBarIconButton
                    label={t('zen.toggle')}
                    active={zenMode}
                    onPress={() => setZenMode(!zenMode)}
                    testID="herd-zen-toggle"
                >
                    <Image
                        source={require('@/assets/images/zen-icon.png')}
                        contentFit="contain"
                        style={styles.zenIcon}
                        tintColor={zenMode ? theme.colors.textLink : theme.colors.header.tint}
                    />
                </HerdTopBarIconButton>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('sidebar.sessionsTitle')}
                    onPress={() => router.navigate('/')}
                    style={({ hovered, pressed }: any) => [styles.brand, (hovered || pressed) && styles.brandHovered]}
                    testID="herd-top-bar-brand"
                >
                    <Image
                        source={require('@/assets/images/logo-black.png')}
                        contentFit="contain"
                        style={styles.brandMark}
                        tintColor={theme.colors.textLink}
                    />
                    {!compact && <Text numberOfLines={1} style={styles.brandText}>{t('sidebar.sessionsTitle')}</Text>}
                </Pressable>
                {/* History stays at every width: tablets have no screen-level Back. */}
                <View style={styles.history}>
                    <HerdTopBarIconButton label={t('common.back')} onPress={handleBack} disabled={!canGoBack} testID="herd-top-bar-back">
                        <Ionicons name="chevron-back" size={18} color={theme.colors.header.tint} />
                    </HerdTopBarIconButton>
                    {Platform.OS === 'web' && (
                        <HerdTopBarIconButton label={t('common.forward')} onPress={handleForward} disabled={!canGoForward} testID="herd-top-bar-forward">
                            <Ionicons name="chevron-forward" size={18} color={theme.colors.header.tint} />
                        </HerdTopBarIconButton>
                    )}
                </View>
            </View>

            <View style={styles.center} pointerEvents="box-none">
                {openCommandPalette && (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('commandPalette.placeholder')}
                        onPress={openCommandPalette}
                        testID="herd-command-search"
                        style={({ hovered, pressed }: any) => [
                            styles.search,
                            compact && styles.searchCompact,
                            (hovered || pressed) && styles.searchHovered,
                        ]}
                        {...noDragRegion}
                    >
                        <Ionicons name="search" size={15} color={theme.colors.kilv.inkFaint} />
                        {!compact && (
                            <>
                                <Text numberOfLines={1} style={styles.searchText}>{t('commandPalette.placeholder')}</Text>
                                <View style={styles.kbd}>
                                    <Text style={styles.kbdText}>{formatShortcut(modifier, 'K', browserSafeShortcuts)}</Text>
                                </View>
                            </>
                        )}
                    </Pressable>
                )}
            </View>

            <View style={styles.cluster} {...noDragRegion}>
                <FocusModeControl />
                <HerdInboxBell />
                <HerdMachineMenu compact={compact} />
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    bar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingRight: 12,
        backgroundColor: theme.colors.header.background,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
        zIndex: 20,
    },
    cluster: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0,
    },
    center: {
        flex: 1,
        minWidth: 0,
        alignItems: 'center',
    },
    zenIcon: {
        width: 18,
        height: 18,
    },
    brand: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        height: 34,
        paddingLeft: 6,
        paddingRight: 10,
        marginLeft: 2,
        borderRadius: theme.kilv.radius,
        _web: { _classNames: ['herd-transition'] },
    },
    brandHovered: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    brandMark: {
        width: 22,
        height: 22,
    },
    brandText: {
        fontSize: 16,
        letterSpacing: -0.1,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    history: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        marginLeft: 4,
    },
    search: {
        width: '100%',
        maxWidth: 440,
        height: 34,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingLeft: 12,
        paddingRight: 6,
        borderRadius: theme.kilv.radius,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.input.background,
        _web: { _classNames: ['herd-transition'], cursor: 'text' },
    },
    searchCompact: {
        width: 36,
        paddingLeft: 0,
        paddingRight: 0,
        justifyContent: 'center',
        alignSelf: 'flex-end',
    },
    searchHovered: {
        borderColor: theme.colors.kilv.rimLine,
        _web: { boxShadow: theme.kilv.glowRim },
    },
    searchText: {
        flex: 1,
        minWidth: 0,
        fontSize: 14,
        color: theme.colors.kilv.inkFaint,
        ...Typography.default(),
    },
    kbd: {
        paddingHorizontal: 6,
        height: 20,
        justifyContent: 'center',
        borderRadius: 5,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    kbdText: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.mono(),
    },
}));
