import * as React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { VoiceAssistantStatusBar } from './VoiceAssistantStatusBar';
import { useRealtimeStatus, useSetting, useSettingMutable } from '@/sync/storage';
import { MainView } from './MainView';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { useShortcutHints } from './ShortcutHints';
import { Typography } from '@/constants/Typography';
import { HerdShellIcon } from './herd/shell/HerdShellIcon';
import { useHasArchivedSessions } from '@/hooks/useVisibleSessionListViewData';
import { SidebarNavigationButton } from './SidebarNavigationButton';
import { useHerdPhoneLayout } from '@/components/herd/mobile/useHerdPhone';
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
    // The mock's `.sb-arch.on`: molten line and icon, no fill.
    archiveButtonActive: {
        borderColor: theme.colors.selection.border,
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
    // The mock's `kbd`: sunken keycap with a 2 px bottom edge.
    kbd: {
        minWidth: 20,
        height: 20,
        paddingHorizontal: 5,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 5,
        borderWidth: 1,
        borderBottomWidth: 2,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.input.background,
    },
    kbdLit: {
        borderColor: theme.colors.kilv.accent,
    },
    kbdText: {
        fontSize: 11,
        color: theme.colors.kilv.inkFaint,
        ...Typography.mono(),
    },
}));

/**
 * The shortcut on a panel control, always shown on web desktop as the mock
 * draws it (the real chord, such as ⌥⌘N). Holding the modifier lights it.
 */
// The mock's panel `kbd` names only the key, as the held-modifier hints do;
// it lights while the shortcut modifiers are held.
function PanelShortcutKbd({ shortcutKey }: { shortcutKey: string }) {
    const styles = stylesheet;
    const phone = useHerdPhoneLayout();
    const { visible } = useShortcutHints();
    if (Platform.OS !== 'web' || phone) return null;
    return (
        <View pointerEvents="none" style={[styles.kbd, visible && styles.kbdLit]} testID={`herd-panel-kbd-${shortcutKey}`}>
            <Text style={styles.kbdText}>{shortcutKey}</Text>
        </View>
    );
}

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
    const phone = useHerdPhoneLayout();
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
                            icon="split"
                            label={t('workspace.title')}
                            active={pathname.startsWith('/workspace')}
                            onPress={() => go(() => router.navigate('/workspace'))}
                        />
                    )}
                    <SidebarNavigationButton
                        iconOnly
                        icon="folders"
                        label={t('sidebar.projects')}
                        active={pathname.startsWith('/projects')}
                        onPress={() => go(() => router.navigate('/projects'))}
                    />
                    <SidebarNavigationButton
                        iconOnly
                        icon="bolt"
                        label={t('happyHerd.automations.title')}
                        active={pathname.startsWith('/automations')}
                        onPress={() => go(() => router.navigate('/automations'))}
                    />
                    {settingsInNav && (
                        <SidebarNavigationButton
                            iconOnly
                            icon="gear"
                            label={t('settings.title')}
                            active={pathname.startsWith('/settings')}
                            onPress={openSettings}
                        />
                    )}
                </View>
                <View style={styles.sessionActions}>
                    <View style={styles.newSession}>
                        <SidebarNavigationButton
                            icon="pen"
                            label={t('sidebar.newSession')}
                            onPress={handleNewSession}
                            emphasis
                            active={pathname.startsWith('/new')}
                            highlighted={shortcutHintsVisible}
                            trailing={<PanelShortcutKbd shortcutKey="N" />}
                        />
                    </View>
                    {hasArchivedSessions && (
                        <Pressable
                            onPress={handleArchiveVisibility}
                            accessibilityLabel={hideArchivedSessions
                                ? t('sidebar.showArchived')
                                : t('sidebar.hideArchived')}
                            accessibilityRole="button"
                            aria-pressed={!hideArchivedSessions}
                            testID="herd-archive-toggle"
                            style={({ pressed, hovered }: any) => [
                                styles.archiveButton,
                                hovered && styles.archiveButtonHovered,
                                !hideArchivedSessions && styles.archiveButtonActive,
                                pressed && styles.archiveButtonPressed,
                            ]}
                        >
                            {({ hovered }: any) => (
                                <HerdShellIcon
                                    name={hideArchivedSessions ? 'archive' : 'unarchive'}
                                    size={18}
                                    color={!hideArchivedSessions ? theme.colors.textLink : hovered ? theme.colors.text : theme.colors.textSecondary}
                                />
                            )}
                        </Pressable>
                    )}
                </View>
            </View>

            {/*
              * The connection line: the phone session list, which inherited it from the phone
              * home header, and the desktop panel. The phone drawer, over another page, has none.
              */}
            {(docked || !phone) && <HerdConnectionStatus />}

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
                        icon="gear"
                        label={t('settings.title')}
                        onPress={openSettings}
                        quiet
                        active={pathname.startsWith('/settings')}
                        highlighted={shortcutHintsVisible}
                        trailing={<PanelShortcutKbd shortcutKey="," />}
                        testID="herd-panel-settings"
                    />
                </View>
            )}
        </View>
    );
});
