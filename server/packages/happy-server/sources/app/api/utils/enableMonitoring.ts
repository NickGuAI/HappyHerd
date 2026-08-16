import { db } from "@/storage/db";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Fastify } from "../types";
import { httpRequestsCounter, httpRequestDurationHistogram, getMetricsLabelsFromRequest } from "@/app/monitoring/metrics2";
import { log } from "@/utils/log";

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
        log({ module: 'health', level: 'error' }, `Health check failed: ${error}`);
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
    // Add metrics hooks
    app.addHook('onRequest', async (request, reply) => {
        request.startTime = Date.now();
    });

    app.addHook('onResponse', async (request, reply) => {
        const duration = (Date.now() - (request.startTime || Date.now())) / 1000;
        const method = request.method;
        // Use routeOptions.url for the route template, fallback to parsed URL path
        const route = request.routeOptions?.url || request.url.split('?')[0] || 'unknown';
        const status = reply.statusCode.toString();
        const labels = getMetricsLabelsFromRequest(request);

        // Increment request counter
        httpRequestsCounter.inc({ method, route, status, ...labels });

        // Record request duration
        httpRequestDurationHistogram.observe({ method, route, status, ...labels }, duration);
    });

    const healthHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
        const result = await resolveHealthStatus();
        return reply.code(result.statusCode).send(result.body);
    };

    app.get('/health', healthHandler);
    app.get('/api/health', healthHandler);
}
