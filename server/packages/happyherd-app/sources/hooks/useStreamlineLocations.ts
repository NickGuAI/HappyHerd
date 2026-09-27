import { useAllMachines, useSetting } from '@/sync/storage';
import type { Machine } from '@/sync/storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';
import { normalizeMachinePath } from '@/utils/normalizeMachinePath';

export type StreamlineLocationInput = {
    machineId: string;
    path: string;
};

export type StreamlineLocation = StreamlineLocationInput & {
    name: string;
    machineName: string;
    online: boolean;
};

export type BuildStreamlineLocationsOptions = {
    machines: readonly Machine[];
    favorites: readonly StreamlineLocationInput[];
    recents: readonly StreamlineLocationInput[];
    commanderWorkspaces?: readonly StreamlineLocationInput[];
};

const STREAMLINE_LOCATION_LIMIT = 8;

function trimTrailingPathSeparator(path: string): string {
    if (path === '/' || /^[A-Za-z]:[\\/]?$/.test(path)) {
        return path;
    }
    return path.replace(/[\\/]+$/, '');
}

/** Uses New Session's path identity rules without changing the selected path value. */
export const normalizeStreamlineLocationPath = normalizeMachinePath;

function getFolderName(path: string): string {
    const withoutTrailingSeparators = trimTrailingPathSeparator(path);
    const separatorIndex = Math.max(withoutTrailingSeparators.lastIndexOf('/'), withoutTrailingSeparators.lastIndexOf('\\'));
    return separatorIndex >= 0 ? withoutTrailingSeparators.slice(separatorIndex + 1) || withoutTrailingSeparators : withoutTrailingSeparators;
}

/** Builds favorite, recent, then Commander workspace locations with machine/path identity deduplication. */
export function buildStreamlineLocations({
    machines,
    favorites,
    recents,
    commanderWorkspaces = [],
}: BuildStreamlineLocationsOptions): StreamlineLocation[] {
    const machineById = new Map(machines.map((machine) => [machine.id, machine]));
    const seen = new Set<string>();
    const locations: StreamlineLocation[] = [];

    for (const candidate of [...favorites, ...recents, ...commanderWorkspaces]) {
        const machine = machineById.get(candidate.machineId);
        const canonicalPath = normalizeStreamlineLocationPath(candidate.path, machine?.metadata?.homeDir ?? undefined);
        if (canonicalPath === null) continue;

        // JSON encoding avoids delimiter collisions in either component.
        const identity = JSON.stringify([candidate.machineId, canonicalPath]);
        if (seen.has(identity)) continue;
        seen.add(identity);

        locations.push({
            machineId: candidate.machineId,
            path: candidate.path,
            name: getFolderName(canonicalPath),
            machineName: machine
                ? machine.metadata?.displayName || machine.metadata?.host || 'unknown'
                : candidate.machineId,
            online: machine ? isMachineOnline(machine) : false,
        });
        if (locations.length === STREAMLINE_LOCATION_LIMIT) break;
    }

    return locations;
}

/** Subscribes to saved locations and machine presence for the New Session streamline picker. */
export function useStreamlineLocations(commanderWorkspaces: readonly StreamlineLocationInput[] = []): StreamlineLocation[] {
    const machines = useAllMachines({ includeOffline: true });
    const favorites = useSetting('favoriteMachinePaths');
    const recents = useSetting('recentMachinePaths');

    return buildStreamlineLocations({ machines, favorites, recents, commanderWorkspaces });
}
