export type SupportedUsageProvider = 'claude' | 'codex' | 'grok' | 'dsh';

export type UsageTokenTotals = {
    total: number;
    input: number;
    output: number;
    cache_creation: number;
    cache_read: number;
    reasoning?: number;
};

export type UsageCounterSnapshot = {
    total: number;
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
    reasoning: number;
};

export type ProviderUsageReport = {
    key: string;
    provider: SupportedUsageProvider;
    model: string | null;
    source: string;
    occurredAt: number;
    tokens: UsageTokenTotals;
    cost: { total: number };
    costBasis: 'provider-reported' | 'provider-estimate' | 'unavailable';
    tokensAvailable: boolean;
    costAvailable: boolean;
    limitations: string[];
};

export type ClaudeModelUsageLike = {
    inputTokens?: unknown;
    outputTokens?: unknown;
    cacheCreationInputTokens?: unknown;
    cacheReadInputTokens?: unknown;
    costUSD?: unknown;
};

export type AcpPromptUsageLike = {
    totalTokens?: unknown;
    inputTokens?: unknown;
    outputTokens?: unknown;
    cachedWriteTokens?: unknown;
    cachedReadTokens?: unknown;
    thoughtTokens?: unknown;
};

export type AcpCostLike = {
    amount?: unknown;
    currency?: unknown;
};

const EMPTY_COUNTERS: UsageCounterSnapshot = {
    total: 0,
    input: 0,
    output: 0,
    cacheCreation: 0,
    cacheRead: 0,
    reasoning: 0,
};

function finiteNonNegative(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? value
        : undefined;
}

function count(value: unknown): number {
    const normalized = finiteNonNegative(value);
    return normalized === undefined ? 0 : Math.trunc(normalized);
}

function counterReset(current: UsageCounterSnapshot, previous: UsageCounterSnapshot): boolean {
    return current.total < previous.total;
}

export function usageCounterDelta(
    current: UsageCounterSnapshot,
    previous?: UsageCounterSnapshot,
): UsageCounterSnapshot {
    const baseline = previous && !counterReset(current, previous) ? previous : EMPTY_COUNTERS;
    return {
        total: current.total - baseline.total,
        input: Math.max(0, current.input - baseline.input),
        output: Math.max(0, current.output - baseline.output),
        cacheCreation: Math.max(0, current.cacheCreation - baseline.cacheCreation),
        cacheRead: Math.max(0, current.cacheRead - baseline.cacheRead),
        reasoning: Math.max(0, current.reasoning - baseline.reasoning),
    };
}

export function usageTokens(snapshot: UsageCounterSnapshot): UsageTokenTotals {
    return {
        total: snapshot.total,
        input: snapshot.input,
        output: snapshot.output,
        cache_creation: snapshot.cacheCreation,
        cache_read: snapshot.cacheRead,
        ...(snapshot.reasoning > 0 ? { reasoning: snapshot.reasoning } : {}),
    };
}

export function claudeModelUsageSnapshot(usage: ClaudeModelUsageLike): {
    tokens: UsageCounterSnapshot;
    costUsd: number | undefined;
} {
    const input = count(usage.inputTokens);
    const output = count(usage.outputTokens);
    const cacheCreation = count(usage.cacheCreationInputTokens);
    const cacheRead = count(usage.cacheReadInputTokens);
    return {
        tokens: {
            total: input + output + cacheCreation + cacheRead,
            input,
            output,
            cacheCreation,
            cacheRead,
            reasoning: 0,
        },
        costUsd: finiteNonNegative(usage.costUSD),
    };
}

