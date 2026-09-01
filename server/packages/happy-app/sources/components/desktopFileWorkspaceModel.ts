export type DesktopFileWorkspaceState = {
    paths: string[];
    activePath: string | null;
    references: Record<string, DesktopFileReference>;
};

export type DesktopFileReference = {
    machineId: string;
    source: 'session' | 'machine';
    line?: number;
    column?: number;
};

export const EMPTY_DESKTOP_FILE_WORKSPACE: DesktopFileWorkspaceState = {
    paths: [],
    activePath: null,
    references: {},
};

export const DESKTOP_FILE_WORKSPACE_MIN_WIDTH = 360;
export const DESKTOP_FILE_WORKSPACE_MAX_SHARE = 0.75;
export const DESKTOP_FILE_WORKSPACE_DIVIDER_WIDTH = 8;

export function openDesktopFile(
    state: DesktopFileWorkspaceState,
    path: string,
    reference: DesktopFileReference,
): DesktopFileWorkspaceState {
    const identity = desktopFileIdentity(path, reference.machineId);
    const paths = state.paths.includes(identity) ? state.paths : [...state.paths, identity];
    const current = state.references[identity];
    // Identity is the machine and absolute path. A machine-backed reopen
    // upgrades an earlier session-backed tab because explicit absolute links
    // are not limited to the session cwd. Never downgrade a machine-backed
    // tab when Chat Workspace later reopens the same path.
    const source: DesktopFileReference['source'] = current?.source === 'machine' || reference.source === 'machine'
        ? 'machine'
        : 'session';
    const next = current
        ? reference.line === undefined
            // Chat and Machine Workspace reopens retain an existing link
            // location. A new located link replaces the whole location so a
            // stale column cannot accompany its newer line.
            ? current.source === source ? current : { ...current, source }
            : {
                machineId: current.machineId,
                source,
                line: reference.line,
                ...(reference.column === undefined ? {} : { column: reference.column }),
            }
        : reference;
    const nextReference = current
        && current.source === next.source
        && current.machineId === next.machineId
        && current.line === next.line
        && current.column === next.column
        ? state.references
        : { ...state.references, [identity]: next };
    if (state.activePath === identity && paths === state.paths && nextReference === state.references) {
        return state;
    }
    return {
        paths,
        activePath: identity,
        references: nextReference,
    };
}

export function selectDesktopFile(
    state: DesktopFileWorkspaceState,
    path: string,
): DesktopFileWorkspaceState {
    if (!state.paths.includes(path) || state.activePath === path) return state;
    return { ...state, activePath: path };
}

export function closeDesktopFile(
    state: DesktopFileWorkspaceState,
    path: string,
): DesktopFileWorkspaceState {
    const closingIndex = state.paths.indexOf(path);
    if (closingIndex === -1) return state;

    const paths = state.paths.filter((candidate) => candidate !== path);
    const { [path]: _closedReference, ...references } = state.references;
    if (state.activePath !== path) {
        return { paths, activePath: state.activePath, references };
    }

    return {
        paths,
        activePath: paths[closingIndex - 1] ?? paths[closingIndex] ?? null,
        references,
    };
}

export function desktopFileIdentity(path: string, machineId: string): string {
    return JSON.stringify([machineId, path]);
}

export function desktopFilePath(identity: string): string {
    try {
        const parsed = JSON.parse(identity);
        return Array.isArray(parsed) && typeof parsed[1] === 'string' ? parsed[1] : identity;
    } catch {
        return identity;
    }
}

export function resolveDesktopFileWorkspaceWidth(
    requestedWidth: number,
    availableWidth: number,
): number {
    const maximum = Math.max(
        DESKTOP_FILE_WORKSPACE_MIN_WIDTH,
        (availableWidth - DESKTOP_FILE_WORKSPACE_DIVIDER_WIDTH)
            * DESKTOP_FILE_WORKSPACE_MAX_SHARE,
    );
    return Math.min(Math.max(requestedWidth, DESKTOP_FILE_WORKSPACE_MIN_WIDTH), maximum);
}

export function defaultDesktopFileWorkspaceWidth(availableWidth: number): number {
    return resolveDesktopFileWorkspaceWidth(availableWidth * 0.45, availableWidth);
}
