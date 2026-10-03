import { isProtectedGitControlPath } from "@slopus/happy-agent-compute";
import type { Context } from "@steve.kite/stdlib";

import type { Compute } from "../Compute.js";
import { computePermissionsForContext } from "./computePermissionsForContext.js";
import { canonicalComputePath } from "./canonicalComputePath.js";
import { isProtectedComputePath, projectProtectedComputePaths } from "./isProtectedComputePath.js";
import { isPathInside, resolveComputePath } from "./resolveComputePath.js";

/**
 * Whether one file operation is something Auto has to decide on rather than simply allow.
 *
 * Work inside the workspace is what the agent is for, so it passes without a reviewer. What
 * leaves the workspace does not: reading somewhere else on the machine, writing somewhere else,
 * or changing a path the compute protects. Both the written path and the path it really leads to
 * are weighed, so a link pointing out of the workspace is reviewed like the outside path it is.
 * A path that cannot be resolved at all is reviewed rather than guessed at.
 */
export async function shouldReviewComputePath(
    compute: Compute,
    path: string,
    options: { write: boolean },
    ctx: Context,
): Promise<boolean> {
    let resolvedPath: string;
    try {
        resolvedPath = resolveComputePath(path, compute.cwd, compute.fs.home);
    } catch {
        return true;
    }
    if (!isPathInside(compute.cwd, resolvedPath)) return true;
    const permissions = computePermissionsForContext(ctx);
    const canonicalRoot = await canonicalComputePath(compute.fs, permissions, compute.cwd);
    const canonicalTarget = await canonicalComputePath(compute.fs, permissions, resolvedPath);
    if (canonicalRoot === undefined || canonicalTarget === undefined) return true;
    if (!isPathInside(canonicalRoot, canonicalTarget)) return true;
    if (
        options.write &&
        (isProtectedComputePath(resolvedPath, projectProtectedComputePaths(compute.cwd)) ||
            isProtectedComputePath(canonicalTarget, projectProtectedComputePaths(canonicalRoot)) ||
            isProtectedGitControlPath(resolvedPath) ||
            isProtectedGitControlPath(canonicalTarget))
    ) {
        return true;
    }
    return false;
}
