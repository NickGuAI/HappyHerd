import { posix } from "node:path";

import { EMPTY_COMPUTE_HOST_POLICY, type ComputeHostPolicy } from "../../ComputeHostPolicy.js";
import { assertComputePermissions, type ComputePermissions } from "../../ComputePermissions.js";

/**
 * Resolves a read path against the container working directory and refuses explicit denials.
 *
 * Reads follow Codex: a restricted command may inspect the whole container filesystem, including a
 * user's private files, so modes do not otherwise narrow the boundary. Both the spelling and the
 * canonical destination are checked so a symlink cannot enter a denied tree.
 */
export async function assertDockerReadPath(
    cwd: string,
    path: string,
    permissions: ComputePermissions,
    resolvePath: (target: string) => Promise<string>,
    hostPolicy: ComputeHostPolicy = EMPTY_COMPUTE_HOST_POLICY,
    privateVariablePaths: readonly string[] = [],
): Promise<string> {
    assertComputePermissions(permissions);
    const target = posix.resolve(cwd, path);
    const deniedPaths = [
        ...(permissions.deniedReadPaths ?? []),
        ...(permissions.mode === "full_access"
            ? []
            : [...(hostPolicy.privateDirectories ?? []), ...privateVariablePaths]),
    ];
    if (deniedPaths.length === 0) return target;
    const canonicalTarget = await resolvePath(target);
    for (const deniedPath of deniedPaths) {
        const deniedTarget = posix.resolve(cwd, deniedPath);
        const canonicalDeniedTarget = await resolvePath(deniedTarget);
        if (
            isAtOrBelow(deniedTarget, target) ||
            isAtOrBelow(canonicalDeniedTarget, canonicalTarget)
        ) {
            throw new Error(`Reading '${target}' is denied by this operation's permissions.`);
        }
    }
    return target;
}

function isAtOrBelow(root: string, target: string): boolean {
    const relative = posix.relative(root, target);
    return relative === "" || (relative !== ".." && !relative.startsWith("../"));
}
