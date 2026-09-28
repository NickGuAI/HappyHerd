import * as React from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { FocusModeControl } from '@/components/FocusModeControl';
import { Typography } from '@/constants/Typography';
import { DEFAULT_APP_ZOOM } from '@/hooks/useTauriZoom';
import { formatShortcut } from '@/keyboard/shortcuts';
import { useLocalSettingMutable } from '@/sync/storage';
import { t } from '@/text';
import { isTauri } from '@/utils/isTauri';
import { useHeaderHeight } from '@/utils/responsive';
import { useHerdCommandPalette } from './commandPaletteBridge';
import { herdBrandMarkFill } from './brandMark';
import { HerdMaskImage } from './HerdMaskImage';
import { HerdShellIcon } from './HerdShellIcon';
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
 * header overlay), drawn as the approved mock: panel toggle, Zen, brand,
 * command search, then the Focus mode button, the Inbox bell and the machine
 * pill. There are no Back or Forward buttons; Escape, mouse side buttons and
 * the browser keep history.
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

    const collapseLabel = navigationSidebarCollapsed ? t('navigation.expandSidebar') : t('navigation.collapseSidebar');
    const dragRegion = inTauri ? { dataSet: { tauriDragRegion: 'true' } } : {};
    const noDragRegion = inTauri ? { dataSet: { tauriDragRegion: 'false' } } : {};

    return (
        <View
            testID="herd-top-bar"
            style={[styles.bar, {
                height: safeArea.top + headerHeight,
                paddingTop: safeArea.top,
                paddingLeft: isMacTauri ? TAURI_TRAFFIC_LIGHT_CLEARANCE : 14,
            }]}
            {...dragRegion}
        >
            <View style={styles.cluster} {...noDragRegion}>
                <HerdTopBarIconButton
                    label={collapseLabel}
                    hint={formatSidebarToggleShortcut(modifier)}
                    expanded={!navigationSidebarCollapsed}
                    active={navigationSidebarCollapsed}
                    onPress={toggleNavigationSidebarCollapsed}
                    testID="navigation-sidebar-toggle"
                    tooltipAlign="start"
                >
                    <HerdShellIcon
                        name="panelLeft"
                        size={19}
                        color={navigationSidebarCollapsed ? theme.colors.textLink : theme.colors.header.tint}
                    />
                </HerdTopBarIconButton>
                <HerdTopBarIconButton
                    label={t('zen.toggle')}
                    active={zenMode}
                    onPress={() => setZenMode(!zenMode)}
                    testID="herd-zen-toggle"
                    tooltipAlign="start"
                >
                    <HerdMaskImage
                        source={require('@/assets/images/zen-icon.png')}
                        size={18}
                        tint={zenMode ? theme.colors.textLink : theme.colors.header.tint}
                        testID="herd-zen-icon"
                    />
                </HerdTopBarIconButton>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('sidebar.sessionsTitle')}
                    onPress={() => router.navigate('/')}
                    style={({ hovered, pressed }: any) => [styles.brand, (hovered || pressed) && styles.brandHovered]}
                    testID="herd-top-bar-brand"
                >
                    <HerdMaskImage
                        source={require('@/assets/images/logo-black.png')}
                        size={24}
                        tint={theme.colors.textLink}
                        fill={herdBrandMarkFill(theme)}
                        testID="herd-brand-mark"
                    />
                    {/* The mock keeps the name below 1100 px; only the search collapses. */}
                    <Text numberOfLines={1} style={styles.brandText}>{t('sidebar.sessionsTitle')}</Text>
                </Pressable>
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
                        <HerdShellIcon name="search" size={15} color={theme.colors.kilv.inkFaint} />
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

            <View style={[styles.cluster, styles.trailing]} {...noDragRegion}>
                <FocusModeControl />
                <HerdInboxBell />
                <HerdMachineMenu />
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
    // The mock's `.top-right`: Focus mode, the bell and the machine pill, 8 px apart.
    trailing: {
        gap: 8,
    },
    center: {
        flex: 1,
        minWidth: 0,
        alignItems: 'center',
    },
    brand: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        height: 32,
        paddingLeft: 4,
        paddingRight: 8,
        marginLeft: 2,
        borderRadius: theme.kilv.radius,
        _web: { _classNames: ['herd-transition'] },
    },
    brandHovered: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    brandText: {
        fontSize: 16.5,
        letterSpacing: -0.16,
        color: theme.colors.text,
        ...Typography.logo(),
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
    // The mock's `kbd`: sunken, hairline border with a 2 px bottom edge.
    kbd: {
        minWidth: 20,
        paddingHorizontal: 5,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 5,
        borderWidth: 1,
        borderBottomWidth: 2,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.input.background,
    },
    kbdText: {
        fontSize: 11,
        color: theme.colors.kilv.inkFaint,
        ...Typography.mono(),
    },
}));
