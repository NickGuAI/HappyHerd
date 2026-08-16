import { describe, expect, it } from 'vitest';

import { isReasoningEffort } from './reasoningEffort';

describe('isReasoningEffort', () => {
    it('accepts provider-advertised effort values without a CLI release', () => {
        expect(isReasoningEffort('ultra')).toBe(true);
        expect(isReasoningEffort('future-provider-effort')).toBe(true);
    });

    it('rejects malformed effort overrides', () => {
        expect(isReasoningEffort('')).toBe(false);
        expect(isReasoningEffort('   ')).toBe(false);
        expect(isReasoningEffort(null)).toBe(false);
        expect(isReasoningEffort(42)).toBe(false);
    });
});
