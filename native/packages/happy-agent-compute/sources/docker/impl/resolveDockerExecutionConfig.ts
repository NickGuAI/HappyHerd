import { isAbsolute, resolve } from "node:path";

import type { DockerExecutionConfig, DockerMountConfig } from "../DockerExecutionConfig.js";

/**
 * Normalizes a Docker configuration's mounts and adds caller-owned reserved mounts.
 *
 * Mount sources are resolved against the host working directory so a relative source in a saved
 * configuration keeps meaning what the user meant. Reserved mounts only apply when this backend
 * creates the container, since an existing container keeps whatever mounts it was started with.
 * Their host source and container destination both come from the caller; the compute package does
 * not reserve product-specific container paths.
 */
export function resolveDockerExecutionConfig(
    config: DockerExecutionConfig,
    hostCwd: string,
    reservedMounts: readonly DockerMountConfig[] = [],
): DockerExecutionConfig {
    if (config.container !== undefined) return { ...config };
    const mounts = [...(config.mounts ?? []), ...reservedMounts].map((mount) => ({
        ...mount,
        source: isAbsolute(mount.source) ? mount.source : resolve(hostCwd, mount.source),
    }));
    return mounts.length === 0 ? { ...config } : { ...config, mounts };
}
