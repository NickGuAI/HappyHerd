import { describe, expect, it } from 'vitest';
import { preserveUsageOccurrenceTime, usageSessionMatchesSocketScope, validateUsagePayload } from './usageHandler';

describe('validateUsagePayload', () => {
    const valid = {
        key: 'usage-v2:codex:thread:turn',
        sessionId: 'session-1',
        provider: 'codex',
        model: 'gpt-5',
        source: 'codex-thread-token-usage',
        occurredAt: 1_788_436_800_000,
        tokens: { total: 17, input: 10, output: 7 },
        cost: { total: 0 },
        costBasis: 'unavailable',
        tokensAvailable: true,
        costAvailable: false,
        limitations: ['cost-not-reported-by-provider'],
    };

    it('retains provider metadata and canonical numeric totals', () => {
        expect(validateUsagePayload(valid)).toEqual({
            success: true,
            value: {
                key: valid.key,
                sessionId: valid.sessionId,
                usageData: {
                    provider: 'codex',
                    model: 'gpt-5',
                    source: 'codex-thread-token-usage',
                    occurredAt: 1_788_436_800_000,
                    tokens: { total: 17, input: 10, output: 7 },
                    cost: { total: 0 },
                    costBasis: 'unavailable',
                    tokensAvailable: true,
                    costAvailable: false,
                    limitations: ['cost-not-reported-by-provider'],
                },
            },
        });
    });

    it.each([
        [{ ...valid, tokens: { total: Number.NaN } }, 'Invalid tokens object'],
        [{ ...valid, tokens: { total: -1 } }, 'Invalid tokens object'],
        [{ ...valid, tokens: { total: 1.5 } }, 'Invalid tokens object'],
        [{ ...valid, cost: { total: Number.POSITIVE_INFINITY } }, 'Invalid cost object'],
        [{ ...valid, provider: 'unknown' }, 'Invalid provider'],
        [{ ...valid, occurredAt: 0 }, 'Invalid occurredAt'],
        [{ ...valid, occurredAt: 1.5 }, 'Invalid occurredAt'],
        [{ ...valid, costBasis: 'guessed' }, 'Invalid costBasis'],
        [{ ...valid, costAvailable: false, cost: { total: 1 } }, 'Unavailable cost must be zero'],
        [{ ...valid, tokensAvailable: false, tokens: { total: 0, input: 1 } }, 'Unavailable tokens must be zero'],
        [{ ...valid, costAvailable: false, costBasis: 'provider-reported' }, 'Unavailable cost must use unavailable basis'],
        [{ ...valid, costAvailable: true, costBasis: 'unavailable' }, 'Available cost must use a reported or estimated basis'],
    ])('rejects malformed input %#', (payload, error) => {
        expect(validateUsagePayload(payload)).toEqual({ success: false, error });
    });

    it('binds a session-scoped socket to its own usage session', () => {
        expect(usageSessionMatchesSocketScope('session-1', 'session-1')).toBe(true);
        expect(usageSessionMatchesSocketScope('session-2', 'session-1')).toBe(false);
        expect(usageSessionMatchesSocketScope('session-2')).toBe(true);
    });

    it('preserves the original occurrence time when an idempotent key is retried later', () => {
        const validated = validateUsagePayload(valid);
        expect(validated.success).toBe(true);
        if (!validated.success) return;
        expect(preserveUsageOccurrenceTime(
            { ...validated.value.usageData, occurredAt: valid.occurredAt + 60_000 },
            { data: validated.value.usageData, createdAt: new Date(valid.occurredAt + 120_000) },
        ).occurredAt).toBe(valid.occurredAt);
        expect(preserveUsageOccurrenceTime(
            validated.value.usageData,
            { data: { ...validated.value.usageData, occurredAt: undefined }, createdAt: new Date(valid.occurredAt - 60_000) },
        ).occurredAt).toBe(valid.occurredAt - 60_000);
    });
});
