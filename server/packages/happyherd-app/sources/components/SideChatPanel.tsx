import * as React from 'react';
import { ActivityIndicator, View, Text, Pressable, Platform, ScrollView, useWindowDimensions } from 'react-native';
import { Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { useSession, useSideChatSessions } from '@/sync/storage';
import { Modal } from '@/modal';
import type { Session } from '@/sync/storageTypes';
import {
    SessionViewLoaded,
    SessionWorkspaceControllerContext,
    type SessionWorkspaceController,
} from '@/-session/SessionView';
import { WorkspaceLinkPressContext } from '@/-session/workspaceLinkNavigation';
import { getSessionName } from '@/utils/sessionUtils';
import { resolveActiveSideChatId } from './sideChatPresentation';
import { herdWebClasses } from './herd/motion';
import { HerdPanelIconButton } from './herd/panels/PanelIconButton';
import { HerdPanelScreenHeader } from './herd/panels/PanelScreenHeader';
import { HerdPanelTab } from './herd/panels/PanelTab';
import { panelHairline } from './herd/panels/panelColors';

export type SideChatPanelProps = {
    sideChats: Session[];
    activeSideChatId: string | null;
    onSelectSideChat: (id: string) => void;
    onCloseSideChat: (id: string) => void;
    creatingSideChat: boolean;
    canCreateSideChat: boolean;
    onCreateSideChat: () => Promise<boolean>;
};

export const SideChatAccessButton = React.memo(function SideChatAccessButton({
    count,
    expanded,
    compact,
    onPress,
}: {
    count: number;
    expanded: boolean;
    compact: boolean;
    onPress: () => void;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={expanded
                ? t('sideChat.collapse')
                : count > 0
                    ? t('sideChat.openCount', { count })
                    : t('sideChat.newChat')}
            accessibilityState={{ expanded }}
            hitSlop={8}
            style={({ pressed, hovered }: any) => [
                styles.accessButton,
                (pressed || hovered || expanded) && { backgroundColor: theme.colors.surface },
            ]}
        >
            <Octicons name="comment-discussion" size={15} color={theme.colors.text} />
            {!compact && <Text style={styles.accessButtonText}>{t('sideChat.panelTitle')}</Text>}
            {count > 0 && (
                <View style={styles.accessCountBadge}>
                    <Text style={styles.accessCountText}>{count}</Text>
                </View>
            )}
        </Pressable>
    );
});
import { useIsFocused } from '@react-navigation/native';

/**
 * Right-sidebar "side chat" panel (controlled).
 *
 * A side chat is a forked child session with stable parent lineage. Human
 * creation opens an empty conversation in one click; Main Agent CLI creation
 * may seed the child with a structured brief. Both stay out of top-level lists.
 *
 * A parent can have several side chats, shown here as switchable tabs.
 *
 * The chat body is the exact same `SessionViewLoaded` used by the main screen
 * (rendered `embedded`), so tools, MCP, options, permission/model pickers and
 * everything else behave identically to a normal chat.
 */
export const SideChatPanel = React.memo(function SideChatPanel({
    sideChats,
    activeSideChatId,
    onSelectSideChat,
    onCloseSideChat,
    creatingSideChat,
    canCreateSideChat,
    onCreateSideChat,
    newChatInTabs = true,
}: SideChatPanelProps & {
    /** The phone full-screen host offers New side chat in its header instead. */
    newChatInTabs?: boolean;
}) {
    const { theme } = useUnistyles();
    const activeSession = React.useMemo(() => {
        const resolvedId = resolveActiveSideChatId(
            sideChats.map((session) => session.id),
            activeSideChatId,
        );
        return resolvedId ? sideChats.find((session) => session.id === resolvedId) ?? null : null;
    }, [activeSideChatId, sideChats]);

    // An off-screen parent route must not activate its embedded chat.
    const isFocused = useIsFocused();
    const activeId = activeSession?.id ?? null;

    if (sideChats.length === 0) {
        const disabled = creatingSideChat || !canCreateSideChat;
        return (
            <View style={styles.emptyState}>
                <View style={styles.emptyHero}>
                    <Octicons name="comment-discussion" size={22} color={theme.colors.kilv.accent} />
                </View>
                <Text style={styles.emptyTitle}>{t('sideChat.emptyTitle')}</Text>
                <Text style={styles.emptyDescription}>{t('sideChat.emptyDescription')}</Text>
                <Pressable
                    onPress={() => void onCreateSideChat()}
                    disabled={disabled}
                    accessibilityRole="button"
                    accessibilityLabel={t('sideChat.newChat')}
                    style={({ pressed, hovered }: any) => [
                        styles.primaryButton,
                        (pressed || hovered) && !disabled && styles.primaryButtonHovered,
                        disabled && styles.buttonDisabled,
                    ]}
                >
                    {creatingSideChat
                        ? <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                        : <Octicons name="plus" size={14} color={theme.colors.button.primary.tint} />}
                    <Text style={styles.primaryButtonText}>
                        {creatingSideChat ? t('sideChat.creating') : t('sideChat.newChat')}
                    </Text>
                </Pressable>
                {!canCreateSideChat && (
                    <Text style={styles.unavailableText}>{t('sideChat.unavailable')}</Text>
                )}
            </View>
        );
    }

    return (
        <View style={styles.panel}>
            <SideChatTabs
                sessions={sideChats}
                activeId={activeId}
                onSelect={onSelectSideChat}
                onClose={onCloseSideChat}
                onNew={newChatInTabs ? () => void onCreateSideChat() : undefined}
                creating={creatingSideChat}
                canCreate={canCreateSideChat}
            />
            {activeSession && (
                <SideChatConversation key={activeSession.id} session={activeSession} active={isFocused} />
            )}
        </View>
    );
});

/** Full-screen host for the same controlled panel used by the wide sidebar. */
export const SideChatFullscreen = React.memo(function SideChatFullscreen({
    onCollapse,
    ...panelProps
}: SideChatPanelProps & {
    onCollapse: () => void;
}) {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    // The parent session names the stack of side chats (mock `.m-title .s`).
    const parent = useSession(panelProps.sideChats[0]?.metadata?.parentSessionId ?? '');

    return (
        <View
            style={[
                styles.fullscreen,
                {
                    paddingBottom: safeArea.bottom,
                    backgroundColor: theme.colors.groupped.background,
                },
            ]}
        >
            <HerdPanelScreenHeader
                backIcon="chevron-down"
                backLabel={t('sideChat.collapse')}
                onBack={onCollapse}
                title={t('sideChat.panelTitle')}
                subtitle={parent ? getSessionName(parent) : null}
                topInset={safeArea.top}
                actions={panelProps.sideChats.length > 0 ? (
                    <HerdPanelIconButton
                        accessibilityLabel={t('sideChat.newChat')}
                        size={40}
                        busy={panelProps.creatingSideChat}
                        disabled={!panelProps.canCreateSideChat}
                        onPress={() => void panelProps.onCreateSideChat()}
                        renderIcon={(color) => <Octicons name="plus" size={20} color={color} />}
                    />
                ) : null}
            />
            <SideChatPanel {...panelProps} newChatInTabs={false} />
        </View>
    );
});

/** Compute a short, stable label for a side-chat tab / header. */
function sideChatLabel(session: Session, index: number): string {
    const title = session.metadata?.summary?.text?.trim();
    if (title) return title;
    return t('sideChat.tabLabel', { index: index + 1 });
}

/**
 * Tab strip for existing side chats: one pill per child (mock `.rtab`), New
 * side chat, and Open full screen for the focused child.
 */
const SideChatTabs = React.memo(function SideChatTabs({
    sessions,
    activeId,
    onSelect,
    onClose,
    onNew,
    creating,
    canCreate,
}: {
    sessions: Session[];
    activeId: string | null;
    onSelect: (id: string) => void;
    onClose: (id: string) => void;
    onNew?: () => void;
    creating: boolean;
    canCreate: boolean;
}) {
    const workspaceController = React.useContext(SessionWorkspaceControllerContext);
    const openFullScreen = React.useCallback(() => {
        if (!activeId) return;
        Modal.show({ component: SideChatModal, props: { sessionId: activeId, workspaceController } });
    }, [activeId, workspaceController]);

    return (
        <View style={styles.tabsRow}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.tabsScroller}
                contentContainerStyle={styles.tabsScroll}
            >
                {sessions.map((session, index) => (
                    <HerdPanelTab
                        key={session.id}
                        label={sideChatLabel(session, index)}
                        active={session.id === activeId}
                        onPress={() => onSelect(session.id)}
                        onClose={() => onClose(session.id)}
                        closeLabel={t('sideChat.close')}
                        maxWidth={170}
                        entrance
                        renderIcon={(color) => <Octicons name="comment-discussion" size={13} color={color} />}
                    />
                ))}
            </ScrollView>
            {onNew ? (
                <HerdPanelIconButton
                    accessibilityLabel={t('sideChat.newChat')}
                    busy={creating}
                    disabled={!canCreate}
                    onPress={onNew}
                    renderIcon={(color) => <Octicons name="plus" size={15} color={color} />}
                />
            ) : null}
            <View style={styles.tabsSpacer} />
            {activeId ? (
                <HerdPanelIconButton
                    accessibilityLabel={t('sideChat.expand')}
                    onPress={openFullScreen}
                    renderIcon={(color) => <Octicons name="screen-full" size={14} color={color} />}
                />
            ) : null}
        </View>
    );
});

