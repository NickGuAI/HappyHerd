import { describe, expect, it } from 'vitest';
import { aggregateUsageReports, filterUsageReportsByPeriod } from './usageAggregation';

function report(
    id: string,
    provider: string | undefined,
    model: string | null,
    tokens: number,
    cost: number,
    availability: { tokens?: boolean; cost?: boolean } = {},
) {
    const createdAt = new Date('2026-09-03T12:30:00.000Z');
    return {
        id,
        key: provider ? `usage-v2:${provider}:${id}` : 'claude-session',
        createdAt,
        data: {
            ...(provider ? { provider } : {}),
            model,
            source: provider ? 'provider-native' : undefined,
            occurredAt: createdAt.getTime(),
            costBasis: availability.cost === false ? 'unavailable' : 'provider-reported',
            tokens: { total: tokens, input: tokens - 1, output: 1 },
            cost: { total: cost, input: cost },
            tokensAvailable: availability.tokens,
            costAvailable: availability.cost,
            limitations: availability.cost === false ? ['cost-not-reported-by-provider'] : [],
        },
    } as unknown as Parameters<typeof aggregateUsageReports>[0][number];
}

describe('aggregateUsageReports', () => {
    it('sums only canonical totals and makes the provider breakdown reconcile', () => {
        const result = aggregateUsageReports([
            report('1', 'claude', 'claude-sonnet', 100, 0.1),
            report('2', 'codex', 'gpt-5.6-sol', 250, 0, { cost: false }),
        ], 'day');

        expect(result.usage).toEqual([expect.objectContaining({
            tokens: {
                total: 350,
                claude: 100,
                codex: 250,
            },
            cost: {
                total: 0.1,
                claude: 0.1,
            },
            reportCount: 2,
        })]);
        expect(result.coverage).toEqual([
            { provider: 'claude', tokens: 'reported', cost: 'reported', limitations: [], costBasis: ['provider-reported'] },
            { provider: 'codex', tokens: 'reported', cost: 'unavailable', limitations: ['cost-not-reported-by-provider'], costBasis: ['unavailable'] },
        ]);
    });

    it('does not double-count a duplicate event id and uses legacy total fields once', () => {
        const legacy = report('legacy', undefined, null, 30, 0.03);
        delete legacy.data.occurredAt;
        const result = aggregateUsageReports([legacy, legacy], 'hour');

        expect(result.usage[0]).toMatchObject({
            tokens: { total: 30, claude: 30 },
            cost: { total: 0.03, claude: 0.03 },
            reportCount: 1,
        });
        expect(result.coverage).toEqual([{
            provider: 'claude',
            tokens: 'partial',
            cost: 'partial',
            limitations: ['historical-snapshot-incomplete', 'occurrence-time-unavailable'],
            costBasis: ['provider-reported'],
        }]);
    });

    it('filters and buckets a delayed retry by immutable event time', () => {
        const delayed = report('delayed', 'codex', 'gpt-5.6-sol', 75, 0, { cost: false });
        delayed.createdAt = new Date('2026-09-04T00:01:00.000Z');
        delayed.data.occurredAt = new Date('2026-09-03T23:59:59.500Z').getTime();

        const septemberThird = filterUsageReportsByPeriod(
            [delayed],
            new Date('2026-09-03T00:00:00.000Z').getTime() / 1000,
            Math.floor(new Date('2026-09-03T23:59:59.999Z').getTime() / 1000),
        );
        const septemberFourth = filterUsageReportsByPeriod(
            [delayed],
            new Date('2026-09-04T00:00:00.000Z').getTime() / 1000,
            undefined,
        );

        expect(septemberThird).toHaveLength(1);
        expect(septemberFourth).toHaveLength(0);
        expect(aggregateUsageReports(septemberThird, 'day').usage[0].timestamp)
            .toBe(new Date('2026-09-03T00:00:00.000Z').getTime() / 1000);
    });

    it('marks mixed provider reporting as partial without adding unavailable zeros', () => {
        const result = aggregateUsageReports([
            report('1', 'grok', 'grok-code', 40, 0.2),
            report('2', 'grok', 'grok-code', 0, 0, { tokens: false, cost: false }),
        ], 'day');

        expect(result.usage[0].tokens).toEqual({ total: 40, grok: 40 });
        expect(result.usage[0].cost).toEqual({ total: 0.2, grok: 0.2 });
        expect(result.coverage[0]).toMatchObject({ provider: 'grok', tokens: 'partial', cost: 'partial' });
    });

    it('reconciles all four provider paths exactly while naming unavailable metrics', () => {
        const claude = report('claude-turn', 'claude', 'claude-sonnet', 100, 0.1);
        claude.data.costBasis = 'provider-estimate';
        const result = aggregateUsageReports([
            claude,
            report('codex-turn', 'codex', 'gpt-5.6-sol', 200, 0, { cost: false }),
            report('grok-turn', 'grok', 'grok-code', 50, 0.02),
            report('dsh-turn', 'dsh', 'deepseek-chat', 0, 0, { tokens: false, cost: false }),
        ], 'day');

        const bucket = result.usage[0];
        expect(bucket.tokens.total).toBe(350);
        expect(Object.entries(bucket.tokens)
            .filter(([key]) => key !== 'total')
            .reduce((sum, [, value]) => sum + value, 0)).toBe(350);
        expect(bucket.cost.total).toBeCloseTo(0.12);
        expect(Object.entries(bucket.cost)
            .filter(([key]) => key !== 'total')
            .reduce((sum, [, value]) => sum + value, 0)).toBeCloseTo(0.12);
        expect(result.coverage).toEqual(expect.arrayContaining([
            expect.objectContaining({ provider: 'claude', tokens: 'reported', cost: 'reported', costBasis: ['provider-estimate'] }),
            expect.objectContaining({ provider: 'codex', tokens: 'reported', cost: 'unavailable' }),
            expect.objectContaining({ provider: 'grok', tokens: 'reported', cost: 'reported' }),
            expect.objectContaining({ provider: 'dsh', tokens: 'unavailable', cost: 'unavailable' }),
        ]));
    });
});
