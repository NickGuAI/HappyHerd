import * as React from 'react';
import { useSession, useSessionMessages, useSetting } from "@/sync/storage";
import { sync } from '@/sync/sync';
import { ActivityIndicator, AppState, FlatList, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, Text, View } from 'react-native';
import { useCallback } from 'react';
import { useHeaderHeight } from '@/utils/responsive';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageView } from './MessageView';
import { AgentWorkGroupView, ToolGroupView } from './ToolGroupView';
import { Metadata, Session } from '@/sync/storageTypes';
import { ChatFooter } from './ChatFooter';
import { Message } from '@/sync/typesMessage';
import { DisplayItem, ToolGroupItem, useGroupedMessages } from '@/hooks/useGroupedMessages';
import { Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { resolveControlMode } from '@/sync/controlHandoff';
import { usesControlledSessionUi } from '@/sync/rig';
import {
    countNewConversationMessages,
    getChatListMaintainVisibleContentPosition,
    getConversationMessageIds,
    planMessageFocusScrollRetry,
    refreshMessageFocusScrollRetryState,
    resolveMessageFocusTarget,
    shouldFollowLatestForMessageFocus,
    type MessageFocusScrollRetryState,
} from './chatLatestNavigation';
import { t } from '@/text';
import { projectSessionQueue } from '@/sync/queueProjection';
import { buildAgentTurnCopyTextByMessageId } from '@/utils/agentTurnCopy';

const SCROLL_THRESHOLD = 300;
const DOCK_DETAILS_SHOW_OFFSET = 16;
const DOCK_DETAILS_HIDE_OFFSET = 48;
const SCROLL_BUTTON_DOCK_GAP = 8;

export const ChatList = React.memo((props: {
    session: Session;
    focusMessageId?: string;
    topContentInset?: number;
    bottomContentInset?: number;
    /** Distance from the screen bottom to the composer. Independent of status-chrome fade. */
    scrollButtonInset?: number;
    headerOverlayHeight?: number;
    onHeaderBackdropVisibilityChange?: (visible: boolean) => void;
    onBottomDockVisibilityChange?: (visible: boolean) => void;
}) => {
    const { messages, hasMoreOlder, isLoadingOlder } = useSessionMessages(props.session.id);
    const queueProjection = React.useMemo(
        () => projectSessionQueue(messages, props.session.agentState?.messageQueue),
        [messages, props.session.agentState?.messageQueue],
    );
    return (
        <ChatListInternal
            metadata={props.session.metadata}
            sessionId={props.session.id}
            messages={queueProjection.transcriptMessages}
            focusMessageId={props.focusMessageId}
            hasMoreOlder={hasMoreOlder}
            isLoadingOlder={isLoadingOlder}
            topContentInset={props.topContentInset}
            bottomContentInset={props.bottomContentInset}
            scrollButtonInset={props.scrollButtonInset}
            headerOverlayHeight={props.headerOverlayHeight}
            onHeaderBackdropVisibilityChange={props.onHeaderBackdropVisibilityChange}
            onBottomDockVisibilityChange={props.onBottomDockVisibilityChange}
        />
    )
});

const ListHeader = React.memo((props: { isLoadingOlder: boolean; topContentInset?: number }) => {
    const headerHeight = useHeaderHeight();
    const safeArea = useSafeAreaInsets();
    // ListFooterComponent on an inverted FlatList renders at the visual top
    // — that is exactly where the spinner for "loading older messages"
    // belongs. The spacer below keeps the header bar from clipping the
    // oldest message.
    return (
        <View>
            {props.isLoadingOlder && (
                <View style={{ paddingVertical: 12, alignItems: 'center', justifyContent: 'center' }}>
                    <ActivityIndicator size="small" />
                </View>
            )}
            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    height: props.topContentInset ?? headerHeight + safeArea.top + 32,
                }}
            />
        </View>
    );
});

const ListFooter = React.memo((props: { sessionId: string }) => {
    const session = useSession(props.sessionId)!;
    return (
        <ChatFooter controlledByUser={usesControlledSessionUi(session.metadata) && (session.agentState?.controlledByUser || false)} />
    )
});

