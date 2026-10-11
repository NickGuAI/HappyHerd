import { describe, expect, it } from 'vitest';
import { composeReplyAppendSystemPrompt } from './voiceOverviewPrompt';

describe('spoken reply prompt', () => {
    it('adds the summary instruction only when local text-to-speech is enabled', () => {
        expect(composeReplyAppendSystemPrompt('Base prompt', false)).toBe('Base prompt');
        const prompt = composeReplyAppendSystemPrompt('Base prompt', true);
        expect(prompt.startsWith('Base prompt\n\n# Spoken reply summary')).toBe(true);
        expect(prompt).toContain('<voice_overview>...</voice_overview>');
        expect(prompt).toContain('required HappyHerd safeguard reminder');
        expect(prompt).toContain('<options>');
    });
});
