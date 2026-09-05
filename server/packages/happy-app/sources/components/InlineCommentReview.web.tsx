import * as React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { sync } from '@/sync/sync';
import {
    submitWorkspaceFeedback,
    type WorkspaceFeedbackComment,
} from '@/sync/workspaceFeedback';
import { t } from '@/text';
import type {
    InlineCommentAnchor,
    InlineCommentReviewProps,
    InlineCommentThreadProps,
    InlineReviewComment,
} from './InlineCommentReview';

function matchesAnchor(
    value: InlineCommentAnchor | WorkspaceFeedbackComment | null,
    anchor: InlineCommentAnchor,
): boolean {
    if (!value) return false;
    if (anchor.line !== undefined) return value.line === anchor.line;
    if (anchor.nodeId !== undefined) return value.nodeId === anchor.nodeId;
    if (anchor.elementSelector !== undefined) return value.elementSelector === anchor.elementSelector;
    return false;
}

function labelForAnchor(anchor: InlineCommentAnchor | WorkspaceFeedbackComment): string {
    return anchor.elementSelector
        ? t('workspace.liveCommentOnElement', { element: anchor.elementSelector })
        : anchor.nodeId
            ? t('files.commentOnNode', { node: anchor.nodeId })
            : t('files.commentOnLine', { line: String(anchor.line ?? 0) });
}

function threadTestId(anchor?: InlineCommentAnchor | null): string {
    if (anchor?.line !== undefined) return `inline-comment-thread:line:${anchor.line}`;
    if (anchor?.nodeId !== undefined) return `inline-comment-thread:node:${anchor.nodeId}`;
    if (anchor?.elementSelector !== undefined) return `inline-comment-thread:element:${anchor.elementSelector}`;
    return 'inline-comment-thread:docked';
}

function inputHeight(value: string): number {
    return Math.min(148, Math.max(52, 30 + (value.split('\n').length * 22)));
}

