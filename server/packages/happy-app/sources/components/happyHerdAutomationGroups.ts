import {
    HappyHerdAutomationSchema,
    type HappyHerdAutomation,
    type HappyHerdAutomationCreateInput,
} from '@slopus/happy-wire';

import type { Machine } from '@/sync/storageTypes';

export type HappyHerdAutomationMachine = Pick<Machine, 'id' | 'metadata'>;

type RuntimeListResponse = {
    definitionSchemaVersion?: 1 | 2;
    automations: unknown[];
};

export type HappyHerdAutomationMachineCollection<
    TMachine extends HappyHerdAutomationMachine = HappyHerdAutomationMachine,
> = {
    machine: TMachine;
    definitionSchemaVersion: 1 | 2;
    automations: HappyHerdAutomation[];
};

export type HappyHerdAutomationMachineFailure<
    TMachine extends HappyHerdAutomationMachine = HappyHerdAutomationMachine,
> = {
    machine: TMachine;
    error: Error;
};

export type HappyHerdAutomationProjectGroup<
    TMachine extends HappyHerdAutomationMachine = HappyHerdAutomationMachine,
> = {
    tag: string | null;
    machines: HappyHerdAutomationMachineCollection<TMachine>[];
};

function bytewiseCompare(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

export function happyHerdAutomationMachineName(machine: HappyHerdAutomationMachine): string {
    return machine.metadata?.displayName || machine.metadata?.host || machine.id;
}

export function happyHerdAutomationTagInput(
    tags: string,
    definitionSchemaVersion: 1 | 2,
): Partial<Pick<HappyHerdAutomationCreateInput, 'tags'>> {
    if (definitionSchemaVersion < 2) return {};
    return {
        tags: tags.split(/[\r\n]+/).map((tag) => tag.trim()).filter(Boolean),
    };
}

export function happyHerdAutomationProjectKey(tag: string | null): string {
    return tag === null ? 'project:untagged' : `project:tag:${tag}`;
}

function normalizeRuntimeAutomation(value: unknown): HappyHerdAutomation {
    if (value && typeof value === 'object' && !Array.isArray(value) && !('tags' in value)) {
        const { schemaVersion: _schemaVersion, ...fields } = value as Record<string, unknown>;
        return HappyHerdAutomationSchema.parse({ schemaVersion: 1, ...fields });
    }
    return HappyHerdAutomationSchema.parse(value);
}

export async function loadHappyHerdAutomationMachines<
    TMachine extends HappyHerdAutomationMachine,
>(
    machines: readonly TMachine[],
    listAutomations: (machineId: string) => Promise<RuntimeListResponse>,
): Promise<{
    collections: HappyHerdAutomationMachineCollection<TMachine>[];
    failures: HappyHerdAutomationMachineFailure<TMachine>[];
}> {
    const settled = await Promise.allSettled(
        machines.map((machine) => listAutomations(machine.id)),
    );
    const collections: HappyHerdAutomationMachineCollection<TMachine>[] = [];
    const failures: HappyHerdAutomationMachineFailure<TMachine>[] = [];

    settled.forEach((result, index) => {
        const machine = machines[index];
        if (result.status === 'rejected') {
            failures.push({
                machine,
                error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
            });
            return;
        }
        try {
            collections.push({
                machine,
                definitionSchemaVersion: result.value.definitionSchemaVersion === 2 ? 2 : 1,
                automations: result.value.automations.map(normalizeRuntimeAutomation),
            });
        } catch (error) {
            failures.push({
                machine,
                error: error instanceof Error ? error : new Error(String(error)),
            });
        }
    });

    return { collections, failures };
}

export function groupHappyHerdAutomationsByProject<
    TMachine extends HappyHerdAutomationMachine,
>(
    collections: readonly HappyHerdAutomationMachineCollection<TMachine>[],
): HappyHerdAutomationProjectGroup<TMachine>[] {
    const projects = new Map<string | null, Map<string, HappyHerdAutomationMachineCollection<TMachine>>>();

    for (const collection of collections) {
        for (const automation of collection.automations) {
            const tags = automation.tags.length > 0 ? automation.tags : [null];
            for (const tag of tags) {
                let machines = projects.get(tag);
                if (!machines) {
                    machines = new Map();
                    projects.set(tag, machines);
                }
                let machineCollection = machines.get(collection.machine.id);
                if (!machineCollection) {
                    machineCollection = {
                        machine: collection.machine,
                        definitionSchemaVersion: collection.definitionSchemaVersion,
                        automations: [],
                    };
                    machines.set(collection.machine.id, machineCollection);
                }
                machineCollection.automations.push(automation);
            }
        }
    }

    return [...projects.entries()]
        .sort(([left], [right]) => {
            if (left === null) return right === null ? 0 : 1;
            if (right === null) return -1;
            return bytewiseCompare(left, right);
        })
        .map(([tag, machines]) => ({
            tag,
            machines: [...machines.values()]
                .sort((left, right) => (
                    bytewiseCompare(
                        happyHerdAutomationMachineName(left.machine),
                        happyHerdAutomationMachineName(right.machine),
                    ) || bytewiseCompare(left.machine.id, right.machine.id)
                ))
                .map((collection) => ({
                    ...collection,
                    automations: [...collection.automations].sort((left, right) => (
                        bytewiseCompare(right.createdAt, left.createdAt) || bytewiseCompare(left.id, right.id)
                    )),
                })),
        }));
}
