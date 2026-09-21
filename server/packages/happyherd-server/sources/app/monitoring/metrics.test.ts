import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    close: vi.fn(),
    get: vi.fn(),
    listen: vi.fn(),
}));

vi.mock('fastify', () => ({
    default: () => ({
        close: mocks.close,
        get: mocks.get,
        listen: mocks.listen,
    }),
}));
vi.mock('@/storage/db', () => ({
    db: { $metrics: { prometheus: vi.fn(async () => '') } },
}));
vi.mock('@/app/monitoring/metrics2', () => ({
    register: { metrics: vi.fn(async () => '') },
}));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));

import { startMetricsServer } from './metrics';

describe('startMetricsServer', () => {
    beforeEach(() => {
        mocks.close.mockReset();
        mocks.get.mockReset();
        mocks.listen.mockReset().mockResolvedValue(undefined);
        process.env.METRICS_ENABLED = 'true';
        process.env.METRICS_PORT = '19090';
    });

    afterEach(() => {
        delete process.env.METRICS_ENABLED;
        delete process.env.METRICS_PORT;
    });

    it('binds to the explicit private host used by the self-host runtime', async () => {
        await startMetricsServer({ host: '127.0.0.1' });

        expect(mocks.listen).toHaveBeenCalledWith({
            host: '127.0.0.1',
            port: 19090,
        });
    });
});
