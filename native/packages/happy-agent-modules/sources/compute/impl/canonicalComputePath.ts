import type { ComputeFileSystem, ComputePermissions } from "../Compute.js";
import { basenameComputePath, joinComputePath, parentComputePath } from "./resolveComputePath.js";

/** How many not-yet-existing directories a path may name before it stops being a near miss. */
const MAX_UNRESOLVED_DEPTH = 64;

/**
 * Where a path really leads, with every symbolic link on the way followed.
 *
 * A boundary drawn on the written path alone is not a boundary: a link inside the workspace can
 * name anything on the machine, and a write through it would look like a write to the workspace.
 * A path that does not exist yet cannot be resolved at all, so the nearest directory above it
 * that does exist is resolved instead and the missing names are put back on the end — which is
 * exactly the case of creating a file, or a small tree of them, inside a directory that is itself
 * a link out. When not one directory on the way up can be resolved, nothing is known about where
 * the path leads, and answering with the written path would dress a guess up as a resolution.
 * Nothing comes back instead, and the caller decides what an unresolvable path means to it.
 */
export async function canonicalComputePath(
    fs: ComputeFileSystem,
    permissions: ComputePermissions,
    path: string,
): Promise<string | undefined> {
    const missing: string[] = [];
    let current = path;
    for (let depth = 0; depth <= MAX_UNRESOLVED_DEPTH; depth += 1) {
        try {
            const resolved = await fs.realpath(permissions, current);
            return missing.reduce(
                (canonical, segment) => joinComputePath(canonical, segment),
                resolved,
            );
        } catch {
            // This part of the path does not exist yet, which is ordinary for something about to
            // be created; where its parent leads still answers the question.
        }
        const parent = parentComputePath(current);
        if (parent === current) return undefined;
        missing.unshift(basenameComputePath(current));
        current = parent;
    }
    return undefined;
}
