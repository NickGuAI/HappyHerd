import { db } from "@/storage/db";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Fastify } from "../types";
import { httpRequestsCounter, httpRequestDurationHistogram, getMetricsLabelsFromRequest } from "@/app/monitoring/metrics2";
import { debug } from "@/utils/log";
import { recordProductionRequest, startProductionLogSummary } from "@/app/monitoring/productionLogSummary";

export async function resolveHealthStatus(
    checkDatabase: () => Promise<unknown> = async () => db.$queryRaw`SELECT 1`,
) {
    try {
        await checkDatabase();
        return {
            statusCode: 200 as const,
            body: {
                status: 'ok' as const,
                timestamp: new Date().toISOString(),
                service: 'happy-server' as const,
            },
        };
    } catch (error) {
        debug({ module: 'health' }, `health:database-check-failed error=${error}`);
        return {
            statusCode: 503 as const,
            body: {
                status: 'error' as const,
                timestamp: new Date().toISOString(),
                service: 'happy-server' as const,
                error: 'Database connectivity failed',
            },
        };
    }
}

export function enableMonitoring(app: Fastify) {
    const stopProductionLogSummary = startProductionLogSummary();
    app.addHook('onClose', async () => stopProductionLogSummary());

    // Add metrics hooks
    app.addHook('onRequest', async (request, reply) => {
        request.startTime = Date.now();
    });

    app.addHook('onResponse', async (request, reply) => {
        const duration = (Date.now() - (request.startTime || Date.now())) / 1000;
        const method = request.method;
        // Keep metrics bounded: unmatched paths do not have a route template.
        const route = request.routeOptions?.url || 'other';
        const status = reply.statusCode.toString();
        const labels = getMetricsLabelsFromRequest(request);

        // Increment request counter
        httpRequestsCounter.inc({ method, route, status, ...labels });

        // Record request duration
        httpRequestDurationHistogram.observe({ method, route, status, ...labels }, duration);
        recordProductionRequest({
            method,
            route: request.routeOptions?.url || '<unmatched>',
            statusCode: reply.statusCode,
            durationMs: duration * 1_000,
        });
    });

    const healthHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
        const result = await resolveHealthStatus();
        return reply.code(result.statusCode).send(result.body);
    };

    app.get('/health', healthHandler);
    app.get('/api/health', healthHandler);
}
