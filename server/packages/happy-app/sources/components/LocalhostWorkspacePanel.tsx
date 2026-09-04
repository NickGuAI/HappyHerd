import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { InlineCommentReview, type InlineCommentAnchor } from '@/components/InlineCommentReview';
import { LocalhostLiveView } from '@/components/LocalhostLiveView';
import { Text } from '@/components/StyledText';
import type { WorkspaceFeedbackComment } from '@/sync/workspaceFeedback';
import type { WorkspaceLiveElementPick } from '@/sync/workspaceLive';
import { t } from '@/text';

export const LocalhostWorkspacePanel = React.memo(function LocalhostWorkspacePanel({
    sessionId,
    machineId,
    url,
    active,
    onHeaderRightSlotChange,
}: {
    sessionId: string;
    machineId: string;
    url: string;
    active: boolean;
    onHeaderRightSlotChange: (slot: React.ReactNode) => void;
}) {
    const { theme } = useUnistyles();
    const [pickerEnabled, setPickerEnabled] = React.useState(false);
    const [activeAnchor, setActiveAnchor] = React.useState<InlineCommentAnchor | null>(null);
    const [comments, setComments] = React.useState<WorkspaceFeedbackComment[]>([]);
    const [loadFailed, setLoadFailed] = React.useState(false);
    const [captureFailed, setCaptureFailed] = React.useState(false);

    React.useEffect(() => {
        if (!active) {
            setPickerEnabled(false);
            return;
        }
        setLoadFailed(false);
        setCaptureFailed(false);
    }, [active]);

    const handlePick = React.useCallback((pick: WorkspaceLiveElementPick) => {
        setPickerEnabled(false);
        setCaptureFailed(false);
        setActiveAnchor({
            elementSelector: pick.selector,
            elementHtml: pick.outerHTML,
            elementCss: pick.computedCss,
            elementBounds: pick.bounds,
            screenshot: pick.screenshot,
        });
    }, []);
    const handleError = React.useCallback(() => {
        setPickerEnabled(false);
        setCaptureFailed(false);
        setLoadFailed(true);
    }, []);
    const handleCaptureError = React.useCallback(() => {
        setPickerEnabled(false);
        setCaptureFailed(true);
    }, []);

    const pickerButton = React.useMemo(() => (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(pickerEnabled ? 'workspace.stopElementComment' : 'workspace.startElementComment')}
            onPress={() => {
                setLoadFailed(false);
                setCaptureFailed(false);
                setPickerEnabled((current) => !current);
            }}
            style={({ pressed, hovered }: any) => [
                styles.pickerButton,
                { backgroundColor: pickerEnabled ? theme.colors.surfaceHigh : 'transparent' },
                (pressed || hovered) && { opacity: 0.72 },
            ]}
        >
            <Octicons name="comment-discussion" size={15} color={theme.colors.text} />
            <Text style={{ color: theme.colors.text }}>
                {t(pickerEnabled ? 'workspace.stopElementComment' : 'workspace.startElementComment')}
            </Text>
        </Pressable>
    ), [pickerEnabled, theme.colors.surfaceHigh, theme.colors.text]);

    React.useEffect(() => {
        onHeaderRightSlotChange(pickerButton);
        return () => onHeaderRightSlotChange(null);
    }, [onHeaderRightSlotChange, pickerButton]);

    return (
        <View style={styles.container}>
            <View style={styles.liveView}>
                <LocalhostLiveView
                    machineId={machineId}
                    url={url}
                    pickerEnabled={active && pickerEnabled}
                    onPick={handlePick}
                    onError={handleError}
                    onCaptureError={handleCaptureError}
                />
                {active && loadFailed ? (
                    <View style={[styles.error, { backgroundColor: theme.colors.surface }]}>
                        <Text accessibilityRole="alert" style={{ color: theme.colors.textDestructive }}>
                            {t('workspace.liveLoadFailed')}
                        </Text>
                    </View>
                ) : null}
                {active && captureFailed ? (
                    <View style={[styles.error, { backgroundColor: theme.colors.surface }]}>
                        <Text accessibilityRole="alert" style={{ color: theme.colors.textDestructive }}>
                            {t('workspace.liveCaptureFailed')}
                        </Text>
                    </View>
                ) : null}
            </View>
            <InlineCommentReview
                originSessionId={sessionId}
                reference={{ machineId, liveUrl: url }}
                activeAnchor={activeAnchor}
                comments={comments}
                onActiveAnchorChange={setActiveAnchor}
                onCommentsChange={setComments}
            />
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    container: { flex: 1, minWidth: 0, minHeight: 0 },
    liveView: { flex: 1, minWidth: 0, minHeight: 0 },
    error: {
        position: 'absolute',
        left: 12,
        right: 12,
        top: 46,
        padding: 10,
        borderRadius: 8,
    },
    pickerButton: {
        minHeight: 32,
        borderRadius: 8,
        paddingHorizontal: 9,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
}));
