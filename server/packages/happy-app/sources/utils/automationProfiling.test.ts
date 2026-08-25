import { afterEach, describe, expect, it, vi } from 'vitest';

import { profileAutomationRpc, recordAutomationProfile } from './automationProfiling';

describe('automationProfiling', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('records a successful RPC with a bounded name and duration', async () => {
        const measure = vi.fn();
        const now = vi.fn()
            .mockReturnValueOnce(10)
            .mockReturnValueOnce(35);
        vi.stubGlobal('performance', { measure, now });

        await expect(profileAutomationRpc(
            'happyherd-automations-list',
            async () => ({ automations: [] }),
        )).resolves.toEqual({ automations: [] });

        expect(measure).toHaveBeenCalledWith(
            'happyherd.automations.rpc.happyherd-automations-list.success',
            { start: 10, end: 35 },
        );
    });

    it('records an RPC error without changing the thrown value', async () => {
        const measure = vi.fn();
        vi.stubGlobal('performance', {
            measure,
            now: vi.fn()
                .mockReturnValueOnce(20)
                .mockReturnValueOnce(45),
        });
        const failure = new Error('private failure');

        await expect(profileAutomationRpc(
            'happyherd-list-commanders',
            async () => { throw failure; },
        )).rejects.toBe(failure);
        expect(measure).toHaveBeenCalledWith(
            'happyherd.automations.rpc.happyherd-list-commanders.error',
            { start: 20, end: 45 },
        );
        expect(JSON.stringify(measure.mock.calls)).not.toContain('private failure');
    });

    it('does nothing when the Performance measure API is unavailable', () => {
        vi.stubGlobal('performance', { now: vi.fn(() => 50) });

        expect(() => recordAutomationProfile('render', 'commit', 'success', 40)).not.toThrow();
    });
});
