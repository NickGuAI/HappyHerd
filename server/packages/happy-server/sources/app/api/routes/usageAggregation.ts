export type UsageCoverageStatus = 'reported' | 'partial' | 'unavailable';

export type UsageCoverage = {
    provider: string;
    tokens: UsageCoverageStatus;
    cost: UsageCoverageStatus;
    limitations: string[];
    costBasis: string[];
};

export type UsageReportForAggregation = {
    id: string;
    key: string;
    createdAt: Date;
    data: PrismaJson.UsageReportData;
};

type CoverageAccumulator = {
    tokenReports: number;
    tokenGaps: number;
    costReports: number;
    costGaps: number;
    limitations: Set<string>;
    costBasis: Set<string>;
};

const REQUIRED_USAGE_PROVIDERS = ['claude', 'codex', 'grok', 'dsh'] as const;

function emptyCoverageAccumulator(): CoverageAccumulator {
    return {
        tokenReports: 0,
        tokenGaps: 0,
        costReports: 0,
        costGaps: 0,
        limitations: new Set<string>(),
        costBasis: new Set<string>(),
    };
}

function validTotal(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function providerForReport(report: UsageReportForAggregation): string {
    const explicit = report.data.provider?.trim();
    if (explicit) return explicit;
    return report.key.startsWith('claude') ? 'claude' : 'legacy';
}

function coverageStatus(reported: number, gaps: number): UsageCoverageStatus {
    if (reported > 0 && gaps > 0) return 'partial';
    if (reported > 0) return 'reported';
    return 'unavailable';
}

export function usageReportOccurredAt(report: UsageReportForAggregation): Date {
    const occurredAt = report.data.occurredAt;
    return typeof occurredAt === 'number' && Number.isInteger(occurredAt) && occurredAt > 0
        ? new Date(occurredAt)
        : new Date(report.createdAt);
}

function hasImmutableOccurrenceTime(report: UsageReportForAggregation): boolean {
    const occurredAt = report.data.occurredAt;
    return typeof occurredAt === 'number' && Number.isInteger(occurredAt) && occurredAt > 0;
}

export function filterUsageReportsByPeriod(
    reports: UsageReportForAggregation[],
    startTime?: number | null,
    endTime?: number | null,
): UsageReportForAggregation[] {
    const startMs = startTime ? startTime * 1000 : Number.NEGATIVE_INFINITY;
    // The public route accepts integer epoch seconds, so an inclusive end
    // covers the whole encoded second rather than only its first millisecond.
    const endMs = endTime ? endTime * 1000 + 999 : Number.POSITIVE_INFINITY;
    return reports.filter((report) => {
        const occurredAt = usageReportOccurredAt(report).getTime();
        return occurredAt >= startMs && occurredAt <= endMs;
    });
}

export function aggregateUsageReports(
    reports: UsageReportForAggregation[],
    groupBy: 'hour' | 'day',
): { usage: Array<{ timestamp: number; tokens: Record<string, number>; cost: Record<string, number>; reportCount: number }>; coverage: UsageCoverage[] } {
    const aggregated = new Map<string, {
        tokens: Record<string, number>;
        cost: Record<string, number>;
        count: number;
        timestamp: number;
    }>();
    // Coverage must name every provider in the task contract even when a
    // selected period contains no report for it. Otherwise an absent emitter
    // disappears from the response and the UI can present an under-count as a
    // complete total.
    const coverageByProvider = new Map<string, CoverageAccumulator>(
        REQUIRED_USAGE_PROVIDERS.map((provider) => [provider, emptyCoverageAccumulator()]),
    );
    const seenReportIds = new Set<string>();

    for (const report of reports) {
        if (seenReportIds.has(report.id)) continue;
        seenReportIds.add(report.id);

        const provider = providerForReport(report);
        const legacySnapshot = !report.data.provider;
        const legacyOccurrenceTime = !hasImmutableOccurrenceTime(report);
        const breakdownKey = provider;
        const tokensAvailable = report.data.tokensAvailable !== false;
        const costAvailable = report.data.costAvailable !== false;
        const tokenTotal = tokensAvailable ? validTotal(report.data.tokens?.total) : 0;
        const costTotal = costAvailable ? validTotal(report.data.cost?.total) : 0;
        const date = usageReportOccurredAt(report);
        const bucketDate = groupBy === 'hour'
            ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), 0, 0, 0)
            : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
        const timestamp = Math.floor(bucketDate.getTime() / 1000);
        const bucketKey = timestamp.toString();
        const bucket = aggregated.get(bucketKey) ?? {
            tokens: { total: 0 },
            cost: { total: 0 },
            count: 0,
            timestamp,
        };
        bucket.count++;
        bucket.tokens.total += tokenTotal;
        bucket.cost.total += costTotal;
        if (tokensAvailable) {
            bucket.tokens[breakdownKey] = (bucket.tokens[breakdownKey] ?? 0) + tokenTotal;
        }
        if (costAvailable) {
            bucket.cost[breakdownKey] = (bucket.cost[breakdownKey] ?? 0) + costTotal;
        }
        aggregated.set(bucketKey, bucket);

        const providerCoverage = coverageByProvider.get(provider) ?? emptyCoverageAccumulator();
        if (tokensAvailable) providerCoverage.tokenReports++;
        else providerCoverage.tokenGaps++;
        if (costAvailable) providerCoverage.costReports++;
        else providerCoverage.costGaps++;
        if (legacySnapshot) {
            providerCoverage.tokenGaps++;
            providerCoverage.costGaps++;
            providerCoverage.limitations.add('historical-snapshot-incomplete');
        }
        if (legacyOccurrenceTime) {
            providerCoverage.tokenGaps++;
            providerCoverage.costGaps++;
            providerCoverage.limitations.add('occurrence-time-unavailable');
        }
        if (report.data.costBasis) providerCoverage.costBasis.add(report.data.costBasis);
        for (const limitation of report.data.limitations ?? []) {
            if (typeof limitation === 'string' && limitation.length > 0) {
                providerCoverage.limitations.add(limitation);
            }
        }
        coverageByProvider.set(provider, providerCoverage);
    }

    return {
        usage: Array.from(aggregated.values()).sort((a, b) => a.timestamp - b.timestamp).map((bucket) => ({
            timestamp: bucket.timestamp,
            tokens: bucket.tokens,
            cost: bucket.cost,
            reportCount: bucket.count,
        })),
        coverage: Array.from(coverageByProvider.entries())
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([provider, value]) => ({
                provider,
                tokens: coverageStatus(value.tokenReports, value.tokenGaps),
                cost: coverageStatus(value.costReports, value.costGaps),
                limitations: Array.from(value.limitations).sort(),
                costBasis: Array.from(value.costBasis).sort(),
            })),
    };
}
