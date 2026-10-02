import { posix } from "node:path";

import { EMPTY_COMPUTE_HOST_POLICY, type ComputeHostPolicy } from "../../ComputeHostPolicy.js";
import { assertComputePermissions, type ComputePermissions } from "../../ComputePermissions.js";
import { dockerProtectedProjectFileNames } from "./resolveDockerHostPolicy.js";

/**
 * Decides whether a write may touch a container path, and returns the absolute target it names.
 *
 * The boundary is the same one every backend enforces, evaluated in the container's own paths:
 * read-only refuses every write, explicit denials always win, and workspace-write and auto allow
 * the working directory plus explicitly granted roots. Full access allows everything, since a
 * permission that both claims full access and denies something is refused before it reaches here.
 * Paths are resolved inside the container so a symlink cannot disguise either a grant or a denial.
 * Git control files remain protected outside Full access because a restricted command must never
 * rewrite the repository's own history or hooks.
 */
export async function assertDockerWritePath(
    cwd: string,
    path: string,
    permissions: ComputePermissions,
    resolvePath: (target: string) => Promise<string>,
    hostPolicy: ComputeHostPolicy = EMPTY_COMPUTE_HOST_POLICY,
    privateVariablePaths: readonly string[] = [],
): Promise<string> {
    assertComputePermissions(permissions);
    const target = posix.resolve(cwd, path);
    const hostDeniedPaths =
        permissions.mode === "full_access"
            ? []
            : [
                  ...(hostPolicy.privateDirectories ?? []),
                  ...privateVariablePaths,
                  ...(hostPolicy.readableDirectories ?? []),
                  ...dockerProtectedProjectFileNames(hostPolicy).map((name) =>
                      posix.join(cwd, name),
                  ),
              ];
    const deniedPaths = [...(permissions.deniedWritePaths ?? []), ...hostDeniedPaths];
    if (deniedPaths.length === 0) {
        if (permissions.mode === "full_access") return target;
        if (permissions.mode === "read_only") {
            throw new Error("File changes are disabled in read-only mode.");
        }
    }
    const canonicalTarget = await resolvePath(target);
    if (await matchesAnyPath(cwd, target, canonicalTarget, deniedPaths, resolvePath)) {
        throw new Error(`Writing '${target}' is denied by this operation's permissions.`);
    }
    if (permissions.mode === "full_access") return target;
    if (permissions.mode === "read_only") {
        throw new Error("File changes are disabled in read-only mode.");
    }

    const canonicalCwd = await resolvePath(posix.resolve(cwd));
    const insideWorkspace = isAtOrBelow(canonicalCwd, canonicalTarget);
    const explicitlyAllowed = await matchesAnyPath(
        cwd,
        target,
        canonicalTarget,
        permissions.allowedWritePaths ?? [],
        resolvePath,
    );
    if (!insideWorkspace && !explicitlyAllowed) {
        throw new Error(
            `Workspace write mode cannot modify files outside the working directory: ${cwd}.`,
        );
    }
    if (
        [target, canonicalTarget].some((candidate) =>
            candidate
                .split("/")
                .some((part) => [".git", ".gitconfig", ".gitmodules"].includes(part.toLowerCase())),
        )
    ) {
        throw new Error(
            "Workspace write mode cannot modify Git control files without Full access.",
        );
    }
    return target;
}

async function matchesAnyPath(
    cwd: string,
    target: string,
    canonicalTarget: string,
    paths: readonly string[],
    resolvePath: (target: string) => Promise<string>,
): Promise<boolean> {
    for (const path of paths) {
        const candidate = posix.resolve(cwd, path);
        if (isAtOrBelow(candidate, target)) return true;
        if (isAtOrBelow(await resolvePath(candidate), canonicalTarget)) return true;
    }
    return false;
}

function isAtOrBelow(root: string, target: string): boolean {
    const relative = posix.relative(root, target);
    return relative === "" || (relative !== ".." && !relative.startsWith("../"));
}
