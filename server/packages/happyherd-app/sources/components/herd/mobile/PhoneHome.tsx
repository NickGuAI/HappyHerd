import * as React from 'react';
import { Keyboard, Platform, Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { HomeDock, MOBILE_HOME_DOCK_CONTENT_INSET } from '@/components/HomeDock';
import { SessionsListWrapper } from '@/components/SessionsListWrapper';
import { SidebarView } from '@/components/SidebarView';
import { Typography } from '@/constants/Typography';
import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
import { useStartSessionFromDraft } from '@/hooks/useStartSessionFromDraft';
import { useVisibleSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import type { WorkspaceContextEntry } from '@/sync/workspaceContext';
import { t } from '@/text';
import { useHerdPhoneShell } from '../shell/phoneShell';

/**
 * The phone session list (UI overhaul): the desktop left panel, docked at full
 * width, for Web Mobile and the native phone app alike. The list keeps the
 * phone's own empty and connect states. Native phones also keep the home dock
 * for starting a session in place, and the session search the top bar opens.
 */
export const PhoneHome = React.memo(function PhoneHome() {
    const native = Platform.OS !== 'web';
    const searchOpen = useHerdPhoneShell((state) => state.searchOpen);
    const searchQuery = useHerdPhoneShell((state) => state.searchQuery);
    const sessionListViewData = useVisibleSessionListViewData();
    const [homePrompt, setHomePrompt] = React.useState('');
    const {
        isStarting: isStartingHomeSession,
        phase: homeSessionPhase,
        startSession: startHomeSession,
        cancelStart: cancelHomeSession,
    } = useStartSessionFromDraft();

    const handleHomePromptSubmit = React.useCallback(async (
        workspaceEntries: readonly WorkspaceContextEntry[] = [],
    ): Promise<boolean> => {
        const prompt = homePrompt.trim();
        const attachments = useNewSessionDraft.getState().attachments;
        if (!prompt && attachments.length === 0 && workspaceEntries.length === 0) {
            return false;
        }
        useNewSessionDraft.getState().setInput(prompt);
        // The keyboard stays up: the dock reports what is happening above the
        // composer and closes itself once the session is open.
        const started = await startHomeSession(workspaceEntries);
        if (started) setHomePrompt('');
        return started;
    }, [homePrompt, startHomeSession]);

    const showDock = native && !searchOpen;

    return (
        <View style={styles.root}>
            <SidebarView
                docked
                settingsInNav={native}
                list={(
                    <View style={styles.list}>
                        {native && searchOpen && <PhoneSessionSearch />}
                        <SessionsListWrapper
                            bottomContentInset={native ? (showDock ? MOBILE_HOME_DOCK_CONTENT_INSET : 16) : 0}
                            searchQuery={native ? searchQuery : ''}
                        />
                    </View>
                )}
            />
            {showDock && (
                <View pointerEvents="box-none" style={styles.dockOverlay}>
                    <HomeDock
                        prompt={homePrompt}
                        onPromptChange={setHomePrompt}
                        onSubmit={handleHomePromptSubmit}
                        isSubmitting={isStartingHomeSession}
                        submitPhase={homeSessionPhase}
                        onSubmitCancel={cancelHomeSession}
                        showBottomBackdrop={sessionListViewData !== null && sessionListViewData.length > 0}
                    />
                </View>
            )}
        </View>
    );
});

/** Native phones: the session search field the top bar's search control opens above the list. */
function PhoneSessionSearch() {
    const { theme } = useUnistyles();
    const searchQuery = useHerdPhoneShell((state) => state.searchQuery);
    const setSearchQuery = useHerdPhoneShell((state) => state.setSearchQuery);
    const closeSearch = useHerdPhoneShell((state) => state.closeSearch);
    const close = React.useCallback(() => {
        Keyboard.dismiss();
        closeSearch();
    }, [closeSearch]);

    return (
        <View style={styles.search} testID="herd-phone-session-search">
            <Ionicons name="search" size={18} color={theme.colors.textSecondary} />
            <TextInput
                autoFocus
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={t('tools.names.search')}
                placeholderTextColor={theme.colors.textSecondary}
                selectionColor={theme.colors.text}
                returnKeyType="search"
                autoCorrect={false}
                style={styles.searchInput}
            />
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
                onPress={close}
                hitSlop={8}
                style={styles.searchClose}
            >
                <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
    },
    list: {
        flex: 1,
    },
    dockOverlay: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
    },
    search: {
        height: 44,
        marginHorizontal: 16,
        marginBottom: 6,
        paddingLeft: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: theme.kilv.radius,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.input.background,
    },
    searchInput: {
        flex: 1,
        minWidth: 0,
        height: 44,
        paddingVertical: 0,
        color: theme.colors.text,
        fontSize: 16,
        ...Typography.default(),
    },
    searchClose: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));
