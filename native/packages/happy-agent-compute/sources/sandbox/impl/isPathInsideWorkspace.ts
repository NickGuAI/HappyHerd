import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { resolvePotentialPath } from "./resolvePotentialPath.js";

export async function isPathInsideWorkspace(
    cwd: string,
    path: string,
    resolveCanonicalPath?: (path: string) => Promise<string>,
): Promise<boolean> {
    try {
        const root =
            resolveCanonicalPath === undefined
                ? await realpath(cwd)
                : await resolveCanonicalPath(cwd);
        const target =
            resolveCanonicalPath === undefined
                ? isAbsolute(path)
                    ? path
                    : resolve(cwd, path)
                : path;
        const canonicalTarget =
            resolveCanonicalPath === undefined
                ? await resolvePotentialPath(target)
                : await resolveCanonicalPath(target);
        if (canonicalTarget === root) return true;
        const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
        const prefix = root.endsWith(separator) ? root : `${root}${separator}`;
        return canonicalTarget.startsWith(prefix);
    } catch {
        return false;
    }
}
