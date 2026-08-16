import { describe, expect, it } from 'vitest';

import {
    DEFAULT_CODEX_REASONING_EFFORT,
    initialCodexReasoningEffort,
    isReasoningEffort,
    resolveCodexReasoningEffort,
} from './reasoningEffort';

const model = (supportedReasoningEfforts: string[]) => ({
    id: 'gpt-test',
    model: 'gpt-test',
    displayName: 'GPT Test',
    description: 'test model',
    hidden: false,
    supportedReasoningEfforts: supportedReasoningEfforts.map((reasoningEffort) => ({
        reasoningEffort,
        description: reasoningEffort,
    })),
    defaultReasoningEffort: supportedReasoningEfforts[0] ?? 'none',
    isDefault: true,
});

describe('isReasoningEffort', () => {
    it('defaults every direct Codex session to max effort', () => {
        expect(DEFAULT_CODEX_REASONING_EFFORT).toBe('max');
        expect(initialCodexReasoningEffort(undefined)).toBe('max');
        expect(initialCodexReasoningEffort('high')).toBe('high');
    });

    it('accepts provider-advertised effort values without a CLI release', () => {
        expect(isReasoningEffort('ultra')).toBe(true);
        expect(isReasoningEffort('future-provider-effort')).toBe(true);
    });

    it('resolves semantic max to the selected model\'s highest advertised effort', () => {
        expect(resolveCodexReasoningEffort('max', 'gpt-test', [
            model(['low', 'high', 'xhigh']),
        ])).toBe('xhigh');
        expect(resolveCodexReasoningEffort('max', 'gpt-test', [
            model(['low', 'high', 'max']),
        ])).toBe('max');
        expect(resolveCodexReasoningEffort('high', 'gpt-test', [
            model(['low', 'high', 'xhigh']),
        ])).toBe('high');
    });

    it('uses the provider default model when no model is selected explicitly', () => {
        expect(resolveCodexReasoningEffort(undefined, undefined, [
            { ...model(['low', 'high']), id: 'other', model: 'other', isDefault: false },
            model(['low', 'high', 'xhigh']),
        ])).toBe('xhigh');
    });

    it('leaves max intact when the selected model has no advertised catalog entry', () => {
        expect(resolveCodexReasoningEffort('max', 'unknown-model', [
            model(['low', 'high', 'xhigh']),
        ])).toBe('max');
    });

    it('rejects malformed effort overrides', () => {
        expect(isReasoningEffort('')).toBe(false);
        expect(isReasoningEffort('   ')).toBe(false);
        expect(isReasoningEffort(null)).toBe(false);
        expect(isReasoningEffort(42)).toBe(false);
    });
});
