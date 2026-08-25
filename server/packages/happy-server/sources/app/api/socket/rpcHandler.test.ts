import { beforeEach, describe, expect, it, vi } from 'vitest';
import { register } from 'prom-client';

vi.mock('@/utils/log', () => ({
    log: vi.fn(),
}));

vi.mock('@/app/monitoring/productionLogSummary', () => ({
    recordProductionRpc: vi.fn(),
}));

import { rpcHandler } from './rpcHandler';

describe('rpcHandler metrics', () => {
    beforeEach(() => register.resetMetrics());

    it('maps arbitrary RPC suffixes to other before metrics observation', async () => {
        const marker = 'attacker-rpc-marker';
        const handlers = new Map<string, (...args: any[]) => any>();
        const socket = {
            id: 'caller',
            on: vi.fn((event: string, handler: (...args: any[]) => any) => handlers.set(event, handler)),
            emit: vi.fn(),
            join: vi.fn(),
            leave: vi.fn(),
        };
        const room = {
            timeout: vi.fn(),
            fetchSockets: vi.fn().mockResolvedValue([{ id: socket.id }]),
        };
        room.timeout.mockReturnValue(room);
        const io = { in: vi.fn(() => room) };

        rpcHandler('user', socket as any, io as any);
        const call = handlers.get('rpc-call');
        expect(call).toBeTypeOf('function');

        await call?.({ method: `machine:${marker}`, params: {} }, vi.fn());
        await call?.({ method: 'machine:happyherd-automations-list', params: {} }, vi.fn());

        const scrape = await register.metrics();
        expect(scrape).not.toContain(marker);
        expect(scrape).toMatch(/rpc_calls_total\{[^}]*method="other"[^}]*result="self_call"/);
        expect(scrape).toMatch(/rpc_calls_total\{[^}]*method="happyherd-automations-list"[^}]*result="self_call"/);
    });
});
