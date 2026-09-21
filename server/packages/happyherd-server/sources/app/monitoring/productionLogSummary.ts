import { isProduction, summary } from '@/utils/log';

export const PRODUCTION_LOG_WINDOW_MS = 30_000;

type RequestSample = {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
};

type RouteStats = {
    requests: number;
    errors: number;
    totalDurationMs: number;
    maxDurationMs: number;
};

type RpcSample = {
    method: string;
    result: string;
    durationMs: number;
};

type RpcMethodStats = {
    calls: number;
    successes: number;
    errors: number;
    timeouts: number;
    durationsMs: number[];
};

const AUTOMATIONS_PROFILE_METHODS = new Set([
    'happyherd-list-commanders',
    'happyherd-automations-list',
    'happyherd-automations-create',
    'happyherd-automations-update',
    'happyherd-automations-pause',
    'happyherd-automations-resume',
    'happyherd-automations-delete',
    'happyherd-automations-run-now',
    'happyherd-automations-history',
]);

function percentile(values: number[], fraction: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function oneLine(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

export function isTransactionTimeout(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } };
    if (candidate.code === 'P2028') return true;
    const message = `${oneLine(candidate.message)} ${oneLine(candidate.meta?.message)}`;
    return /transaction (already closed|.*expired)|expired transaction|interactive transaction.*timeout/i.test(message);
}

export class ProductionLogWindow {
    private startedAt: number;
    private requests = 0;
    private status2xx = 0;
    private status4xx = 0;
    private status5xx = 0;
    private errors = 0;
    private transactionTimeouts = 0;
    private slowRequests = 0;
    private totalDurationMs = 0;
    private maxDurationMs = 0;
    private durationsMs: number[] = [];
    private routes = new Map<string, RouteStats>();
    private rpcMethods = new Map<string, RpcMethodStats>();

    constructor(startedAt = Date.now()) {
        this.startedAt = startedAt;
    }

    recordRequest(sample: RequestSample): void {
        if (sample.route === '/health' && sample.statusCode < 500) return;

        this.requests += 1;
        if (sample.statusCode >= 500) this.status5xx += 1;
        else if (sample.statusCode >= 400) this.status4xx += 1;
        else if (sample.statusCode >= 200) this.status2xx += 1;

        this.totalDurationMs += sample.durationMs;
        this.maxDurationMs = Math.max(this.maxDurationMs, sample.durationMs);
        this.durationsMs.push(sample.durationMs);
        if (sample.durationMs >= 1_000) this.slowRequests += 1;

        const key = `${sample.method} ${sample.route}`;
        const route = this.routes.get(key) || { requests: 0, errors: 0, totalDurationMs: 0, maxDurationMs: 0 };
        route.requests += 1;
        if (sample.statusCode >= 500) route.errors += 1;
        route.totalDurationMs += sample.durationMs;
        route.maxDurationMs = Math.max(route.maxDurationMs, sample.durationMs);
        this.routes.set(key, route);
    }

    recordError(error: unknown): void {
        this.errors += 1;
        if (isTransactionTimeout(error)) this.transactionTimeouts += 1;
    }

    recordRpc(sample: RpcSample): void {
        if (!AUTOMATIONS_PROFILE_METHODS.has(sample.method)) return;

        const stats = this.rpcMethods.get(sample.method) || {
            calls: 0,
            successes: 0,
            errors: 0,
            timeouts: 0,
            durationsMs: [],
        };
        stats.calls += 1;
        if (sample.result === 'success') stats.successes += 1;
        else stats.errors += 1;
        if (sample.result === 'timeout') stats.timeouts += 1;
        stats.durationsMs.push(sample.durationMs);
        this.rpcMethods.set(sample.method, stats);
    }

