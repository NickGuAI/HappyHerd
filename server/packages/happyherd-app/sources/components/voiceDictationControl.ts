import type { VoiceDictationPhase } from '@/hooks/useVoiceDictation';

export type VoiceDictationControlAction = 'start' | 'finish' | 'transcribing' | 'retry';

export type VoiceDictationControlState = {
    action: VoiceDictationControlAction;
    disabled: boolean;
    showCancel: boolean;
};

export type VoiceDictationControlVisibility = {
    showAction: boolean;
    showCancel: boolean;
    shouldRender: boolean;
};

export function resolveVoiceDictationControlVisibility({
    state,
    hasActionHandler,
    hasCancelHandler,
}: {
    state: VoiceDictationControlState;
    hasActionHandler: boolean;
    hasCancelHandler: boolean;
}): VoiceDictationControlVisibility {
    const showAction = state.action === 'transcribing' || hasActionHandler;
    const showCancel = state.showCancel && hasCancelHandler;
    return {
        showAction,
        showCancel,
        shouldRender: showAction || showCancel,
    };
}

export function resolveVoiceDictationControl({
    phase,
    canRetry,
    disabled,
}: {
    phase: VoiceDictationPhase;
    canRetry: boolean;
    disabled: boolean;
}): VoiceDictationControlState {
    if (phase === 'recording') {
        return { action: 'finish', disabled: false, showCancel: true };
    }
    if (phase === 'transcribing') {
        return { action: 'transcribing', disabled: true, showCancel: false };
    }
    if (phase === 'error' && canRetry) {
        return { action: 'retry', disabled, showCancel: false };
    }
    return { action: 'start', disabled, showCancel: false };
}
