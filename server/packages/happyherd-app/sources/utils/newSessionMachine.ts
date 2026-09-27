import type { Machine } from '@/sync/storageTypes';

/**
 * The machine New Session starts on. A fresh draft takes the newest known
 * machine (online or not); an explicit choice stays in place even when that
 * daemon is gone, so a launch fails visibly instead of routing elsewhere.
 */
export function resolveNewSessionMachine(
    machines: readonly Machine[],
    selectedMachineId: string | null,
): { id: string; machine: Machine | null } | null {
    if (selectedMachineId) {
        return { id: selectedMachineId, machine: machines.find((machine) => machine.id === selectedMachineId) ?? null };
    }
    const first = machines[0];
    return first ? { id: first.id, machine: first } : null;
}
