import { describe, expect, it, vi } from 'vitest';
import type { HappyHerdAutomation } from '@slopus/happy-wire';

import type { Machine } from '@/sync/storageTypes';
import {
    groupHappyHerdAutomationsByProject,
    happyHerdAutomationProjectKey,
    happyHerdAutomationReloadKey,
    happyHerdAutomationTagInput,
    loadHappyHerdAutomationMachines,
} from './happyHerdAutomationGroups';

function machine(id: string, displayName: string): Machine {
    return {
        id,
        metadata: { displayName } as Machine['metadata'],
    } as Machine;
}

function automation(
    id: string,
    machineId: string,
    tags: string[],
    createdAt = '2026-08-20T00:00:00.000Z',
): HappyHerdAutomation {
    return {
        schemaVersion: 3,
        runtimeOwner: 'happyherd',
        id,
        machineId,
        name: id,
        kind: 'scheduled',
        instruction: 'Review.',
        schedule: '0 8 * * *',
        timezone: 'UTC',
        workspace: '/srv/app',
        rail: 'codex',
        commanderId: null,
        status: 'paused',
        maxRetries: 0,
        tags,
        createdAt,
        updatedAt: createdAt,
        lastScheduledAt: null,
        lastRunAt: null,
    };
}

describe('HappyHerd automation machine loading', () => {
    it('ignores heartbeat churn while tracking meaningful machine topology changes', () => {
        const original = {
            ...machine('machine-a', 'Alpha'),
            seq: 1,
            active: true,
            activeAt: 100,
            updatedAt: 100,
            metadataVersion: 2,
            daemonStateVersion: 3,
        } as Machine;
        const heartbeat = {
            ...original,
            seq: 2,
            activeAt: 200,
            updatedAt: 200,
        };
        const activeBeta = {
            ...machine('machine-b', 'Beta'),
            active: true,
            metadataVersion: 1,
            daemonStateVersion: 1,
        } as Machine;
        const reordered = [
            {
                ...machine('machine-b', 'Beta'),
                active: false,
                metadataVersion: 1,
                daemonStateVersion: 1,
            } as Machine,
            heartbeat,
        ];

        expect(happyHerdAutomationReloadKey([original])).toBe(
            happyHerdAutomationReloadKey([heartbeat]),
        );
        expect(happyHerdAutomationReloadKey([original])).toBe(
            happyHerdAutomationReloadKey(reordered),
        );
        expect(happyHerdAutomationReloadKey([original, activeBeta])).toBe(
            happyHerdAutomationReloadKey([activeBeta, heartbeat]),
        );
        expect(happyHerdAutomationReloadKey([original])).not.toBe(
            happyHerdAutomationReloadKey([{ ...heartbeat, active: false }]),
        );
        expect(happyHerdAutomationReloadKey([original])).not.toBe(
            happyHerdAutomationReloadKey([{ ...heartbeat, metadataVersion: 3 }]),
        );
        expect(happyHerdAutomationReloadKey([original])).not.toBe(
            happyHerdAutomationReloadKey([{ ...heartbeat, daemonStateVersion: 4 }]),
        );
    });

    it('omits tag mutations for legacy daemons and sends normalized lines to v2 daemons', () => {
        expect(happyHerdAutomationTagInput(' Project Beacon, Operations', 1)).toEqual({});
        expect(happyHerdAutomationTagInput(' Project Beacon, Operations \n Reliability ', 2)).toEqual({
            tags: ['Project Beacon, Operations', 'Reliability'],
        });
    });

    it('round-trips comma-bearing tags through the line-based editor', () => {
        const stored = ['Finance, Operations', 'Reliability'];
        expect(happyHerdAutomationTagInput(stored.join('\n'), 2)).toEqual({ tags: stored });
    });

    it('loads every machine concurrently and preserves healthy results when one fails', async () => {
        const alpha = machine('machine-a', 'Alpha');
        const beta = machine('machine-b', 'Beta');
        const alphaResult = automation('11111111-1111-4111-8111-111111111111', alpha.id, ['Beacon']);
        const pendingResolvers: Array<() => void> = [];
        const list = vi.fn((machineId: string) => new Promise<{ definitionSchemaVersion: 2; automations: HappyHerdAutomation[] }>((resolve, reject) => {
            pendingResolvers.push(() => machineId === alpha.id
                ? resolve({ definitionSchemaVersion: 2, automations: [alphaResult] })
                : reject(new Error('Beta daemon unavailable')));
        }));

        const loading = loadHappyHerdAutomationMachines([alpha, beta], list);
        expect(list).toHaveBeenCalledTimes(2);
        pendingResolvers.forEach((resolve) => resolve());
        const result = await loading;

        expect(result.collections).toEqual([{
            machine: alpha,
            definitionSchemaVersion: 2,
            automations: [alphaResult],
        }]);
        expect(result.failures).toEqual([{
            machine: beta,
            error: expect.objectContaining({ message: 'Beta daemon unavailable' }),
        }]);
    });

    it('treats missing capability and runtime tags as legacy untagged data', async () => {
        const alpha = machine('machine-a', 'Alpha');
        const tagged = automation('11111111-1111-4111-8111-111111111111', alpha.id, []);
        const { schemaVersion: _schemaVersion, tags: _tags, ...legacyFields } = tagged;
        const result = await loadHappyHerdAutomationMachines([alpha], async () => ({
            automations: [{ schemaVersion: 1, ...legacyFields }],
        }));

        expect(result.failures).toEqual([]);
        expect(result.collections[0]).toMatchObject({
            definitionSchemaVersion: 1,
            automations: [{ schemaVersion: 3, tags: [] }],
        });
    });
});

describe('HappyHerd automation project grouping', () => {
    it('uses distinct renderer keys for Untagged and a literal sentinel-looking tag', () => {
        expect(happyHerdAutomationProjectKey(null)).not.toBe(
            happyHerdAutomationProjectKey('__untagged__'),
        );
    });

    it('duplicates multi-tag definitions and nests projects by machine deterministically', () => {
        const alpha = machine('machine-a', 'Alpha');
        const beta = machine('machine-b', 'Beta');
        const shared = automation(
            '11111111-1111-4111-8111-111111111111',
            beta.id,
            ['Project Zeta', 'Project Alpha'],
        );
        const newer = automation(
            '22222222-2222-4222-8222-222222222222',
            alpha.id,
            ['Project Alpha'],
            '2026-08-21T00:00:00.000Z',
        );
        const untagged = automation(
            '33333333-3333-4333-8333-333333333333',
            alpha.id,
            [],
        );

        const groups = groupHappyHerdAutomationsByProject([
            { machine: beta, definitionSchemaVersion: 2, automations: [shared] },
            { machine: alpha, definitionSchemaVersion: 2, automations: [untagged, newer] },
        ]);

        expect(groups.map((group) => group.tag)).toEqual(['Project Alpha', 'Project Zeta', null]);
        expect(groups[0].machines.map((entry) => entry.machine.id)).toEqual([alpha.id, beta.id]);
        expect(groups[0].machines.flatMap((entry) => entry.automations.map((entry) => entry.id))).toEqual([
            newer.id,
            shared.id,
        ]);
        expect(groups[1].machines[0].automations).toEqual([shared]);
        expect(groups[2].machines[0].automations).toEqual([untagged]);
    });
});
