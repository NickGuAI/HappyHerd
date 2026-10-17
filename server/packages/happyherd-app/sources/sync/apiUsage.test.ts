import { describe, expect, it, vi } from 'vitest';
import { calculateTotals, getUsageForPeriod, queryUsage, usageMetricTotal, type UsageDataPoint } from './apiUsage';

vi.mock('./serverConfig', () => ({
    getServerUrl: () => 'https://api.example.test',
}));

vi.mock('./apiSocket', () => ({
    getHappyHerdClientId: () => 'happyherd-test',
}));

const point: UsageDataPoint = {
    timestamp: 1_700_000_000,
    tokens: { total: 17, claude: 10, codex: 7 },
    cost: { total: 0.25, claude: 0.25, codex: 0 },
    reportCount: 2,
};

describe('usage totals', () => {
    it('counts canonical totals once and keeps provider/model breakdowns separate', () => {
        expect(calculateTotals([point])).toEqual({
            totalTokens: 17,
            totalCost: 0.25,
            tokensByProvider: { claude: 10, codex: 7 },
            costByProvider: { claude: 0.25, codex: 0 },
        });
    });

    it('uses a legacy component sum only when no canonical total is present', () => {
        const legacy = { ...point, tokens: { input: 10, output: 7 } };
        expect(usageMetricTotal(legacy, 'tokens')).toBe(17);
    });
});

describe('usage query timezone', () => {
    it('sends the viewer timezone with day and hour usage queries', async () => {
        const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) => Response.json({ usage: [], coverage: [] }));
        vi.stubGlobal('fetch', fetchMock);
        try {
            await getUsageForPeriod({ token: 'token-1' } as any, '7days');
            await getUsageForPeriod({ token: 'token-1' } as any, 'today');
            await queryUsage({ token: 'token-1' } as any, { groupBy: 'day' });
            await queryUsage({ token: 'token-1' } as any, { groupBy: 'day', timeZone: 'Asia/Tokyo' });
        } finally {
            vi.unstubAllGlobals();
        }

        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({ groupBy: 'day', timeZone });
        expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toMatchObject({ groupBy: 'hour', timeZone });
        expect(JSON.parse(fetchMock.mock.calls[2][1]!.body as string)).toMatchObject({ groupBy: 'day', timeZone });
        expect(JSON.parse(fetchMock.mock.calls[3][1]!.body as string)).toMatchObject({ groupBy: 'day', timeZone: 'Asia/Tokyo' });
    });
});
