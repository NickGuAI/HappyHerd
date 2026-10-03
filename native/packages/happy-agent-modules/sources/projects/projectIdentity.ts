import { MAX_PROJECT_STORAGE_KEY_LENGTH } from "./Project.js";

/** Leaves room for the "-2", "-3" suffix a collision adds. */
const STORAGE_KEY_BASE_LENGTH = 48;

/**
 * Derives the portable kebab key a host uses to name this project's managed
 * directories. Accents are folded away and anything that is not a letter or a
 * digit becomes a separator, so the key is safe on every filesystem we target.
 */
export function projectStorageKey(name: string): string {
    const readable = name
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .toLocaleLowerCase("en-US")
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-+|-+$/gu, "")
        .slice(0, STORAGE_KEY_BASE_LENGTH)
        .replace(/-+$/gu, "");
    return readable.length === 0 ? "project" : readable;
}

/** Appends the smallest numeric suffix the caller reports as free. */
export function uniqueProjectStorageKey(
    base: string,
    taken: (candidate: string) => boolean,
): string {
    if (!taken(base)) return base;
    const trimmed = base.slice(0, MAX_PROJECT_STORAGE_KEY_LENGTH - 8).replace(/-+$/u, "");
    for (let suffix = 2; ; suffix += 1) {
        const candidate = `${trimmed}-${String(suffix)}`;
        if (!taken(candidate)) return candidate;
    }
}

/**
 * The display name a folder gets before anything better is known: its last
 * path segment. The home project is named "Home" instead.
 */
export function folderProjectName(path: string): string {
    const segments = path.split(/[\\/]+/u).filter((segment) => segment.length > 0);
    const candidate = segments[segments.length - 1]?.trim() ?? "";
    return candidate.length === 0 ? "Project" : candidate;
}

export const HOME_PROJECT_NAME = "Home";
export const HOME_PROJECT_STORAGE_KEY = "home";
