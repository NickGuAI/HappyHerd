import { resolve } from "node:path";

import type { ComputeHostPolicy } from "../../ComputeHostPolicy.js";
import { projectProtectedFileNames } from "./projectProtectedFileNames.js";

export function isProtectedProjectConfigPath(
    cwd: string,
    targetPath: string,
    hostPolicy: ComputeHostPolicy = {},
): boolean {
    const requestedPath = resolve(targetPath);
    return projectProtectedFileNames(hostPolicy).some(
        (name) => requestedPath === resolve(cwd, name),
    );
}
