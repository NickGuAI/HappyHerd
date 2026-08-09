import { describe, expect, it } from 'vitest';
import { resolveAgentInputPrimaryAction } from './agentInputPrimaryAction';

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

    it('uses voice for an empty composer only when dictation is available', () => {
        expect(resolveAgentInputPrimaryAction({ ...base, canVoice: true })).toBe('voice');
    });

    it('keeps send ahead of voice when the composer has content', () => {
        expect(resolveAgentInputPrimaryAction({
            ...base,
            hasComposerContent: true,
            canVoice: true,
        })).toBe('send');
    });

    it('keeps stop ahead of voice while an empty active turn can be aborted', () => {
        expect(resolveAgentInputPrimaryAction({
            ...base,
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
