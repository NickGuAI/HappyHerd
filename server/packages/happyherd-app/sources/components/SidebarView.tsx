import * as React from 'react';
import { View, Pressable } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { VoiceAssistantStatusBar } from './VoiceAssistantStatusBar';
import { useRealtimeStatus, useSetting, useSettingMutable } from '@/sync/storage';
import { MainView } from './MainView';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { Ionicons } from '@expo/vector-icons';
import { ShortcutHintBadge, useShortcutHints } from './ShortcutHints';
import { useHasArchivedSessions } from '@/hooks/useVisibleSessionListViewData';
import { SidebarNavigationButton } from './SidebarNavigationButton';

const stylesheet = StyleSheet.create((theme) => ({
    // Sits below the HappyHerd top bar, which owns the window's top edge.
    container: {
        flex: 1,
        borderStyle: 'solid',
        backgroundColor: theme.colors.surface,
        borderRightWidth: 1,
        borderRightColor: theme.colors.divider,
    },
    topControls: {
        marginHorizontal: 14,
        marginTop: 14,
        marginBottom: 6,
        gap: 10,
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
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
        gap: 10,
    },
}));

export const SidebarView = React.memo(() => {
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

    const handleNewSession = React.useCallback(() => {
        router.navigate('/new');
    }, [router]);
    const handleArchiveVisibility = React.useCallback(() => {
        setHideArchivedSessions(!hideArchivedSessions);
    }, [hideArchivedSessions, setHideArchivedSessions]);
    return (
        <View style={styles.container}>
            <View style={styles.topControls}>
                <View style={styles.primaryNavigation}>
                    {machineWorkspaceEnabled && (
                        <SidebarNavigationButton
                            iconOnly
                            icon="folder-open-outline"
                            label={t('workspace.title')}
                            active={pathname.startsWith('/workspace')}
                            onPress={() => router.navigate('/workspace')}
                        />
                    )}
                    <SidebarNavigationButton
                        iconOnly
                        icon="albums-outline"
                        label={t('sidebar.projects')}
                        active={pathname.startsWith('/projects')}
                        onPress={() => router.navigate('/projects')}
                    />
                    <SidebarNavigationButton
                        iconOnly
                        icon="time-outline"
                        label={t('happyHerd.automations.title')}
                        active={pathname.startsWith('/automations')}
                        onPress={() => router.navigate('/automations')}
                    />
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

            {realtimeStatus !== 'disconnected' && (
                <VoiceAssistantStatusBar variant="sidebar" />
            )}

            {/* Sessions list */}
            <MainView variant="sidebar" />

            {/* Settings at bottom */}
            <View style={styles.settingsRow}>
                <SidebarNavigationButton
                    icon="settings-outline"
                    label={t('settings.title')}
                    onPress={() => router.push('/settings')}
                    quiet
                    active={pathname.startsWith('/settings')}
                    highlighted={shortcutHintsVisible}
                    trailing={<ShortcutHintBadge shortcutKey="," />}
                />
            </View>
        </View>
    );
});
