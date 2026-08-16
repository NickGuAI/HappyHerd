import { describe, expect, it } from 'vitest';

import {
    HAPPYHERD_CLAUDE_MODEL_SLUGS,
    HAPPYHERD_DEFAULT_CLAUDE_MODEL_SLUG,
    normalizeHappyHerdClaudeModelSlug,
} from './providerModels';

describe('HappyHerd provider model catalog', () => {
    it('contains only canonical Claude model slugs', () => {
        expect(HAPPYHERD_CLAUDE_MODEL_SLUGS).toEqual([
            'claude-fable-5',
            'claude-opus-5',
            'claude-opus-4-8',
            'claude-opus-4-6',
            'claude-sonnet-5',
            'claude-haiku-4-5',
        ]);
        expect(HAPPYHERD_CLAUDE_MODEL_SLUGS.every((slug) => /^claude-[a-z]+-\d(?:-\d+)?$/.test(slug))).toBe(true);
        expect(HAPPYHERD_CLAUDE_MODEL_SLUGS).toContain(HAPPYHERD_DEFAULT_CLAUDE_MODEL_SLUG);
    });

    it('normalizes persisted aliases without advertising them', () => {
        expect(normalizeHappyHerdClaudeModelSlug('opus')).toBe('claude-opus-5');
        expect(normalizeHappyHerdClaudeModelSlug('claude-opus-4-6')).toBe('claude-opus-4-6');
    });
});
