import React, { useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Modal } from '@/modal';
import { CommandPalette } from './CommandPalette';
import { Command } from './types';
import { useGlobalKeyboard } from '@/hooks/useGlobalKeyboard';
import { useAuth } from '@/auth/AuthContext';
import { storage, useAllMachines } from '@/sync/storage';
import { useShallow } from 'zustand/react/shallow';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { ShortcutHintsProvider } from '@/components/ShortcutHints';
import {
    formatShortcut,
    getPreferredShortcutModifier,
} from '@/keyboard/shortcuts';
import { isTauri } from '@/utils/isTauri';
import { useVisibleSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import { getSessionShortcutIdsInDisplayOrder } from '@/utils/sessionDisplayOrder';
import { t } from '@/text';

const EMPTY_SESSION_IDS: readonly string[] = [];

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const { logout, isAuthenticated } = useAuth();
    const sessions = storage(useShallow((state) => state.sessions));
    const commandPaletteEnabled = storage(useShallow((state) => state.localSettings.commandPaletteEnabled));
    const sessionListViewData = useVisibleSessionListViewData();
    const machines = useAllMachines();
    const navigateToSession = useNavigateToSession();
    const preferredModifier = useMemo(() => getPreferredShortcutModifier(
        typeof navigator === 'undefined' ? undefined : navigator
    ), []);
    const browserSafeShortcuts = useMemo(() => Platform.OS === 'web' && !isTauri(), []);
    const visibleSessionShortcutIds = useMemo(() => getSessionShortcutIdsInDisplayOrder(
        sessionListViewData,
        machines,
        t('status.unknown'),
    ), [machines, sessionListViewData]);

    // Define available commands
    const commands = useMemo((): Command[] => {
        const cmds: Command[] = [
            // Navigation commands
            {
                id: 'new-session',
                title: t("uiCopy.newSession"),
                subtitle: t("uiCopy.startANewChatSession"),
                icon: 'add-circle-outline',
                category: 'Sessions',
                shortcut: formatShortcut(preferredModifier, 'N', browserSafeShortcuts),
                action: () => {
                    router.navigate('/new');
                }
            },
            {
                id: 'sessions',
                title: t("uiCopy.viewAllSessions"),
                subtitle: t("uiCopy.browseYourChatHistory"),
                icon: 'chatbubbles-outline',
                category: 'Sessions',
                action: () => {
                    router.push('/');
                }
            },
            {
                id: 'settings',
                title: t("tabs.settings"),
                subtitle: t("uiCopy.configureYourPreferences"),
                icon: 'settings-outline',
                category: 'Navigation',
                shortcut: formatShortcut(preferredModifier, ',', browserSafeShortcuts),
                action: () => {
                    router.push('/settings');
                }
            },
            {
                id: 'account',
                title: t("settings.account"),
                subtitle: t("uiCopy.manageYourAccount"),
                icon: 'person-circle-outline',
                category: 'Navigation',
                action: () => {
                    router.push('/settings/account');
                }
            },
            {
                id: 'connect',
                title: t("uiCopy.connectDevice"),
                subtitle: t("uiCopy.connectANewDeviceViaWeb"),
                icon: 'link-outline',
                category: 'Navigation',
                action: () => {
                    router.push('/terminal/connect');
                }
            },
        ];

        // Add session-specific commands
        const recentSessions = Object.values(sessions)
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 5);

        recentSessions.forEach(session => {
            const sessionName = session.metadata?.name || t('uiCopy.sessionValue', { value1: session.id.slice(0, 6) });
            cmds.push({
                id: `session-${session.id}`,
                title: sessionName,
                subtitle: session.metadata?.path || t('uiCopy.switchToSession'),
                icon: 'time-outline',
                category: t('uiCopy.recentSessions'),
                action: () => {
                    navigateToSession(session.id);
                }
            });
        });

        // System commands
        cmds.push({
            id: 'sign-out',
            title: t("uiCopy.signOut"),
            subtitle: t("uiCopy.signOutOfYourAccount"),
            icon: 'log-out-outline',
            category: 'System',
            action: async () => {
                await logout();
            }
        });

        // Dev commands (if in development)
        if (__DEV__) {
            cmds.push({
                id: 'dev-menu',
                title: t("uiCopy.developerMenu"),
                subtitle: t("uiCopy.accessDeveloperTools"),
                icon: 'code-slash-outline',
                category: 'Developer',
                action: () => {
                    router.push('/dev');
                }
            });
        }

        return cmds;
    }, [browserSafeShortcuts, router, logout, sessions, navigateToSession, preferredModifier]);

    const showCommandPalette = useCallback(() => {
        if (Platform.OS !== 'web' || !isAuthenticated || !commandPaletteEnabled) return;
        
        Modal.show({
            component: CommandPalette,
            props: {
                commands,
            }
        } as any);
    }, [commands, commandPaletteEnabled, isAuthenticated]);

    const openNewSession = useCallback(() => {
        router.navigate('/new');
    }, [router]);

    const openSettings = useCallback(() => {
        router.push('/settings');
    }, [router]);

    const openRecentSession = useCallback((index: number) => {
        const sessionId = visibleSessionShortcutIds[index];
        if (!sessionId) {
            return false;
        }
        navigateToSession(sessionId);
        return true;
    }, [navigateToSession, visibleSessionShortcutIds]);

    const visibleModifier = useGlobalKeyboard(
        {
            commandPalette: isAuthenticated && commandPaletteEnabled ? showCommandPalette : undefined,
            newSession: isAuthenticated ? openNewSession : undefined,
            settings: isAuthenticated ? openSettings : undefined,
            recentSession: isAuthenticated ? openRecentSession : undefined,
        },
        browserSafeShortcuts,
    );

    return (
        <ShortcutHintsProvider
            modifier={isAuthenticated ? visibleModifier : null}
            commandPaletteEnabled={isAuthenticated && commandPaletteEnabled}
            recentSessionIds={isAuthenticated ? visibleSessionShortcutIds : EMPTY_SESSION_IDS}
            browserSafeShortcuts={browserSafeShortcuts}
        >
            {children}
        </ShortcutHintsProvider>
    );
}
