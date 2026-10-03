import { isAbsolute, relative, resolve } from "node:path";

import { createSensitiveReadPaths } from "./impl/createSensitiveReadPaths.js";
import { createHostPolicyPrivatePaths } from "./impl/createHostPolicyPrivatePaths.js";
import { isPathInsideWorkspace } from "./impl/isPathInsideWorkspace.js";
import { isProtectedPath } from "./impl/isProtectedPath.js";
import { resolvePotentialPath } from "./impl/resolvePotentialPath.js";
import type { ComputeHostPolicy } from "../ComputeHostPolicy.js";
import { assertComputePermissions, type ComputePermissions } from "../ComputePermissions.js";

export async function assertCanReadPath(
    cwd: string,
    targetPath: string,
    permissions: ComputePermissions,
    hostPolicy: ComputeHostPolicy = {},
    options: {
        environment?: NodeJS.ProcessEnv;
        homeDirectory?: string;
        platform?: NodeJS.Platform;
    } = {},
): Promise<void> {
    assertComputePermissions(permissions);
    const absoluteTarget = isAbsolute(targetPath) ? targetPath : resolve(cwd, targetPath);
    const canonicalTarget = await resolvePotentialPath(absoluteTarget);
    const policyPrivatePaths = createHostPolicyPrivatePaths(
        hostPolicy,
        options.environment ?? process.env,
    );
    const deniedPaths = [...(permissions.deniedReadPaths ?? []), ...policyPrivatePaths];
    if (
        isProtectedPath(absoluteTarget, deniedPaths) ||
        (await isCanonicalPathProtected(cwd, canonicalTarget, deniedPaths))
    ) {
        throw new Error(`Permission boundary blocks reading the denied path: ${targetPath}.`);
    }
    if (permissions.mode === "full_access" || (await isPathInsideWorkspace(cwd, absoluteTarget))) {
        return;
    }
    const platform = options.platform ?? process.platform;
    if (platform === "darwin" || platform === "linux") return;

    for (const allowedPath of [
        ...(permissions.allowedReadPaths ?? []),
        ...(hostPolicy.readableDirectories ?? []),
    ]) {
        const canonicalAllowedPath = await resolvePotentialPath(
            isAbsolute(allowedPath) ? allowedPath : resolve(cwd, allowedPath),
        );
        const pathFromAllowedRoot = relative(canonicalAllowedPath, canonicalTarget);
        if (
            pathFromAllowedRoot === "" ||
            (!pathFromAllowedRoot.startsWith("..") && !isAbsolute(pathFromAllowedRoot))
        ) {
            return;
        }
    }
    for (const sensitivePath of createSensitiveReadPaths({ ...options, hostPolicy })) {
        const canonicalSensitivePath = await resolvePotentialPath(sensitivePath);
        const pathFromSensitiveRoot = relative(canonicalSensitivePath, canonicalTarget);
        if (
            pathFromSensitiveRoot === "" ||
            (!pathFromSensitiveRoot.startsWith("..") && !isAbsolute(pathFromSensitiveRoot))
        ) {
            throw new Error(
                `Restricted permissions block reading private files outside the workspace: ${targetPath}. Select Full access only if you intend to expose this data to the model.`,
            );
        }
    }
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
