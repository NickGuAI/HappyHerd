import * as React from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useLocalSetting } from '@/sync/storage';
import { t } from '@/text';
import { herdWebClasses } from '../motion';
import { toggleNavigationSidebarCollapsed } from './sidebarShortcut';

export const HERD_SIDEBAR_EDGE_TOGGLE_WIDTH = 24;
export const HERD_SIDEBAR_EDGE_TOGGLE_HEIGHT = 44;
/** Inset from the window edge while the panel is collapsed. */
export const HERD_SIDEBAR_EDGE_TOGGLE_COLLAPSED_LEFT = 6;

/** Straddles the panel's edge while open; rests against the window edge once collapsed. */
export function resolveHerdSidebarEdgeToggleLeft(drawerWidth: number): number {
    return drawerWidth > 0
        ? drawerWidth - HERD_SIDEBAR_EDGE_TOGGLE_WIDTH / 2
        : HERD_SIDEBAR_EDGE_TOGGLE_COLLAPSED_LEFT;
}

/**
 * Secondary collapse handle on the panel boundary, vertically centred. While
 * the panel is open it appears when the pointer is over the shell; once the
 * panel is collapsed it stays visible so the panel can be brought back from
 * where it left.
 */
export function HerdSidebarEdgeToggle({ drawerWidth }: { drawerWidth: number }) {
    const { theme } = useUnistyles();
    const collapsed = useLocalSetting('navigationSidebarCollapsed');
    const label = collapsed ? t('navigation.expandSidebar') : t('navigation.collapseSidebar');

    return (
        <Pressable
            onPress={toggleNavigationSidebarCollapsed}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={label}
            aria-expanded={!collapsed}
            testID="navigation-sidebar-edge-toggle"
            style={({ hovered, pressed }: any) => [
                styles.handle(!collapsed),
                { left: resolveHerdSidebarEdgeToggleLeft(drawerWidth) },
                (hovered || pressed) && styles.handleHovered,
            ]}
        >
            <Ionicons
                name={collapsed ? 'chevron-forward' : 'chevron-back'}
                size={14}
                color={theme.colors.textSecondary}
            />
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    handle: (revealOnHover: boolean) => ({
        position: 'absolute',
        top: '50%',
        marginTop: -HERD_SIDEBAR_EDGE_TOGGLE_HEIGHT / 2,
        width: HERD_SIDEBAR_EDGE_TOGGLE_WIDTH,
        height: HERD_SIDEBAR_EDGE_TOGGLE_HEIGHT,
        zIndex: 30,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.kilv.radius,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        _web: { _classNames: herdWebClasses('herd-transition', revealOnHover && 'herd-shell-reveal') },
    }),
    handleHovered: {
        borderColor: theme.colors.kilv.rimLine,
    },
}));
