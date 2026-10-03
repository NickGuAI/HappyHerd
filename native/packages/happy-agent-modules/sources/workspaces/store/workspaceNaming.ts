import {
    MAX_WORKSPACE_BRANCH_LENGTH,
    MAX_WORKSPACE_NAME_LENGTH,
    MAX_WORKSPACE_STORAGE_KEY_LENGTH,
} from "../Workspace.js";

/**
 * How a workspace steps aside when something already answers to the name it asked for.
 *
 * A name gains a counted suffix the way a person would write one, and a folder key or a branch
 * gains a counted suffix the way Git and the filesystem read one. Both stay inside the length the
 * record allows: a name at its legal maximum still has to fit after it is suffixed, so the base is
 * shortened to make room rather than producing a value nothing can store.
 */
export function uniqueWorkspaceName(base: string, taken: (candidate: string) => boolean): string {
    if (!taken(base)) return base;
    for (let suffix = 2; ; suffix += 1) {
        const candidate = suffixedName(base, suffix);
        if (!taken(candidate)) return candidate;
    }
}

export async function uniqueWorkspaceStorageKey(
    base: string,
    taken: (candidate: string) => Promise<boolean>,
): Promise<string> {
    return await uniqueSuffixedKey(base, MAX_WORKSPACE_STORAGE_KEY_LENGTH, taken);
}

export async function uniqueWorkspaceBranch(
    base: string,
    taken: (candidate: string) => Promise<boolean>,
): Promise<string> {
    return await uniqueSuffixedKey(base, MAX_WORKSPACE_BRANCH_LENGTH, taken);
}

async function uniqueSuffixedKey(
    base: string,
    maxLength: number,
    taken: (candidate: string) => Promise<boolean>,
): Promise<string> {
    if (!(await taken(base))) return base;
    for (let suffix = 2; ; suffix += 1) {
        const candidate = suffixedKey(base, suffix, maxLength);
        if (!(await taken(candidate))) return candidate;
    }
}

function suffixedName(base: string, suffix: number): string {
    const marker = ` (${String(suffix)})`;
    const room = MAX_WORKSPACE_NAME_LENGTH - marker.length;
    return `${trimTo(base, room)}${marker}`;
}

function suffixedKey(base: string, suffix: number, maxLength: number): string {
    const marker = `-${String(suffix)}`;
    const room = maxLength - marker.length;
    return `${trimTo(base, room).replace(/-+$/u, "")}${marker}`;
}

/** Keeps at least one character of the base, so a suffixed value never loses what it names. */
function trimTo(value: string, room: number): string {
    return value.length <= room ? value : value.slice(0, Math.max(1, room));
}
