import { posix } from "node:path";

import type { DockerEnvironment } from "../DockerEnvironment.js";
import { runDockerExec } from "./runDockerExec.js";

/**
 * Canonicalizes an absolute container path, resolving symlinks in its existing prefix.
 *
 * `realpath -f` alone cannot canonicalize a path whose final components do not exist yet, which is
 * exactly the case for a write to a new file. This walks up to the deepest part that does exist,
 * canonicalizes that inside the container, and reattaches the missing suffix — so a symlinked
 * parent is followed while a not-yet-created leaf is preserved.
 */
export async function resolveDockerPath(
    environment: DockerEnvironment,
    target: string,
): Promise<string> {
    if (!posix.isAbsolute(target)) {
        throw new Error(`Docker paths must be absolute before resolution: '${target}'.`);
    }
    const result = await runDockerExec(await environment.container(), [
        "/bin/sh",
        "-c",
        'target=$1; suffix=; while [ ! -e "$target" ] && [ ! -L "$target" ]; do [ "$target" = / ] && break; name=${target##*/}; suffix="/$name$suffix"; target=${target%/*}; [ -n "$target" ] || target=/; done; resolved=$(readlink -f "$target") || exit 1; printf "%s%s" "$resolved" "$suffix"',
        "compute-path",
        target,
    ]);
    if (result.exitCode !== 0 || result.stdout.length === 0) {
        throw new Error(`Could not resolve '${target}' in the Docker container.`);
    }
    return posix.normalize(result.stdout.toString("utf8"));
}
