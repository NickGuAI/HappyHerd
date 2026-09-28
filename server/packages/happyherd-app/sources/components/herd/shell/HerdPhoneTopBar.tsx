import * as React from 'react';
import { Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { FocusModeControl } from '@/components/FocusModeControl';
import { useFocusMode } from '@/hooks/useFocusMode';
import { t } from '@/text';
import { useHerdCommandPalette } from './commandPaletteBridge';
import { HerdInboxBell } from './HerdInboxBell';
import { HerdMachineMenu } from './HerdMachineMenu';
import { HerdMaskImage } from './HerdMaskImage';
import { HerdShellIcon } from './HerdShellIcon';
import { herdBrandMarkFill } from './brandMark';
import { HerdTopBarIconButton } from './HerdTopBarIconButton';
import { useHerdPhoneShell } from './phoneShell';
import { HERD_PHONE_TOP_BAR_HEIGHT, HerdTopBarLayoutContext } from './topBarLayout';

/** Below this width the machine pill keeps only its status dot. */
const PHONE_MACHINE_NAME_MIN_WIDTH = 360;

/**
 * The desktop top bar at phone width (UI overhaul), shared by Web Mobile and
 * the native phone app. Left to right: the panel toggle, the brand (back to
 * the session list), search, then Focus mode, the Inbox bell and the machine
 * pill. On the session list the panel is docked open, so the toggle steps
 * aside. Search opens the command palette where the Web build has it, and the
 * session search at the top of the list on native phones.
 */
export const HerdPhoneTopBar = React.memo(function HerdPhoneTopBar({ home }: { home: boolean }) {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const router = useRouter();
    const { width } = useWindowDimensions();
    const focus = useFocusMode();
    const openCommandPalette = useHerdCommandPalette();
    const drawerOpen = useHerdPhoneShell((state) => state.drawerOpen);
    const toggleDrawer = useHerdPhoneShell((state) => state.toggleDrawer);
    const searchOpen = useHerdPhoneShell((state) => state.searchOpen);
    const toggleSearch = useHerdPhoneShell((state) => state.toggleSearch);
    const nativeSearch = Platform.OS !== 'web';

    const onSearch = React.useCallback(() => {
        if (!nativeSearch) {
            openCommandPalette?.();
            return;
        }
        if (!home) router.navigate('/');
        toggleSearch();
    }, [home, nativeSearch, openCommandPalette, router, toggleSearch]);

    return (
        <HerdTopBarLayoutContext.Provider value="phone">
            <View
                testID="herd-top-bar"
                style={[styles.bar, { height: safeArea.top + HERD_PHONE_TOP_BAR_HEIGHT, paddingTop: safeArea.top }]}
            >
                {!home && (
                    <HerdTopBarIconButton
                        label={drawerOpen ? t('navigation.collapseSidebar') : t('navigation.expandSidebar')}
                        expanded={drawerOpen}
                        onPress={toggleDrawer}
                        testID="navigation-sidebar-toggle"
                    >
                        <HerdShellIcon name="panelLeft" size={20} color={theme.colors.header.tint} />
                    </HerdTopBarIconButton>
                )}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('sidebar.sessionsTitle')}
                    onPress={() => router.navigate('/')}
                    style={({ pressed }) => [styles.square, pressed && styles.pressed]}
                    testID="herd-top-bar-brand"
                >
                    <HerdMaskImage
                        source={require('@/assets/images/logo-black.png')}
                        size={24}
                        tint={theme.colors.textLink}
                        fill={herdBrandMarkFill(theme)}
                        testID="herd-brand-mark"
                    />
                </Pressable>
                {(nativeSearch || openCommandPalette) && (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={nativeSearch ? t('tools.names.search') : t('commandPalette.placeholder')}
                        accessibilityState={nativeSearch ? { selected: searchOpen } : undefined}
                        onPress={onSearch}
                        style={styles.square}
                        testID={nativeSearch ? 'herd-phone-search' : 'herd-command-search'}
                    >
                        {({ pressed }) => (
                            <View style={[styles.search, (pressed || (nativeSearch && searchOpen)) && styles.searchActive]}>
                                <HerdShellIcon name="search" size={17} color={theme.colors.kilv.inkFaint} />
                            </View>
                        )}
                    </Pressable>
                )}
                <View style={styles.spacer} />
                <View style={styles.trailing}>
                    <FocusModeControl />
                    <HerdInboxBell />
                    <HerdMachineMenu nameHidden={!!focus || width < PHONE_MACHINE_NAME_MIN_WIDTH} />
                </View>
            </View>
        </HerdTopBarLayoutContext.Provider>
    );
});

const styles = StyleSheet.create((theme) => ({
    // Controls are 44 px squares from a 4 px edge, so their icons line up with the 16 px page gutter.
    bar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        paddingHorizontal: 4,
        backgroundColor: theme.colors.header.background,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
        zIndex: 20,
    },
    square: {
        width: 44,
        height: 44,
        borderRadius: theme.kilv.radius,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    pressed: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    search: {
        width: 36,
        height: 36,
        borderRadius: theme.kilv.radius,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.input.background,
        alignItems: 'center',
        justifyContent: 'center',
        _web: { _classNames: ['herd-transition'] },
    },
    searchActive: {
        borderColor: theme.colors.kilv.rimLine,
    },
    spacer: {
        flex: 1,
        minWidth: 0,
    },
    trailing: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        flexShrink: 1,
        minWidth: 0,
    },
}));
