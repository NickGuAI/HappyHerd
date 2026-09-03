import { describe, expect, it } from 'vitest';
import {
    acpPromptUsageTokens,
    acpPromptUsageSnapshot,
    acpUsdCost,
    claudeModelUsageSnapshot,
    codexUsageIncrement,
    codexUsageReportKey,
    codexUsageSnapshot,
    cumulativeCostDelta,
    usageCounterDelta,
    usageReportKey,
    usageTokens,
} from './providerUsage';

describe('provider usage normalization', () => {
    it('diffs cumulative Claude model usage without re-counting prior turns', () => {
        const first = claudeModelUsageSnapshot({
            inputTokens: 10,
            outputTokens: 5,
            cacheCreationInputTokens: 2,
            cacheReadInputTokens: 20,
            costUSD: 0.12,
        });
        const second = claudeModelUsageSnapshot({
            inputTokens: 14,
            outputTokens: 8,
            cacheCreationInputTokens: 2,
            cacheReadInputTokens: 35,
            costUSD: 0.2,
        });

        expect(usageTokens(usageCounterDelta(second.tokens, first.tokens))).toEqual({
            total: 22,
            input: 4,
            output: 3,
            cache_creation: 0,
            cache_read: 15,
        });
        expect(cumulativeCostDelta(second.costUsd!, first.costUsd)).toBeCloseTo(0.08);
    });

    it('treats a decreasing cumulative counter as a provider reset', () => {
        expect(usageCounterDelta(
            { total: 9, input: 4, output: 2, cacheCreation: 1, cacheRead: 2, reasoning: 0 },
            { total: 90, input: 40, output: 20, cacheCreation: 10, cacheRead: 20, reasoning: 0 },
        )).toEqual({ total: 9, input: 4, output: 2, cacheCreation: 1, cacheRead: 2, reasoning: 0 });
        expect(cumulativeCostDelta(0.25, 2)).toBe(0.25);
    });

    it('does not re-count a cumulative total when an optional category disappears', () => {
        expect(usageCounterDelta(
            { total: 120, input: 90, output: 30, cacheCreation: 0, cacheRead: 0, reasoning: 0 },
            { total: 100, input: 70, output: 20, cacheCreation: 0, cacheRead: 10, reasoning: 5 },
        )).toEqual({
            total: 20,
            input: 20,
            output: 10,
            cacheCreation: 0,
            cacheRead: 0,
            reasoning: 0,
        });
    });

    it('preserves the Codex provider total while separating cached input', () => {
        expect(codexUsageSnapshot({
            total: {
                totalTokens: 1_200,
                inputTokens: 1_000,
                cachedInputTokens: 600,
                cacheWriteInputTokens: 50,
                outputTokens: 200,
                reasoningOutputTokens: 25,
            },
        })).toEqual({
            total: 1_200,
            input: 350,
            output: 200,
            cacheCreation: 50,
            cacheRead: 600,
            reasoning: 25,
        });
    });

    it('uses Codex turn usage without importing a forked thread total', () => {
        expect(codexUsageSnapshot({
            total: { totalTokens: 1_100, inputTokens: 1_000, outputTokens: 100 },
            last: { totalTokens: 100, inputTokens: 80, outputTokens: 20 },
        }, 'last')).toEqual({
            total: 100,
            input: 80,
            output: 20,
            cacheCreation: 0,
            cacheRead: 0,
            reasoning: 0,
        });
    });

    it('counts every Codex model response in a tool loop and makes replay idempotent', () => {
        const firstMessage = {
            total: { totalTokens: 1_100, inputTokens: 1_080, outputTokens: 20 },
            last: { totalTokens: 100, inputTokens: 80, outputTokens: 20 },
        };
        const first = codexUsageIncrement(firstMessage);
        expect(first?.increment.total).toBe(100);

        const secondMessage = {
            total: { totalTokens: 1_250, inputTokens: 1_200, outputTokens: 50 },
            last: { totalTokens: 150, inputTokens: 120, outputTokens: 30 },
        };
        const second = codexUsageIncrement(secondMessage, first?.cumulative);
        expect(second?.increment.total).toBe(150);
        expect(first!.increment.total + second!.increment.total).toBe(250);

        expect(codexUsageReportKey('thread-1', 'turn-1', second!.cumulative))
            .toBe(codexUsageReportKey('thread-1', 'turn-1', codexUsageIncrement(secondMessage)!.cumulative));
        expect(codexUsageIncrement(secondMessage, second?.cumulative)).toBeUndefined();
        expect(codexUsageIncrement(secondMessage)?.increment.total).toBe(150);
    });

    it('uses ACP prompt totals and accepts only explicitly reported USD cost', () => {
        expect(acpPromptUsageTokens({
            totalTokens: 36,
            inputTokens: 10,
            outputTokens: 4,
            cachedReadTokens: 20,
            cachedWriteTokens: 2,
        })).toEqual({
            total: 36,
            input: 10,
            output: 4,
            cache_creation: 2,
            cache_read: 20,
        });
        expect(acpUsdCost({ amount: 1.25, currency: 'usd' })).toBe(1.25);
        expect(acpUsdCost({ amount: 1.25, currency: 'EUR' })).toBeUndefined();
    });

    it('keeps ACP prompt usage as a complete current-prompt total', () => {
        const second = acpPromptUsageSnapshot({ totalTokens: 145, inputTokens: 110, outputTokens: 35 });
        expect(usageTokens(second!)).toEqual({
            total: 145,
            input: 110,
            output: 35,
            cache_creation: 0,
            cache_read: 0,
        });
    });

    it('builds byte-stable event keys from provider identifiers', () => {
        expect(usageReportKey(['codex', 'thread/a', 'turn 1', 100, 150]))
            .toBe('usage-v2:codex:thread%2Fa:turn%201:100:150');
    });
});
