import type { Machine } from './storageTypes';

/**
 * Apply a complete machine snapshot without letting an older HTTP response
 * roll back presence already received over the realtime channel.
 */
export function mergeMachineSnapshot(
    existing: Record<string, Machine>,
    snapshot: readonly Machine[],
): Record<string, Machine> {
    const merged: Record<string, Machine> = {};
    for (const machine of snapshot) {
        const current = existing[machine.id];
        merged[machine.id] = current && current.activeAt > machine.activeAt
            ? { ...machine, active: current.active, activeAt: current.activeAt }
            : machine;
    }
    return merged;
}