/** Focused side chat inside the panel: the real chat body. */
const SideChatConversation = React.memo(function SideChatConversation({ session, active }: { session: Session; active: boolean }) {
    return (
        <View style={styles.conversationContainer}>
            <View style={styles.chatWrap}>
                <SessionViewLoaded sessionId={session.id} session={session} active={active} embedded />
            </View>
        </View>
    );
});

/** Full-screen modal presentation of a single side chat. */
const SideChatModal = React.memo(function SideChatModal({
    sessionId,
    workspaceController,
    onClose,
}: {
    sessionId: string;
    workspaceController: SessionWorkspaceController | null;
    onClose?: () => void;
}) {
    const { theme } = useUnistyles();
    const { width, height } = useWindowDimensions();
    const session = useSession(sessionId);
    // Resolve this side chat's position among its live siblings — gives the
    // correct "Side chat N" title and lets us auto-dismiss the modal once the
    // chat is closed (it drops out of useSideChatSessions when archived).
    const parentId = session?.metadata?.parentSessionId ?? null;
    const liveSideChats = useSideChatSessions(parentId);
    const index = liveSideChats.findIndex((s) => s.id === sessionId);
    const stillOpen = !!session && index !== -1;

    React.useEffect(() => {
        if (!stillOpen && onClose) onClose();
    }, [stillOpen, onClose]);

    const visibleWorkspaceController = React.useMemo<SessionWorkspaceController | null>(() => {
        if (!workspaceController) return null;
        const dismiss = () => onClose?.();
        return {
            openChanges: (targetSessionId) => {
                dismiss();
                workspaceController.openChanges(targetSessionId);
            },
            openWorkspace: (targetSession) => {
                dismiss();
                workspaceController.openWorkspace(targetSession);
            },
            openWorkspaceLink: (route) => {
                dismiss();
                workspaceController.openWorkspaceLink(route);
            },
        };
    }, [onClose, workspaceController]);

    if (!stillOpen) return null;

    return (
        <View style={[styles.modalContainer, { width, height, backgroundColor: theme.colors.groupped.background }]}>
            <View style={styles.modalHeader}>
                <Octicons name="comment-discussion" size={17} color={theme.colors.kilv.accent} />
                <Text style={styles.modalTitle} numberOfLines={1}>
                    {sideChatLabel(session, index)}
                </Text>
                <HerdPanelIconButton
                    accessibilityLabel={t('sideChat.close')}
                    onPress={() => onClose?.()}
                    size={34}
                    renderIcon={(color) => <Octicons name="x" size={17} color={color} />}
                />
            </View>
            <View style={styles.chatWrap}>
                <SessionWorkspaceControllerContext.Provider value={visibleWorkspaceController}>
                    <WorkspaceLinkPressContext.Provider value={visibleWorkspaceController?.openWorkspaceLink}>
                        <SessionViewLoaded sessionId={session.id} session={session} embedded />
                    </WorkspaceLinkPressContext.Provider>
                </SessionWorkspaceControllerContext.Provider>
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    accessButton: {
        minHeight: 32,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: 8,
        borderRadius: 4,
    },
    accessButtonText: {
        color: theme.colors.text,
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    accessCountBadge: {
        minWidth: 18,
        height: 18,
        borderRadius: 4,
        paddingHorizontal: 5,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceSelected,
    },
    accessCountText: {
        color: theme.colors.text,
        fontSize: 11,
        ...Typography.default('semiBold'),
    },
    panel: {
        flex: 1,
    },
    fullscreen: {
        flex: 1,
    },
    tabsRow: {
        height: 46,
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingLeft: 10,
        paddingRight: 8,
        borderBottomWidth: 1,
        borderBottomColor: panelHairline(theme),
    },
    // Hugs its tabs until they overflow, then scrolls; + stays beside them.
    tabsScroller: {
        flexGrow: 0,
        flexShrink: 1,
        minWidth: 0,
    },
    tabsSpacer: {
        flex: 1,
    },
    tabsScroll: {
        alignItems: 'center',
        gap: 4,
        paddingRight: 4,
    },
    conversationContainer: {
        flex: 1,
    },
    chatWrap: {
        flex: 1,
    },
    modalContainer: {
        borderRadius: Platform.select({ web: theme.kilv.radiusSheet, default: 0 }),
        overflow: 'hidden',
    },
    modalHeader: {
        height: 58,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingLeft: 22,
        paddingRight: 14,
        borderBottomWidth: 1,
        borderBottomColor: panelHairline(theme),
    },
    modalTitle: {
        flex: 1,
        fontSize: 17,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingHorizontal: 26,
        paddingVertical: 30,
    },
    emptyHero: {
        width: 54,
        height: 54,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        _web: {
            boxShadow: theme.kilv.glowMoltenSoft,
        },
    },
    emptyTitle: {
        color: theme.colors.text,
        fontSize: 16,
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    emptyDescription: {
        color: theme.colors.kilv.inkFaint,
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
        ...Typography.default(),
    },
    unavailableText: {
        color: theme.colors.kilv.inkFaint,
        fontSize: 12,
        lineHeight: 17,
        textAlign: 'center',
        ...Typography.default(),
    },
    primaryButton: {
        minHeight: 38,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        paddingHorizontal: 16,
        marginTop: 4,
        borderRadius: theme.kilv.radius,
        backgroundColor: theme.colors.button.primary.background,
        _web: {
            cursor: 'pointer',
            _classNames: herdWebClasses('herd-transition', 'herd-press'),
        },
    },
    primaryButtonHovered: {
        _web: {
            boxShadow: theme.kilv.glowMoltenSoft,
        },
    },
    primaryButtonText: {
        color: theme.colors.button.primary.tint,
        fontSize: 14,
        ...Typography.default('semiBold'),
    },
    buttonDisabled: {
        opacity: theme.kilv.disabledOpacity,
    },
}));
