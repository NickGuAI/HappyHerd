import type { DirectoryTreeNode } from '@/sync/ops';

export const WORKSPACE_LINK_DESKTOP_MIN_WIDTH = 900;

export type WorkspaceLinkPresentation = 'side-panel' | 'full-screen';

export function workspaceLinkViewerKey(reference: {
    originSessionId: string;
    machineId: string;
    absolutePath: string;
    line?: string | null;
    column?: string | null;
}): string {
    return JSON.stringify([
        reference.originSessionId,
        reference.machineId,
        reference.absolutePath,
        reference.line ?? null,
        reference.column ?? null,
    ]);
}

export type WorkspaceLinkTarget =
    | {
        kind: 'file';
        absolutePath: string;
        directoryPath: string;
    }
    | {
        kind: 'directory';
        absolutePath: string;
        tree: DirectoryTreeNode & { type: 'directory' };
    };

export function resolveWorkspaceLinkPresentation(input: {
    width: number;
    platform: string;
    runningOnMac: boolean;
}): WorkspaceLinkPresentation {
    const desktopPlatform = input.platform === 'web'
        || input.platform === 'macos'
        || input.runningOnMac;
    return desktopPlatform && input.width >= WORKSPACE_LINK_DESKTOP_MIN_WIDTH
        ? 'side-panel'
        : 'full-screen';
}

export function resolveActiveWorkspaceLinkPresentation(
    requested: WorkspaceLinkPresentation,
    hasOpenSidePanel: boolean,
): WorkspaceLinkPresentation {
    return hasOpenSidePanel ? 'side-panel' : requested;
}

export function findPinnedWorkspaceLinkMachine<T extends { id: string }>(
    machines: readonly T[],
    machineId: string,
): T | null {
    return machines.find((machine) => machine.id === machineId) ?? null;
}

export function classifyWorkspaceLinkTree(
    tree: DirectoryTreeNode,
    parentPath: (path: string) => string,
): WorkspaceLinkTarget {
    if (tree.type === 'file') {
        return {
            kind: 'file',
            absolutePath: tree.path,
            directoryPath: parentPath(tree.path),
        };
    }
    return {
        kind: 'directory',
        absolutePath: tree.path,
        tree: tree as DirectoryTreeNode & { type: 'directory' },
    };
}
