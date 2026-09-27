import * as React from 'react';
import { View, Pressable } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { VoiceAssistantStatusBar } from './VoiceAssistantStatusBar';
import { useRealtimeStatus, useSetting, useSettingMutable } from '@/sync/storage';
import { MainView } from './MainView';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { Ionicons } from '@expo/vector-icons';
import { ShortcutHintBadge, useShortcutHints } from './ShortcutHints';
import { useHasArchivedSessions } from '@/hooks/useVisibleSessionListViewData';
import { SidebarNavigationButton } from './SidebarNavigationButton';
import { useIsTablet } from '@/utils/responsive';
import { HerdConnectionStatus } from './herd/shell/HerdConnectionStatus';
import { useHerdPhoneShell } from './herd/shell/phoneShell';

const stylesheet = StyleSheet.create((theme) => ({
    // Sits below the HappyHerd top bar, which owns the window's top edge.
    container: {
        flex: 1,
        borderStyle: 'solid',
        backgroundColor: theme.colors.surface,
        borderRightWidth: 1,
        borderRightColor: theme.colors.divider,
    },
    // Phones: the panel is the session list itself, at full width.
    containerDocked: {
        borderRightWidth: 0,
    },
    topControls: {
        marginHorizontal: 14,
        marginTop: 14,
        marginBottom: 6,
        gap: 10,
    },
    // Phones put the panel's controls on the 16 px page gutter.
    topControlsPhone: {
        marginHorizontal: 16,
        marginTop: 12,
        gap: 8,
    },
    primaryNavigation: {
        flexDirection: 'row',
        gap: 8,
    },
    sessionActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    newSession: {
        flex: 1,
    },
    archiveButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.kilv.radius,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        _web: { _classNames: ['herd-transition', 'herd-press'] },
    },
    archiveButtonHovered: {
        borderColor: theme.colors.kilv.rimLine,
    },
    archiveButtonActive: {
        borderColor: theme.colors.selection.border,
        backgroundColor: theme.colors.selection.background,
    },
    archiveButtonPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    settingsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
        gap: 10,
    },
    settingsRowPhone: {
        paddingHorizontal: 8,
    },
}));

type SidebarViewProps = {
    /** Phones (UI overhaul): the panel is the session list, docked at full width. */
    docked?: boolean;
    /** The session list; the desktop panel's list by default. */
    list?: React.ReactNode;
    /**
     * The native phone home keeps its home dock along the bottom edge, so
     * Settings joins the icon row there instead of the bottom row.
     */
    settingsInNav?: boolean;
};

