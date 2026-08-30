import {
    HappyHerdAutomationSchema,
    type HappyHerdAutomation,
    type HappyHerdAutomationCreateInput,
} from '@slopus/happy-wire';

import type { Machine } from '@/sync/storageTypes';

export type HappyHerdAutomationMachine = Pick<Machine, 'id' | 'metadata'>;

type HappyHerdAutomationReloadMachine = Pick<
    Machine,
    'id' | 'active' | 'metadataVersion' | 'daemonStateVersion'
>;

type RuntimeListResponse = {
    definitionSchemaVersion?: 1 | 2 | 3;
    automations: unknown[];
};

export type HappyHerdAutomationMachineCollection<
    TMachine extends HappyHerdAutomationMachine = HappyHerdAutomationMachine,
> = {
    machine: TMachine;
    definitionSchemaVersion: 1 | 2 | 3;
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
    definitionSchemaVersion: 1 | 2 | 3,
): Partial<Pick<HappyHerdAutomationCreateInput, 'tags'>> {
    if (definitionSchemaVersion < 2) return {};
    return {
        tags: tags.split(/[\r\n]+/).map((tag) => tag.trim()).filter(Boolean),
    };
}

export function happyHerdAutomationProjectKey(tag: string | null): string {
    return tag === null ? 'project:untagged' : `project:tag:${tag}`;
}

export function happyHerdAutomationTags<
    TMachine extends HappyHerdAutomationMachine,
>(
    collections: readonly HappyHerdAutomationMachineCollection<TMachine>[],
): string[] {
    return [...new Set(
        collections.flatMap((collection) => (
            collection.automations.flatMap((automation) => automation.tags)
        )),
    )].sort(bytewiseCompare);
}

export function happyHerdAutomationsForMachine<
    TMachine extends HappyHerdAutomationMachine,
>(
    collections: readonly HappyHerdAutomationMachineCollection<TMachine>[],
    machineId: string | null,
): HappyHerdAutomation[] {
    if (!machineId) return [];

    const unique = new Map<string, HappyHerdAutomation>();
    for (const collection of collections) {
        if (collection.machine.id !== machineId) continue;
        for (const automation of collection.automations) {
            unique.set(automation.id, automation);
        }
    }

    return [...unique.values()].sort((left, right) => (
        bytewiseCompare(right.createdAt, left.createdAt) || bytewiseCompare(left.id, right.id)
    ));
}

export function filterHappyHerdAutomations(
    automations: readonly HappyHerdAutomation[],
    tag: string | null,
    query: string,
): HappyHerdAutomation[] {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return automations.filter((automation) => {
        if (tag !== null && !automation.tags.includes(tag)) return false;
        if (!normalizedQuery) return true;

        return [
            automation.name,
            automation.instruction,
            automation.workspace,
            automation.rail,
            automation.kind,
            ...automation.tags,
        ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    });
}

export function happyHerdAutomationReloadKey(
    machines: readonly HappyHerdAutomationReloadMachine[],
): string {
    return JSON.stringify(
        machines
            .filter((machine) => machine.active)
            .map((machine) => [machine.id, machine.metadataVersion, machine.daemonStateVersion] as const)
            .sort(([left], [right]) => bytewiseCompare(left, right)),
    );
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
                definitionSchemaVersion: result.value.definitionSchemaVersion === 3
                    ? 3
                    : result.value.definitionSchemaVersion === 2
                        ? 2
                        : 1,
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