    flush(now = Date.now()): string | null {
        const elapsedSeconds = Math.max(1, Math.round((now - this.startedAt) / 1_000));
        if (this.requests === 0 && this.errors === 0 && this.rpcMethods.size === 0) {
            this.reset(now);
            return null;
        }

        const averageMs = this.requests > 0 ? this.totalDurationMs / this.requests : 0;
        const topRoutes = [...this.routes.entries()]
            .sort((a, b) => b[1].requests - a[1].requests)
            .slice(0, 3)
            .map(([route, stats]) => {
                const avgMs = stats.totalDurationMs / stats.requests;
                return `${route}:${stats.requests}req/${stats.errors}err/${Math.round(avgMs)}ms`;
            })
            .join(',');

        const rpcTotals = [...this.rpcMethods.values()].reduce((totals, stats) => ({
            calls: totals.calls + stats.calls,
            errors: totals.errors + stats.errors,
            timeouts: totals.timeouts + stats.timeouts,
        }), { calls: 0, errors: 0, timeouts: 0 });
        const slowestRpc = [...this.rpcMethods.entries()]
            .map(([method, stats]) => ({
                method,
                stats,
                p50: percentile(stats.durationsMs, 0.50),
                p95: percentile(stats.durationsMs, 0.95),
                max: Math.max(...stats.durationsMs),
            }))
            .sort((left, right) => (
                right.p95 - left.p95
                || right.max - left.max
                || left.method.localeCompare(right.method)
            ))[0];

        const message = [
            'http:summary',
            `window=${elapsedSeconds}s`,
            `requests=${this.requests}`,
            `2xx=${this.status2xx}`,
            `4xx=${this.status4xx}`,
            `5xx=${this.status5xx}`,
            `errors=${this.errors}`,
            `txTimeouts=${this.transactionTimeouts}`,
            `slow1s=${this.slowRequests}`,
            `avg=${Math.round(averageMs)}ms`,
            `p95=${Math.round(percentile(this.durationsMs, 0.95))}ms`,
            `max=${Math.round(this.maxDurationMs)}ms`,
            topRoutes ? `top=${topRoutes}` : null,
            slowestRpc ? `rpcCalls=${rpcTotals.calls}` : null,
            slowestRpc ? `rpcErrors=${rpcTotals.errors}` : null,
            slowestRpc ? `rpcTimeouts=${rpcTotals.timeouts}` : null,
            slowestRpc ? `rpcSlowest=${slowestRpc.method}` : null,
            slowestRpc ? `rpcSlowestCalls=${slowestRpc.stats.calls}` : null,
            slowestRpc ? `rpcSlowestOk=${slowestRpc.stats.successes}` : null,
            slowestRpc ? `rpcSlowestErrors=${slowestRpc.stats.errors}` : null,
            slowestRpc ? `rpcSlowestTimeouts=${slowestRpc.stats.timeouts}` : null,
            slowestRpc ? `rpcSlowestP50=${Math.round(slowestRpc.p50)}ms` : null,
            slowestRpc ? `rpcSlowestP95=${Math.round(slowestRpc.p95)}ms` : null,
            slowestRpc ? `rpcSlowestMax=${Math.round(slowestRpc.max)}ms` : null,
        ].filter(Boolean).join(' ');

        this.reset(now);
        return message;
    }

    private reset(now: number): void {
        this.startedAt = now;
        this.requests = 0;
        this.status2xx = 0;
        this.status4xx = 0;
        this.status5xx = 0;
        this.errors = 0;
        this.transactionTimeouts = 0;
        this.slowRequests = 0;
        this.totalDurationMs = 0;
        this.maxDurationMs = 0;
        this.durationsMs = [];
        this.routes.clear();
        this.rpcMethods.clear();
    }
}

const productionWindow = new ProductionLogWindow();
let summaryTimer: ReturnType<typeof setInterval> | undefined;

export function recordProductionRequest(sample: RequestSample): void {
    if (isProduction) productionWindow.recordRequest(sample);
}

export function recordProductionError(error: unknown): void {
    if (isProduction) productionWindow.recordError(error);
}

export function recordProductionRpc(sample: RpcSample): void {
    if (isProduction) productionWindow.recordRpc(sample);
}

export function startProductionLogSummary(): () => void {
    if (!isProduction || summaryTimer) return () => {};

    summaryTimer = setInterval(() => {
        const message = productionWindow.flush();
        if (message) summary({ module: 'http-summary' }, message);
    }, PRODUCTION_LOG_WINDOW_MS);
    (summaryTimer as unknown as { unref?: () => void }).unref?.();

    return () => {
        if (summaryTimer) clearInterval(summaryTimer);
        summaryTimer = undefined;
    };
}