export const SidebarView = React.memo(({ docked = false, list, settingsInNav = false }: SidebarViewProps) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const pathname = usePathname();
    const realtimeStatus = useRealtimeStatus();
    const machineWorkspaceEnabled = useSetting('machineWorkspace');
    const hasArchivedSessions = useHasArchivedSessions();
    // Stored under its original `hideInactiveSessions` key — synced settings
    // have no rename migration — but it hides archived sessions only.
    const [hideArchivedSessions, setHideArchivedSessions] = useSettingMutable('hideInactiveSessions');
    const { visible: shortcutHintsVisible } = useShortcutHints();
    const phone = !useIsTablet();
    // The bottom row owns the home-indicator inset, so the list above it must not add it again.
    const insets = useSafeAreaInsets();
    const listInsets = React.useMemo(() => ({ ...insets, bottom: 0 }), [insets]);
    const sessionList = list ?? <MainView variant="sidebar" />;
    // Phones (UI overhaul): choosing a destination closes the drawer, even the
    // page already open underneath. Elsewhere the drawer is closed and this is a no-op.
    const closePhoneDrawer = useHerdPhoneShell((state) => state.closeDrawer);
    const go = React.useCallback((navigate: () => void) => {
        closePhoneDrawer();
        navigate();
    }, [closePhoneDrawer]);
    const openSettings = React.useCallback(() => go(() => router.push('/settings')), [go, router]);

    const handleNewSession = React.useCallback(() => {
        go(() => router.navigate('/new'));
    }, [go, router]);
    const handleArchiveVisibility = React.useCallback(() => {
        setHideArchivedSessions(!hideArchivedSessions);
    }, [hideArchivedSessions, setHideArchivedSessions]);
    return (
        <View style={[styles.container, docked && styles.containerDocked]} testID={docked ? 'herd-sidebar-docked' : 'herd-sidebar'}>
            <View style={[styles.topControls, phone && styles.topControlsPhone]}>
                <View style={styles.primaryNavigation}>
                    {machineWorkspaceEnabled && (
                        <SidebarNavigationButton
                            iconOnly
                            icon="folder-open-outline"
                            label={t('workspace.title')}
                            active={pathname.startsWith('/workspace')}
                            onPress={() => go(() => router.navigate('/workspace'))}
                        />
                    )}
                    <SidebarNavigationButton
                        iconOnly
                        icon="albums-outline"
                        label={t('sidebar.projects')}
                        active={pathname.startsWith('/projects')}
                        onPress={() => go(() => router.navigate('/projects'))}
                    />
                    <SidebarNavigationButton
                        iconOnly
                        icon="time-outline"
                        label={t('happyHerd.automations.title')}
                        active={pathname.startsWith('/automations')}
                        onPress={() => go(() => router.navigate('/automations'))}
                    />
                    {settingsInNav && (
                        <SidebarNavigationButton
                            iconOnly
                            icon="settings-outline"
                            label={t('settings.title')}
                            active={pathname.startsWith('/settings')}
                            onPress={openSettings}
                        />
                    )}
                </View>
                <View style={styles.sessionActions}>
                    <View style={styles.newSession}>
                        <SidebarNavigationButton
                            icon="create-outline"
                            label={t('sidebar.newSession')}
                            onPress={handleNewSession}
                            emphasis
                            active={pathname.startsWith('/new')}
                            highlighted={shortcutHintsVisible}
                            trailing={<ShortcutHintBadge shortcutKey="N" />}
                        />
                    </View>
                    {hasArchivedSessions && (
                        <Pressable
                            onPress={handleArchiveVisibility}
                            accessibilityLabel={hideArchivedSessions
                                ? t('sidebar.showArchived')
                                : t('sidebar.hideArchived')}
                            accessibilityRole="button"
                            accessibilityState={{ selected: !hideArchivedSessions }}
                            style={({ pressed, hovered }: any) => [
                                styles.archiveButton,
                                hovered && styles.archiveButtonHovered,
                                !hideArchivedSessions && styles.archiveButtonActive,
                                pressed && styles.archiveButtonPressed,
                            ]}
                        >
                            <Ionicons
                                name={hideArchivedSessions ? 'archive-outline' : 'archive'}
                                size={18}
                                color={hideArchivedSessions ? theme.colors.text : theme.colors.textLink}
                            />
                        </Pressable>
                    )}
                </View>
            </View>

            {/* The phone session list carries the connection line its home header used to. */}
            {docked && <HerdConnectionStatus />}

            {realtimeStatus !== 'disconnected' && (
                <VoiceAssistantStatusBar variant="sidebar" />
            )}

            {/* Sessions list */}
            {settingsInNav ? sessionList : (
                <SafeAreaInsetsContext.Provider value={listInsets}>{sessionList}</SafeAreaInsetsContext.Provider>
            )}

            {/* Settings at bottom */}
            {!settingsInNav && (
                <View style={[styles.settingsRow, phone && styles.settingsRowPhone, { paddingBottom: 8 + insets.bottom }]}>
                    <SidebarNavigationButton
                        icon="settings-outline"
                        label={t('settings.title')}
                        onPress={openSettings}
                        quiet
                        active={pathname.startsWith('/settings')}
                        highlighted={shortcutHintsVisible}
                        trailing={<ShortcutHintBadge shortcutKey="," />}
                    />
                </View>
            )}
        </View>
    );
});
