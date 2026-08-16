import * as React from 'react';
import { Text, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useHeaderHeight } from '@/utils/responsive';
import { VoiceAssistantStatusBar } from './VoiceAssistantStatusBar';
import { useRealtimeStatus, useSetting, useSettingMutable } from '@/sync/storage';
import { MainView } from './MainView';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { ShortcutHintBadge, useShortcutHints } from './ShortcutHints';
import { useHasArchivedSessions } from '@/hooks/useVisibleSessionListViewData';
import { SidebarNavigationButton } from './SidebarNavigationButton';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        borderStyle: 'solid',
        backgroundColor: theme.colors.groupped.background,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    topControls: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 4,
        gap: 8,
    },
    primaryNavigation: {
        flex: 1,
        gap: 8,
    },
    archiveButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    archiveButtonActive: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    archiveButtonPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    shortcutTargetActive: {
        backgroundColor: theme.colors.surfacePressed,
    },
    settingsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        gap: 10,
    },
    settingsText: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text,
        ...Typography.default(),
    },
    shortcutBadgeInline: {
        marginLeft: 'auto',
    },
}));

export const SidebarView = React.memo(() => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const router = useRouter();
    const headerHeight = useHeaderHeight();
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
        <View style={[styles.container, { paddingTop: safeArea.top + headerHeight }]}>
            <View style={styles.topControls}>
                <View style={styles.primaryNavigation}>
                    <SidebarNavigationButton
                        icon="create-outline"
                        label={t('sidebar.newSession')}
                        onPress={handleNewSession}
                        highlighted={shortcutHintsVisible}
                        trailing={<ShortcutHintBadge shortcutKey="N" />}
                    />
                    {machineWorkspaceEnabled && (
                        <SidebarNavigationButton
                            icon="folder-open-outline"
                            label={t('workspace.title')}
                            onPress={() => router.navigate('/workspace')}
                        />
                    )}
                    <SidebarNavigationButton
                        icon="time-outline"
                        label={t('happyHerd.automations.title')}
                        onPress={() => router.navigate('/automations')}
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
                        style={({ pressed }) => [
                            styles.archiveButton,
                            !hideArchivedSessions && styles.archiveButtonActive,
                            pressed && styles.archiveButtonPressed,
                        ]}
                    >
                        <Ionicons
                            name={hideArchivedSessions ? 'archive-outline' : 'archive'}
                            size={18}
                            color={theme.colors.text}
                        />
                    </Pressable>
                )}
            </View>

            {realtimeStatus !== 'disconnected' && (
                <VoiceAssistantStatusBar variant="sidebar" />
            )}

            {/* Sessions list */}
            <MainView variant="sidebar" />

            {/* Settings at bottom */}
            <Pressable
                onPress={() => router.push('/settings')}
                style={[
                    styles.settingsRow,
                    shortcutHintsVisible && styles.shortcutTargetActive,
                ]}
            >
                <Ionicons name="settings-outline" size={18} color={stylesheet.settingsText.color} />
                <Text style={styles.settingsText}>{t('settings.title')}</Text>
                <ShortcutHintBadge shortcutKey="," style={styles.shortcutBadgeInline} />
            </Pressable>
        </View>
    );
});
