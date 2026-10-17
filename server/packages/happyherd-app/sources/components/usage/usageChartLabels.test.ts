import { describe, expect, it } from 'vitest';
import { formatUsageChartLabel } from './usageChartLabels';

describe('formatUsageChartLabel', () => {
    it('labels daily buckets as dates even when the bucket is today at midnight', () => {
        const midnight = new Date(2026, 9, 17).getTime() / 1000;

        expect(formatUsageChartLabel(midnight, 'day')).toBe('Oct 17');
    });

    it('keeps today hourly buckets labeled as times', () => {
        const midnight = new Date(2026, 9, 17).getTime() / 1000;

        expect(formatUsageChartLabel(midnight, 'hour')).toBe('12 AM');
    });
});
