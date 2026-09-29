import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { AgentInputAttachmentStrip } from './AgentInputAttachmentStrip';
import { MultiTextInput } from './MultiTextInput';
import { Text } from './StyledText';
import { resolveAgentInputPrimaryAction } from './agentInputPrimaryAction';
import { useImagePicker } from '@/hooks/useImagePicker';
import { useVoiceDictation } from '@/hooks/useVoiceDictation';
import { useVoiceInputAvailability } from '@/hooks/useVoiceInputAvailability';
import { sync, type SendMessageReceipt } from '@/sync/sync';
import {
    submitWorkspaceFeedback,
    type WorkspaceFeedbackReference,
    type WorkspaceFeedbackSender,
} from '@/sync/workspaceFeedback';
import { t } from '@/text';
import { herdAlpha } from './herd/session/color';

export type WorkspaceFeedbackComposerProps = {
    originSessionId: string;
    machineId: string;
    machineLabel?: string | null;
    absolutePath: string;
    line?: number;
    column?: number;
    onSent: (receipt: SendMessageReceipt) => void;
    onSendingChange?: (sending: boolean) => void;
    /** Test seam; production callers use the synchronized outbox singleton. */
    sendMessage?: WorkspaceFeedbackSender;
};

function appendTranscript(current: string, transcript: string): string {
    if (!current) return transcript;
    if (!transcript) return current;
    return `${current}${/\s$/.test(current) ? '' : ' '}${transcript}`;
}

