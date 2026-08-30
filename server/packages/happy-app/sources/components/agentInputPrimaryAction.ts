export type AgentInputPrimaryAction = 'send' | 'stop' | 'blocked' | 'voice' | 'idle';

type DictationPhase = 'idle' | 'recording' | 'transcribing' | 'error';

export function resolveAgentInputSendPressAvailability({
    isAborting,
    isSending,
    isSendDisabled,
}: {
    isAborting: boolean;
    isSending: boolean;
    isSendDisabled: boolean;
}): boolean {
    return !isAborting && !isSending && !isSendDisabled;
}

export function doesVoiceOwnPrimaryPress({
    primaryAction,
    dictationPhase,
    liveHasContent,
}: {
    primaryAction: AgentInputPrimaryAction;
    dictationPhase: DictationPhase;
    liveHasContent: boolean;
}): boolean {
    if (primaryAction !== 'voice') return false;
    return !liveHasContent || dictationPhase === 'recording' || dictationPhase === 'transcribing';
}

export function resolveAgentInputPrimaryAction({
    hasComposerContent,
    isSendBlocked,
    isSendDisabled,
    showAbortButton,
    canAbort,
    canVoice = false,
    dictationPhase = 'idle',
    canRetryVoice = false,
    voiceControlPlacement = 'primary',
}: {
    hasComposerContent: boolean;
    isSendBlocked: boolean;
    isSendDisabled: boolean;
    showAbortButton: boolean;
    canAbort: boolean;
    canVoice?: boolean;
    dictationPhase?: DictationPhase;
    canRetryVoice?: boolean;
    voiceControlPlacement?: 'primary' | 'dedicated';
}): AgentInputPrimaryAction {
    const voiceOwnsPrimaryAction = canVoice && voiceControlPlacement === 'primary';
    // Once recording starts, the primary control must keep owning that
    // lifecycle even if the Human types or attaches content in parallel.
    // Transcribing retains the same position as a disabled progress control.
    if (voiceOwnsPrimaryAction && (dictationPhase === 'recording' || dictationPhase === 'transcribing')) {
        return 'voice';
    }
    if (voiceOwnsPrimaryAction && canRetryVoice && dictationPhase === 'error' && !hasComposerContent) {
        return 'voice';
    }
    // A blank composer while the agent is working is the one case where the
    // primary control is Stop. As soon as the user starts a follow-up, sending
    // takes priority so the next message can be queued without aborting work.
    // A blocked send must not suppress Stop: an agent that refuses steering
    // while it thinks is exactly the one the user has no other way to stop.
    if (showAbortButton && canAbort && !hasComposerContent) {
        return 'stop';
    }
    if (isSendBlocked && hasComposerContent) {
        return 'blocked';
    }
    if (!isSendDisabled && hasComposerContent) {
        return 'send';
    }
    // An empty composer with dictation available falls back to voice rather
    // than to a dead button, which is what the separate mic button used to do.
    if (!isSendDisabled && voiceOwnsPrimaryAction) {
        return 'voice';
    }
    return 'idle';
}
