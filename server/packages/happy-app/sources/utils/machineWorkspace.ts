import type { Machine, Metadata } from '@/sync/storageTypes';
import type { Settings } from '@/sync/settings';

export type WorkspaceDirectoryErrorKind = 'offline' | 'permission' | 'missing' | 'unknown';

export type WorkspaceAttachmentParams = {
    mode: 'attach';
    sessionId: string;
    machineId: string;
    path: string;
};

export const DESKTOP_WORKSPACE_BROWSER_WIDTH = 360;

/**
 * React Native Web expands `flex: 0` to a zero flex-basis, which can collapse
 * an otherwise fixed-width pane. Keep every flex axis explicit so the file
 * browser remains visible beside the preview on desktop.
 */
export const desktopWorkspaceBrowserLayout = {
    width: DESKTOP_WORKSPACE_BROWSER_WIDTH,
    minWidth: DESKTOP_WORKSPACE_BROWSER_WIDTH,
    maxWidth: DESKTOP_WORKSPACE_BROWSER_WIDTH,
    flexBasis: DESKTOP_WORKSPACE_BROWSER_WIDTH,
    flexGrow: 0,
    flexShrink: 0,
} as const;

export function buildWorkspaceAttachmentParams(
    sessionId: string,
    metadata: Pick<Metadata, 'machineId' | 'path' | 'homeDir'> | null | undefined,
): WorkspaceAttachmentParams | null {
    if (!metadata?.machineId) return null;
    return {
        mode: 'attach',
        sessionId,
        machineId: metadata.machineId,
        path: metadata.path || metadata.homeDir || '/',
    };
}

export function pickWorkspaceMachine(
    machines: readonly Machine[],
    requestedMachineId: string | undefined,
    recentPaths: Settings['recentMachinePaths'],
): Machine | null {
    const requested = machines.find((machine) => machine.id === requestedMachineId);
    if (requested) return requested;
    const recent = recentPaths
        .map((entry) => machines.find((machine) => machine.id === entry.machineId))
        .find((machine): machine is Machine => !!machine);
    return recent ?? machines.find((machine) => machine.active) ?? machines[0] ?? null;
}

export function pickWorkspaceDirectory(
    machine: Machine,
    requestedPath: string | undefined,
    recentPaths: Settings['recentMachinePaths'],
): string {
    if (requestedPath?.trim()) return requestedPath.trim();
    const recent = recentPaths.find((entry) => entry.machineId === machine.id)?.path;
    return recent || machine.metadata?.homeDir || '/';
}

export function rememberWorkspacePath(
    recentPaths: Settings['recentMachinePaths'],
    machineId: string,
    path: string,
): Settings['recentMachinePaths'] {
    const next = [
        { machineId, path },
        ...recentPaths.filter((entry) => entry.machineId !== machineId || entry.path !== path),
    ];
    return next.slice(0, 10);
}

export function toggleWorkspaceFavorite(
    favorites: Settings['favoriteMachinePaths'],
    machineId: string,
    path: string,
): Settings['favoriteMachinePaths'] {
    const exists = favorites.some((entry) => entry.machineId === machineId && entry.path === path);
    return exists
        ? favorites.filter((entry) => entry.machineId !== machineId || entry.path !== path)
        : [...favorites, { machineId, path }];
}

export function classifyWorkspaceDirectoryError(
    message: string | undefined,
    online: boolean,
): WorkspaceDirectoryErrorKind {
    if (!online) return 'offline';
    const normalized = message?.toLowerCase() ?? '';
    if (normalized.includes('permission') || normalized.includes('access denied') || normalized.includes('eacces')) {
        return 'permission';
    }
    if (normalized.includes('not found') || normalized.includes('enoent') || normalized.includes('no such file')) {
        return 'missing';
    }
    return 'unknown';
}
