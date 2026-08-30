export type DesktopFileWorkspaceState = {
    paths: string[];
    activePath: string | null;
};

export const EMPTY_DESKTOP_FILE_WORKSPACE: DesktopFileWorkspaceState = {
    paths: [],
    activePath: null,
};

export const DESKTOP_FILE_WORKSPACE_MIN_WIDTH = 360;
export const DESKTOP_FILE_WORKSPACE_MAX_WIDTH = 860;
export const DESKTOP_FILE_WORKSPACE_MIN_CHAT_WIDTH = 380;
export const DESKTOP_FILE_WORKSPACE_DIVIDER_WIDTH = 8;

export function openDesktopFile(
    state: DesktopFileWorkspaceState,
    path: string,
): DesktopFileWorkspaceState {
    if (state.paths.includes(path)) {
        return state.activePath === path ? state : { ...state, activePath: path };
    }
    return {
        paths: [...state.paths, path],
        activePath: path,
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
    if (state.activePath !== path) {
        return { paths, activePath: state.activePath };
    }

    return {
        paths,
        activePath: paths[closingIndex - 1] ?? paths[closingIndex] ?? null,
    };
}

export function resolveDesktopFileWorkspaceWidth(
    requestedWidth: number,
    availableWidth: number,
): number {
    const maximum = Math.max(
        DESKTOP_FILE_WORKSPACE_MIN_WIDTH,
        Math.min(
            DESKTOP_FILE_WORKSPACE_MAX_WIDTH,
            availableWidth
                - DESKTOP_FILE_WORKSPACE_MIN_CHAT_WIDTH
                - DESKTOP_FILE_WORKSPACE_DIVIDER_WIDTH,
        ),
    );
    return Math.min(Math.max(requestedWidth, DESKTOP_FILE_WORKSPACE_MIN_WIDTH), maximum);
}

export function defaultDesktopFileWorkspaceWidth(availableWidth: number): number {
    return resolveDesktopFileWorkspaceWidth(availableWidth * 0.45, availableWidth);
}