export function InlineCommentThread(props: InlineCommentThreadProps) {
    const { theme } = useUnistyles();
    const [draft, setDraft] = React.useState('');
    const visibleComments = props.anchor
        ? props.comments.filter((comment) => matchesAnchor(comment, props.anchor!))
        : props.comments;
    const activeAnchor = props.anchor
        ? (matchesAnchor(props.activeAnchor, props.anchor) ? props.activeAnchor : null)
        : props.activeAnchor;

    React.useEffect(() => {
        setDraft('');
    }, [activeAnchor]);

    if (!activeAnchor && visibleComments.length === 0) return null;

    const addComment = () => {
        const feedback = draft.trim();
        if (!activeAnchor || !feedback) return;
        props.onCommentsChange([...props.comments, {
            ...activeAnchor,
            id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
            feedback,
        }]);
        props.onActiveAnchorChange(null);
        setDraft('');
    };

    const updateComment = (comment: InlineReviewComment) => {
        const feedback = comment.editingDraft?.trim();
        if (!feedback) return;
        props.onCommentsChange(props.comments.flatMap((item) => {
            if (item.id !== comment.id) return [item];
            if (item.acknowledged && item.feedback === feedback) return [];
            return [{ ...item, feedback, editingDraft: undefined, acknowledged: undefined }];
        }));
    };

    const cancelEdit = (comment: InlineReviewComment) => {
        props.onCommentsChange(props.comments.flatMap((item) => {
            if (item.id !== comment.id) return [item];
            return item.acknowledged ? [] : [{ ...item, editingDraft: undefined }];
        }));
    };

    const isInline = props.anchor?.line !== undefined;
    const seamColor = theme.dark ? '#b4b85c' : '#6f7424';
    const glowColor = theme.dark ? '#f3c969' : '#b7791f';
    const cardBackground = theme.dark ? '#211e18' : '#fffaf0';
    const cardBorder = theme.dark ? '#514a35' : '#ded2b4';

    return (
        <View
            testID={threadTestId(props.anchor)}
            style={[styles.thread, isInline && styles.inlineThread]}
            accessibilityLabel={activeAnchor ? labelForAnchor(activeAnchor) : t('files.inlineComments')}
        >
            {isInline ? (
                <View testID={`inline-comment-seam:line:${props.anchor?.line}`} style={styles.seamColumn} aria-hidden>
                    <View style={[styles.seam, { backgroundColor: seamColor }]} />
                    <View style={[styles.seamDot, { backgroundColor: glowColor, borderColor: cardBackground }, { boxShadow: `0 0 12px ${glowColor}` } as any]} />
                </View>
            ) : null}
            <View style={[
                styles.threadCard,
                {
                    backgroundColor: isInline ? cardBackground : theme.colors.surface,
                    borderColor: isInline ? cardBorder : theme.colors.divider,
                },
                isInline && ({ boxShadow: theme.dark ? '0 12px 30px rgba(0,0,0,.28)' : '0 10px 24px rgba(80,65,35,.14)' } as any),
            ]}>
                {isInline ? <View style={[styles.threadFace, styles.threadFaceTop, { backgroundColor: glowColor }]} /> : null}
                {visibleComments.map((comment) => (
                    <View key={comment.id} style={styles.commentRow} testID={`inline-comment:${comment.id}`}>
                        {comment.editingDraft !== undefined ? (
                            <View style={styles.editColumn}>
                                <TextInput
                                    value={comment.editingDraft}
                                    onChangeText={(value) => {
                                        props.onCommentsChange(props.comments.map((item) => (
                                            item.id === comment.id ? { ...item, editingDraft: value } : item
                                        )));
                                    }}
                                    multiline
                                    autoFocus
                                    style={[
                                        styles.input,
                                        { height: inputHeight(comment.editingDraft), color: theme.colors.text, borderColor: theme.colors.divider },
                                    ]}
                                    accessibilityLabel={t('files.commentPlaceholder')}
                                />
                                <View style={styles.actions}>
                                    <Pressable accessibilityRole="button" disabled={!comment.editingDraft.trim()} onPress={() => updateComment(comment)} style={styles.action}>
                                        <Text style={[styles.actionText, { color: theme.colors.textLink }]}>{t('common.save')}</Text>
                                    </Pressable>
                                    <Pressable accessibilityRole="button" onPress={() => cancelEdit(comment)} style={styles.action}>
                                        <Text style={[styles.actionText, { color: theme.colors.textSecondary }]}>{t('common.cancel')}</Text>
                                    </Pressable>
                                </View>
                            </View>
                        ) : (
                            <>
                                <View style={styles.commentBody}>
                                    {!props.anchor ? (
                                        <Text style={[styles.anchor, { color: theme.colors.textSecondary }]}>{labelForAnchor(comment)}</Text>
                                    ) : null}
                                    <Text style={[styles.commentText, { color: theme.colors.text }]}>{comment.feedback}</Text>
                                </View>
                                <View style={styles.actions}>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={t('files.editFile')}
                                        onPress={() => {
                                            props.onCommentsChange(props.comments.flatMap((item) => {
                                                if (item.id === comment.id) return [{ ...item, editingDraft: item.feedback }];
                                                if (!visibleComments.includes(item) || item.editingDraft === undefined) return [item];
                                                return item.acknowledged ? [] : [{ ...item, editingDraft: undefined }];
                                            }));
                                        }}
                                        style={styles.action}
                                    >
                                        <Text style={[styles.actionText, { color: theme.colors.textLink }]}>{t('files.editFile')}</Text>
                                    </Pressable>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={t('files.removeComment')}
                                        onPress={() => {
                                            props.onCommentsChange(props.comments.filter((item) => item.id !== comment.id));
                                        }}
                                        style={styles.action}
                                    >
                                        <Text style={[styles.actionText, { color: theme.colors.textDestructive }]}>{t('common.delete')}</Text>
                                    </Pressable>
                                </View>
                            </>
                        )}
                    </View>
                ))}
                {activeAnchor ? (
                    <View style={styles.composeRow} testID={props.anchor?.line !== undefined ? `inline-comment-composer:line:${props.anchor.line}` : 'inline-comment-composer:docked'}>
                        <Text style={[styles.anchor, { color: theme.colors.textSecondary }]}>{labelForAnchor(activeAnchor)}</Text>
                        <TextInput
                            value={draft}
                            onChangeText={setDraft}
                            placeholder={t('files.commentPlaceholder')}
                            multiline
                            autoFocus
                            style={[
                                styles.input,
                                { height: inputHeight(draft), color: theme.colors.text, borderColor: theme.colors.divider },
                            ]}
                            accessibilityLabel={t('files.commentPlaceholder')}
                        />
                        <View style={styles.actions}>
                            <Pressable accessibilityRole="button" disabled={!draft.trim()} onPress={addComment} style={styles.action}>
                                <Text style={[styles.actionText, { color: theme.colors.textLink }]}>{t('files.pinComment')}</Text>
                            </Pressable>
                            <Pressable accessibilityRole="button" onPress={() => props.onActiveAnchorChange(null)} style={styles.action}>
                                <Text style={[styles.actionText, { color: theme.colors.textSecondary }]}>{t('common.cancel')}</Text>
                            </Pressable>
                        </View>
                    </View>
                ) : null}
                {isInline ? <View style={[styles.threadFace, styles.threadFaceBottom, { backgroundColor: glowColor }]} /> : null}
            </View>
        </View>
    );
}