export function codexUsageSnapshot(
    message: Record<string, unknown>,
    field: 'total' | 'last' = 'total',
): UsageCounterSnapshot | undefined {
    const total = message[field];
    if (!total || typeof total !== 'object' || Array.isArray(total)) {
        return undefined;
    }
    const source = total as Record<string, unknown>;
    const totalTokens = finiteNonNegative(source.totalTokens);
    const inputTokens = finiteNonNegative(source.inputTokens);
    const outputTokens = finiteNonNegative(source.outputTokens);
    if (totalTokens === undefined || inputTokens === undefined || outputTokens === undefined) {
        return undefined;
    }
    const cacheRead = count(source.cachedInputTokens);
    const cacheCreation = count(source.cacheWriteInputTokens);
    return {
        total: Math.trunc(totalTokens),
        input: Math.max(0, Math.trunc(inputTokens) - cacheRead - cacheCreation),
        output: Math.trunc(outputTokens),
        cacheCreation,
        cacheRead,
        reasoning: count(source.reasoningOutputTokens),
    };
}

export function codexUsageIncrement(
    message: Record<string, unknown>,
    previous?: UsageCounterSnapshot,
): { cumulative: UsageCounterSnapshot; increment: UsageCounterSnapshot } | undefined {
    const cumulative = codexUsageSnapshot(message, 'total');
    const latestResponse = codexUsageSnapshot(message, 'last');
    if (!cumulative || !latestResponse) return undefined;
    if (previous
        && cumulative.total === previous.total
        && cumulative.input === previous.input
        && cumulative.output === previous.output
        && cumulative.cacheCreation === previous.cacheCreation
        && cumulative.cacheRead === previous.cacheRead
        && cumulative.reasoning === previous.reasoning) {
        return undefined;
    }
    return {
        cumulative,
        increment: previous && cumulative.total >= previous.total
            ? usageCounterDelta(cumulative, previous)
            : latestResponse,
    };
}

export function codexUsageReportKey(
    threadId: string,
    turnId: string,
    cumulative: UsageCounterSnapshot,
): string {
    return usageReportKey([
        'codex',
        threadId,
        turnId,
        'snapshot',
        cumulative.total,
        cumulative.input,
        cumulative.output,
        cumulative.cacheCreation,
        cumulative.cacheRead,
        cumulative.reasoning,
    ]);
}

export function acpPromptUsageSnapshot(
    usage: AcpPromptUsageLike | null | undefined,
): UsageCounterSnapshot | undefined {
    if (!usage || typeof usage !== 'object') {
        return undefined;
    }
    const total = finiteNonNegative(usage.totalTokens);
    const input = finiteNonNegative(usage.inputTokens);
    const output = finiteNonNegative(usage.outputTokens);
    if (total === undefined || input === undefined || output === undefined) {
        return undefined;
    }
    const thought = count(usage.thoughtTokens);
    return {
        total: Math.trunc(total),
        input: Math.trunc(input),
        output: Math.trunc(output),
        cacheCreation: count(usage.cachedWriteTokens),
        cacheRead: count(usage.cachedReadTokens),
        reasoning: thought,
    };
}

export function acpPromptUsageTokens(usage: AcpPromptUsageLike | null | undefined): UsageTokenTotals | undefined {
    const snapshot = acpPromptUsageSnapshot(usage);
    return snapshot ? usageTokens(snapshot) : undefined;
}

export function acpUsdCost(cost: AcpCostLike | null | undefined): number | undefined {
    if (!cost || typeof cost !== 'object') {
        return undefined;
    }
    const currency = typeof cost.currency === 'string' ? cost.currency.toUpperCase() : '';
    if (currency !== 'USD') {
        return undefined;
    }
    return finiteNonNegative(cost.amount);
}

export function cumulativeCostDelta(current: number, previous?: number): number {
    if (previous === undefined || current < previous) {
        return current;
    }
    return current - previous;
}

export function emptyUsageTokens(): UsageTokenTotals {
    return usageTokens(EMPTY_COUNTERS);
}

export function usageReportKey(parts: Array<string | number>): string {
    return ['usage-v2', ...parts.map((part) => encodeURIComponent(String(part)))].join(':');
}
