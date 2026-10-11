import { describe, expect, it } from 'vitest';
import { parseVoiceOverview, toSpeechText } from './voiceOverview';

describe('voice reply parsing', () => {
    it('extracts an overview before the body and keeps trailing options at the end', () => {
        expect(parseVoiceOverview('<voice_overview>Short answer.</voice_overview>\nBody.\n<options>\n<option>Next</option>\n</options>')).toEqual({
            summary: 'Short answer.',
            body: 'Body.\n<options>\n<option>Next</option>\n</options>',
            pending: false,
        });
    });

    it.each([
        '<voice_overview',
        '<voice_overview ',
        '<voice_overview mode="short"',
        '<voice_overview>in progress',
    ])('hides a streamed overview prefix: %s', (text) => {
        expect(parseVoiceOverview(text)).toEqual({ summary: null, body: '', pending: true });
    });

    it.each([
        '    <voice_overview>literal example</voice_overview>',
        '\t<voice_overview>literal example</voice_overview>',
    ])('preserves an indented literal overview example: %s', (text) => {
        expect(parseVoiceOverview(text)).toEqual({ summary: null, body: text, pending: false });
    });

    it('leaves legacy replies without an overview readable', () => {
        expect(parseVoiceOverview('A previous reply.')).toEqual({ summary: null, body: 'A previous reply.', pending: false });
    });

    it('filters code, tables, tools, safeguards and protocol options from full reply speech', () => {
        expect(toSpeechText([
            '## Summary',
            'Useful prose.',
            '| Name | Value |',
            '| --- | --- |',
            '| token | 42 |',
            '```ts',
            'secret()',
            '```',
            '~~~python',
            'secret_tilde()',
            '~~~',
            '    secret_indented()',
            '    <voice_overview>literal code</voice_overview>',
            'Do not read `private_variable` aloud.',
            '<tool_call>secret tool action</tool_call>',
            '<options><option>Choose</option></options>',
            '<happyherd-safeguard-reminder status="ready">Private reminder</happyherd-safeguard-reminder>',
            '[Link](https://example.com)',
        ].join('\n'))).toBe('Summary\nUseful prose.\nDo not read  aloud.\n\nLink');
    });
});
