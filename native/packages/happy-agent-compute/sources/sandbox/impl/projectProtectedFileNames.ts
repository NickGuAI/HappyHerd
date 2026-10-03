import { dirname, isAbsolute } from "node:path";

import type { ComputeHostPolicy } from "../../ComputeHostPolicy.js";

/** Root project files a restricted command must not create or modify. */
export function projectProtectedFileNames(hostPolicy: ComputeHostPolicy = {}): readonly string[] {
    return [
        ...new Set([
            ...(hostPolicy.protectedProjectFiles ?? []),
            ...(hostPolicy.networkPolicyFiles ?? []),
        ]),
    ].map(assertProjectFileName);
}

/** Root project files whose contents can grant later commands network access. */
export function projectNetworkPolicyFileNames(
    hostPolicy: ComputeHostPolicy = {},
): readonly string[] {
    return [...new Set(hostPolicy.networkPolicyFiles ?? [])].map(assertProjectFileName);
}

function assertProjectFileName(name: string): string {
    if (
        name.length === 0 ||
        isAbsolute(name) ||
        dirname(name) !== "." ||
        name === "." ||
        name === ".."
    ) {
        throw new Error(`Host project policy file '${name}' must be a root file name.`);
    }
    return name;
}
