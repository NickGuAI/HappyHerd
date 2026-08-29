import * as React from 'react';
import { ActivityIndicator, View, Text, TextInput, Pressable, Platform, ScrollView, useWindowDimensions } from 'react-native';
import { Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { useSession, useSideChatSessions } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { Modal } from '@/modal';
import type { Session } from '@/sync/storageTypes';
import { SessionViewLoaded } from '@/-session/SessionView';
import { resolveActiveSideChatId } from './sideChatPresentation';
import type { SideChatDelegationBrief } from '@/sync/ops';

export type SideChatPanelProps = {
    sideChats: Session[];
    activeSideChatId: string | null;
    onSelectSideChat: (id: string) => void;
    onCloseSideChat: (id: string) => void;
    createOpen: boolean;
    creating: boolean;
    canCreate: boolean;
    onStartCreate: () => void;
    onCancelCreate: () => void;
    onCreate: (brief: SideChatDelegationBrief) => Promise<boolean>;
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

/**
 * Right-sidebar "side chat" panel (controlled).
 *
 * A side chat is a forked child session with stable parent lineage. It inherits
 * the parent's provider context, receives its bounded brief as the first queued
 * message, and is flagged `metadata.isSideChat` so it stays out of top-level lists.
 *
 * A parent can have several side chats, shown here as switchable tabs. Human
 * creation collects the same bounded brief as the Main Agent CLI and submits
 * it through the daemon-owned lifecycle.
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
    createOpen,
    creating,
    canCreate,
    onStartCreate,
    onCancelCreate,
    onCreate,
}: SideChatPanelProps) {
    const { theme } = useUnistyles();
    const activeSession = React.useMemo(() => {
        const resolvedId = resolveActiveSideChatId(
            sideChats.map((session) => session.id),
            activeSideChatId,
        );
        return resolvedId ? sideChats.find((session) => session.id === resolvedId) ?? null : null;
    }, [activeSideChatId, sideChats]);

    // Pull the focused side chat's messages into the store while mounted.
    const activeId = activeSession?.id ?? null;
    React.useEffect(() => {
        if (activeId) {
            sync.onSessionVisible(activeId);
        }
    }, [activeId]);

    if (createOpen) {
        return (
            <SideChatCreateForm
                creating={creating}
                canCreate={canCreate}
                onCancel={onCancelCreate}
                onCreate={onCreate}
            />
        );
    }

    if (sideChats.length === 0) {
        return (
            <View style={styles.emptyState}>
                <Octicons name="comment-discussion" size={28} color={theme.colors.textSecondary} />
                <Text style={styles.emptyTitle}>{t('sideChat.emptyTitle')}</Text>
                <Text style={styles.emptyDescription}>{t('sideChat.emptyDescription')}</Text>
                <Pressable
                    onPress={onStartCreate}
                    accessibilityRole="button"
                    accessibilityLabel={t('sideChat.newChat')}
                    style={({ pressed, hovered }: any) => [
                        styles.primaryButton,
                        (pressed || hovered) && { opacity: 0.82 },
                    ]}
                >
                    <Octicons name="plus" size={14} color={theme.colors.button.primary.tint} />
                    <Text style={styles.primaryButtonText}>{t('sideChat.newChat')}</Text>
                </Pressable>
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
                onNew={onStartCreate}
            />
            {activeSession && (
                <SideChatConversation key={activeSession.id} session={activeSession} />
            )}
        </View>
    );
});

const SIDE_CHAT_BRIEF_FIELDS = [
    'outcome',
    'scope',
    'dependencies',
    'writeOwnership',
    'verification',
    'handoff',
] as const satisfies ReadonlyArray<keyof SideChatDelegationBrief>;

function sideChatBriefFieldLabel(field: keyof SideChatDelegationBrief): string {
    switch (field) {
        case 'outcome': return t('sideChat.fields.outcome');
        case 'scope': return t('sideChat.fields.scope');
        case 'dependencies': return t('sideChat.fields.dependencies');
        case 'writeOwnership': return t('sideChat.fields.writeOwnership');
        case 'verification': return t('sideChat.fields.verification');
        case 'handoff': return t('sideChat.fields.handoff');
    }
}

function sideChatBriefFieldPlaceholder(field: keyof SideChatDelegationBrief): string {
    switch (field) {
        case 'outcome': return t('sideChat.placeholders.outcome');
        case 'scope': return t('sideChat.placeholders.scope');
        case 'dependencies': return t('sideChat.placeholders.dependencies');
        case 'writeOwnership': return t('sideChat.placeholders.writeOwnership');
        case 'verification': return t('sideChat.placeholders.verification');
        case 'handoff': return t('sideChat.placeholders.handoff');
    }
}

const SideChatCreateForm = React.memo(function SideChatCreateForm({
    creating,
    canCreate,
    onCancel,
    onCreate,
}: {
    creating: boolean;
    canCreate: boolean;
    onCancel: () => void;
    onCreate: (brief: SideChatDelegationBrief) => Promise<boolean>;
}) {
    const { theme } = useUnistyles();
    const [brief, setBrief] = React.useState<Record<keyof SideChatDelegationBrief, string>>({
        outcome: '',
        scope: '',
        dependencies: '',
        writeOwnership: '',
        verification: '',
        handoff: '',
    });
    const complete = SIDE_CHAT_BRIEF_FIELDS.every((field) => brief[field].trim().length > 0);
    const submit = React.useCallback(async () => {
        if (!complete || !canCreate || creating) return;
        await onCreate({
            outcome: brief.outcome.trim(),
            scope: brief.scope.trim(),
            dependencies: brief.dependencies.trim(),
            writeOwnership: brief.writeOwnership.trim(),
            verification: brief.verification.trim(),
            handoff: brief.handoff.trim(),
        });
    }, [brief, canCreate, complete, creating, onCreate]);

    return (
        <View style={styles.createForm}>
            <View style={styles.createHeader}>
                <View style={styles.createHeading}>
                    <Text style={styles.createTitle}>{t('sideChat.createTitle')}</Text>
                    <Text style={styles.createDescription}>{t('sideChat.createDescription')}</Text>
                </View>
                <Pressable
                    onPress={onCancel}
                    accessibilityLabel={t('common.cancel')}
                    hitSlop={8}
                    style={styles.toolbarButton}
                >
                    <Octicons name="x" size={16} color={theme.colors.textSecondary} />
                </Pressable>
            </View>
            <ScrollView style={styles.formScroll} contentContainerStyle={styles.formContent}>
                {SIDE_CHAT_BRIEF_FIELDS.map((field) => (
                    <View key={field} style={styles.field}>
                        <Text style={styles.fieldLabel}>{sideChatBriefFieldLabel(field)}</Text>
                        <TextInput
                            value={brief[field]}
                            onChangeText={(value) => setBrief((current) => ({ ...current, [field]: value }))}
                            placeholder={sideChatBriefFieldPlaceholder(field)}
                            placeholderTextColor={theme.colors.input.placeholder}
                            multiline
                            editable={!creating}
                            style={styles.fieldInput}
                        />
                    </View>
                ))}
                {!canCreate && (
                    <Text style={styles.unavailableText}>{t('sideChat.unavailable')}</Text>
                )}
                <View style={styles.formActions}>
                    <Pressable
                        onPress={onCancel}
                        disabled={creating}
                        style={styles.secondaryButton}
                    >
                        <Text style={styles.secondaryButtonText}>{t('common.cancel')}</Text>
                    </Pressable>
                    <Pressable
                        onPress={submit}
                        disabled={!complete || !canCreate || creating}
                        accessibilityRole="button"
                        accessibilityLabel={t('sideChat.create')}
                        style={[
                            styles.primaryButton,
                            (!complete || !canCreate || creating) && styles.buttonDisabled,
                        ]}
                    >
                        {creating && <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />}
                        <Text style={styles.primaryButtonText}>
                            {creating ? t('sideChat.creating') : t('sideChat.create')}
                        </Text>
                    </Pressable>
                </View>
            </ScrollView>
        </View>
    );
});

/** Full-screen host for the same controlled panel used by the wide sidebar. */
export const SideChatFullscreen = React.memo(function SideChatFullscreen({
    onCollapse,
    ...panelProps
}: SideChatPanelProps & { onCollapse: () => void }) {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();

    return (
        <View
            style={[
                styles.fullscreen,
                {
                    paddingTop: safeArea.top,
                    paddingBottom: safeArea.bottom,
                    backgroundColor: theme.colors.groupped.background,
                },
            ]}
        >
            <View style={styles.fullscreenHeader}>
                <Octicons name="comment-discussion" size={16} color={theme.colors.textSecondary} />
                <Text style={styles.fullscreenTitle} numberOfLines={1}>
                    {t('sideChat.panelTitle')}
                </Text>
                <Pressable
                    onPress={onCollapse}
                    accessibilityRole="button"
                    accessibilityLabel={t('sideChat.collapse')}
                    hitSlop={8}
                    style={({ pressed, hovered }: any) => [
                        styles.toolbarButton,
                        (pressed || hovered) && { backgroundColor: theme.colors.surface },
                    ]}
                >
                    <Octicons name="chevron-down" size={18} color={theme.colors.text} />
                </Pressable>
            </View>
            <SideChatPanel {...panelProps} />
        </View>
    );
});

/** Compute a short, stable label for a side-chat tab / header. */
function sideChatLabel(session: Session, index: number): string {
    const title = session.metadata?.summary?.text?.trim();
    if (title) return title;
    return t('sideChat.tabLabel', { index: index + 1 });
}

/** Horizontal tab strip for already-briefed side chats. */
const SideChatTabs = React.memo(function SideChatTabs({
    sessions,
    activeId,
    onSelect,
    onClose,
    onNew,
}: {
    sessions: Session[];
    activeId: string | null;
    onSelect: (id: string) => void;
    onClose: (id: string) => void;
    onNew: () => void;
}) {
    const { theme } = useUnistyles();
    return (
        <View style={styles.tabsRow}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tabsScroll}
            >
                {sessions.map((session, index) => (
                    <SideChatTab
                        key={session.id}
                        label={sideChatLabel(session, index)}
                        active={session.id === activeId}
                        onSelect={() => onSelect(session.id)}
                        onClose={() => onClose(session.id)}
                    />
                ))}
                <Pressable
                    onPress={onNew}
                    accessibilityRole="button"
                    accessibilityLabel={t('sideChat.newChat')}
                    hitSlop={6}
                    style={styles.newTabButton}
                >
                    <Octicons name="plus" size={13} color={theme.colors.textSecondary} />
                    <Text style={styles.newTabText}>{t('sideChat.newChat')}</Text>
                </Pressable>
            </ScrollView>
        </View>
    );
});

const SideChatTab = React.memo(function SideChatTab({
    label,
    active,
    onSelect,
    onClose,
}: {
    label: string;
    active: boolean;
    onSelect: () => void;
    onClose: () => void;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            onPress={onSelect}
            style={[styles.tab, active && styles.tabActive]}
        >
            <Octicons
                name="comment-discussion"
                size={12}
                color={active ? theme.colors.text : theme.colors.textSecondary}
            />
            <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
                {label}
            </Text>
            <Pressable
                onPress={(e) => {
                    e.stopPropagation?.();
                    onClose();
                }}
                accessibilityLabel={t('sideChat.close')}
                hitSlop={6}
                style={styles.tabClose}
            >
                <Octicons name="x" size={11} color={active ? theme.colors.text : theme.colors.textSecondary} />
            </Pressable>
        </Pressable>
    );
});

/** Focused side chat inside the panel: the real chat body + an expand button. */
const SideChatConversation = React.memo(function SideChatConversation({ session }: { session: Session }) {
    const { theme } = useUnistyles();
    const openFullScreen = React.useCallback(() => {
        Modal.show({ component: SideChatModal, props: { sessionId: session.id } });
    }, [session.id]);

    return (
        <View style={styles.conversationContainer}>
            <View style={styles.toolbar}>
                <Pressable
                    onPress={openFullScreen}
                    accessibilityLabel={t('sideChat.expand')}
                    hitSlop={6}
                    style={({ pressed, hovered }: any) => [
                        styles.toolbarButton,
                        (pressed || hovered) && { backgroundColor: theme.colors.surface },
                    ]}
                >
                    <Octicons name="screen-full" size={13} color={theme.colors.textSecondary} />
                </Pressable>
            </View>
            <View style={styles.chatWrap}>
                <SessionViewLoaded sessionId={session.id} session={session} embedded />
            </View>
        </View>
    );
});

/** Full-screen modal presentation of a single side chat. */
const SideChatModal = React.memo(function SideChatModal({ sessionId, onClose }: { sessionId: string; onClose?: () => void }) {
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

    if (!stillOpen) return null;

    return (
        <View style={[styles.modalContainer, { width, height, backgroundColor: theme.colors.groupped.background }]}>
            <View style={styles.modalHeader}>
                <Octicons name="comment-discussion" size={15} color={theme.colors.textSecondary} />
                <Text style={styles.modalTitle} numberOfLines={1}>
                    {sideChatLabel(session, index)}
                </Text>
                <Pressable
                    onPress={onClose}
                    accessibilityLabel={t('sideChat.close')}
                    hitSlop={8}
                    style={({ pressed, hovered }: any) => [
                        styles.toolbarButton,
                        (pressed || hovered) && { backgroundColor: theme.colors.surface },
                    ]}
                >
                    <Octicons name="x" size={18} color={theme.colors.text} />
                </Pressable>
            </View>
            <View style={styles.chatWrap}>
                <SessionViewLoaded sessionId={session.id} session={session} embedded />
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
        borderRadius: 9,
    },
    accessButtonText: {
        color: theme.colors.text,
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    accessCountBadge: {
        minWidth: 18,
        height: 18,
        borderRadius: 9,
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
    fullscreenHeader: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    fullscreenTitle: {
        flex: 1,
        color: theme.colors.text,
        fontSize: 16,
        ...Typography.default('semiBold'),
    },
    tabsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 8,
        paddingRight: 6,
        paddingBottom: 6,
        gap: 4,
    },
    tabsScroll: {
        alignItems: 'center',
        gap: 4,
        paddingRight: 4,
    },
    newTabButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 7,
    },
    newTabText: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        ...Typography.default('semiBold'),
    },
    tab: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingLeft: 8,
        paddingRight: 5,
        paddingVertical: 5,
        borderRadius: 7,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'transparent',
        maxWidth: 140,
    },
    tabActive: {
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.divider,
    },
    tabText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        flexShrink: 1,
        ...Typography.default(),
    },
    tabTextActive: {
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    tabClose: {
        width: 16,
        height: 16,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
    },
    conversationContainer: {
        flex: 1,
    },
    toolbar: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    toolbarButton: {
        width: 30,
        height: 30,
        borderRadius: 7,
        alignItems: 'center',
        justifyContent: 'center',
    },
    chatWrap: {
        flex: 1,
    },
    modalContainer: {
        borderRadius: Platform.select({ web: 12, default: 0 }),
        overflow: 'hidden',
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    modalTitle: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingHorizontal: 24,
    },
    emptyTitle: {
        color: theme.colors.text,
        fontSize: 16,
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    emptyDescription: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 19,
        textAlign: 'center',
        ...Typography.default(),
    },
    createForm: {
        flex: 1,
    },
    createHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    createHeading: {
        flex: 1,
        gap: 3,
    },
    createTitle: {
        color: theme.colors.text,
        fontSize: 15,
        ...Typography.default('semiBold'),
    },
    createDescription: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 17,
        ...Typography.default(),
    },
    formScroll: {
        flex: 1,
    },
    formContent: {
        padding: 12,
        gap: 12,
    },
    field: {
        gap: 5,
    },
    fieldLabel: {
        color: theme.colors.text,
        fontSize: 12,
        ...Typography.default('semiBold'),
    },
    fieldInput: {
        minHeight: 58,
        maxHeight: 104,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        color: theme.colors.text,
        backgroundColor: theme.colors.surface,
        fontSize: 13,
        lineHeight: 18,
        textAlignVertical: 'top',
        ...Typography.default(),
    },
    unavailableText: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 17,
        ...Typography.default(),
    },
    formActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: 8,
        paddingTop: 4,
    },
    primaryButton: {
        minHeight: 36,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        paddingHorizontal: 14,
        borderRadius: 9,
        backgroundColor: theme.colors.button.primary.background,
    },
    primaryButtonText: {
        color: theme.colors.button.primary.tint,
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    secondaryButton: {
        minHeight: 36,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 14,
        borderRadius: 9,
        backgroundColor: theme.colors.surface,
    },
    secondaryButtonText: {
        color: theme.colors.text,
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    buttonDisabled: {
        opacity: 0.45,
    },
}));
