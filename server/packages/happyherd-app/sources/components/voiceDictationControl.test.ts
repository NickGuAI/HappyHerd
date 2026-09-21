import { describe, expect, it } from 'vitest';
import {
    resolveVoiceDictationControl,
    resolveVoiceDictationControlVisibility,
} from './voiceDictationControl';

describe('resolveVoiceDictationControl', () => {
    it('keeps the dedicated microphone available to start an idle recording', () => {
        expect(resolveVoiceDictationControl({
            phase: 'idle',
            canRetry: false,
            disabled: false,
        })).toEqual({
            action: 'start',
            disabled: false,
            showCancel: false,
        });
    });

    it('keeps finish and cancel on the dictation controls while recording', () => {
        expect(resolveVoiceDictationControl({
            phase: 'recording',
            canRetry: false,
            disabled: true,
        })).toEqual({
            action: 'finish',
            disabled: false,
            showCancel: true,
        });
    });

    it('shows non-interactive progress while OpenAI transcription is in flight', () => {
        expect(resolveVoiceDictationControl({
            phase: 'transcribing',
            canRetry: false,
            disabled: false,
        })).toEqual({
            action: 'transcribing',
            disabled: true,
            showCancel: false,
        });
    });

    it('routes a retryable error back through the dedicated microphone control', () => {
        expect(resolveVoiceDictationControl({
            phase: 'error',
            canRetry: true,
            disabled: false,
        })).toEqual({
            action: 'retry',
            disabled: false,
            showCancel: false,
        });
    });

    it('allows a non-retryable error to start a fresh recording', () => {
        expect(resolveVoiceDictationControl({
            phase: 'error',
            canRetry: false,
            disabled: false,
        })).toEqual({
            action: 'start',
            disabled: false,
            showCancel: false,
        });
    });
});

describe('resolveVoiceDictationControlVisibility', () => {
    it('keeps Cancel visible if the start/finish handler disappears during recording', () => {
        const state = resolveVoiceDictationControl({
            phase: 'recording',
            canRetry: false,
            disabled: true,
        });
        expect(resolveVoiceDictationControlVisibility({
            state,
            hasActionHandler: false,
            hasCancelHandler: true,
        })).toEqual({
            showAction: false,
            showCancel: true,
            shouldRender: true,
        });
    });

    it('keeps transcription progress visible without a press handler', () => {
        const state = resolveVoiceDictationControl({
            phase: 'transcribing',
            canRetry: false,
            disabled: true,
        });
        expect(resolveVoiceDictationControlVisibility({
            state,
            hasActionHandler: false,
            hasCancelHandler: false,
        })).toEqual({
            showAction: true,
            showCancel: false,
            shouldRender: true,
        });
    });
});
