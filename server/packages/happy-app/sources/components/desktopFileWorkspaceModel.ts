import { isWorkspaceLiveLoopbackUrl } from '@slopus/happy-wire';

export type DesktopFileWorkspaceState = {
    paths: string[];
    activePath: string | null;
    references: Record<string, DesktopWorkspaceReference>;
};

export type DesktopFileReference = {
    kind?: 'file';
    machineId: string;
    source: 'session' | 'machine';
    line?: number;
    column?: number;
};

export type DesktopLocalhostReference = {
    kind: 'localhost';
    machineId: string;
    url: string;
};

export type DesktopWorkspaceReference = DesktopFileReference | DesktopLocalhostReference;

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
    const candidate = state.references[identity];
    const current = candidate?.kind === 'localhost' ? undefined : candidate;
    // Identity is the machine and absolute path. A machine-backed reopen
    // upgrades an earlier session-backed tab because explicit absolute links
    // are not limited to the session cwd. Never downgrade a machine-backed
    // tab when Workspace later reopens the same path.
    const source: DesktopFileReference['source'] = current?.source === 'machine' || reference.source === 'machine'
        ? 'machine'
        : 'session';
    const next = current
        ? reference.line === undefined
            // Workspace reopens retain an existing link
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

export function openDesktopLocalhost(
    state: DesktopFileWorkspaceState,
    machineId: string,
    normalizedUrl: string,
): DesktopFileWorkspaceState {
    const identity = desktopLocalhostIdentity(normalizedUrl, machineId);
    const paths = state.paths.includes(identity) ? state.paths : [...state.paths, identity];
    const current = state.references[identity];
    const reference: DesktopLocalhostReference = {
        kind: 'localhost',
        machineId,
        url: normalizedUrl,
    };
    const references = current?.kind === 'localhost'
        && current.machineId === machineId
        && current.url === normalizedUrl
        ? state.references
        : { ...state.references, [identity]: reference };

    if (state.activePath === identity && paths === state.paths && references === state.references) {
        return state;
    }
    return {
        paths,
        activePath: identity,
        references,
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

export function desktopLocalhostIdentity(normalizedUrl: string, machineId: string): string {
    return JSON.stringify([machineId, 'localhost', normalizedUrl]);
}

export function isDesktopLocalhostReference(
    reference: DesktopWorkspaceReference | undefined,
): reference is DesktopLocalhostReference {
    return reference?.kind === 'localhost';
}

export function normalizeWorkspaceLocalhostUrl(value: string): string | null {
    const candidate = value.trim();
    if (!isWorkspaceLiveLoopbackUrl(candidate)) return null;
    try {
        return new URL(candidate).toString();
    } catch {
        return null;
    }
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
