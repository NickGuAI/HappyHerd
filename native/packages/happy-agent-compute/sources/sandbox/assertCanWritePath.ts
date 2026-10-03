import { basename, isAbsolute, resolve } from "node:path";

import { isPathInsideWorkspace } from "./impl/isPathInsideWorkspace.js";
import { isProtectedGitControlPath } from "./impl/isProtectedGitControlPath.js";
import { isProtectedProjectConfigPath } from "./impl/isProtectedProjectConfigPath.js";
import { resolvePotentialPath } from "./impl/resolvePotentialPath.js";
import { isProtectedPath } from "./impl/isProtectedPath.js";
import { createHostPolicyPrivatePaths } from "./impl/createHostPolicyPrivatePaths.js";
import type { ComputeHostPolicy } from "../ComputeHostPolicy.js";
import { assertComputePermissions, type ComputePermissions } from "../ComputePermissions.js";

export async function assertCanWritePath(
    cwd: string,
    targetPath: string,
    permissions: ComputePermissions,
    hostPolicy: ComputeHostPolicy = {},
    options: { environment?: NodeJS.ProcessEnv } = {},
): Promise<void> {
    assertComputePermissions(permissions);
    const absoluteTarget = isAbsolute(targetPath) ? targetPath : resolve(cwd, targetPath);
    const canonicalTarget = await resolvePotentialPath(absoluteTarget);
    const deniedPaths = [
        ...(permissions.deniedWritePaths ?? []),
        ...createHostPolicyPrivatePaths(hostPolicy, options.environment ?? process.env),
    ];
    if (
        isProtectedPath(absoluteTarget, deniedPaths) ||
        (await isCanonicalPathProtected(cwd, canonicalTarget, deniedPaths))
    ) {
        throw new Error(`Permission boundary blocks modifying the denied path: ${targetPath}.`);
    }
    if (permissions.mode === "full_access") return;
    if (permissions.mode === "read_only") {
        throw new Error("File changes are disabled in read-only mode.");
    }

    const canonicalCwd = await resolvePotentialPath(cwd);
    if (
        isProtectedProjectConfigPath(cwd, absoluteTarget, hostPolicy) ||
        isProtectedProjectConfigPath(canonicalCwd, canonicalTarget, hostPolicy)
    ) {
        throw new Error(
            `Workspace write mode cannot modify the protected project file ${basename(absoluteTarget)}.`,
        );
    }
    if (isProtectedGitControlPath(absoluteTarget) || isProtectedGitControlPath(canonicalTarget)) {
        throw new Error(
            "Workspace write mode cannot modify Git control files without Full access.",
        );
    }
    if (
        (await isPathInsideWorkspace(cwd, absoluteTarget)) ||
        (await isAllowedWritePath(cwd, absoluteTarget, canonicalTarget, permissions))
    ) {
        return;
    }
    throw new Error(
        `Workspace write mode cannot modify files outside the working directory: ${cwd}.`,
    );
}

async function isAllowedWritePath(
    cwd: string,
    absoluteTarget: string,
    canonicalTarget: string,
    permissions: ComputePermissions,
): Promise<boolean> {
    for (const allowedPath of permissions.allowedWritePaths ?? []) {
        const absoluteAllowedPath = isAbsolute(allowedPath)
            ? allowedPath
            : resolve(cwd, allowedPath);
        if (isProtectedPath(absoluteTarget, [absoluteAllowedPath])) return true;
        const canonicalAllowedPath = await resolvePotentialPath(absoluteAllowedPath);
        if (isProtectedPath(canonicalTarget, [canonicalAllowedPath])) return true;
    }
    return false;
}

async function isCanonicalPathProtected(
    cwd: string,
    canonicalTarget: string,
    deniedPaths: readonly string[],
): Promise<boolean> {
    for (const deniedPath of deniedPaths) {
        const absoluteDeniedPath = isAbsolute(deniedPath) ? deniedPath : resolve(cwd, deniedPath);
        if (isProtectedPath(canonicalTarget, [await resolvePotentialPath(absoluteDeniedPath)])) {
            return true;
        }
    }
    return false;
}
