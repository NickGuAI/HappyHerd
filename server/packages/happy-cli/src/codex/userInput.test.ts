import { describe, expect, it } from 'vitest';
import { readCodexQuestions } from './userInput';
import fixture from './fixtures/native-question.json';

describe('native question admission', () => {
    it('retains native IDs, offered labels, free-text capability and masking', () => {
        const params = structuredClone(fixture.params);
        params.questions[1].isSecret = true;
        expect(readCodexQuestions(params)).toEqual([
            { id: 'storage', header: 'Storage', question: 'Where should the result be saved?', options: params.questions[0].options, allowCustom: true, isSecret: false },
            { id: 'details', header: 'Details', question: 'What should the result contain?', options: [], allowCustom: true, isSecret: true },
        ]);
        expect(readCodexQuestions({ questions: [{ ...params.questions[0], isOther: false }] })?.[0].allowCustom).toBe(false);
    });

    it.each([
        { questions: [] }, { questions: [null] }, { questions: 'unsupported' },
        { questions: [fixture.params.questions[0], fixture.params.questions[0]] },
        { questions: [{ ...fixture.params.questions[0], options: [{ label: 'Missing description' }] }] },
        { questions: [{ ...fixture.params.questions[0], isSecret: 'unknown' }] },
    ])('keeps malformed or unsupported shapes out of a specialized form: %j', params => {
        expect(readCodexQuestions(params)).toBeNull();
    });
});
