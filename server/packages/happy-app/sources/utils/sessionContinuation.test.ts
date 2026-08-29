import { describe, expect, it, vi } from 'vitest';

import { deliverSessionTurn } from './sessionContinuation';

describe('deliverSessionTurn', () => {
    it('persists an archived next turn before resuming it with the same record ID', async () => {
        const order: string[] = [];
        const deliver = vi.fn(async (options) => {
            order.push('deliver');
            expect(options).toEqual({ deliveryMode: 'queue', awaitDelivery: true });
            return { localId: 'archived-next-turn' };
        });
        const resume = vi.fn(async (replayQueueMessageId: string) => {
            order.push('resume');
            expect(replayQueueMessageId).toBe('archived-next-turn');
        });

        await expect(deliverSessionTurn({
            isDisconnected: true,
            canResume: true,
            sessionLifecycleState: 'archived',
            awaitDelivery: false,
            deliver,
            resume,
        })).resolves.toEqual({ localId: 'archived-next-turn' });

        expect(order).toEqual(['deliver', 'resume']);
        expect(deliver).toHaveBeenCalledOnce();
        expect(resume).toHaveBeenCalledOnce();
    });

    it('keeps active-session delivery unchanged', async () => {
        const deliver = vi.fn(async () => ({ localId: 'active-turn' }));
        const resume = vi.fn();

        await deliverSessionTurn({
            isDisconnected: false,
            canResume: true,
            sessionLifecycleState: 'running',
            requestedDeliveryMode: 'queue',
            awaitDelivery: false,
            deliver,
            resume,
        });

        expect(deliver).toHaveBeenCalledWith({ deliveryMode: 'queue', awaitDelivery: false });
        expect(resume).not.toHaveBeenCalled();
    });

    it('does not resume a transiently disconnected provider that is still running', async () => {
        const deliver = vi.fn(async () => ({ localId: 'transient-turn' }));
        const resume = vi.fn();

        await deliverSessionTurn({
            isDisconnected: true,
            canResume: true,
            sessionLifecycleState: 'running',
            awaitDelivery: false,
            deliver,
            resume,
        });

        expect(deliver).toHaveBeenCalledWith({ deliveryMode: undefined, awaitDelivery: false });
        expect(resume).not.toHaveBeenCalled();
    });

    it('does not start a provider when the message was not persisted', async () => {
        const resume = vi.fn();

        await expect(deliverSessionTurn({
            isDisconnected: true,
            canResume: true,
            sessionLifecycleState: 'archived',
            awaitDelivery: false,
            deliver: vi.fn(async () => undefined),
            resume,
        })).resolves.toBeUndefined();

        expect(resume).not.toHaveBeenCalled();
    });
});