const ChatListInternal = React.memo((props: {
    metadata: Metadata | null,
    sessionId: string,
    messages: Message[],
    focusMessageId?: string,
    hasMoreOlder: boolean,
    isLoadingOlder: boolean,
    topContentInset?: number,
    bottomContentInset?: number,
    scrollButtonInset?: number,
    headerOverlayHeight?: number,
    onHeaderBackdropVisibilityChange?: (visible: boolean) => void,
    onBottomDockVisibilityChange?: (visible: boolean) => void,
}) => {
    const { theme } = useUnistyles();
    const flatListRef = React.useRef<FlatList>(null);
    const focusedMessageIdRef = React.useRef<string | null>(null);
    const focusedListRevisionRef = React.useRef<number | null>(null);
    const focusScrollRetryRef = React.useRef<MessageFocusScrollRetryState | null>(null);
    const focusScrollRetryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [showScrollButton, setShowScrollButton] = React.useState(false);
    const [newMessageCount, setNewMessageCount] = React.useState(0);
    const [handoffListRevision, setHandoffListRevision] = React.useState(0);
    const [releasedFocusRequestKey, setReleasedFocusRequestKey] = React.useState<string | null>(null);
    // Tracks whether the scroll-button is currently shown, so we only call
    // setShowScrollButton when the threshold is actually crossed instead of
    // on every scroll frame (60Hz). Without this guard, the entire list
    // parent re-renders on every wheel tick.
    const showScrollButtonRef = React.useRef(false);
    const newMessageCountRef = React.useRef(0);
    const isFollowingLatestRef = React.useRef(true);
    const exactMessageFocusAnchoredRef = React.useRef(false);
    const headerBackdropVisibleRef = React.useRef(false);
    const bottomDockVisibleRef = React.useRef(true);
    const scrollMetricsRef = React.useRef({
        offsetY: 0,
        contentHeight: 0,
        viewportHeight: 0,
    });
    const session = useSession(props.sessionId);
    const controlMode = resolveControlMode(usesControlledSessionUi(session?.metadata) ? session?.agentState?.controlledByUser : false);
    const previousControlModeRef = React.useRef(controlMode);
    const focusRequestKey = props.focusMessageId
        ? `${props.sessionId}\u0000${props.focusMessageId}`
        : null;

    const cancelFocusScrollRetry = useCallback(() => {
        focusScrollRetryRef.current = null;
        if (focusScrollRetryTimerRef.current) {
            clearTimeout(focusScrollRetryTimerRef.current);
            focusScrollRetryTimerRef.current = null;
        }
    }, []);

    const releaseExactMessageFocus = useCallback(() => {
        exactMessageFocusAnchoredRef.current = false;
        cancelFocusScrollRetry();
        if (focusRequestKey) {
            setReleasedFocusRequestKey(focusRequestKey);
        }
    }, [cancelFocusScrollRetry, focusRequestKey]);

    React.useEffect(() => {
        if (previousControlModeRef.current === controlMode) {
            return;
        }
        previousControlModeRef.current = controlMode;
        if (Platform.OS !== 'web') {
            return;
        }
        cancelFocusScrollRetry();
        if (!exactMessageFocusAnchoredRef.current && showScrollButtonRef.current) {
            showScrollButtonRef.current = false;
            setShowScrollButton(false);
        }
        setHandoffListRevision((revision) => revision + 1);
    }, [cancelFocusScrollRetry, controlMode]);

    // Collapse agent work between a user prompt and the final answer.
    // Nested tool groups remain expandable inside the work block.
    const groupToolCalls = useSetting('groupToolCalls');
    const hasPendingPermission = Boolean(
        session?.agentState?.requests && Object.keys(session.agentState.requests).length > 0,
    );
    const collapseCurrentTurn = session?.thinking !== true && !hasPendingPermission;
    const groupingOptions = React.useMemo(
        () => ({ collapseCurrentTurn }),
        [collapseCurrentTurn],
    );
    const displayItems = useGroupedMessages(props.messages, groupToolCalls, groupingOptions);
    const exactMessageFocusTarget = React.useMemo(
        () => props.focusMessageId
            ? resolveMessageFocusTarget(displayItems, props.focusMessageId)
            : null,
        [displayItems, props.focusMessageId],
    );
    const exactMessageFocusAnchored = focusRequestKey !== null
        && releasedFocusRequestKey !== focusRequestKey
        && exactMessageFocusTarget !== null
        && exactMessageFocusTarget.index !== null;
    // Scroll callbacks must observe the render's native-prop decision
    // synchronously, before the focus effect performs the actual scroll.
    exactMessageFocusAnchoredRef.current = exactMessageFocusAnchored;

    const conversationMessageIds = React.useMemo(
        () => getConversationMessageIds(props.messages),
        [props.messages],
    );
    const previousConversationMessageIdsRef = React.useRef(conversationMessageIds);

    React.useEffect(() => {
        const added = countNewConversationMessages(
            previousConversationMessageIdsRef.current,
            conversationMessageIds,
        );
        previousConversationMessageIdsRef.current = conversationMessageIds;
        if (added === 0 || isFollowingLatestRef.current) {
            return;
        }
        setNewMessageCount((current) => {
            const next = current + added;
            newMessageCountRef.current = next;
            return next;
        });
    }, [conversationMessageIds]);

    React.useEffect(() => {
        previousConversationMessageIdsRef.current = conversationMessageIds;
        focusedMessageIdRef.current = null;
        focusedListRevisionRef.current = null;
        cancelFocusScrollRetry();
        isFollowingLatestRef.current = true;
        setReleasedFocusRequestKey(null);
        newMessageCountRef.current = 0;
        setNewMessageCount(0);
    }, [cancelFocusScrollRetry, props.sessionId]);

    const agentCopyTextByMessageId = React.useMemo(
        () => buildAgentTurnCopyTextByMessageId(props.messages, { currentTurnComplete: collapseCurrentTurn }),
        [collapseCurrentTurn, props.messages],
    );

    // Tracks which groups are explicitly collapsed. Groups start collapsed;
    // pending approval groups are the only ones we auto-expand.
    const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => {
        const initial = new Set<string>();
        for (const item of displayItems) {
            if (isCollapsibleDisplayItem(item) && !item.hasPendingPermission) {
                initial.add(item.id);
            }
        }
        return initial;
    });

    // Auto-expand groups that need user approval — but only if the user
    // hasn't manually collapsed them.
    // We track manually-collapsed IDs so we never force-reopen them.
    const manuallyCollapsedRef = React.useRef<Set<string>>(new Set());
    const initialSeenCollapsibleGroups = React.useMemo(() => {
        const initial = new Set<string>();
        for (const item of displayItems) {
            if (isCollapsibleDisplayItem(item)) {
                initial.add(item.id);
            }
        }
        return initial;
    }, []);
    const seenCollapsibleGroupsRef = React.useRef<Set<string>>(initialSeenCollapsibleGroups);

    React.useEffect(() => {
        setCollapsedGroups((prev) => {
            let changed = false;
            const next = new Set(prev);
            const seen = seenCollapsibleGroupsRef.current;
            for (const item of displayItems) {
                if (!isCollapsibleDisplayItem(item)) {
                    continue;
                }
                const isNewGroup = !seen.has(item.id);
                if (isNewGroup) {
                    seen.add(item.id);
                }
                if (item.hasPendingPermission && prev.has(item.id) && !manuallyCollapsedRef.current.has(item.id)) {
                    next.delete(item.id);
                    changed = true;
                    continue;
                }
                if (isNewGroup && !item.hasPendingPermission) {
                    next.add(item.id);
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [displayItems]);

    // Ref so AppState handler reads fresh items without re-subscribing
    const displayItemsRef = React.useRef(displayItems);
    displayItemsRef.current = displayItems;

    // Auto-collapse completed groups when app goes to background / tab hidden
    React.useEffect(() => {
        const sub = AppState.addEventListener('change', (state) => {
            if (state !== 'active') {
                setCollapsedGroups((prev) => {
                    const next = new Set(prev);
                    for (const item of displayItemsRef.current) {
                        if (isCollapsibleDisplayItem(item) && !item.hasRunning) {
                            next.add(item.id);
                        }
                    }
                    return next;
                });
            }
        });
        return () => sub.remove();
    }, []);

    // Auto-collapse all previous groups when user sends a new message
    const latestUserMsgId = React.useMemo(() => {
        for (const msg of props.messages) {
            if (msg.kind === 'user-text') return msg.id;
        }
        return null;
    }, [props.messages]);

    const prevUserMsgIdRef = React.useRef(latestUserMsgId);
    React.useEffect(() => {
        if (latestUserMsgId && latestUserMsgId !== prevUserMsgIdRef.current) {
            prevUserMsgIdRef.current = latestUserMsgId;
            manuallyCollapsedRef.current.clear();
            setCollapsedGroups((prev) => {
                const next = new Set(prev);
                for (const item of displayItemsRef.current) {
                    if (isCollapsibleDisplayItem(item)) {
                        next.add(item.id);
                    }
                }
                return next;
            });
        }
    }, [latestUserMsgId]);

    const handleToggleGroup = useCallback((groupId: string) => {
        setCollapsedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupId)) {
                next.delete(groupId);
                manuallyCollapsedRef.current.delete(groupId);
            } else {
                next.add(groupId);
                manuallyCollapsedRef.current.add(groupId);
            }
            return next;
        });
    }, []);

    const keyExtractor = useCallback((item: DisplayItem) => item.id, []);

    const updateHeaderBackdropVisibility = useCallback(() => {
        if (!props.onHeaderBackdropVisibilityChange || !props.headerOverlayHeight) {
            return;
        }
        const { offsetY, contentHeight, viewportHeight } = scrollMetricsRef.current;
        const topSpacerHeight = props.topContentInset ?? 0;
        const nonSpacerContentHeight = Math.max(
            0,
            contentHeight - topSpacerHeight - (props.bottomContentInset ?? 0),
        );
        const nextVisible = viewportHeight > 0
            && nonSpacerContentHeight > offsetY + viewportHeight - props.headerOverlayHeight;
        if (nextVisible === headerBackdropVisibleRef.current) {
            return;
        }
        headerBackdropVisibleRef.current = nextVisible;
        props.onHeaderBackdropVisibilityChange(nextVisible);
    }, [props.bottomContentInset, props.headerOverlayHeight, props.onHeaderBackdropVisibilityChange, props.topContentInset]);

    const setBottomDockVisibility = useCallback((visible: boolean) => {
        if (!props.onBottomDockVisibilityChange) {
            return;
        }
        if (visible === bottomDockVisibleRef.current) {
            return;
        }
        bottomDockVisibleRef.current = visible;
        props.onBottomDockVisibilityChange(visible);
    }, [props.onBottomDockVisibilityChange]);

    const handleFocusScrollToIndexFailed = React.useCallback((info: {
        index: number;
        highestMeasuredFrameIndex: number;
        averageItemLength: number;
    }) => {
        const pending = focusScrollRetryRef.current;
        const currentTargetIndex = pending
            ? resolveMessageFocusTarget(displayItemsRef.current, pending.messageId).index
            : null;
        const plan = planMessageFocusScrollRetry({
            state: pending,
            failedIndex: info.index,
            averageItemLength: info.averageItemLength,
            currentTargetIndex,
        });
        if (!plan) return;

        focusScrollRetryRef.current = plan.nextState;
        flatListRef.current?.scrollToOffset({ offset: plan.offset, animated: false });
        if (focusScrollRetryTimerRef.current) {
            clearTimeout(focusScrollRetryTimerRef.current);
        }
        focusScrollRetryTimerRef.current = setTimeout(() => {
            focusScrollRetryTimerRef.current = null;
            const latest = focusScrollRetryRef.current;
            if (!latest || latest.messageId !== plan.nextState.messageId || !latest.didRetry) return;
            const refreshed = refreshMessageFocusScrollRetryState(
                latest,
                resolveMessageFocusTarget(displayItemsRef.current, latest.messageId).index,
            );
            if (!refreshed) return;
            focusScrollRetryRef.current = refreshed;
            try {
                flatListRef.current?.scrollToIndex({
                    index: refreshed.index,
                    animated: true,
                    viewPosition: 0.5,
                });
            } catch {
                // One exact retry is the bounded recovery contract. Preserve
                // the requested focus state if the native list still cannot
                // measure the row; do not redirect the user to latest.
            }
        }, 50);
    }, []);

    React.useEffect(() => () => {
        if (focusScrollRetryTimerRef.current) {
            clearTimeout(focusScrollRetryTimerRef.current);
        }
    }, []);

    React.useEffect(() => {
        if (!props.focusMessageId) {
            focusedMessageIdRef.current = null;
            focusedListRevisionRef.current = null;
            cancelFocusScrollRetry();
            setReleasedFocusRequestKey(null);
            return;
        }
        if (focusRequestKey === releasedFocusRequestKey) return;
        if (
            focusedMessageIdRef.current === props.focusMessageId
            && focusedListRevisionRef.current === handoffListRevision
        ) return;
        cancelFocusScrollRetry();
        const target = exactMessageFocusTarget;
        if (!target) return;
        if (target.index === null) {
            isFollowingLatestRef.current = true;
            newMessageCountRef.current = 0;
            setNewMessageCount(0);
            showScrollButtonRef.current = false;
            setShowScrollButton(false);
            setBottomDockVisibility(true);
            flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
            // The optimistic record can arrive one store update after the
            // route mounts. Keep the receipt ID pending so this effect retries
            // exact-index focus when that record becomes visible.
            return;
        }

        focusedMessageIdRef.current = props.focusMessageId;
        focusedListRevisionRef.current = handoffListRevision;
        focusScrollRetryRef.current = {
            messageId: props.focusMessageId,
            index: target.index,
            didRetry: false,
        };
        const followingLatest = shouldFollowLatestForMessageFocus(target);
        isFollowingLatestRef.current = followingLatest;
        newMessageCountRef.current = target.newerConversationCount;
        setNewMessageCount(target.newerConversationCount);
        showScrollButtonRef.current = !followingLatest;
        setShowScrollButton(!followingLatest);
        setBottomDockVisibility(followingLatest);

        try {
            flatListRef.current?.scrollToIndex({
                index: target.index,
                animated: true,
                viewPosition: 0.5,
            });
        } catch {
            handleFocusScrollToIndexFailed({
                index: target.index,
                highestMeasuredFrameIndex: -1,
                averageItemLength: displayItems.length > 0
                    ? scrollMetricsRef.current.contentHeight / displayItems.length
                    : 0,
            });
        }
    }, [
        cancelFocusScrollRetry,
        displayItems.length,
        exactMessageFocusTarget,
        focusRequestKey,
        handoffListRevision,
        handleFocusScrollToIndexFailed,
        props.focusMessageId,
        releasedFocusRequestKey,
        setBottomDockVisibility,
    ]);

    const updateBottomDockVisibility = useCallback((offsetY: number) => {
        // Hysteresis avoids toggling while the list is resting or bouncing
        // very near the newest message.
        const nextVisible = bottomDockVisibleRef.current
            ? offsetY <= DOCK_DETAILS_HIDE_OFFSET
            : offsetY <= DOCK_DETAILS_SHOW_OFFSET;
        setBottomDockVisibility(nextVisible);
    }, [setBottomDockVisibility]);

    React.useEffect(() => {
        setBottomDockVisibility(true);
    }, [props.sessionId, setBottomDockVisibility]);

    React.useEffect(() => () => {
        if (headerBackdropVisibleRef.current) {
            props.onHeaderBackdropVisibilityChange?.(false);
        }
        setBottomDockVisibility(true);
    }, [props.onHeaderBackdropVisibilityChange, setBottomDockVisibility]);

    const renderItem = useCallback(({ item }: { item: DisplayItem }) => {
        if (item.type === 'tool-group') {
            return (
                <ToolGroupView
                    group={item}
                    metadata={props.metadata}
                    sessionId={props.sessionId}
                    expanded={!collapsedGroups.has(item.id)}
                    onToggle={() => handleToggleGroup(item.id)}
                    forceCompleted={session?.active === false}
                />
            );
        }
        if (item.type === 'agent-work-group') {
            return (
                <AgentWorkGroupView
                    group={item}
                    metadata={props.metadata}
                    sessionId={props.sessionId}
                    expanded={!collapsedGroups.has(item.id)}
                    onToggle={() => handleToggleGroup(item.id)}
                    forceCompleted={session?.active === false}
                    forceCompletedAt={session?.active === false ? session.activeAt : undefined}
                />
            );
        }
        return (
            <MessageView
                message={item.message}
                metadata={props.metadata}
                sessionId={props.sessionId}
                copyText={agentCopyTextByMessageId.get(item.message.id)}
            />
        );
    }, [agentCopyTextByMessageId, props.metadata, props.sessionId, collapsedGroups, handleToggleGroup, session?.active, session?.activeAt]);

    // In inverted FlatList, offset 0 = latest messages (visual bottom).
    // Offset increases as user scrolls up to see older messages.
    // Auto-stick-to-bottom on new messages is handled natively while following
    // latest — no JS-side scrollToOffset is needed (and running both produces
    // a fight that drags the user's viewport when reading older messages).
    const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const offsetY = e.nativeEvent.contentOffset.y;
        scrollMetricsRef.current.offsetY = offsetY;
        isFollowingLatestRef.current = !exactMessageFocusAnchoredRef.current && offsetY <= 50;
        if (isFollowingLatestRef.current && newMessageCountRef.current > 0) {
            newMessageCountRef.current = 0;
            setNewMessageCount(0);
        }
        updateHeaderBackdropVisibility();
        updateBottomDockVisibility(offsetY);
        const next = exactMessageFocusAnchoredRef.current || offsetY > SCROLL_THRESHOLD;
        if (next !== showScrollButtonRef.current) {
            showScrollButtonRef.current = next;
            setShowScrollButton(next);
        }
    }, [updateBottomDockVisibility, updateHeaderBackdropVisibility]);

    const handleScrollBeginDrag = useCallback(() => {
        // A drag hands viewport ownership back to the user. Native follow-latest
        // may resume according to the resulting offset after this interaction.
        releaseExactMessageFocus();
    }, [releaseExactMessageFocus]);

    const scrollToBottom = useCallback(() => {
        // This is an explicit "go to latest" action, so its animated native
        // scroll should restore the dock even though it is not a drag.
        setBottomDockVisibility(true);
        releaseExactMessageFocus();
        isFollowingLatestRef.current = true;
        newMessageCountRef.current = 0;
        setNewMessageCount(0);
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, [releaseExactMessageFocus, setBottomDockVisibility]);

    // Anchor on the second-newest message (index 1), not the newest token slot.
    // In an inverted list autoscrollToTopThreshold means follow the visual
    // bottom; the helper omits only that threshold during exact receipt focus.
    const maintainVisibleContentPosition = React.useMemo(
        () => getChatListMaintainVisibleContentPosition(exactMessageFocusAnchored),
        [exactMessageFocusAnchored],
    );

    // In an inverted FlatList, `onEndReached` fires when the user scrolls
    // past the visual top — i.e. when they want to see older history.
    // Initial fetch only loads the latest 100 messages (see
    // sync.fetchInitialLatestPage), so we lazy-load earlier pages here.
    const sessionId = props.sessionId;
    const hasMoreOlder = props.hasMoreOlder;
    const isLoadingOlder = props.isLoadingOlder;
    const handleLoadOlder = useCallback(() => {
        if (!hasMoreOlder || isLoadingOlder) return;
        void sync.loadOlderMessages(sessionId);
    }, [sessionId, hasMoreOlder, isLoadingOlder]);

    // On macOS/web, Shift+wheel swaps deltaX/deltaY — restore vertical scrolling
    React.useEffect(() => {
        if (Platform.OS !== 'web') return;
        const node = (flatListRef.current as any)?.getScrollableNode?.() as HTMLElement | undefined;
        if (!node) return;
        const handler = (e: WheelEvent) => {
            if (e.shiftKey && Math.abs(e.deltaX) > 0 && Math.abs(e.deltaY) < 1) {
                node.scrollTop += e.deltaX;
                e.preventDefault();
            }
        };
        node.addEventListener('wheel', handler, { passive: false });
        return () => node.removeEventListener('wheel', handler);
    }, []);

    return (
        <View style={{ flex: 1 }}>
            <FlatList
                key={`${props.sessionId}:${handoffListRevision}`}
                ref={flatListRef}
                data={displayItems}
                inverted={true}
                keyExtractor={keyExtractor}
                maintainVisibleContentPosition={maintainVisibleContentPosition}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
                // Inverted list: paddingTop renders at the visual bottom.
                // The measured dock inset lets the newest message scroll above
                // the floating composer instead of stopping underneath it.
                contentContainerStyle={{ paddingTop: 8 + (props.bottomContentInset ?? 0) }}
                renderItem={renderItem}
                onScrollToIndexFailed={handleFocusScrollToIndexFailed}
                onScroll={handleScroll}
                onScrollBeginDrag={handleScrollBeginDrag}
                scrollEventThrottle={16}
                onLayout={(event) => {
                    scrollMetricsRef.current.viewportHeight = event.nativeEvent.layout.height;
                    updateHeaderBackdropVisibility();
                }}
                onContentSizeChange={(_width, height) => {
                    scrollMetricsRef.current.contentHeight = height;
                    updateHeaderBackdropVisibility();
                }}
                ListHeaderComponent={<ListFooter sessionId={props.sessionId} />}
                ListFooterComponent={(
                    <ListHeader
                        isLoadingOlder={props.isLoadingOlder}
                        topContentInset={props.topContentInset}
                    />
                )}
                onEndReached={handleLoadOlder}
                onEndReachedThreshold={0.5}
            />
            {(showScrollButton || newMessageCount > 0) && (
                <View style={[
                    styles.scrollButtonContainer,
                    { bottom: SCROLL_BUTTON_DOCK_GAP + (props.scrollButtonInset ?? props.bottomContentInset ?? 0) },
                ]}>
                    <Pressable
                        style={({ pressed }) => [
                            styles.scrollButton,
                            pressed ? styles.scrollButtonPressed : styles.scrollButtonDefault
                        ]}
                        onPress={scrollToBottom}
                        accessibilityRole="button"
                        accessibilityLabel={t('uiCopy.jumpToLatest')}
                    >
                        <Octicons name="arrow-down" size={14} color={theme.colors.text} />
                        <Text style={styles.scrollButtonLabel}>
                            {newMessageCount > 0
                                ? t('uiCopy.newMessagesJumpToLatest', { count: newMessageCount })
                                : t('uiCopy.jumpToLatest')}
                        </Text>
                    </Pressable>
                </View>
            )}
        </View>
    )
});

function isCollapsibleDisplayItem(item: DisplayItem): item is ToolGroupItem | Extract<DisplayItem, { type: 'agent-work-group' }> {
    return item.type === 'tool-group' || item.type === 'agent-work-group';
}

const styles = StyleSheet.create((theme) => ({
    scrollButtonContainer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: SCROLL_BUTTON_DOCK_GAP,
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'box-none',
    },
    scrollButton: {
        borderRadius: 16,
        minHeight: 32,
        paddingHorizontal: 12,
        flexDirection: 'row',
        gap: 6,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: theme.colors.divider,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 1 },
        shadowRadius: 2,
        shadowOpacity: theme.colors.shadow.opacity * 0.5,
        elevation: 2,
    },
    scrollButtonDefault: {
        backgroundColor: theme.colors.surface,
        opacity: 0.9,
    },
    scrollButtonPressed: {
        backgroundColor: theme.colors.surface,
        opacity: 0.7,
    },
    scrollButtonLabel: {
        color: theme.colors.text,
        fontSize: 12,
        fontWeight: '600',
    },
}));
