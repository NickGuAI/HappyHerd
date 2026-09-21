import { describe, expect, it } from 'vitest';
import { hasPlanBody, readClaudeAnswers, readClaudeQuestions } from './questionPresentation';

const question = {
    header: 'Approach',
    question: 'Which approach should I use?',
    options: [{ label: 'Small patch', description: 'Keep the existing design' }, { label: 'Refactor' }],
};

describe('question presentation ownership', () => {
    it('accepts optional descriptions and multiSelect without dropping native text', () => {
        expect(readClaudeQuestions({ questions: [question] })).toEqual([{
            ...question, id: 'question-0', multiSelect: false, allowCustom: true, required: true,
        }]);
    });

    it.each([
        null, {}, { questions: [] }, { questions: [null] },
        { questions: [{ ...question, header: '' }] },
        { questions: [{ ...question, question: '  ' }] },
        { questions: [{ ...question, options: [] }] },
        { questions: [{ ...question, options: [null] }] },
        { questions: [{ ...question, options: [{ label: 42 }] }] },
        { questions: [{ ...question, options: [{ label: 'A', description: 42 }] }] },
        { questions: [{ ...question, multiSelect: 'false' }] },
    ])('leaves malformed payloads with the generic view and real permission controls: %j', input => {
        expect(readClaudeQuestions(input)).toBeNull();
    });

    it('maps completed answers by exact original question text, not the header or index', () => {
        const questions = readClaudeQuestions({ questions: [question] })!;
        expect(readClaudeAnswers(questions, { answers: { [question.question]: 'My custom approach' } }))
            .toEqual({ 'question-0': ['My custom approach'] });
        expect(readClaudeAnswers(questions, { answers: { Approach: 'Small patch' } })).toBeNull();
    });

    it('does not infer an answer from tool prose or erase a later structured receipt', () => {
        const questions = readClaudeQuestions({ questions: [question] })!;
        expect(readClaudeAnswers(questions, 'The user answered Small patch')).toBeNull();
        expect(readClaudeAnswers(questions, { answers: {} }, { answers: { [question.question]: 'Refactor' } }))
            .toEqual({ 'question-0': ['Refactor'] });
    });

    it('uses a plan view only for an actual nonblank body', () => {
        expect(hasPlanBody({ plan: '# Proposed implementation\nDetails' })).toBe(true);
        for (const input of [null, {}, { plan: '' }, { plan: ' \n ' }, { plan: 1 }]) {
            expect(hasPlanBody(input)).toBe(false);
        }
    });
});
