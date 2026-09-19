export interface PresentedQuestion {
    id: string;
    question: string;
    header: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect: boolean;
    allowCustom: boolean;
    required: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}

/** A specialized form must be usable before it replaces the generic tool view. */
export function readClaudeQuestions(input: unknown): PresentedQuestion[] | null {
    const raw = record(input)?.questions;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const questions: PresentedQuestion[] = [];
    for (let index = 0; index < raw.length; index += 1) {
        const question = record(raw[index]);
        if (!question || typeof question.question !== 'string' || !question.question.trim()
            || typeof question.header !== 'string' || !question.header.trim()
            || !Array.isArray(question.options) || question.options.length === 0
            || (question.multiSelect !== undefined && typeof question.multiSelect !== 'boolean')) return null;
        const options: PresentedQuestion['options'] = [];
        for (const value of question.options) {
            const option = record(value);
            if (!option || typeof option.label !== 'string' || !option.label.trim()
                || (option.description !== undefined && typeof option.description !== 'string')) return null;
            options.push({ label: option.label, ...(typeof option.description === 'string' ? { description: option.description } : {}) });
        }
        questions.push({
            id: `question-${index}`, question: question.question, header: question.header,
            options, multiSelect: question.multiSelect === true, allowCustom: true, required: true,
        });
    }
    return questions;
}

/** Never parse prose as an answer: use the native structured answer fields. */
export function readClaudeAnswers(questions: PresentedQuestion[], ...sources: unknown[]): Record<string, string[]> | null {
    for (const source of sources) {
        const answers = record(record(source)?.answers);
        if (!answers) continue;
        const result: Record<string, string[]> = {};
        for (const question of questions) {
            const value = answers[question.question];
            if (typeof value === 'string') result[question.id] = [value];
        }
        if (Object.keys(result).length > 0) return result;
    }
    return null;
}

export function hasPlanBody(input: unknown): boolean {
    const plan = record(input)?.plan;
    return typeof plan === 'string' && plan.trim().length > 0;
}
