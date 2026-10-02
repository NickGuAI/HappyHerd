import type { ComputeFileSystem, ComputePermissions } from "../Compute.js";
import {
    isGitIgnored,
    loadInitialGitIgnoreScopes,
    readGitIgnoreScope,
    type GitIgnoreScope,
} from "./gitIgnore.js";
import { joinComputePath } from "./resolveComputePath.js";

/** One file the walk found, with what it needs to be ordered by recency. */
export interface WalkedFile {
    readonly path: string;
    readonly mtimeMs: number;
    readonly size: number;
}

/** What a walk found, and whether it saw the whole tree. */
export interface WalkedTree {
    readonly files: readonly WalkedFile[];
    /** The walk stopped at a limit, so a file it never reached may still match. */
    readonly truncated: boolean;
}

/** Directories whose contents are never what a search is looking for. */
const SKIPPED_DIRECTORIES = new Set([".git"]);

/** How many entries one search may look at before it answers with what it has. */
const MAX_VISITED_ENTRIES = 20_000;

/** How many files one search may carry back, whatever it then does with them. */
const MAX_COLLECTED_FILES = 10_000;

/** How many names one call asks the machine for at a time. */
const DIRECTORY_PAGE_SIZE = 512;

/**
 * Every file under a directory, breadth first, within a bound.
 *
 * Breadth first because a search that runs out of budget should have spent it near the top of the
 * tree, where the answer usually is, rather than deep inside the first branch it happened to
 * enter. Symbolic links are skipped and never followed, which keeps a cycle from turning the
 * walk into a loop. Git's own directory is skipped: it is large, it is never what was meant, and
 * finding a loose object by name helps nobody. Each directory is read a page at a time and only
 * as far as the walk's own budget reaches, so one enormous directory cannot be materialized in
 * full before the bound that was supposed to contain it applies. The bounds belong to the walk
 * rather than to what
 * the caller means to show, so a search keeps its whole budget for finding matches, and a walk
 * that stopped early says so — nothing should read a short answer as proof that nothing matches.
 */
export async function walkComputeFiles(
    fs: ComputeFileSystem,
    permissions: ComputePermissions,
    root: string,
    options: { respectGitIgnore?: boolean } = {},
): Promise<WalkedTree> {
    // A root that is itself a file is the whole walk. Treating it as a directory read a
    // directory listing off a file, which failed, which read as an empty tree — and a search
    // over an empty tree answered "no matches" about a file that was never opened. A file the
    // caller named directly is also searched even where an ignore rule would have hidden it.
    try {
        const rootStat = await fs.stat(permissions, root);
        if (!rootStat.isDirectory) {
            return {
                files: [{ path: root, mtimeMs: rootStat.mtimeMs, size: rootStat.size }],
                truncated: false,
            };
        }
    } catch {
        // A root that cannot be inspected walks as the empty tree it always was.
    }
    const files: WalkedFile[] = [];
    const respectGitIgnore = options.respectGitIgnore === true;
    const initialScopes = respectGitIgnore
        ? await loadInitialGitIgnoreScopes(fs, permissions, root)
        : [];
    const directories: { directory: string; scopes: readonly GitIgnoreScope[] }[] = [
        {
            directory: root,
            scopes: initialScopes,
        },
    ];
    let visited = 0;
    let truncated = false;
    while (directories.length > 0) {
        const entry = directories.shift();
        if (entry === undefined) break;
        const { directory, scopes } = entry;
        let names: readonly string[];
        try {
            const page = await readDirectoryNames(
                fs,
                permissions,
                directory,
                MAX_VISITED_ENTRIES - visited + 1,
            );
            names = page.names;
            if (page.incomplete) truncated = true;
        } catch {
            // A directory that cannot be read is one the search simply does not cover.
            continue;
        }
        let currentScopes = scopes;
        if (
            respectGitIgnore &&
            names.includes(".gitignore") &&
            !scopes.some((scope) => scope.directory === directory)
        ) {
            const scope = await readGitIgnoreScope(fs, permissions, directory);
            if (scope !== undefined) currentScopes = [...scopes, scope];
        }
        const sorted = [...names].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
        const paths = sorted.map((name) => joinComputePath(directory, name));
        const stats = await fs.lstatMany(permissions, paths);
        for (const [index, path] of paths.entries()) {
            visited += 1;
            if (visited > MAX_VISITED_ENTRIES) return { files, truncated: true };
            const stat = stats[index];
            if (stat === undefined || stat.isSymbolicLink) continue;
            if (stat.isDirectory) {
                if (
                    !SKIPPED_DIRECTORIES.has(sorted[index] ?? "") &&
                    !(respectGitIgnore && isGitIgnored(path, true, currentScopes))
                ) {
                    directories.push({
                        directory: path,
                        scopes: currentScopes,
                    });
                }
                continue;
            }
            if (respectGitIgnore && isGitIgnored(path, false, currentScopes)) continue;
            files.push({ path, mtimeMs: stat.mtimeMs, size: stat.size });
            if (files.length >= MAX_COLLECTED_FILES) return { files, truncated: true };
        }
    }
    return { files, truncated };
}

/**
 * The names in one directory, read a page at a time and never beyond what the walk can still
 * visit. A directory larger than that is reported as incomplete rather than held in full.
 */
async function readDirectoryNames(
    fs: ComputeFileSystem,
    permissions: ComputePermissions,
    directory: string,
    limit: number,
): Promise<{ readonly names: readonly string[]; readonly incomplete: boolean }> {
    const names: string[] = [];
    let after: string | undefined;
    while (names.length < limit) {
        const page = await fs.readdirPage(permissions, directory, {
            ...(after === undefined ? {} : { after }),
            limit: Math.min(DIRECTORY_PAGE_SIZE, limit - names.length),
        });
        names.push(...page.entries);
        after = page.entries.at(-1);
        if (!page.hasMore || after === undefined) return { names, incomplete: false };
    }
    return { names, incomplete: true };
}
