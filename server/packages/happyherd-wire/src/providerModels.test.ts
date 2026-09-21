import { describe, expect, it } from 'vitest';

import {
    HAPPYHERD_AGY_MODEL_NAMES,
    HAPPYHERD_AGY_EFFORTS,
    HAPPYHERD_CLAUDE_MODEL_CONTEXT_WINDOWS,
    HAPPYHERD_DEFAULT_AGY_MODEL,
    HAPPYHERD_DEFAULT_AGY_EFFORT,
    HAPPYHERD_CLAUDE_MODEL_SLUGS,
    HAPPYHERD_DEFAULT_CLAUDE_MODEL_SLUG,
    normalizeHappyHerdClaudeModelSlug,
} from './providerModels';

describe('HappyHerd provider model catalog', () => {
    it('contains only canonical Claude model slugs', () => {
        expect(HAPPYHERD_CLAUDE_MODEL_SLUGS).toEqual([
            'claude-fable-5-1',
            'claude-fable-5',
            'claude-opus-5',
            'claude-opus-5[1m]',
            'claude-opus-4-8',
            'claude-opus-4-6',
            'claude-sonnet-5',
            'claude-haiku-4-5',
        ]);
        expect(HAPPYHERD_CLAUDE_MODEL_SLUGS.every((slug) => /^claude-[a-z]+-\d(?:-\d+)?(?:\[1m\])?$/.test(slug))).toBe(true);
        expect(HAPPYHERD_DEFAULT_CLAUDE_MODEL_SLUG).toBe('claude-opus-5');
        expect(HAPPYHERD_CLAUDE_MODEL_CONTEXT_WINDOWS['claude-fable-5-1']).toBe(1_000_000);
    });

    it('normalizes persisted aliases without advertising them', () => {
        expect(normalizeHappyHerdClaudeModelSlug('opus')).toBe('claude-opus-5');
        expect(normalizeHappyHerdClaudeModelSlug('claude-opus-4-6')).toBe('claude-opus-4-6');
    });

    it('keeps the four Antigravity logical model choices in one launch-and-UI catalog', () => {
        expect(HAPPYHERD_AGY_EFFORTS).toEqual(['low', 'medium', 'high']);
        expect(HAPPYHERD_DEFAULT_AGY_EFFORT).toBe('medium');
        expect(HAPPYHERD_DEFAULT_AGY_MODEL).toBe('Gemini 3.8 Flash');
        expect(HAPPYHERD_AGY_MODEL_NAMES).toEqual([
            'Gemini 3.8 Flash',
            'Claude Sonnet 4.6 (Thinking)',
            'Claude Opus 4.6 (Thinking)',
            'GPT-OSS 120B (Medium)',
        ]);
    });

});