export function WorkspaceFeedbackComposer(props: WorkspaceFeedbackComposerProps) {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const [draft, setDraft] = React.useState('');
    const [isSending, setIsSending] = React.useState(false);
    const [sendError, setSendError] = React.useState<string | null>(null);
    const [acceptedReceipt, setAcceptedReceipt] = React.useState<SendMessageReceipt | null>(null);
    const imagePicker = useImagePicker();
    const voiceAvailability = useVoiceInputAvailability();
    const handleTranscript = React.useCallback((transcript: string) => {
        setDraft((current) => appendTranscript(current, transcript));
    }, []);
    const dictation = useVoiceDictation(handleTranscript);
    const updateSending = React.useCallback((sending: boolean) => {
        setIsSending(sending);
        props.onSendingChange?.(sending);
    }, [props.onSendingChange]);

    React.useEffect(() => {
        if (!acceptedReceipt || isSending) return;
        setAcceptedReceipt(null);
        props.onSent(acceptedReceipt);
    }, [acceptedReceipt, isSending, props.onSent]);

    const hasComposerContent = draft.trim().length > 0 || imagePicker.selectedImages.length > 0;
    const dictatedPrimaryAction = dictation.phase === 'recording'
        ? 'finish'
        : dictation.phase === 'error' && dictation.canRetry && !hasComposerContent ? 'retry' : null;
    const primaryAction = dictatedPrimaryAction
        ? 'voice'
        : resolveAgentInputPrimaryAction({
            hasComposerContent,
            isSendBlocked: false,
            isSendDisabled: isSending || dictation.phase === 'transcribing',
            showAbortButton: false,
            canAbort: false,
            canVoice: voiceAvailability.available,
        });

    const handleSend = React.useCallback(async () => {
        if (
            !hasComposerContent
            || isSending
            || dictation.phase === 'recording'
            || dictation.phase === 'transcribing'
        ) return;
        updateSending(true);
        setSendError(null);
        const reference: WorkspaceFeedbackReference = {
            machineId: props.machineId,
            machineLabel: props.machineLabel,
            absolutePath: props.absolutePath,
            line: props.line,
            column: props.column,
        };
        const sender: WorkspaceFeedbackSender = props.sendMessage
            ?? ((sessionId, text, options) => sync.sendMessage(sessionId, text, options));

        let receipt: SendMessageReceipt;
        try {
            receipt = await submitWorkspaceFeedback({
                originSessionId: props.originSessionId,
                reference,
                feedback: draft,
                attachments: imagePicker.selectedImages,
                sendMessage: sender,
            });
        } catch {
            // The draft and picker state deliberately remain untouched so the
            // same complete feedback can be retried from the Viewer.
            setSendError(t('happyHerd.composer.sendFailedBody'));
            updateSending(false);
            return;
        }
        setDraft('');
        imagePicker.clearImages();
        // Let the route owner commit usePreventRemove(false) before the effect
        // above dispatches navigation back to Chat.
        updateSending(false);
        setAcceptedReceipt(receipt);
    }, [
        dictation.phase,
        draft,
        hasComposerContent,
        imagePicker,
        isSending,
        props,
        updateSending,
    ]);

    const handlePrimaryPress = React.useCallback(() => {
        if (primaryAction === 'send') {
            void handleSend();
        } else if (primaryAction === 'voice') {
            if (dictation.phase === 'error' && dictation.canRetry) {
                dictation.retry();
            } else {
                dictation.toggle();
            }
        }
    }, [dictation, handleSend, primaryAction]);

    const primaryDisabled = primaryAction === 'idle'
        || primaryAction === 'blocked'
        || isSending
        || dictation.phase === 'transcribing';
    const isVoiceAction = primaryAction === 'voice';
    const isVoiceRetryAction = dictatedPrimaryAction === 'retry';

    return (
        <View
            style={[
                styles.container,
                {
                    paddingBottom: safeArea.bottom + 8,
                },
            ]}
        >
            <View style={styles.card} testID="workspace-feedback-card">
                <AgentInputAttachmentStrip
                    images={imagePicker.selectedImages}
                    onRemove={imagePicker.removeImage}
                    disabled={isSending}
                />
                {(sendError || dictation.error) && (
                    <Text accessibilityRole="alert" style={[styles.error, { color: theme.colors.textDestructive }]}>
                        {sendError || dictation.error}
                    </Text>
                )}
                <View style={styles.inputShell}>
                    <MultiTextInput
                        value={draft}
                        onChangeText={(text) => {
                            setDraft(text);
                            if (sendError) setSendError(null);
                        }}
                        placeholder={t('review.feedbackPrompt')}
                        editable={!isSending}
                        maxHeight={120}
                        paddingTop={8}
                        paddingBottom={8}
                        paddingLeft={12}
                        paddingRight={12}
                    />
                </View>
                <View style={styles.row}>
                    <Pressable
                        onPress={imagePicker.pickImages}
                        disabled={isSending || dictation.phase === 'transcribing'}
                        accessibilityRole="button"
                        accessibilityLabel={t(imagePicker.selectedImages.length > 0
                            ? 'happyHerd.composer.addPhotos'
                            : 'happyHerd.composer.addPhoto')}
                        style={({ pressed }) => [
                            styles.secondaryButton,
                            {
                                backgroundColor: pressed ? theme.colors.surfacePressedOverlay : 'transparent',
                                opacity: isSending || dictation.phase === 'transcribing'
                                    ? 0.45
                                    : pressed ? 0.7 : 1,
                            },
                        ]}
                    >
                        <Ionicons name="image-outline" size={20} color={theme.colors.kilv.inkDim} />
                    </Pressable>


                    <Pressable
                        onPress={handlePrimaryPress}
                        disabled={primaryDisabled}
                        accessibilityRole="button"
                        accessibilityLabel={isVoiceAction
                            ? (isVoiceRetryAction
                                ? t('happyHerd.composer.retryVoice')
                                : dictation.phase === 'recording'
                                ? t('happyHerd.composer.finishVoice')
                                : t('happyHerd.composer.startVoice'))
                            : t('happyHerd.composer.send')}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            {
                                backgroundColor: theme.colors.button.primary.background,
                                opacity: primaryDisabled ? 0.45 : pressed ? 0.72 : 1,
                            },
                        ]}
                    >
                        {isSending || dictation.phase === 'transcribing' ? (
                            <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                        ) : isVoiceAction ? (
                            <Ionicons
                                name={isVoiceRetryAction
                                    ? 'refresh'
                                    : dictation.phase === 'recording' ? 'stop' : 'mic'}
                                size={20}
                                color={theme.colors.button.primary.tint}
                            />
                        ) : (
                            <Octicons
                                name="arrow-up"
                                size={17}
                                color={theme.colors.button.primary.tint}
                            />
                        )}
                    </Pressable>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        paddingHorizontal: 16,
        paddingTop: 8,
    },
    card: {
        borderWidth: 1,
        borderRadius: theme.kilv.radiusCard,
        borderColor: theme.colors.kilv.rimLine,
        backgroundColor: theme.colors.kilv.bgRaised,
        padding: 8,
        _web: {
            '_focus-within': {
                borderColor: herdAlpha(theme.colors.kilv.accent, 0.55),
                boxShadow: `0 0 0 3px ${herdAlpha(theme.colors.kilv.accent, 0.08)}, ${theme.kilv.glowMoltenSoft}`,
            },
        },
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        minWidth: 0,
    },
    inputShell: {
        minWidth: 0,
        minHeight: 44,
        borderRadius: theme.kilv.radius,
        justifyContent: 'center',
        overflow: 'hidden',
    },
    secondaryButton: {
        width: 44,
        height: 44,
        flexShrink: 0,
        borderRadius: theme.kilv.radius,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryButton: {
        width: 44,
        height: 44,
        flexShrink: 0,
        borderRadius: theme.kilv.radiusPill,
        alignItems: 'center',
        justifyContent: 'center',
    },
    error: {
        fontSize: 12,
        lineHeight: 16,
        marginHorizontal: 8,
        marginBottom: 6,
    },
}));
