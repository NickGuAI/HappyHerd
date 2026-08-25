import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRaw, incrementRequests, observeDuration } = vi.hoisted(() => ({
    queryRaw: vi.fn(),
    incrementRequests: vi.fn(),
    observeDuration: vi.fn(),
}));

vi.mock('@/storage/db', () => ({
    db: { $queryRaw: queryRaw },
}));

vi.mock('@/app/monitoring/metrics2', () => ({
    httpRequestsCounter: { inc: incrementRequests },
    httpRequestDurationHistogram: { observe: observeDuration },
    getMetricsLabelsFromRequest: () => ({}),
}));

vi.mock('@/utils/log', () => ({
    debug: vi.fn(),
    isProduction: false,
    log: vi.fn(),
}));

import { enableMonitoring, resolveHealthStatus } from './enableMonitoring';

describe('health route compatibility', () => {
    beforeEach(() => {
        queryRaw.mockReset().mockResolvedValue([{ ok: 1 }]);
        incrementRequests.mockReset();
        observeDuration.mockReset();
    });

    it.each(['/health', '/api/health'])('serves the same healthy service contract at %s', async (path) => {
        const app = fastify();
        enableMonitoring(app as any);
        const response = await app.inject({ method: 'GET', url: path });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ status: 'ok', service: 'happy-server' });
        await app.close();
    });

    it('fails closed when storage is unavailable', async () => {
        const result = await resolveHealthStatus(async () => {
            throw new Error('offline');
        });
        expect(result.statusCode).toBe(503);
        expect(result.body).toMatchObject({ status: 'error', service: 'happy-server' });
    });

    it('records every unmatched path under the bounded other route', async () => {
        const marker = 'attacker-route-marker';
        const app = fastify();
        enableMonitoring(app as any);

        await app.inject({ method: 'GET', url: `/${marker}` });
        await app.close();

        expect(incrementRequests).toHaveBeenCalledWith(expect.objectContaining({ route: 'other' }));
        expect(observeDuration).toHaveBeenCalledWith(
            expect.objectContaining({ route: 'other' }),
            expect.any(Number),
        );
        expect(JSON.stringify(incrementRequests.mock.calls)).not.toContain(marker);
        expect(JSON.stringify(observeDuration.mock.calls)).not.toContain(marker);
    });
});
