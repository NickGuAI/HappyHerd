import { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { getServerUrl } from './serverConfig';
import { getHappyClientId } from './apiSocket';

export interface UsageDataPoint {
    timestamp: number;
    tokens: Record<string, number>;
    cost: Record<string, number>;
    reportCount: number;
}

export interface UsageQueryParams {
    sessionId?: string;
    startTime?: number; // Unix timestamp in seconds
    endTime?: number;   // Unix timestamp in seconds
    groupBy?: 'hour' | 'day';
}

export type UsageCoverageStatus = 'reported' | 'partial' | 'unavailable';

export interface UsageCoverage {
    provider: string;
    tokens: UsageCoverageStatus;
    cost: UsageCoverageStatus;
    limitations: string[];
    costBasis: string[];
}

export interface UsageResponse {
    usage: UsageDataPoint[];
    coverage?: UsageCoverage[];
}

/**
 * Query usage data from the server
 */
export async function queryUsage(
    credentials: AuthCredentials,
    params: UsageQueryParams = {}
): Promise<UsageResponse> {
    const API_ENDPOINT = getServerUrl();
    
    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/usage/query`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json',
                'X-Happy-Client': getHappyClientId(),
            },
            body: JSON.stringify(params)
        });

        if (!response.ok) {
            if (response.status === 404 && params.sessionId) {
                throw new Error('Session not found');
            }
            throw new Error(`Failed to query usage: ${response.status}`);
        }

        const data = await response.json() as UsageResponse;
        return data;
    });
}

/**
 * Helper function to get usage for a specific time period
 */
export async function getUsageForPeriod(
    credentials: AuthCredentials,
    period: 'today' | '7days' | '30days',
    sessionId?: string
): Promise<UsageResponse> {
    const now = Math.floor(Date.now() / 1000);
    const oneDaySeconds = 24 * 60 * 60;
    
    let startTime: number;
    let groupBy: 'hour' | 'day';
    
    switch (period) {
        case 'today':
            // Start of today (local timezone)
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            startTime = Math.floor(today.getTime() / 1000);
            groupBy = 'hour';
            break;
        case '7days':
            startTime = now - (7 * oneDaySeconds);
            groupBy = 'day';
            break;
        case '30days':
            startTime = now - (30 * oneDaySeconds);
            groupBy = 'day';
            break;
    }
    
    return queryUsage(credentials, {
        sessionId,
        startTime,
        endTime: now,
        groupBy
    });
}

/**
 * Calculate total tokens and cost from usage data
 */
export function calculateTotals(usage: UsageDataPoint[]): {
    totalTokens: number;
    totalCost: number;
    tokensByProvider: Record<string, number>;
    costByProvider: Record<string, number>;
} {
    const result = {
        totalTokens: 0,
        totalCost: 0,
        tokensByProvider: {} as Record<string, number>,
        costByProvider: {} as Record<string, number>
    };
    
    for (const dataPoint of usage) {
        result.totalTokens += usageMetricTotal(dataPoint, 'tokens');
        for (const [provider, tokens] of Object.entries(dataPoint.tokens)) {
            if (provider !== 'total' && typeof tokens === 'number') {
                result.tokensByProvider[provider] = (result.tokensByProvider[provider] || 0) + tokens;
            }
        }

        result.totalCost += usageMetricTotal(dataPoint, 'cost');
        for (const [provider, cost] of Object.entries(dataPoint.cost)) {
            if (provider !== 'total' && typeof cost === 'number') {
                result.costByProvider[provider] = (result.costByProvider[provider] || 0) + cost;
            }
        }
    }
    
    return result;
}

export function usageMetricTotal(
    point: UsageDataPoint,
    metric: 'tokens' | 'cost',
): number {
    const values = point[metric];
    if (typeof values.total === 'number' && Number.isFinite(values.total)) {
        return values.total;
    }
    return Object.values(values).reduce(
        (sum, value) => sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0),
        0,
    );
}
