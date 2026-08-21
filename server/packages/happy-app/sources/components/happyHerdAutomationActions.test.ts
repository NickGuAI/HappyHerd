import { describe, expect, it, vi } from 'vitest';
import type { HappyHerdAutomation } from '@slopus/happy-wire';

import { createHappyHerdAutomationMachineActions } from './happyHerdAutomationActions';

function automation(status: 'active' | 'paused'): HappyHerdAutomation {
    return {
        machineId: 'owning-machine',
        id: '11111111-1111-4111-8111-111111111111',
        status,
    } as HappyHerdAutomation;
}

describe('HappyHerd automation action routing', () => {
    it('routes every card action to the definition owning machine', async () => {
        const result = {} as never;
        const operations = {
            pause: vi.fn().mockResolvedValue(result),
            resume: vi.fn().mockResolvedValue(result),
            runNow: vi.fn().mockResolvedValue(result),
            history: vi.fn().mockResolvedValue(result),
            delete: vi.fn().mockResolvedValue(undefined),
        };
        const actions = createHappyHerdAutomationMachineActions(operations);
        const active = automation('active');
        const paused = automation('paused');

        await actions.toggleStatus(active);
        await actions.toggleStatus(paused);
        await actions.runNow(active);
        await actions.history(active);
        await actions.delete(active);

        const target = ['owning-machine', active.id];
        expect(operations.pause).toHaveBeenCalledWith(...target);
        expect(operations.resume).toHaveBeenCalledWith(...target);
        expect(operations.runNow).toHaveBeenCalledWith(...target);
        expect(operations.history).toHaveBeenCalledWith(...target);
        expect(operations.delete).toHaveBeenCalledWith(...target);
    });
});
