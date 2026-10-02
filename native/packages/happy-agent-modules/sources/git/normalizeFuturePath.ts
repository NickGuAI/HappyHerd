import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { normalizeProjectCwd } from "./normalizeProjectCwd.js";

/**
 * Canonicalizes as much of a path as already exists.
 *
 * Managed folders are named before they are created, so the usual canonical form is unavailable.
 * Resolving the deepest existing ancestor and re-appending the missing segments gives a path that
 * compares equal to the one the folder will have once it is there.
 */
export function normalizeFuturePath(path: string): string {
    const missingSegments: string[] = [];
    let existingAncestor = resolve(path);
    while (!existsSync(existingAncestor)) {
        const parent = dirname(existingAncestor);
        if (parent === existingAncestor) break;
        missingSegments.unshift(basename(existingAncestor));
        existingAncestor = parent;
    }
    return resolve(normalizeProjectCwd(existingAncestor), ...missingSegments);
}
