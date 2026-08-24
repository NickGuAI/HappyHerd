import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { SessionActionsAnchor, SessionActionsPopover } from './SessionActionsPopover';
import { SessionShortcutHintBadge } from './ShortcutHints';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useSessionActionAlert } from '@/hooks/useSessionQuickActions';
import { useHappyAction } from '@/hooks/useHappyAction';
import { HappyError } from '@/utils/errors';
import { sessionKill } from '@/sync/ops';
import type { FlatSessionRowData } from '@/utils/flatSessionList';
import { formatSessionListTimestamp } from '@/utils/sessionListTimestamp';
import type { Theme } from '@/theme';
import { t } from '@/text';
import { RigGitLineChanges } from './RigGitLineChanges';
import { SessionStatusAvatar } from './SessionStatusAvatar';

// Roughly three quarters of the row, the proportion a chat list uses: the row
// is 10 + 61 + 10, so 60 leaves an even 10 either side of the avatar.
const AVATAR_SIZE = 60;
const ROW_PADDING_LEFT = 16;
const AVATAR_GAP = 12;
const TOP_RIGHT_SLOT_WIDTH = 56;
const UNREAD_RING_CLEAR_GRACE_MS = 350;

/**
 * The single colour the flat list paints, rows and page alike, so nothing reads
 * as a card sitting on a backdrop: plain white in light, the page's own black in
 * dark. `surface` is deliberately not used — in dark it is a lifted graphite
 * meant to contrast against exactly the backdrop this variant removes.
 */
export function flatListBackgroundColor(theme: Theme): string {
    return theme.dark ? theme.colors.groupped.background : '#FFFFFF';
}

/**
 * One session in the flat home list: avatar, title, the project and worktree it
 * runs in, and its status. The row spans the full width on the page background
 * with a hairline under it, so the list reads as one continuous column rather
 * than a stack of project cards.
 */
