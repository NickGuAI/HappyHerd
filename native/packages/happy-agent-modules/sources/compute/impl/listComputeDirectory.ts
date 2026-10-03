import type { Context } from "@steve.kite/stdlib";

import type { Compute } from "../Compute.js";
import { computePermissionsForContext } from "./computePermissionsForContext.js";
import { joinComputePath, resolveComputePath } from "./resolveComputePath.js";

/** What one directory holds, as far as one listing goes. */
export interface ComputeDirectoryListing {
    readonly path: string;
    /** Sorted names, a directory's own name ending in a slash. */
    readonly entries: readonly string[];
    readonly totalEntries: number;
    readonly truncated: boolean;
}

/** How many names one call asks the machine for at a time. */
const DIRECTORY_PAGE_SIZE = 512;

/**
 * How far one listing counts before it answers with what it has. A directory this large is a data
 * store rather than a place to look around in, and holding all of its names to count them costs
 * more than the count is worth.
 */
const MAX_COUNTED_ENTRIES = 20_000;

/**
 * List one level of a directory.
 *
 * Sorted, because a listing that changes order between calls reads as a tree that changed — which
 * the machine already guarantees by answering pages in name order. The directory is read a page
 * at a time rather than all at once, so a directory holding a million files costs one page plus
 * the counting, not a million names held in memory. A directory keeps its trailing slash so the
 * model can tell at a glance what it can descend into.
 */
export async function listComputeDirectory(
    compute: Compute,
    ctx: Context,
    options: {
        readonly path?: string;
        readonly showHidden?: boolean;
        readonly maxEntries: number;
    },
): Promise<ComputeDirectoryListing> {
    const permissions = computePermissionsForContext(ctx);
    const directory = resolveComputePath(options.path ?? ".", compute.cwd, compute.fs.home);
    const stat = await compute.fs.stat(permissions, directory);
    if (!stat.isDirectory) throw new Error(`This path is not a directory: ${directory}`);
    const shown: string[] = [];
    let totalEntries = 0;
    let countIncomplete = false;
    let after: string | undefined;
    for (;;) {
        const page = await compute.fs.readdirPage(permissions, directory, {
            ...(after === undefined ? {} : { after }),
            limit: DIRECTORY_PAGE_SIZE,
        });
        for (const name of page.entries) {
            if (options.showHidden !== true && name.startsWith(".")) continue;
            totalEntries += 1;
            if (shown.length < options.maxEntries) shown.push(name);
        }
        after = page.entries.at(-1);
        if (!page.hasMore || after === undefined) break;
        if (totalEntries >= MAX_COUNTED_ENTRIES) {
            countIncomplete = true;
            break;
        }
    }
    const stats = await compute.fs.lstatMany(
        permissions,
        shown.map((name) => joinComputePath(directory, name)),
    );
    return {
        path: directory,
        entries: shown.map((name, index) =>
            stats[index]?.isDirectory === true ? `${name}/` : name,
        ),
        totalEntries,
        truncated: countIncomplete || totalEntries > shown.length,
    };
}
