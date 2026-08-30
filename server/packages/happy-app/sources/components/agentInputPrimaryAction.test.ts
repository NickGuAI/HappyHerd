import { describe, expect, it } from 'vitest';
import {
    doesVoiceOwnPrimaryPress,
    resolveAgentInputPrimaryAction,
    resolveAgentInputSendPressAvailability,
} from './agentInputPrimaryAction';

describe('resolveAgentInputPrimaryAction', () => {
    const base = {
        hasComposerContent: false,
        isSendBlocked: false,
        isSendDisabled: false,
        showAbortButton: false,
        canAbort: true,
    };

    it('shows Stop for a blank composer while the agent is thinking', () => {
        expect(resolveAgentInputPrimaryAction({
            ...base,
            showAbortButton: true,
        })).toBe('stop');
    });

    it('switches to Send as soon as a follow-up has content', () => {
        expect(resolveAgentInputPrimaryAction({
            ...base,
            hasComposerContent: true,
            showAbortButton: true,
        })).toBe('send');
    });

    it('does not show Stop when there is no abort handler', () => {
        expect(resolveAgentInputPrimaryAction({
            ...base,
            showAbortButton: true,
            canAbort: false,
        })).toBe('idle');
    });

    it('keeps an empty idle composer inactive', () => {
        expect(resolveAgentInputPrimaryAction(base)).toBe('idle');
    });

    it('falls back to voice on an empty composer when dictation is available', () => {
        expect(resolveAgentInputPrimaryAction({
            ...base,
            canVoice: true,
        })).toBe('voice');
    });

    it('keeps Stop ahead of voice while the agent is thinking', () => {
        expect(resolveAgentInputPrimaryAction({
            ...base,
            showAbortButton: true,
            canVoice: true,
        })).toBe('stop');
    });

    it('keeps Send ahead of voice once there is content', () => {
        expect(resolveAgentInputPrimaryAction({
            ...base,
            hasComposerContent: true,
            canVoice: true,
        })).toBe('send');
    });

    it('keeps Finish ahead of Send while dictation is recording', () => {
        expect(resolveAgentInputPrimaryAction({
            ...base,
            hasComposerContent: true,
            canVoice: true,
            dictationPhase: 'recording',
        })).toBe('voice');
    });

    it('keeps the voice position busy while transcription is in flight', () => {
        expect(resolveAgentInputPrimaryAction({
            ...base,
            hasComposerContent: true,
            canVoice: true,
            dictationPhase: 'transcribing',
        })).toBe('voice');
    });

    it('offers retry from the primary control after a failed blank dictation', () => {
        expect(resolveAgentInputPrimaryAction({
            ...base,
            canVoice: true,
            canRetryVoice: true,
            dictationPhase: 'error',
        })).toBe('voice');
    });

    it.each(['idle', 'recording', 'transcribing', 'error'] as const)(
        'never assigns %s dictation to a dedicated composer primary action',
        (dictationPhase) => {
            expect(resolveAgentInputPrimaryAction({
                ...base,
                hasComposerContent: true,
                canVoice: true,
                canRetryVoice: true,
                dictationPhase,
                voiceControlPlacement: 'dedicated',
            })).toBe('send');
            expect(resolveAgentInputPrimaryAction({
                ...base,
                canVoice: true,
                canRetryVoice: true,
                dictationPhase,
                voiceControlPlacement: 'dedicated',
            })).toBe('idle');
        },
    );

    it('still offers Stop for a blank composer when steering is blocked', () => {
        expect(resolveAgentInputPrimaryAction({
            ...base,
            isSendBlocked: true,
            showAbortButton: true,
            canVoice: true,
        })).toBe('stop');
    });
    it('preserves the blocked-send affordance for content', () => {
        expect(resolveAgentInputPrimaryAction({
            ...base,
            hasComposerContent: true,
            isSendBlocked: true,
            showAbortButton: true,
        })).toBe('blocked');
    });
});

describe('doesVoiceOwnPrimaryPress', () => {
    it('defers a stale idle voice state to newly typed live content', () => {
        expect(doesVoiceOwnPrimaryPress({
            primaryAction: 'voice',
            dictationPhase: 'idle',
            liveHasContent: true,
        })).toBe(false);
    });

    it('defers a stale retry state to newly typed live content', () => {
        expect(doesVoiceOwnPrimaryPress({
            primaryAction: 'voice',
            dictationPhase: 'error',
            liveHasContent: true,
        })).toBe(false);
    });

    it('keeps Finish authoritative after typing during recording', () => {
        expect(doesVoiceOwnPrimaryPress({
            primaryAction: 'voice',
            dictationPhase: 'recording',
            liveHasContent: true,
        })).toBe(true);
    });
});

describe('resolveAgentInputSendPressAvailability', () => {
    const base = {
        isAborting: false,
        isSending: false,
        isSendDisabled: false,
    };

    it('keeps Send reachable while deferred composer state catches up without dictation', () => {
        expect(resolveAgentInputSendPressAvailability(base)).toBe(true);
    });

    it('keeps Send reachable when retry remains visible but starting dictation is unavailable', () => {
        expect(resolveAgentInputPrimaryAction({
            hasComposerContent: false,
            isSendBlocked: false,
            isSendDisabled: false,
            showAbortButton: false,
            canAbort: true,
            canVoice: false,
            canRetryVoice: true,
            dictationPhase: 'error',
            voiceControlPlacement: 'dedicated',
        })).toBe('idle');
        expect(resolveAgentInputSendPressAvailability(base)).toBe(true);
    });

    it.each(['idle', 'recording', 'transcribing', 'error'] as const)(
        'keeps Send actionable during %s dictation when the draft has content',
        (dictationPhase) => {
            expect(resolveAgentInputPrimaryAction({
                hasComposerContent: true,
                isSendBlocked: false,
                isSendDisabled: false,
                showAbortButton: false,
                canAbort: true,
                canVoice: true,
                canRetryVoice: true,
                dictationPhase,
                voiceControlPlacement: 'dedicated',
            })).toBe('send');
            expect(resolveAgentInputSendPressAvailability(base)).toBe(true);
        },
    );

    it('still honors hard send disablement', () => {
        expect(resolveAgentInputSendPressAvailability({
            ...base,
            isSendDisabled: true,
        })).toBe(false);
    });

    it('disables Send only for an abort or in-flight send', () => {
        expect(resolveAgentInputSendPressAvailability({
            ...base,
            isAborting: true,
        })).toBe(false);
        expect(resolveAgentInputSendPressAvailability({
            ...base,
            isSending: true,
        })).toBe(false);
    });
});
