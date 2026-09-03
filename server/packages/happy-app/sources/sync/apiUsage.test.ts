import { describe, expect, it, vi } from 'vitest';
import { calculateTotals, usageMetricTotal, type UsageDataPoint } from './apiUsage';

vi.mock('./serverConfig', () => ({
    getServerUrl: () => 'https://api.example.test',
}));

vi.mock('./apiSocket', () => ({
    getHappyClientId: () => 'happy-test',
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