export function InlineCommentReview(props: InlineCommentReviewProps) {
    const { theme } = useUnistyles();
    const [sending, setSending] = React.useState(false);
    const [error, setError] = React.useState(false);
    const sendingRef = React.useRef(false);
    const commentsRef = React.useRef(props.comments);
    commentsRef.current = props.comments;
    const pendingCount = props.comments.filter((comment) => !comment.acknowledged).length;

    if (!props.activeAnchor && props.comments.length === 0) return null;

    const send = async () => {
        if (sendingRef.current) return;
        const sentComments = commentsRef.current.filter((comment) => !comment.acknowledged);
        if (sentComments.length === 0) return;
        const sentFeedback = new Map(sentComments.map((comment) => [comment.id, comment.feedback]));
        sendingRef.current = true;
        setSending(true);
        setError(false);
        try {
            await submitWorkspaceFeedback({
                originSessionId: props.originSessionId,
                reference: props.reference,
                feedback: sentComments,
                attachments: sentComments.flatMap((comment) => comment.screenshot ? [comment.screenshot] : []),
                sendMessage: (sessionId, text, options) => sync.sendMessage(sessionId, text, options),
            });
            // UI draft changes do not replace the saved payload being delivered.
            // Retain its editor, but exclude the acknowledged payload from later sends.
            props.onCommentsChange(commentsRef.current.flatMap((comment) => {
                if (sentFeedback.get(comment.id) !== comment.feedback) return [comment];
                return comment.editingDraft === undefined ? [] : [{ ...comment, acknowledged: true }];
            }));
        } catch {
            setError(true);
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    };

    return (
        <View
            accessibilityLabel={t('files.inlineComments')}
            style={props.mode === 'bar' ? styles.reviewHost : styles.dockedHost}
        >
            {props.mode !== 'bar' ? (
                <InlineCommentThread
                    activeAnchor={props.activeAnchor}
                    comments={props.comments}
                    onActiveAnchorChange={props.onActiveAnchorChange}
                    onCommentsChange={props.onCommentsChange}
                />
            ) : null}
            {pendingCount > 0 ? (
                <View
                    testID="inline-comment-review-bar"
                    style={[
                        styles.reviewBar,
                        { backgroundColor: theme.dark ? 'rgba(20,20,18,.92)' : 'rgba(255,255,255,.90)', borderColor: theme.colors.divider },
                        { backdropFilter: 'blur(16px)' } as any,
                    ]}
                >
                    <Text style={[styles.reviewCount, { color: theme.colors.textSecondary }]}>{t('files.inlineComments')}</Text>
                    {error ? <Text accessibilityRole="alert" style={[styles.reviewError, { color: theme.colors.textDestructive }]}>{t('happyHerd.composer.sendFailedBody')}</Text> : null}
                    <Pressable accessibilityRole="button" disabled={sending} onPress={() => { void send(); }} style={[styles.send, { backgroundColor: theme.colors.button.primary.background }]}>
                        <Text style={[styles.sendText, { color: theme.colors.button.primary.tint }]}>{sending ? t('common.loading') : t('files.sendComments', { count: pendingCount })}</Text>
                    </Pressable>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    reviewHost: { position: 'relative', zIndex: 4, flexShrink: 0 },
    dockedHost: { position: 'relative', zIndex: 4, flexShrink: 0 },
    thread: { flexDirection: 'row', minWidth: 0 },
    inlineThread: { width: '100%', marginStart: -24, paddingVertical: 6, paddingEnd: 12 },
    seamColumn: { position: 'relative', width: 26, flexShrink: 0, alignItems: 'center' },
    seam: { position: 'absolute', top: -7, bottom: -7, width: 3, borderRadius: 2 },
    seamDot: { position: 'absolute', top: 16, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
    threadCard: { position: 'relative', flex: 1, minWidth: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 10, overflow: 'hidden' },
    threadFace: { position: 'absolute', left: 14, right: 14, height: 1, opacity: 0.42 },
    threadFaceTop: { top: 0 },
    threadFaceBottom: { bottom: 0 },
    commentRow: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, minWidth: 0 },
    commentBody: { flex: 1, minWidth: 160, gap: 2 },
    commentText: { ...Typography.default(), flex: 1, fontSize: 16, lineHeight: 22 },
    editColumn: { flex: 1, minWidth: 0, gap: 6 },
    composeRow: { gap: 7 },
    anchor: { ...Typography.default('semiBold'), fontSize: 16, lineHeight: 22 },
    input: { minHeight: 52, maxHeight: 148, borderWidth: StyleSheet.hairlineWidth, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, lineHeight: 22 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 2 },
    action: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 9, paddingVertical: 7 },
    actionText: { ...Typography.default('semiBold'), fontSize: 16, lineHeight: 22 },
    reviewBar: { minHeight: 58, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
    reviewCount: { ...Typography.default('semiBold'), flexGrow: 1, fontSize: 16, lineHeight: 22 },
    reviewError: { ...Typography.default(), fontSize: 16, lineHeight: 22 },
    send: { minHeight: 40, justifyContent: 'center', borderRadius: 9, paddingHorizontal: 14, paddingVertical: 8 },
    sendText: { ...Typography.default('semiBold'), fontSize: 16, lineHeight: 22 },
}));
