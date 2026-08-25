import { describe, expect, it } from 'vitest';

import type { Machine } from './storageTypes';
import { mergeMachineSnapshot } from './machinePresence';

function machine(
    id: string,
    active: boolean,
    activeAt: number,
    displayName: string,
): Machine {
    return {
        id,
        seq: 1,
        createdAt: 1,
        updatedAt: activeAt,
        active,
        activeAt,
        metadata: {
            displayName,
            host: 'test-host',
            platform: 'linux',
            happyCliVersion: 'test',
            happyHomeDir: '/home/test/.happyherd',
            homeDir: '/home/test',
        },
        metadataVersion: 1,
        daemonState: null,
        daemonStateVersion: 0,
    };
}

describe('mergeMachineSnapshot', () => {
    it('keeps newer realtime presence while accepting snapshot metadata', () => {
        const existing = machine('machine-1', true, 200, 'Old name');
        const staleSnapshot = machine('machine-1', false, 100, 'Current name');

        expect(mergeMachineSnapshot({ [existing.id]: existing }, [staleSnapshot]))
            .toEqual({
                'machine-1': {
                    ...staleSnapshot,
                    active: true,
                    activeAt: 200,
                },
            });
    });

    it('lets an equally new or newer snapshot replace presence and removed machines', () => {
        const existing = machine('machine-1', true, 100, 'Old name');
        const snapshot = machine('machine-1', false, 100, 'Current name');

        expect(mergeMachineSnapshot({
            [existing.id]: existing,
            removed: machine('removed', true, 500, 'Removed'),
        }, [snapshot])).toEqual({ 'machine-1': snapshot });
    });
});
