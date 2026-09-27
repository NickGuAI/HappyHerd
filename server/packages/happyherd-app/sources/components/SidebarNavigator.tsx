import { useAuth } from '@/auth/AuthContext';
import * as React from 'react';
import { Drawer } from 'expo-router/drawer';
import { useIsTablet } from '@/utils/responsive';
import { SidebarView } from './SidebarView';
import { useWindowDimensions, View } from 'react-native';
import { useLocalSetting } from '@/sync/storage';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { HerdTopBar } from './herd/shell/HerdTopBar';
import { HerdSidebarEdgeToggle } from './herd/shell/HerdSidebarEdgeToggle';
import { HerdWindowInsetsContext } from './herd/shell/windowInsets';
import {
    HerdSidebarFrame,
    HerdSidebarPhaseContext,
    useHerdSidebarTransition,
} from './herd/shell/sidebarTransition';
import {
    resolveDesktopNavigationDrawerWidth,
    resolveDesktopNavigationHidden,
} from './sidebarNavigationLayout';

export const SidebarNavigator = React.memo(() => {
    const auth = useAuth();
    const isTablet = useIsTablet();
    const zenMode = useLocalSetting('zenMode');
    const navigationSidebarCollapsed = useLocalSetting('navigationSidebarCollapsed');
    const isDesktopLayout = auth.isAuthenticated && isTablet;
    const { width: windowWidth } = useWindowDimensions();
    const safeArea = useSafeAreaInsets();

    // Calculate target drawer width
    const fullDrawerWidth = React.useMemo(() => {
        if (!isDesktopLayout) return 280;
        return Math.min(Math.max(Math.floor(windowWidth * 0.3), 250), 360);
    }, [windowWidth, isDesktopLayout]);
    const transition = useHerdSidebarTransition(resolveDesktopNavigationHidden({
        zenMode,
        navigationSidebarCollapsed,
    }));
    const drawerWidth = resolveDesktopNavigationDrawerWidth({
        isDesktopLayout,
        hidden: transition.widthHidden,
        fullDrawerWidth,
    });

    // The desktop top bar consumes the top inset, so screens below it start
    // flush. Fullscreen modals read the window's real insets instead
    // (useWindowSafeAreaInsets), because they cover the top bar.
    const bodyInsets = React.useMemo(
        () => (isDesktopLayout ? { ...safeArea, top: 0 } : safeArea),
        [isDesktopLayout, safeArea],
    );

    const drawerNavigationOptions = React.useMemo(() => {
        if (!isDesktopLayout) {
            // Non-tablet: use front drawer, hidden
            return {
                lazy: false,
                headerShown: false,
                drawerType: 'front' as const,
                swipeEnabled: false,
                drawerStyle: {
                    width: 0,
                    display: 'none' as const,
                },
            };
        }

        // Tablet: always permanent, just collapse width in zen mode.
        //
        // We deliberately do NOT animate `width` on web. A CSS transition on
        // the drawer width re-flowed the chat flex-1 sibling on every frame,
        // re-measuring the entire FlatList tree at ~15fps. Snapping the
        // width change makes the chat reflow exactly once; the panel's
        // content slides out before the snap (useHerdSidebarTransition).
        // Native already snaps because RN doesn't honor CSS transitions.
        return {
            lazy: false,
            headerShown: false,
            drawerType: 'permanent' as const,
            drawerStyle: {
                backgroundColor: 'white',
                borderRightWidth: 0,
                width: drawerWidth,
                overflow: 'hidden' as const,
            } as any,
            swipeEnabled: false,
            drawerActiveTintColor: 'transparent',
            drawerInactiveTintColor: 'transparent',
            drawerItemStyle: { display: 'none' as const },
            drawerLabelStyle: { display: 'none' as const },
        };
    }, [isDesktopLayout, drawerWidth]);

    const drawerContent = React.useCallback(
        () => (
            <HerdSidebarFrame>
                <SidebarView />
            </HerdSidebarFrame>
        ),
        []
    );

    return (
        <View style={{ flex: 1 }}>
            {/* HappyHerd top bar: always visible on desktop, including Zen mode */}
            {isDesktopLayout && <HerdTopBar />}
            <View style={styles.body}>
                <HerdWindowInsetsContext.Provider value={isDesktopLayout ? safeArea : null}>
                    <SafeAreaInsetsContext.Provider value={bodyInsets}>
                        <HerdSidebarPhaseContext.Provider value={transition.phase}>
                            <Drawer
                                screenOptions={drawerNavigationOptions}
                                drawerContent={isDesktopLayout ? drawerContent : undefined}
                            />
                        </HerdSidebarPhaseContext.Provider>
                    </SafeAreaInsetsContext.Provider>
                </HerdWindowInsetsContext.Provider>
                {isDesktopLayout && !zenMode && (
                    <HerdSidebarEdgeToggle drawerWidth={drawerWidth} />
                )}
            </View>
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    body: {
        flex: 1,
        // Hovering anywhere in the shell reveals the panel's edge handle.
        _web: { _classNames: ['herd-shell'] },
    },
}));
