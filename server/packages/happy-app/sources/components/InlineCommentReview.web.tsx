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
import type { InlineCommentReviewProps } from './InlineCommentReview';

export function InlineCommentReview(props: InlineCommentReviewProps) {
    const { theme } = useUnistyles();
    const [draft, setDraft] = React.useState('');
    const [sending, setSending] = React.useState(false);
    const [error, setError] = React.useState(false);
    const commentsRef = React.useRef(props.comments);
    commentsRef.current = props.comments;

    React.useEffect(() => {
        setDraft('');
        setError(false);
    }, [props.activeAnchor]);

    if (!props.activeAnchor && props.comments.length === 0) return null;

    const addComment = () => {
        const feedback = draft.trim();
        if (!props.activeAnchor || !feedback) return;
        const comment: WorkspaceFeedbackComment = {
            ...props.activeAnchor,
            id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
            feedback,
        };
        props.onCommentsChange([...props.comments, comment]);
        props.onActiveAnchorChange(null);
        setDraft('');
    };

    const send = async () => {
        if (sending || props.comments.length === 0) return;
        const sentComments = commentsRef.current;
        const sentCommentIds = new Set(sentComments.map((comment) => comment.id));
        setSending(true);
        setError(false);
        try {
            await submitWorkspaceFeedback({
                originSessionId: props.originSessionId,
                reference: props.reference,
                feedback: sentComments,
                attachments: [],
                sendMessage: (sessionId, text, options) => sync.sendMessage(sessionId, text, options),
            });
            props.onCommentsChange(commentsRef.current.filter((comment) => !sentCommentIds.has(comment.id)));
        } catch {
            setError(true);
        } finally {
            setSending(false);
        }
    };

    const anchorLabel = props.activeAnchor?.nodeId
        ? t('files.commentOnNode', { node: props.activeAnchor.nodeId })
        : t('files.commentOnLine', { line: String(props.activeAnchor?.line ?? 0) });

    return (
        <View style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider }]} accessibilityLabel={t('files.inlineComments')}>
            {props.comments.map((comment, index) => (
                <View key={comment.id} style={styles.commentRow}>
                    <Text style={[styles.commentText, { color: theme.colors.text }]} numberOfLines={2}>
                        {`${index + 1}. ${comment.nodeId ? t('files.canvasNode', { node: comment.nodeId }) : t('files.lineNumber', { line: String(comment.line ?? 0) })}: ${comment.feedback}`}
                    </Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('files.removeComment')} onPress={() => props.onCommentsChange(props.comments.filter((item) => item.id !== comment.id))}>
                        <Text style={[styles.remove, { color: theme.colors.textDestructive }]}>{t('common.delete')}</Text>
                    </Pressable>
                </View>
            ))}
            {props.activeAnchor ? (
                <View style={styles.composeRow}>
                    <Text style={[styles.anchor, { color: theme.colors.textSecondary }]}>{anchorLabel}</Text>
                    <TextInput
                        value={draft}
                        onChangeText={setDraft}
                        placeholder={t('files.commentPlaceholder')}
                        multiline
                        style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider }]}
                        accessibilityLabel={t('files.commentPlaceholder')}
                    />
                    <Pressable accessibilityRole="button" disabled={!draft.trim()} onPress={addComment} style={styles.action}>
                        <Text style={{ color: theme.colors.textLink }}>{t('files.pinComment')}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => props.onActiveAnchorChange(null)} style={styles.action}>
                        <Text style={{ color: theme.colors.textSecondary }}>{t('common.cancel')}</Text>
                    </Pressable>
                </View>
            ) : null}
            {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.textDestructive }}>{t('happyHerd.composer.sendFailedBody')}</Text> : null}
            {props.comments.length > 0 ? (
                <Pressable accessibilityRole="button" disabled={sending} onPress={() => { void send(); }} style={[styles.send, { backgroundColor: theme.colors.button.primary.background }]}>
                    <Text style={{ color: theme.colors.button.primary.tint }}>{sending ? t('common.loading') : t('files.sendComments', { count: props.comments.length })}</Text>
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    panel: { borderTopWidth: StyleSheet.hairlineWidth, padding: 10, gap: 8 },
    commentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    commentText: { ...Typography.default(), flex: 1, fontSize: 13, lineHeight: 18 },
    remove: { ...Typography.default(), fontSize: 12 },
    composeRow: { gap: 6 },
    anchor: { ...Typography.default('semiBold'), fontSize: 12 },
    input: { minHeight: 38, maxHeight: 96, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
    action: { alignSelf: 'flex-end', paddingHorizontal: 8, paddingVertical: 5 },
    send: { alignSelf: 'flex-end', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
}));