export const FlatSessionRow = React.memo(({ row, selected, showBorder }: {
    row: FlatSessionRowData;
    selected?: boolean;
    showBorder?: boolean;
    /** Archive uses the same deterministic row presentation as Home. */
    archived?: boolean;
}) => {
    const { session, projectName, workspaceName } = row;
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const navigateToSession = useNavigateToSession();
    const swipeableRef = React.useRef<Swipeable | null>(null);
    const swipeEnabled = Platform.OS !== 'web';
    const [actionsAnchor, setActionsAnchor] = React.useState<SessionActionsAnchor | null>(null);

    // Greying out is about the machine, not the session's own socket. A session
    // idle since yesterday on a machine that is still up is ordinary work you
    // can pick back up, and drawing it as dead makes a healthy list look like a
    // graveyard. Only a disconnected session or dead owning daemon fades.
    const faded = session.machineOffline || session.state === 'disconnected';

    // SessionView clears the real unread state as soon as the destination
    // mounts. Keep only the row's unread ring around long enough for the
    // navigation transition to cover it. Read semantics remain immediate.
    const [showUnreadRing, setShowUnreadRing] = React.useState(session.hasUnread);
    React.useEffect(() => {
        if (session.hasUnread) {
            setShowUnreadRing(true);
            return;
        }
        if (!showUnreadRing) return;

        const timeout = setTimeout(() => setShowUnreadRing(false), UNREAD_RING_CLEAR_GRACE_MS);
        return () => clearTimeout(timeout);
    }, [session.hasUnread, showUnreadRing]);

    // The same `lastActivityAt` the flat list sorts on, so the stamps run in
    // the order the rows do.
    const timestamp = React.useMemo(
        () => formatSessionListTimestamp(session.lastActivityAt),
        [session.lastActivityAt],
    );

    const [archiving, performArchive] = useHappyAction(async () => {
        const result = await sessionKill(session.id);
        if (!result.success) {
            throw new HappyError(result.message || t('sessionInfo.failedToArchiveSession'), false);
        }
    });

    const handleArchive = React.useCallback(() => {
        swipeableRef.current?.close();
        performArchive();
    }, [performArchive]);

    const handlePress = React.useCallback(() => {
        navigateToSession(session.id);
    }, [navigateToSession, session.id]);

    const handleContextMenu = React.useCallback((event: any) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        setActionsAnchor({
            type: 'point',
            x: event.nativeEvent.clientX ?? event.nativeEvent.pageX ?? 0,
            y: event.nativeEvent.clientY ?? event.nativeEvent.pageY ?? 0,
        });
    }, []);

    const showActionAlert = useSessionActionAlert(session.id);
    const menuProps = Platform.OS === 'web' ? {
        onContextMenu: handleContextMenu,
    } as any : {
        onLongPress: showActionAlert,
    };

    const content = (
        <Pressable
            style={[styles.row, selected && styles.rowSelected]}
            onPress={handlePress}
            {...menuProps}
        >
            <View style={styles.avatar}>
                <SessionStatusAvatar
                    active={session.active}
                    clientId={session.clientId}
                    commanderId={session.commanderId}
                    commanderName={session.commanderName}
                    flavor={session.flavor}
                    hasDraft={session.hasDraft}
                    hasUnread={showUnreadRing}
                    machineId={session.machineId}
                    machineOffline={session.machineOffline}
                    providerKind={session.providerKind}
                    providerLabel={session.identityLine}
                    size={AVATAR_SIZE}
                    state={session.state}
                />
            </View>

            <View style={[styles.content, faded && styles.contentFaded]}>
                <View style={styles.titleRow}>
                    <View style={styles.titleContainer}>
                        <Text
                            style={[
                                styles.title,
                                faded ? styles.titleDisconnected : styles.titleConnected,
                            ]}
                            numberOfLines={1}
                        >
                            {session.name}
                        </Text>
                    </View>
                    <SessionShortcutHintBadge sessionId={session.id} style={styles.shortcutBadge} />
                    <View style={styles.topRightStatus}>
                        <Text style={styles.timestamp} numberOfLines={1}>
                            {timestamp}
                        </Text>
                    </View>
                </View>

                <View style={styles.projectRow}>
                    <Text style={styles.project} numberOfLines={1}>
                        {projectName}
                    </Text>
                    {(session.daemonLabel || session.daemonShortId) && (
                        <View style={styles.daemonIdentity}>
                            <Ionicons
                                name="desktop-outline"
                                size={12}
                                color={theme.colors.textSecondary}
                            />
                            {session.daemonLabel && session.daemonLabel !== session.daemonShortId && (
                                <Text style={styles.daemonLabel} numberOfLines={1}>
                                    {session.daemonLabel}
                                </Text>
                            )}
                            {session.daemonShortId && (
                                <Text style={styles.daemonShortId} numberOfLines={1}>
                                    {session.daemonShortId}
                                </Text>
                            )}
                        </View>
                    )}
                </View>

                <View style={styles.workspaceRow}>
                    <View style={styles.workspaceLocation}>
                        {workspaceName && (
                            <>
                                <Text style={styles.workspace} numberOfLines={1}>
                                    {workspaceName}
                                </Text>
                                <Ionicons
                                    name="git-branch-outline"
                                    size={13}
                                    color={theme.colors.textSecondary}
                                />
                            </>
                        )}
                    </View>
                    <View style={styles.workspaceMeta}>
                        {session.gitChangedFiles !== null && (
                            <RigGitLineChanges
                                changedFiles={session.gitChangedFiles}
                                countsExact={session.gitCountsExact}
                                deletions={session.gitDeletions ?? 0}
                                insertions={session.gitInsertions ?? 0}
                            />
                        )}
                    </View>
                </View>
            </View>

            {showBorder && <View style={styles.divider} />}
        </Pressable>
    );

    if (!swipeEnabled) {
        return (
            <>
                {content}
                <SessionActionsPopover
                    anchor={actionsAnchor}
                    onClose={() => setActionsAnchor(null)}
                    sessionId={session.id}
                    visible={!!actionsAnchor}
                />
            </>
        );
    }

    const renderRightActions = () => (
        <Pressable style={styles.swipeAction} onPress={handleArchive} disabled={archiving}>
            <Ionicons name="archive-outline" size={20} color="#FFFFFF" />
            <Text style={styles.swipeActionText} numberOfLines={2}>
                {t('sessionInfo.archiveSession')}
            </Text>
        </Pressable>
    );

    return (
        <Swipeable
            ref={swipeableRef}
            renderRightActions={renderRightActions}
            overshootRight={false}
            enabled={!archiving}
        >
            {content}
        </Swipeable>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    row: {
        flexDirection: 'row',
        // Centred, not top-aligned: the avatar sits in the middle of the three
        // text lines the way a chat list draws it, rather than hanging off the
        // title.
        alignItems: 'center',
        paddingLeft: ROW_PADDING_LEFT,
        paddingRight: 16,
        paddingVertical: 10,
        backgroundColor: flatListBackgroundColor(theme),
    },
    rowSelected: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    avatar: {
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        marginRight: AVATAR_GAP,
    },
    contentFaded: {
        opacity: 0.6,
    },
    content: {
        flex: 1,
        minWidth: 0,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    titleContainer: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        fontSize: 17,
        lineHeight: 22,
        ...Typography.default('semiBold'),
    },
    titleConnected: {
        color: theme.colors.text,
    },
    titleDisconnected: {
        color: theme.colors.textSecondary,
    },
    shortcutBadge: {
        flexShrink: 0,
        marginLeft: 8,
    },
    // The dot and time share a Telegram-like right column, so changing status
    // never makes the title jump horizontally. It is only as wide as the
    // longest timestamp; the dot occupies that same slot instead of reserving
    // a second lane.
    topRightStatus: {
        width: TOP_RIGHT_SLOT_WIDTH,
        height: 22,
        flexShrink: 0,
        marginLeft: 8,
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
    timestamp: {
        fontSize: 13,
        lineHeight: 22,
        color: theme.colors.textSecondary,
        fontVariant: ['tabular-nums'],
        textAlign: 'right',
        ...Typography.default('regular'),
    },
    project: {
        flex: 1,
        minWidth: 0,
        fontSize: 15,
        lineHeight: 20,
        color: theme.colors.textSecondary,
        ...Typography.default('regular'),
    },
    projectRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 8,
        minWidth: 0,
    },
    daemonIdentity: {
        alignItems: 'center',
        flexDirection: 'row',
        flexShrink: 1,
        gap: 3,
        maxWidth: '58%',
        minWidth: 0,
    },
    daemonLabel: {
        color: theme.colors.textSecondary,
        flexShrink: 1,
        fontSize: 12,
        lineHeight: 20,
        minWidth: 0,
        ...Typography.default('regular'),
    },
    daemonShortId: {
        color: theme.colors.textSecondary,
        flexShrink: 0,
        fontSize: 12,
        lineHeight: 20,
        ...Typography.default('semiBold'),
    },
    workspaceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 1,
        minHeight: 18,
    },
    workspaceLocation: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    workspace: {
        flexShrink: 1,
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textSecondary,
        ...Typography.default('regular'),
    },
    workspaceMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 0,
        marginLeft: 'auto',
    },
    // Sits on the row itself rather than the text column, so centring the
    // avatar cannot drag it up off the row's bottom edge. Starts where the text
    // does and runs to the screen edge, the way a chat list separates rows
    // without cutting under the avatar.
    divider: {
        position: 'absolute',
        left: ROW_PADDING_LEFT + AVATAR_SIZE + AVATAR_GAP,
        right: 0,
        bottom: 0,
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
    },
    swipeAction: {
        width: 112,
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.status.error,
    },
    swipeActionText: {
        marginTop: 4,
        fontSize: 12,
        color: '#FFFFFF',
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
}));
